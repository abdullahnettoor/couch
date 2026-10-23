import { screenKeyCommand } from "../../shared/keyboard.ts";
import type { Command } from "../../shared/protocol.ts";
import { pictureOffPage } from "../../shared/picture-off.ts";

/** What the cover needs of a view and of the Screen window (Electron's WebContentsView and BrowserWindow fit). */
export interface CoverView {
  webContents: {
    loadURL(url: string): Promise<void>;
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

export interface CoverHost {
  contentView: {
    readonly children?: readonly unknown[];
    addChildView(view: never): void;
    removeChildView(view: never): void;
  };
  getContentBounds(): { width: number; height: number };
}

/**
 * Picture off for web Apps: a black view added last to the Screen window, so it sits above every web
 * App view. It only covers; the App's view is never hidden, resized or given a visibility change.
 */
export class PictureCover {
  #view?: CoverView;
  #on = false;

  readonly #host: CoverHost;
  readonly #create: () => CoverView;
  readonly #onKey: (command: Command) => void;

  constructor(host: CoverHost, create: () => CoverView, onKey: (command: Command) => void) {
    this.#host = host;
    this.#create = create;
    this.#onKey = onKey;
  }

  /** Turn the cover on or off; while on, calling again lifts it back above any view added since. */
  set(on: boolean): void {
    if (!on) {
      if (this.#on && this.#view) this.#host.contentView.removeChildView(this.#view as never);
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
        if (input.type !== "keyDown") return;
        event.preventDefault();
        const command = screenKeyCommand(
          { key: input.key, meta: input.meta, ctrl: input.control, alt: input.alt },
          false,
        );
        if (command) this.#onKey(command);
      });
    }
    this.#on = true;
    this.fit();
    const { children } = this.#host.contentView;
    if (children?.at(-1) !== this.#view) this.#host.contentView.addChildView(this.#view as never);
  }

  fit(): void {
    if (!this.#on || !this.#view) return;
    const { width, height } = this.#host.getContentBounds();
    this.#view.setBounds({ x: 0, y: 0, width, height });
  }
}
