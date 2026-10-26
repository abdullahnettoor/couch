import { screenKeyCommand } from "../../shared/keyboard.ts";
import { Channel } from "../../shared/ipc.ts";
import type { Command, QuickPayload } from "../../shared/protocol.ts";
import {
  QUICK_SLIDE_MS,
  drawerGlassRect,
  quickSettingsPage,
} from "../../shared/quick-settings-page.ts";
import type { Clock } from "../ports/clock.ts";
import { TopView, type TopHost, type TopViewLike } from "./top-view.ts";

type KeyInput = { type: string; key: string; meta?: boolean; control?: boolean; alt?: boolean };

/** What the drawer needs of a view (Electron's WebContentsView fits). */
export interface DrawerView extends TopViewLike {
  webContents: TopViewLike["webContents"] & {
    send(channel: string, quick: QuickPayload | undefined): void;
    on(event: "did-finish-load", handler: () => void): void;
  };
  setBackgroundColor(color: string): void;
}

/** The native glass panel behind the drawer's view; the native side keeps it directly under that view. */
export interface DrawerGlass {
  /** Slide it in over `ms` to `rect` (window points); the drawer's view is already the window's top view. */
  open(rect: ReturnType<typeof drawerGlassRect>, ms: number): void;
  /** Slide it out over `ms` and remove it; 0 removes it at once. Safe to call any time. */
  close(ms: number): void;
}

export type DrawerHost<V extends DrawerView = DrawerView> = TopHost<V>;

/**
 * Quick settings above whatever is on the Screen: one transparent view over the whole window, added
 * last so it sits above web Apps (like the Picture off cover). It only draws over them; an App's own
 * view is never hidden, resized or given a visibility change, so it keeps playing. The page inside
 * is the drawer (a panel on the right) and a transparent scrim whose clicks close it.
 */
export class QuickDrawer<V extends DrawerView = DrawerView> {
  #top: TopView<V>;
  #loaded = false;
  #quick: QuickPayload | undefined;
  #in = false;
  readonly #glass: DrawerGlass | undefined;
  #host: DrawerHost<V>;
  #cancelRemove: (() => void) | undefined;

  readonly #onKey: (command: Command) => void;
  readonly #clock: Clock;
  readonly #onClosed: () => void;

  constructor(
    host: DrawerHost<V>,
    create: () => V,
    onKey: (command: Command) => void,
    clock: Clock,
    onClosed: () => void,
    glass?: DrawerGlass,
  ) {
    this.#glass = glass;
    this.#host = host;
    this.#onKey = onKey;
    this.#clock = clock;
    this.#onClosed = onClosed;
    this.#top = new TopView<V>(host, {
      create,
      page: () => quickSettingsPage({ glass: glass !== undefined }),
      onInput: (event, input) => {
        this.intercept(event, input);
      },
      setup: (view) => {
        view.setBackgroundColor("#00000000");
        view.webContents.on("did-finish-load", () => {
          this.#loaded = true;
          this.#push();
        });
      },
    });
  }

  /** The drawer's own page, to tell its messages from anyone else's. */
  get webContents(): V["webContents"] | undefined {
    return this.#top.view?.webContents;
  }

  /** The row ids on the drawer now (what a pick may name). */
  get itemIds(): string[] {
    return this.#quick?.items.map((i) => i.id) ?? [];
  }

  /** The drawer to show, or undefined to slide it away. Safe to call on every update. */
  set(quick: QuickPayload | undefined): void {
    this.#quick = quick;
    if (!quick) {
      if (!this.#in) {
        if (this.#top.shown) this.#top.show();
        return;
      }
      this.#in = false;
      this.#push();
      this.#top.show();
      this.#glass?.close(QUICK_SLIDE_MS);
      this.#cancelRemove?.();
      this.#cancelRemove = this.#clock.setTimeout(() => {
        this.#cancelRemove = undefined;
        this.#glass?.close(0);
        this.#top.hide();
        this.#onClosed();
      }, QUICK_SLIDE_MS);
      return;
    }
    this.#cancelRemove?.();
    this.#cancelRemove = undefined;
    const opening = !this.#in;
    this.#in = true;
    this.#top.show();
    if (opening) this.#glassOpen(QUICK_SLIDE_MS);
    this.#push();
  }

  #glassOpen(ms: number): void {
    const { width, height } = this.#host.getContentBounds();
    this.#glass?.open(drawerGlassRect(width, height), ms);
  }

  #push(): void {
    const view = this.#top.view;
    if (this.#loaded && view) view.webContents.send(Channel.quick, this.#quick);
  }

  /**
   * For the App's own page (and the drawer's): while open, a physical key never reaches the page.
   * It goes to the core as the command it means. True when it swallowed the key.
   */
  intercept(event: { preventDefault(): void }, input: KeyInput): boolean {
    if (!this.#in) return false;
    event.preventDefault();
    if (input.type !== "keyDown") return true;
    const command = screenKeyCommand(
      { key: input.key, meta: input.meta, ctrl: input.control, alt: input.alt },
      false,
    );
    if (command) this.#onKey(command);
    return true;
  }

  fit(): void {
    this.#top.fit();
    if (this.#in) this.#glassOpen(0);
  }
}
