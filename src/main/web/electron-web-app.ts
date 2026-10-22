import { join } from "node:path";
import { app, BrowserWindow, WebContentsView, clipboard, components, session } from "electron";
import type { Confirmation } from "../../shared/protocol.ts";
import { SCREEN_KEYS, textEditFor } from "../../shared/keyboard.ts";
import { revealScreen } from "../reveal.ts";
import type { YouTube, YouTubeEvent, YouTubeKey } from "../ports/youtube.ts";
import { pageFocusFunction } from "./page-focus.ts";
import { PAGE_HOOKS_FUNCTION } from "./page-hooks.ts";
import { requestHooksFor, type RequestHooks } from "./request-hooks.ts";
import { SessionPreloads } from "./session-preloads.ts";
import { drmGate } from "./drm-gate.ts";
import { seekPlan } from "./seek-plan.ts";
import type { WebAppDescription, WebIdentity } from "./web-app.ts";
import { confirmScript, noteScript, searchBarScript, volumeScript } from "./web-hud.ts";
import {
  allowsPermission,
  LIST_OUTPUTS_SCRIPT,
  pickOutputId,
  SOUND_RECHECK,
  soundScript,
  type PageOutput,
} from "./web-sound.ts";

/** The web-App host: one persistent, always-loaded view over the Screen window, described by `desc`. */
export class ElectronWebApp implements YouTube {
  #desc: WebAppDescription;
  #win: BrowserWindow;
  #view: WebContentsView;
  #listeners = new Set<(event: YouTubeEvent) => void>();
  #visible = false;
  #failed = false;
  #started = false;
  #sending = false;
  #capturing = false;
  #inSearch = false;
  #skipTimer: ReturnType<typeof setTimeout> | undefined;
  #lastSkipAt = 0;
  #page: unknown;
  #routes: ReturnType<WebAppDescription["route"]["tracker"]>;
  #routeTimer: ReturnType<typeof setInterval> | undefined;
  #volume = 60;
  #sinkId = "";
  /** The output the household wants (by name), looked for whenever the page could have it. */
  #wanted: string | undefined;
  #enumerating = false;
  #resolving: Promise<boolean> | undefined;
  #again = false;
  #ready = false;
  #hooks: RequestHooks;
  #preloads: SessionPreloads;
  #addonRequests: Array<() => void> = [];

  constructor(desc: WebAppDescription, win: BrowserWindow) {
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
    this.#view = new WebContentsView({
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false,
        autoplayPolicy: "no-user-gesture-required",
      },
    });
    this.#view.setVisible(false);
    win.contentView.addChildView(this.#view);
    win.on("resize", () => this.#fit());

    const wc = this.#view.webContents;
    wc.setUserAgent(desc.identity.userAgent);
    wc.on("did-finish-load", () => {
      if (this.#failed || !wc.getURL().startsWith("https:")) return;
      this.#emit({ type: "loaded" });
      this.#syncRoute();
      this.#ready = true;
      void this.#resolveOutput();
    });
    wc.on("console-message", (event) => {
      if ((event as { message?: string }).message === SOUND_RECHECK) void this.#resolveOutput();
    });
    // A new document has none of Couch's volume or output yet.
    wc.on("dom-ready", () => void this.#applySound());
    wc.on("did-fail-load", (_e, code, _desc, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      this.#failed = true;
      this.#emit({ type: "failed" });
    });
    wc.on("before-input-event", (event, input) => {
      if (this.#sending) return;
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

  #pollShorts(): void {
    void this.#view.webContents
      .executeJavaScript(this.#desc.route.script)
      .then((page: unknown) => {
        this.#page = page;
        this.#syncRoute();
      })
      .catch(() => {});
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
      .then(() =>
        Promise.race([
          applyIdentity(wc, this.#desc.identity),
          new Promise((r) => setTimeout(r, 3000)),
        ]),
      )
      .then(() => drmGate(this.#desc, components))
      .then((gate) => {
        if (gate.ok) return this.#load();
        console.warn(`[web] ${this.#desc.id}: ${gate.note} ${gate.detail ?? ""}`.trim());
        this.#failed = true;
        this.#emit({ type: "failed", note: gate.note });
      });
  }

  #load(): void {
    this.#failed = false;
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
    if (this.#desc.loadOnShow && !this.#started) this.start();
    this.#visible = true;
    this.#routeTimer ??= setInterval(() => this.#pollShorts(), 400);
    this.#fit();
    this.#view.setVisible(true);
    void revealScreen(this.#win).then(() => this.#view.webContents.focus());
    if (note) void this.#showNote(note);
  }

  hide(): void {
    this.#visible = false;
    clearInterval(this.#routeTimer);
    this.#routeTimer = undefined;
    this.#pause();
    this.#view.setVisible(false);
    this.#win.webContents.focus();
  }

  #pause(): void {
    void this.#view.webContents
      .executeJavaScript("document.querySelectorAll('video').forEach(function(v){v.pause()})")
      .catch(() => {});
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
      // The blank page the view starts on is not somewhere to go back to.
      const history = wc.navigationHistory;
      const before = history.getEntryAtIndex(history.getActiveIndex() - 1);
      if (before?.url.startsWith("https:")) history.goBack();
      return;
    }
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
    wc.sendInputEvent({ type: "keyDown", keyCode: "MediaPlayPause" });
    wc.sendInputEvent({ type: "keyUp", keyCode: "MediaPlayPause" });
  }

  /**
   * Skips by driving YouTube's own scrubber with keys (Left/Right, then OK after the last press).
   * j/l, media fast-forward keys and bare arrows do not seek in the TV player.
   */
  seekBy(seconds: number): void {
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
        ? [{ name: "Couch focus", func: pageFocusFunction(this.#desc.focus.selectors) }]
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
