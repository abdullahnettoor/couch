import { screenKeyCommand } from "../../shared/keyboard.ts";
import { Channel } from "../../shared/ipc.ts";
import type { Command, QuickPayload } from "../../shared/protocol.ts";
import { QUICK_SLIDE_MS, quickSettingsPage } from "../../shared/quick-settings-page.ts";
import type { Clock } from "../ports/clock.ts";

type KeyInput = { type: string; key: string; meta?: boolean; control?: boolean; alt?: boolean };

/** What the drawer needs of a view (Electron's WebContentsView fits). */
export interface DrawerView {
  webContents: {
    loadURL(url: string): Promise<void>;
    send(channel: string, quick: QuickPayload | undefined): void;
    on(
      event: "before-input-event",
      handler: (event: { preventDefault(): void }, input: KeyInput) => void,
    ): void;
    on(event: "did-finish-load", handler: () => void): void;
  };
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void;
  setBackgroundColor(color: string): void;
}

export interface DrawerHost<V extends DrawerView = DrawerView> {
  contentView: {
    readonly children?: readonly unknown[];
    addChildView(view: V): void;
    removeChildView(view: V): void;
  };
  getContentBounds(): { width: number; height: number };
}

/**
 * Quick settings above whatever is on the Screen: one transparent view over the whole window, added
 * last so it sits above web Apps (like the Picture off cover). It only draws over them; an App's own
 * view is never hidden, resized or given a visibility change, so it keeps playing. The page inside
 * is the drawer (a panel on the left) and a transparent scrim whose clicks close it.
 */
export class QuickDrawer<V extends DrawerView = DrawerView> {
  #view?: V;
  #loaded = false;
  #quick: QuickPayload | undefined;
  #in = false;
  #cancelRemove: (() => void) | undefined;

  readonly #host: DrawerHost<V>;
  readonly #create: () => V;
  readonly #onKey: (command: Command) => void;
  readonly #clock: Clock;
  readonly #onClosed: () => void;

  constructor(
    host: DrawerHost<V>,
    create: () => V,
    onKey: (command: Command) => void,
    clock: Clock,
    onClosed: () => void,
  ) {
    this.#host = host;
    this.#create = create;
    this.#onKey = onKey;
    this.#clock = clock;
    this.#onClosed = onClosed;
  }

  /** The drawer to show, or undefined to slide it away. Safe to call on every update. */
  set(quick: QuickPayload | undefined): void {
    this.#quick = quick;
    if (!quick) {
      if (!this.#in) return;
      this.#in = false;
      this.#push();
      this.#cancelRemove?.();
      this.#cancelRemove = this.#clock.setTimeout(() => {
        this.#cancelRemove = undefined;
        if (this.#view) this.#host.contentView.removeChildView(this.#view);
        this.#onClosed();
      }, QUICK_SLIDE_MS);
      return;
    }
    this.#cancelRemove?.();
    this.#cancelRemove = undefined;
    if (!this.#view) {
      const view = (this.#view = this.#create());
      view.setBackgroundColor("#00000000");
      const wc = view.webContents;
      wc.on("did-finish-load", () => {
        this.#loaded = true;
        this.#push();
      });
      wc.on("before-input-event", (event, input) => {
        this.intercept(event, input);
      });
      void wc
        .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(quickSettingsPage())}`)
        .catch(() => {});
    }
    this.#in = true;
    this.fit();
    const { children } = this.#host.contentView;
    if (children?.at(-1) !== this.#view) this.#host.contentView.addChildView(this.#view);
    this.#push();
  }

  #push(): void {
    if (this.#loaded && this.#view) this.#view.webContents.send(Channel.quick, this.#quick);
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
    if (!this.#view) return;
    const { width, height } = this.#host.getContentBounds();
    this.#view.setBounds({ x: 0, y: 0, width, height });
  }
}
