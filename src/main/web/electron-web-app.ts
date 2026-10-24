import { join } from "node:path";
import { app, BrowserWindow, WebContentsView, clipboard, components, session } from "electron";
import type { Confirmation, PromptId, TrackKind } from "../../shared/protocol.ts";
import { SCREEN_KEYS, textEditFor } from "../../shared/keyboard.ts";
import { revealScreen } from "../reveal.ts";
import type { YouTube, YouTubeEvent, YouTubeKey } from "../ports/youtube.ts";
import { BlankGuard, backIsSafe } from "./blank-guard.ts";
import { HiddenAudio } from "./hidden-audio.ts";
import { keyBelongsToField } from "./field-keys.ts";
import {
  BACK_QUERY,
  FIELD_BLURRED,
  FIELD_FOCUSED,
  backAction,
  pageFocusFunction,
  typeIntoFieldScript,
} from "./page-focus.ts";
import { PAGE_HOOKS_FUNCTION } from "./page-hooks.ts";
import { requestHooksFor, type RequestHooks } from "./request-hooks.ts";
import { HIDE_SCROLLBARS_CSS } from "./hide-scrollbars.ts";
import { SessionPreloads } from "./session-preloads.ts";
import type { IdleLifecycle } from "./idle-unload.ts";
import { drmGate } from "./drm-gate.ts";
import {
  composeReport,
  playbackProbe,
  skipTarget,
  sameReport,
  type PlaybackReport,
  type TrackReport,
} from "./playback.ts";
import { seekPlan } from "./seek-plan.ts";
import type { WebAppDescription, WebIdentity } from "./web-app.ts";
import {
  CONFIRM_MESSAGE,
  confirmScript,
  noteScript,
  searchBarScript,
  volumeScript,
} from "./web-hud.ts";
import {
  allowsPermission,
  LIST_OUTPUTS_SCRIPT,
  pickOutputId,
  SOUND_RECHECK,
  soundScript,
  type PageOutput,
} from "./web-sound.ts";

const TRACKS_EVERY_MS = 2000;

/** Asked first about every physical key on the page; true means it was handled. */
export type KeyGate = (
  event: { preventDefault(): void },
  input: { type: string; key: string; meta?: boolean; control?: boolean; alt?: boolean },
) => boolean;

/** The web-App host: one persistent, always-loaded view over the Screen window, described by `desc`. */
export class ElectronWebApp implements YouTube {
  #desc: WebAppDescription;
  #win: BrowserWindow;
  #view!: WebContentsView;
  #listeners = new Set<(event: YouTubeEvent) => void>();
  #visible = false;
  #failed = false;
  #started = false;
  /** The App's home has been asked for (after the DRM gate); a blank page before that is just not loaded yet. */
  #loadIssued = false;
  #unloaded = false;
  #identityApplied = false;
  #lifecycle: IdleLifecycle | undefined;
  #sending = false;
  #capturing = false;
  /** A text field in the page has focus: keys on the Mac keyboard are its, not Couch commands. */
  #fieldFocused = false;
  #inSearch = false;
  #skipTimer: ReturnType<typeof setTimeout> | undefined;
  #lastSkipAt = 0;
  #page: unknown;
  #routes: ReturnType<WebAppDescription["route"]["tracker"]>;
  #report: PlaybackReport | undefined;
  #probing = false;
  #tracks: TrackReport | undefined;
  #tracksAt = 0;
  #routeTimer: ReturnType<typeof setInterval> | undefined;
  #volume = 60;
  #keyGate?: KeyGate;
  #sinkId = "";
  /** The output the household wants (by name), looked for whenever the page could have it. */
  #wanted: string | undefined;
  #enumerating = false;
  #resolving: Promise<boolean> | undefined;
  #again = false;
  #ready = false;
  #silence!: HiddenAudio;
  #guard!: BlankGuard;
  #hooks: RequestHooks;
  #preloads: SessionPreloads;
  #addonRequests: Array<() => void> = [];

  constructor(desc: WebAppDescription, win: BrowserWindow, lifecycle?: IdleLifecycle) {
    this.#lifecycle = lifecycle;
    this.#desc = desc;
    this.#win = win;
    this.#page = desc.route.idle;
    this.#routes = desc.route.tracker();
    const ses = session.fromPartition(desc.partition);
    ses.setUserAgent(desc.identity.userAgent);
    const hooks = requestHooksFor(ses);
    // The identity comes first so every later handler sees (and keeps) its headers.
    hooks.onBeforeSendHeaders((details) =>
      desc.identity.headersFor(new URL(details.url), details.requestHeaders),
    );
    // The view may ask the Mac for nothing (no microphone, no camera). Its media permission *check*
    // is answered yes only for the App's own origin, and only for what choosing an output needs.
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler((_wc, permission, origin) => {
      return allowsPermission(permission, origin, this.#enumerating, (o) => desc.isOwnOrigin(o));
    });
    this.#hooks = hooks;
    this.#preloads = new SessionPreloads(ses, join(app.getPath("userData"), desc.id), desc.id);
    this.#applyAddons(desc.enabledAddons);
    this.#createView();
    win.on("resize", () => this.#fit());
  }

  /** A fresh view (and renderer) over the Screen window; its listeners are Couch's for the host. */
  #createView(): void {
    this.#view = new WebContentsView({
      webPreferences: {
        session: session.fromPartition(this.#desc.partition),
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false,
        autoplayPolicy: "no-user-gesture-required",
      },
    });
    this.#view.setVisible(false);
    this.#win.contentView.addChildView(this.#view);
    this.#identityApplied = false;

    const wc = this.#view.webContents;
    this.#silence = new HiddenAudio(wc);
    this.#guard = new BlankGuard(wc, () => this.#load());
    wc.setUserAgent(this.#desc.identity.userAgent);
    wc.on("did-finish-load", () => {
      if (this.#failed || !wc.getURL().startsWith("https:")) return;
      this.#guard.loaded();
      this.#emit({ type: "loaded" });
      this.#syncRoute();
      this.#ready = true;
      void this.#resolveOutput();
    });
    wc.on("console-message", (event) => {
      const message = (event as { message?: string }).message;
      if (message === SOUND_RECHECK) void this.#resolveOutput();
      if (message === FIELD_FOCUSED) this.#fieldFocused = true;
      const pick = message === undefined ? undefined : CONFIRM_MESSAGE.exec(message);
      if (pick)
        this.#emit({ type: "confirm", index: Number(pick[2]), answer: pick[1] === undefined });
      if (message === FIELD_BLURRED) this.#fieldFocused = false;
    });
    // A new document has none of Couch's volume or output yet.
    wc.on("dom-ready", () => {
      // A style the page itself adds doesn't beat the site's own rules; Chromium's inserted CSS does.
      if (this.#desc.hideScrollbars) void wc.insertCSS(HIDE_SCROLLBARS_CSS).catch(() => {});
      void this.#applySound();
      if (!this.#visible) this.#silence.hide();
    });
    wc.on("did-start-navigation", (_e, _url, _inPlace, isMainFrame) => {
      if (isMainFrame) this.#fieldFocused = false;
    });
    wc.on("did-navigate", (_e, url) => this.#guard.navigated(url));
    wc.on("render-process-gone", () => {
      this.#guard.crashed();
      if (this.#visible) void this.#guard.onShow();
    });
    wc.on("did-fail-load", (_e, code, _desc, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      this.#failed = true;
      this.#emit({ type: "failed" });
    });
    wc.on("before-input-event", (event, input) => {
      if (this.#sending) return;
      if (this.#keyGate?.(event, input)) return;
      if (this.#capturing) {
        event.preventDefault();
        if (input.type !== "keyDown") return;
        const edit = textEditFor({
          key: input.key,
          meta: input.meta,
          ctrl: input.control,
          alt: input.alt,
        });
        if (edit && "paste" in edit) {
          void Promise.resolve(clipboard.readText()).then((text) => {
            if (text) this.#emit({ type: "edit", edit: { insert: text } });
          });
          return;
        }
        if (edit) this.#emit({ type: "edit", edit });
        return;
      }
      if (this.#fieldFocused && keyBelongsToField({ key: input.key, meta: input.meta })) return;
      if (input.type === "keyDown" && !input.control && !input.alt) {
        const find = input.meta ? input.key.toLowerCase() === "f" : input.key === "/";
        if (find) {
          event.preventDefault();
          this.#emit({ type: "find" });
          return;
        }
      }
      const command = SCREEN_KEYS[input.key];
      if (!command || input.control || input.meta || input.alt) return;
      event.preventDefault();
      if (input.type === "keyDown") this.#emit({ type: "key", command });
    });
    const route = (_e: unknown, url: string) => {
      if (!url.startsWith("https:")) return;
      this.#syncRoute();
      const searching = this.#desc.search?.isSearchUrl(url) ?? false;
      const entering = searching && !this.#inSearch;
      this.#inSearch = searching;
      // Only arriving at search counts; Couch's own query updates also change the route.
      if (entering) setTimeout(() => this.#emit({ type: "searchOpened" }), 400);
    };
    wc.on("did-navigate", route);
    wc.on("did-navigate-in-page", route);
  }

  /** Tells the core whether YouTube is on its home screen (a Short keeps Home's URL, so the page is asked too). */
  #syncRoute(): void {
    const route = this.#routes.update(this.#view.webContents.getURL(), this.#page);
    if (route) this.#emit({ type: "route", ...route });
  }

  #pollPage(): void {
    this.#pollPlayback();
    void this.#view.webContents
      .executeJavaScript(this.#desc.route.script)
      .then((page: unknown) => {
        this.#page = page;
        this.#syncRoute();
      })
      .catch(() => {});
  }

  /** Reads the page's playing video; tracks come from the adapter, asked at most every 2 s. */
  #pollPlayback(): void {
    if (this.#probing || !this.#visible) return;
    const adapter = this.#desc.playback;
    const now = Date.now();
    const askTracks = !!adapter?.tracks && now - this.#tracksAt >= TRACKS_EVERY_MS;
    this.#probing = true;
    void this.#view.webContents
      .executeJavaScript(
        playbackProbe({
          tracks: askTracks ? adapter!.tracks!() : undefined,
          active: adapter?.active?.(),
          speeds: adapter?.speeds,
          artwork: adapter?.artwork?.(),
          prompt: adapter?.prompt?.(),
        }),
      )
      .then((found: PlaybackReport | undefined) => {
        if (!this.#visible) return;
        if (askTracks) {
          this.#tracksAt = now;
          this.#tracks = found?.tracks as TrackReport | undefined;
        }
        this.#reportPlayback(
          composeReport(found, this.#tracks, !!adapter?.seek, this.#desc.artworkHosts),
        );
      })
      .catch(() => this.#reportPlayback(undefined))
      .finally(() => {
        this.#probing = false;
      });
  }

  #reportPlayback(next: PlaybackReport | undefined): void {
    if (sameReport(this.#report, next)) return;
    this.#report = next;
    this.#emit({ type: "playback", playback: next });
  }

  seekTo(seconds: number): void {
    const script = this.#desc.playback?.seek?.(seconds);
    if (script) void this.#view.webContents.executeJavaScript(script).catch(() => {});
  }

  pressPrompt(id: PromptId): void {
    const script = this.#desc.playback?.pressPrompt?.(id);
    if (script) void this.#view.webContents.executeJavaScript(script).catch(() => {});
  }

  setSpeed(speed: number): void {
    const script = this.#desc.playback?.setSpeed?.(speed);
    if (script) void this.#view.webContents.executeJavaScript(script).catch(() => {});
  }

  setTrack(kind: TrackKind, id: string): void {
    const script = this.#desc.playback?.setTrack?.(kind, id);
    if (script) void this.#view.webContents.executeJavaScript(script).catch(() => {});
  }

  /** Starts loading in the background so opening YouTube is instant. */
  start(): void {
    this.#started = true;
    const wc = this.#view.webContents;
    // DevTools commands only answer once the view has a renderer, so give it a blank page first.
    void wc
      .loadURL("about:blank")
      .catch(() => {})
      // The identity must never hold YouTube back; load anyway if DevTools doesn't answer.
      .then(() => Promise.race([this.#identityOnce(wc), new Promise((r) => setTimeout(r, 3000))]))
      .then(() => drmGate(this.#desc, components))
      .then((gate) => {
        if (gate.ok) return this.#load();
        console.warn(`[web] ${this.#desc.id}: ${gate.note} ${gate.detail ?? ""}`.trim());
        this.#failed = true;
        this.#emit({ type: "failed", note: gate.note });
      });
  }

  #identityOnce(wc: Electron.WebContents): Promise<void> {
    if (this.#identityApplied) return Promise.resolve();
    this.#identityApplied = true;
    return applyIdentity(wc, this.#desc.identity);
  }

  /** Drops the loaded page (the session stays on disk); the next `show()` loads the App again at its home. */
  unload(): void {
    if (this.#visible || !this.#started) return;
    this.#started = false;
    this.#loadIssued = false;
    this.#unloaded = true;
    this.#failed = false;
    this.#ready = false;
    this.#fieldFocused = false;
    this.#inSearch = false;
    this.#page = this.#desc.route.idle;
    this.#routes = this.#desc.route.tracker();
    // A blank page keeps its renderer, so the whole view goes; the next one starts without a process.
    const old = this.#view;
    this.#win.contentView.removeChildView(old);
    old.webContents.close();
    this.#createView();
    this.#emit({ type: "route", home: true });
  }

  #load(): void {
    this.#failed = false;
    this.#loadIssued = true;
    void this.#view.webContents
      .loadURL(this.#desc.url, { userAgent: this.#desc.identity.userAgent })
      .catch(() => {});
  }

  #emit(event: YouTubeEvent): void {
    for (const l of [...this.#listeners]) l(event);
  }

  #fit(): void {
    if (!this.#visible) return;
    const { width, height } = this.#win.getContentBounds();
    this.#view.setBounds({ x: 0, y: 0, width, height });
  }

  show(note?: string): void {
    if ((this.#desc.loadOnShow || this.#unloaded) && !this.#started) this.start();
    else if (this.#loadIssued) void this.#guard.onShow();
    this.#lifecycle?.shown();
    this.#visible = true;
    this.#routeTimer ??= setInterval(() => this.#pollPage(), 400);
    this.#fit();
    this.#view.setVisible(true);
    this.#silence.show();
    void revealScreen(this.#win).then(() => this.#view.webContents.focus());
    if (note) void this.#showNote(note);
  }

  hide(): void {
    this.#visible = false;
    this.#tracks = undefined;
    this.#tracksAt = 0;
    this.#reportPlayback(undefined);
    clearInterval(this.#routeTimer);
    this.#routeTimer = undefined;
    this.#silence.hide();
    this.#view.setVisible(false);
    this.#win.webContents.focus();
    this.#lifecycle?.hidden();
  }

  /** Asked first about every physical key; true means it was handled (Picture off swallows keys here). */
  setKeyGate(gate: KeyGate): void {
    this.#keyGate = gate;
  }

  showVolume(percent: number | undefined): void {
    void this.#view.webContents.executeJavaScript(volumeScript(percent)).catch(() => {});
  }

  setVolume(percent: number): void {
    this.#volume = percent;
    void this.#applySound();
  }

  /** Puts Couch's volume and the resolved output on the page's media; false when an element refused the output. */
  async #applySound(): Promise<boolean> {
    try {
      const pending = this.#wanted !== undefined && this.#sinkId === "";
      return (await this.#view.webContents.executeJavaScript(
        soundScript(this.#volume, this.#sinkId, pending),
      )) as boolean;
    } catch {
      return false;
    }
  }

  async setOutputDevice(name: string | undefined): Promise<boolean> {
    this.#wanted = name;
    if (name === undefined) {
      this.#sinkId = "";
      await this.#applySound();
      return true;
    }
    // Before the page has loaded there is nothing to ask; the load looks again and reports.
    if (!this.#ready) return true;
    return this.#resolveOutput();
  }

  /** Looks for the wanted output in the page now; a request that arrives meanwhile runs once more after. */
  #resolveOutput(): Promise<boolean> {
    if (this.#resolving) {
      this.#again = true;
      return this.#resolving;
    }
    const run = async (): Promise<boolean> => {
      let ok = true;
      do {
        this.#again = false;
        ok = await this.#resolveOnce();
      } while (this.#again);
      return ok;
    };
    this.#resolving = run().finally(() => {
      this.#resolving = undefined;
    });
    return this.#resolving;
  }

  async #resolveOnce(): Promise<boolean> {
    const name = this.#wanted;
    if (name === undefined) return true;
    let found = false;
    try {
      this.#enumerating = true;
      const outputs = (await this.#view.webContents.executeJavaScript(
        LIST_OUTPUTS_SCRIPT,
      )) as PageOutput[];
      const pick = pickOutputId(name, outputs);
      this.#sinkId = "id" in pick ? pick.id : "";
      found = "id" in pick;
    } catch {
      this.#sinkId = "";
    } finally {
      this.#enumerating = false;
    }
    const applied = await this.#applySound();
    const ok = found && applied && this.#wanted === name;
    if (this.#wanted === name) this.#emit({ type: "output", name, ok });
    return ok;
  }

  async #showNote(note: string): Promise<void> {
    await this.#view.webContents.executeJavaScript(noteScript(note)).catch(() => {});
  }

  showConfirm(confirm: Confirmation | undefined): void {
    void this.#view.webContents.executeJavaScript(confirmScript(confirm)).catch(() => {});
  }

  sendKey(key: YouTubeKey): void {
    const keyCode = this.#desc.keyCodes[key];
    const wc = this.#view.webContents;
    if (key === "back" && this.#desc.backByHistory) {
      // The player's bar and a pop-up close the site's own way (its Escape, or the page hiding the bar); history back is for the player and pages Couch doesn't know.
      void wc
        .executeJavaScript(BACK_QUERY)
        .catch(() => "")
        .then((answer) => {
          const todo = backAction(answer);
          if (todo === "history") return this.#goBack();
          if (todo === "press") this.#press(keyCode);
          this.#emit({ type: "backHandled" });
        });
      return;
    }
    this.#press(keyCode);
  }

  #goBack(): void {
    // The blank page the view starts on is not somewhere to go back to.
    const history = this.#view.webContents.navigationHistory;
    if (!backIsSafe(history.getAllEntries(), history.getActiveIndex())) return;
    // The page's own history.back(): after Netflix pushes a page on top of a Back, the view's native goBack lands on the first (blank) entry.
    void this.#view.webContents.executeJavaScript("history.back()").catch(() => {});
  }

  #press(keyCode: string): void {
    const wc = this.#view.webContents;
    this.#sending = true;
    try {
      wc.sendInputEvent({ type: "keyDown", keyCode });
      wc.sendInputEvent({ type: "keyUp", keyCode });
    } finally {
      this.#sending = false;
    }
  }

  scrollToTop(): void {
    void this.#view.webContents
      .executeJavaScript("window.scrollTo({ top: 0, behavior: 'smooth' })")
      .catch(() => {});
  }

  playPause(): void {
    const wc = this.#view.webContents;
    const own = this.#desc.playback?.playPause;
    if (own) {
      void wc.executeJavaScript(own()).catch(() => {});
      return;
    }
    this.#press("MediaPlayPause");
  }

  /**
   * Skips by driving YouTube's own scrubber with keys (Left/Right, then OK after the last press).
   * j/l, media fast-forward keys and bare arrows do not seek in the TV player.
   */
  seekBy(seconds: number): void {
    const target = this.#desc.playback?.seek ? skipTarget(this.#report, seconds) : undefined;
    if (target !== undefined) return this.seekTo(target);
    // Keys for the player, not for Couch's focus layer (which would move its highlight over the bar).
    if (this.#desc.focus) {
      void this.#view.webContents
        .executeJavaScript(
          `window.__couchRawKeys && window.__couchRawKeys(${(this.#desc.skip?.commitMs ?? 0) + 1500})`,
        )
        .catch(() => {});
    }
    const now = Date.now();
    const skip = this.#desc.skip;
    const plan = seekPlan(
      this.#desc,
      seconds,
      now - this.#lastSkipAt < (skip?.controlsHideMs ?? 0),
    );
    for (const key of plan.keys) this.sendKey(key);
    if (!skip || !plan.commit) return;
    this.#lastSkipAt = now;
    clearTimeout(this.#skipTimer);
    this.#skipTimer = setTimeout(() => {
      this.sendKey("ok");
      this.#lastSkipAt = 0;
    }, skip.commitMs);
  }

  captureText(on: boolean): void {
    this.#capturing = on;
  }

  submitSearch(text: string): void {
    if (!this.#desc.search) return;
    // A field in the page that has focus (a sign-in form) is what the household is typing into.
    void this.#view.webContents
      .executeJavaScript(typeIntoFieldScript(text))
      .catch(() => false)
      .then((typed) => {
        if (typed === true) return this.#view.webContents.focus();
        this.#searchInstead(text);
      });
  }

  #searchInstead(text: string): void {
    // Going to search is Couch's own doing, not the household opening YouTube's search screen.
    this.#inSearch = true;
    this.#goToSearch(text);
    this.#view.webContents.focus();
  }

  showSearchBar(text: string | undefined): void {
    const search = this.#desc.search;
    if (!search) return;
    void this.#view.webContents
      .executeJavaScript(searchBarScript(text, search.placeholder))
      .catch(() => {});
  }

  #goToSearch(text: string): void {
    const wc = this.#view.webContents;
    const url = this.#desc.search!.urlFor(text);
    if (wc.getURL() === url) return;
    void wc.loadURL(url, { userAgent: this.#desc.identity.userAgent }).catch(() => {});
  }

  restart(): void {
    if (!this.#started) return this.start();
    this.#load();
  }

  /** The page hooks runtime, the App's own functions, then each enabled add-on's; request handlers follow the same set. */
  #applyAddons(ids: string[]): void {
    const on = this.#desc.addons.filter((a) => ids.includes(a.id));
    this.#preloads.set([
      { name: "Page hooks", func: PAGE_HOOKS_FUNCTION },
      ...this.#desc.preloads,
      ...(this.#desc.focus
        ? [
            {
              name: "Couch focus",
              func: pageFocusFunction(this.#desc.focus.selectors, this.#desc.focus.layout),
            },
          ]
        : []),
      ...on.flatMap((a) => (a.page ? [{ name: a.label, func: a.page }] : [])),
    ]);
    for (const off of this.#addonRequests.splice(0)) off();
    for (const a of on) {
      if (a.requests?.onBeforeRequest)
        this.#addonRequests.push(this.#hooks.onBeforeRequest(a.requests.onBeforeRequest));
      if (a.requests?.onBeforeSendHeaders)
        this.#addonRequests.push(this.#hooks.onBeforeSendHeaders(a.requests.onBeforeSendHeaders));
    }
  }

  setAddons(ids: string[], note?: string): void {
    this.#applyAddons(ids);
    const wc = this.#view.webContents;
    if (!wc.getURL().startsWith("https:")) return;
    if (note) wc.once("did-finish-load", () => void this.#showNote(note));
    wc.reload();
  }

  onEvent(listener: (event: YouTubeEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }
}

const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true };

/** Makes navigator.userAgent / userAgentData match the App's identity, in the page and its iframes. */
async function applyIdentity(wc: Electron.WebContents, identity: WebIdentity): Promise<void> {
  const dbg = wc.debugger;
  const override = { userAgent: identity.userAgent, userAgentMetadata: identity.metadata };
  try {
    if (!dbg.isAttached()) dbg.attach("1.3");
    dbg.on("message", (_e, method, params: any) => {
      if (method !== "Target.attachedToTarget") return;
      void (async () => {
        const { sessionId, targetInfo, waitingForDebugger } = params;
        try {
          if (targetInfo.type === "iframe") {
            await dbg.sendCommand("Emulation.setUserAgentOverride", override, sessionId);
            await dbg.sendCommand("Target.setAutoAttach", AUTO_ATTACH, sessionId);
          }
        } catch {
        } finally {
          if (waitingForDebugger)
            dbg.sendCommand("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {});
        }
      })();
    });
    await dbg.sendCommand("Emulation.setUserAgentOverride", override);
    await dbg.sendCommand("Target.setAutoAttach", AUTO_ATTACH);
  } catch (error) {
    console.warn(`[web] could not apply client-hint identity: ${String(error)}`);
  }
}
