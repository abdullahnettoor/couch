import { screenKeyCommand } from "../../shared/keyboard.ts";
import type { Command } from "../../shared/protocol.ts";
import { volumeScript } from "./web-hud.ts";
import { pictureOffPage } from "../../shared/picture-off.ts";

/** What the cover needs of a view and of the Screen window (Electron's WebContentsView and BrowserWindow fit). */
export interface CoverView {
  webContents: {
    loadURL(url: string): Promise<void>;
    executeJavaScript(script: string): Promise<unknown>;
    on(
      event: "before-input-event",
      handler: (
        event: { preventDefault(): void },
        input: { type: string; key: string; meta?: boolean; control?: boolean; alt?: boolean },
      ) => void,
    ): void;
  };
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void;
}

export interface CoverHost<V extends CoverView = CoverView> {
  contentView: {
    readonly children?: readonly unknown[];
    addChildView(view: V): void;
    removeChildView(view: V): void;
  };
  getContentBounds(): { width: number; height: number };
}

/**
 * Picture off for web Apps: a black view added last to the Screen window, so it sits above every web
 * App view. It only covers; the App's view is never hidden, resized or given a visibility change.
 */
export class PictureCover<V extends CoverView = CoverView> {
  #view?: V;
  #on = false;

  readonly #host: CoverHost<V>;
  readonly #create: () => V;
  readonly #onKey: (command: Command) => void;

  constructor(host: CoverHost<V>, create: () => V, onKey: (command: Command) => void) {
    this.#host = host;
    this.#create = create;
    this.#onKey = onKey;
  }

  /** Turn the cover on or off; while on, calling again lifts it back above any view added since. */
  set(on: boolean): void {
    if (!on) {
      if (this.#on && this.#view) this.#host.contentView.removeChildView(this.#view);
      this.#on = false;
      return;
    }
    if (!this.#view) {
      this.#view = this.#create();
      const wc = this.#view.webContents;
      void wc
        .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(pictureOffPage())}`)
        .catch(() => {});
      wc.on("before-input-event", (event, input) => {
        this.intercept(event, input);
      });
    }
    this.#on = true;
    this.fit();
    const { children } = this.#host.contentView;
    if (children?.at(-1) !== this.#view) this.#host.contentView.addChildView(this.#view);
  }

  /**
   * For the App's own page (and the cover's): while on, a physical key is swallowed before the page
   * sees it, and the first key press only brings the picture back. True when it swallowed the key.
   */
  intercept(
    event: { preventDefault(): void },
    input: { type: string; key: string; meta?: boolean; control?: boolean; alt?: boolean },
  ): boolean {
    if (!this.#on) return false;
    event.preventDefault();
    if (input.type !== "keyDown") return true;
    const command = screenKeyCommand(
      { key: input.key, meta: input.meta, ctrl: input.control, alt: input.alt },
      false,
    );
    this.#onKey(command ?? { command: "setPictureOff", args: { on: false } });
    return true;
  }

  /** The volume level above the cover, in the same style as the App's own; undefined removes it. */
  showVolume(percent: number | undefined): void {
    if (!this.#on || !this.#view) return;
    void this.#view.webContents.executeJavaScript(volumeScript(percent)).catch(() => {});
  }

  fit(): void {
    if (!this.#on || !this.#view) return;
    const { width, height } = this.#host.getContentBounds();
    this.#view.setBounds({ x: 0, y: 0, width, height });
  }
}
