import type { Confirmation, GridItem, ScreenState } from "../../../shared/protocol.ts";
import { APP_ERROR_ITEMS } from "../../../shared/app-grid.ts";
import type { App } from "../../apps/app.ts";
import { backTo, type Page, type PageBack, type PageContext } from "./page.ts";

const APP_NOTE = "Press Home on your phone to come back";

/** What an App's Page asks of the core, besides the Page context. */
export interface AppPageHost {
  apps: ReadonlyMap<string, App>;
  isShown(id: string): boolean;
  /** The App the Screen is showing, if any. */
  front(): App | undefined;
  dismissConfirm(): void;
  /** The App is no longer in front: what it last reported playing, its titles and speed are let go. */
  released(id: string): void;
}

/**
 * An App on the Screen: its website is the grid, so this Page has none. It owns Back ("Leave …?" asked
 * through the context), opening the App (with its welcome question) and letting it go when the view leaves.
 */
export class AppPage implements Page {
  #ctx: PageContext;
  #h: AppPageHost;
  /** Apps that failed to load, with why when the App said so; cleared when one loads. */
  readonly failed = new Map<string, string | undefined>();
  /** Apps whose welcome question is being looked up (the newest open owns it). */
  #lookups = new Map<string, number>();
  #lookupSeq = 0;
  /** Apps whose welcome question is being looked up or answered. */
  #welcoming = new Set<string>();
  /** The question asked on behalf of the App's Back ("Leave <label>?"). */
  #leaveConfirm: Confirmation | undefined;
  /** The App this Page was entered for. */
  #id: string | undefined;

  constructor(ctx: PageContext, host: AppPageHost) {
    this.#ctx = ctx;
    this.#h = host;
  }

  grid(): GridItem[] {
    return [];
  }

  payload(): Record<string, never> {
    return {};
  }

  action(): boolean {
    return false;
  }

  press(key: "up" | "down" | "left" | "right" | "ok"): boolean {
    const front = this.#h.front();
    front?.sendKey(key);
    return !!front;
  }

  pointable(): boolean {
    return false;
  }

  back(): PageBack | undefined {
    const front = this.#h.front();
    if (!front) return undefined;
    return {
      act: () => {
        if (front.back() !== "leave") return;
        this.#ctx.ask(
          `Leave ${front.label}?`,
          ["Stay", "Go to Home"],
          [() => {}, () => this.#ctx.go("home")],
        );
        this.#leaveConfirm = this.#ctx.state.confirm;
      },
    };
  }

  enter(): void {
    this.#id = this.#ctx.state.app;
  }

  /** Leaving an App hides it (pausing playback). */
  leave(): void {
    const id = this.#id ?? "";
    if (this.#leaveConfirm && this.#ctx.state.confirm === this.#leaveConfirm)
      this.#h.dismissConfirm();
    this.#ctx.stopTyping();
    this.#h.released(id);
    this.#h.apps.get(id)?.hide();
  }

  /** `at`: an address to open the App at (a Continue entry's title), applied to the App just before it is shown. */
  open(id: string, at?: string): void {
    const app = this.#h.apps.get(id);
    if (!app || !this.#h.isShown(id)) return;
    if (app.welcome && !this.failed.has(id)) {
      void this.#welcomeThenOpen(app, at);
      return;
    }
    this.#enter(id, at);
  }

  retry(): void {
    const id = this.#ctx.state.app;
    const app = this.#h.apps.get(id ?? "");
    if (!id || !app) return;
    this.failed.delete(id);
    app.restart();
    this.open(id);
  }

  /** Asks the App's one-time question over the view we are on, and opens the App once it is answered. */
  async #welcomeThenOpen(app: App, at?: string): Promise<void> {
    const welcome = app.welcome;
    if (!welcome) return;
    const ctx = this.#ctx;
    const looking = this.#lookups.has(app.id);
    // Answering: a second open waits. Still looking up: the newest open takes over (the lookup is shared).
    if (this.#welcoming.has(app.id) && !looking) return;
    const lookup = ++this.#lookupSeq;
    this.#lookups.set(app.id, lookup);
    this.#welcoming.add(app.id);
    const view = ctx.state.view;
    let released = false;
    const release = () => {
      if (!released) this.#welcoming.delete(app.id);
      released = true;
    };
    const question = await welcome.question().catch(() => undefined);
    if (this.#lookups.get(app.id) !== lookup) return;
    this.#lookups.delete(app.id);
    // Home, or another page, in the meantime: the household went elsewhere.
    if (ctx.state.view !== view) return release();
    if (!question) {
      release();
      this.#enter(app.id, at);
      ctx.emit();
      return;
    }
    const answer = async (id: string) => {
      this.#welcoming.add(app.id);
      const toast = await welcome.answer(id).then(
        (text) => text,
        () => `Couldn't finish that. ${app.label} is opening.`,
      );
      this.#welcoming.delete(app.id);
      if (ctx.state.view !== view) return;
      this.#enter(app.id, at);
      if (toast) ctx.toast(toast);
      ctx.emit();
    };
    release();
    ctx.ask(
      question.title,
      question.choices.map((c) => c.label),
      question.choices.map((c) => () => void answer(c.id)),
      { body: question.body, phone: true, back: () => void answer(question.back) },
    );
    ctx.emit();
  }

  /** Shows the App; with `at`, it goes to that address first, on whichever host it has by now (a welcome can switch engines). */
  #enter(id: string, at?: string): void {
    const app = this.#h.apps.get(id);
    if (!app) return;
    if (this.failed.has(id)) {
      this.#ctx.set({ app: id, appNote: this.failed.get(id) });
      this.#ctx.go("appError");
      return;
    }
    this.#ctx.set({ app: id });
    this.#ctx.go("app");
    if (at) app.openAt?.(at);
    app.show(APP_NOTE);
  }
}

/** The page shown when an App failed to load: Retry, and Back to Home. */
export class AppErrorPage implements Page {
  #ctx: PageContext;
  #app: AppPage;

  constructor(ctx: PageContext, app: AppPage) {
    this.#ctx = ctx;
    this.#app = app;
  }

  grid(): GridItem[] {
    return APP_ERROR_ITEMS;
  }

  payload(): Record<string, never> {
    return {};
  }

  action(action: string): boolean {
    if (action !== "app:retry") return false;
    this.#app.retry();
    return true;
  }

  back(): PageBack {
    return backTo(this.#ctx, "home");
  }
}

interface AppOverlaysHost {
  apps: ReadonlyMap<string, App>;
  front(): App | undefined;
  level(): number;
  /** A phone is typing into the App's search bar. */
  searching(): boolean;
}

/** What Couch draws over an App (volume, question, search bar) goes through the App, which covers the Screen. */
export class AppOverlays {
  #state: Readonly<ScreenState>;
  #h: AppOverlaysHost;
  #shown = new Map<string, { volume?: number; confirm?: Confirmation; bar?: string }>();

  constructor(state: Readonly<ScreenState>, host: AppOverlaysHost) {
    this.#state = state;
    this.#h = host;
  }

  /** Tells each App what to show now, and only what changed since it was last told. */
  sync(): void {
    const front = this.#h.front();
    for (const app of this.#h.apps.values()) {
      const shown = this.#shown.get(app.id) ?? {};
      const on = app === front;
      const volume = on && this.#state.volumeShown ? this.#h.level() : undefined;
      if (volume !== shown.volume) {
        shown.volume = volume;
        app.drawVolume(volume);
      }
      const c = on ? this.#state.confirm : undefined;
      if (c?.title !== shown.confirm?.title || c?.focus !== shown.confirm?.focus) {
        shown.confirm = c && { ...c };
        app.showConfirm(c && { ...c });
      }
      const bar =
        on && this.#state.typingBy !== undefined && this.#h.searching()
          ? this.#state.query
          : undefined;
      if (bar !== shown.bar) {
        shown.bar = bar;
        app.typing?.showSearchBar(bar);
      }
      this.#shown.set(app.id, shown);
    }
  }
}
