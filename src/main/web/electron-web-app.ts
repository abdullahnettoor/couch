import { join } from "node:path";
import {
  app,
  BrowserWindow,
  WebContentsView,
  clipboard,
  components,
  session,
  type Session,
} from "electron";
import type { Confirmation, PromptId, TrackKind } from "../../shared/protocol.ts";
import { revealScreen } from "../reveal.ts";
import type { YouTube, YouTubeEvent, YouTubeKey } from "../ports/youtube.ts";
import { BlankGuard, backIsSafe } from "./blank-guard.ts";
import { HiddenAudio } from "./hidden-audio.ts";
import { decideKey, type KeyGate } from "./keyboard-policy.ts";
import { FIELD_BLURRED, FIELD_FOCUSED, pageFocusFunction } from "./page-focus.ts";
import { PAGE_HOOKS_FUNCTION } from "./page-hooks.ts";
import { COUCH_HOST_CONSOLE, HOST_CONSOLE_PREFIX } from "./couch-host.ts";
import { parsePageMessage } from "./webkit-messages.ts";
import { releaseRequestHooks, requestHooksFor, type RequestHooks } from "./request-hooks.ts";
import { blockLocalFiles } from "./local-files.ts";
import { HIDE_SCROLLBARS_CSS } from "./hide-scrollbars.ts";
import { SessionPreloads } from "./session-preloads.ts";
import type { IdleLifecycle } from "./idle-unload.ts";
import { drmGate } from "./drm-gate.ts";
import { WebHostCore } from "./web-host-core.ts";
import type { WebAppDescription, WebIdentity } from "./web-app.ts";
import { CONFIRM_MESSAGE, confirmScript, noteScript, volumeScript } from "./web-hud.ts";
import {
  allowsPermission,
  LIST_OUTPUTS_SCRIPT,
  pickOutputId,
  SOUND_RECHECK,
  soundScript,
  type PageOutput,
} from "./web-sound.ts";

/** The part of Electron's `WebFrameMain` the host looks at. */
interface ConsoleFrame {
  parent: unknown;
  origin: string;
}

/** The web-App host: one persistent, always-loaded view over the Screen window, described by `desc`. */
/** Which host last set a session's permission handlers (Electron keeps one of each per session). */
const permissionOwners = new WeakMap<object, object>();

export class ElectronWebApp implements YouTube {
  #desc: WebAppDescription;
  #win: BrowserWindow;
  #view!: WebContentsView;
  #core: WebHostCore;
  #listeners = new Set<(event: YouTubeEvent) => void>();
  #visible = false;
  #failed = false;
  #started = false;
  /** The App's home has been asked for (after the DRM gate); a blank page before that is just not loaded yet. */
  #loadIssued = false;
  #identityApplied = false;
  #lifecycle: IdleLifecycle | undefined;
  #sending = false;
  #capturing = false;
  /** A text field in the page has focus: keys on the Mac keyboard are its, not Couch commands. */
  #fieldFocused = false;
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
  #ses: Session;
  #addonRequests: Array<() => void> = [];
  #ownHooks: Array<() => void> = [];
  #onResize = () => this.#fit();
  #disposed = false;

  constructor(desc: WebAppDescription, win: BrowserWindow, lifecycle?: IdleLifecycle) {
    this.#lifecycle = lifecycle;
    this.#desc = desc;
    this.#win = win;
    this.#core = new WebHostCore(
      desc,
      {
        run: (script) => this.#view.webContents.executeJavaScript(script),
        press: (keyCode) => this.#press(keyCode),
        goBack: () => this.#goBack(),
        canGoBack: () => this.#canGoBack(),
        url: () => this.#view.webContents.getURL(),
        load: (url) =>
          void this.#view.webContents
            .loadURL(url, { userAgent: desc.identity.userAgent })
            .catch(() => {}),
        focus: () => this.#view.webContents.focus(),
        visible: () => this.#visible,
      },
      (event) => this.#emit(event),
      { pollsRoute: true },
    );
    const ses = session.fromPartition(desc.partition);
    ses.setUserAgent(desc.identity.userAgent);
    const hooks = requestHooksFor(ses);
    // The identity comes first so every later handler sees (and keeps) its headers.
    this.#ownHooks.push(
      hooks.onBeforeSendHeaders((details) =>
        desc.identity.headersFor(new URL(details.url), details.requestHeaders),
      ),
      hooks.onBeforeRequest(blockLocalFiles),
    );
    // The view may ask the Mac for nothing (no microphone, no camera). Its media permission *check*
    // is answered yes only for the App's own origin, and only for what choosing an output needs.
    this.#ses = ses;
    permissionOwners.set(ses, this);
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler((_wc, permission, origin) => {
      return allowsPermission(permission, origin, this.#enumerating, (o) => desc.isOwnOrigin(o));
    });
    this.#hooks = hooks;
    this.#preloads = new SessionPreloads(ses, join(app.getPath("userData"), desc.id), desc.id);
    this.#applyAddons(desc.enabledAddons);
    this.#createView();
    win.on("resize", this.#onResize);
  }

  #onConsole(message: string): void {
    if (message === SOUND_RECHECK) void this.#resolveOutput();
    if (message === FIELD_FOCUSED) this.#fieldFocused = true;
    const pick = CONFIRM_MESSAGE.exec(message);
    if (pick)
      this.#emit({ type: "confirm", index: Number(pick[2]), answer: pick[1] === undefined });
    if (message === FIELD_BLURRED) this.#fieldFocused = false;
  }

  /**
   * `couchHost.send` on Chromium arrives as a prefixed console line. Only the App's own main frame is believed, and the body
   * must pass the schema WebKit's messages pass. `input` and `wake-pointer` have native paths here (mouse events, the view), so they are ignored.
   */
  #onHostMessage(line: string, frame: ConsoleFrame | null | undefined): void {
    if (!frame || frame.parent !== null || !this.#desc.isOwnOrigin(frame.origin)) return;
    let body: unknown;
    try {
      body = JSON.parse(line.slice(HOST_CONSOLE_PREFIX.length));
    } catch {
      return;
    }
    const message = parsePageMessage(body);
    if (message?.type === "route") {
      this.#core.setPage(message.page);
      this.#core.navigated(message.url);
    } else if (message?.type === "console") {
      this.#onConsole(message.message);
    }
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
      this.#core.openSettled();
      this.#emit({ type: "loaded" });
      this.#core.syncRoute(wc.getURL());
      this.#ready = true;
      void this.#resolveOutput();
    });
    wc.on("console-message", (event) => {
      const { message, frame } = event as { message?: string; frame?: ConsoleFrame | null };
      if (message === undefined) return;
      if (message.startsWith(HOST_CONSOLE_PREFIX)) return this.#onHostMessage(message, frame);
      this.#onConsole(message);
    });
    // A new document has none of Couch's volume or output yet.
    wc.on("dom-ready", () => {
      // A style the page itself adds doesn't beat the site's own rules; Chromium's inserted CSS does.
      if (this.#desc.hideScrollbars) void wc.insertCSS(HIDE_SCROLLBARS_CSS).catch(() => {});
      void this.#applySound();
      if (!this.#visible) this.#silence.hide();
    });
    wc.on("did-start-navigation", (_e, _url, inPlace, isMainFrame) => {
      // A pushState (Netflix's search writes each letter into the address) keeps the field focused.
      if (isMainFrame && !inPlace) this.#fieldFocused = false;
    });
    wc.on("did-navigate", (_e, url) => this.#guard.navigated(url));
    // While a Continue open is pending, the page may not leave the App's own sites (a redirect included): cancel and go home.
    const police = (event: { url?: string; preventDefault(): void }, url?: string) => {
      if (!this.#core.allowNavigation(url ?? event.url ?? "")) event.preventDefault();
    };
    wc.on("will-navigate", police);
    wc.on("will-redirect", police);
    wc.on("render-process-gone", () => {
      this.#guard.crashed();
      if (this.#visible) void this.#guard.onShow();
    });
    wc.on("did-fail-load", (_e, code, _desc, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      this.#failed = true;
      this.#emit({ type: "failed" });
    });
    wc.on("before-mouse-event", (_event, mouse) => {
      if (this.#sending) return;
      if (mouse.type === "mouseDown" && !this.#capturing) this.#emit({ type: "input" });
    });
    wc.on("before-input-event", (event, input) => {
      if (this.#sending) return;
      const decision = decideKey(
        input,
        { gate: this.#keyGate, capturing: this.#capturing, fieldFocused: this.#fieldFocused },
        event,
      );
      switch (decision.kind) {
        case "gate":
          return;
        case "typed":
          event.preventDefault();
          if (!decision.edit) return;
          if ("paste" in decision.edit) {
            void Promise.resolve(clipboard.readText()).then((text) => {
              if (text) this.#emit({ type: "edit", edit: { insert: text } });
            });
            return;
          }
          this.#emit({ type: "edit", edit: decision.edit });
          return;
        case "find":
          event.preventDefault();
          this.#emit({ type: "find" });
          return;
        case "command":
          event.preventDefault();
          if (input.type === "keyDown") this.#emit({ type: "key", command: decision.command });
          return;
        case "page":
          if (input.type === "keyDown") this.#emit({ type: "input" });
          return;
      }
    });
    const route = (_e: unknown, url: string) => this.#core.navigated(url);
    wc.on("did-navigate", route);
    wc.on("did-navigate-in-page", route);
  }

  seekTo(seconds: number): void {
    this.#core.seekTo(seconds);
  }

  pressPrompt(id: PromptId): void {
    this.#core.pressPrompt(id);
  }

  setSpeed(speed: number): void {
    this.#core.setSpeed(speed);
  }

  setTrack(kind: TrackKind, id: string): void {
    this.#core.setTrack(kind, id);
  }

  /** Starts loading in the background so opening YouTube is instant. */
  start(): void {
    if (this.#disposed) return;
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
    this.#failed = false;
    this.#ready = false;
    this.#fieldFocused = false;
    // A blank page keeps its renderer, so the whole view goes; the next one starts without a process.
    const old = this.#view;
    this.#win.contentView.removeChildView(old);
    old.webContents.close();
    this.#createView();
    this.#core.reset();
  }

  /** The host is taken away for good (an engine switch): its view, window listener, request hooks and preload go; the session's data stays. */
  dispose(): void {
    if (this.#disposed) return;
    if (this.#visible) this.hide();
    this.#disposed = true;
    this.#win.off("resize", this.#onResize);
    for (const off of [...this.#ownHooks.splice(0), ...this.#addonRequests.splice(0)]) off();
    this.#preloads.clear();
    releaseRequestHooks(this.#ses);
    // Only if no newer host took the handlers over since.
    if (permissionOwners.get(this.#ses) === this) {
      permissionOwners.delete(this.#ses);
      this.#ses.setPermissionRequestHandler(null);
      this.#ses.setPermissionCheckHandler(null);
    }
    this.#win.contentView.removeChildView(this.#view);
    this.#view.webContents.close();
    this.#core.reset();
    this.#core.dispose();
    this.#listeners.clear();
  }

  #load(): void {
    if (this.#disposed) return;
    this.#failed = false;
    this.#loadIssued = true;
    void this.#view.webContents
      .loadURL(this.#core.firstUrl(), { userAgent: this.#desc.identity.userAgent })
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
    if (this.#disposed) return;
    if (!this.#started) this.start();
    else if (this.#loadIssued) void this.#guard.onShow();
    this.#lifecycle?.shown();
    this.#visible = true;
    this.#core.shown();
    this.#fit();
    this.#view.setVisible(true);
    this.#silence.show();
    void revealScreen(this.#win).then(() => this.#view.webContents.focus());
    if (note) void this.#showNote(note);
  }

  hide(): void {
    this.#visible = false;
    this.#core.hidden();
    this.#silence.hide();
    this.#view.setVisible(false);
    this.#win.webContents.focus();
    this.#lifecycle?.hidden();
  }

  /** Gives the App's page keyboard focus (after something drawn above it, like Quick settings, closes). */
  focus(): void {
    this.#view.webContents.focus();
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
    this.#core.sendKey(key);
  }

  /** The blank page the view starts on is not somewhere to go back to. */
  #canGoBack(): boolean {
    const history = this.#view.webContents.navigationHistory;
    return backIsSafe(history.getAllEntries(), history.getActiveIndex());
  }

  #goBack(): void {
    if (!this.#canGoBack()) return;
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
    this.#core.scrollToTop();
  }

  playPause(): void {
    this.#core.playPause();
  }

  seekBy(seconds: number): void {
    this.#core.seekBy(seconds);
  }

  captureText(on: boolean): void {
    this.#capturing = on;
  }

  openAt(url: string): void {
    this.#core.openAt(url, this.#loadIssued);
  }

  submitSearch(text: string): void {
    this.#core.submitSearch(text);
  }

  showSearchBar(text: string | undefined): void {
    this.#core.showSearchBar(text);
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
      { name: "Couch host", func: COUCH_HOST_CONSOLE },
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
