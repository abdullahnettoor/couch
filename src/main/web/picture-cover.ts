import { screenKeyCommand } from "../../shared/keyboard.ts";
import type { Command } from "../../shared/protocol.ts";
import { volumeScript } from "./web-hud.ts";
import { pictureOffPage } from "../../shared/picture-off.ts";
import { TopView, type TopHost, type TopViewLike } from "./top-view.ts";

type KeyInput = { type: string; key: string; meta?: boolean; control?: boolean; alt?: boolean };

/** What the cover needs of a view and of the Screen window (Electron's WebContentsView and BrowserWindow fit). */
export interface CoverView extends TopViewLike {
  webContents: TopViewLike["webContents"] & { executeJavaScript(script: string): Promise<unknown> };
}

export type CoverHost<V extends CoverView = CoverView> = TopHost<V>;

/**
 * Picture off for web Apps: a black view added last to the Screen window, so it sits above every web
 * App view. It only covers; the App's view is never hidden, resized or given a visibility change.
 */
export class PictureCover<V extends CoverView = CoverView> {
  #top: TopView<V>;
  #on = false;

  readonly #onKey: (command: Command) => void;

  /** `first` sees the cover's own page's keys before the cover does (the drawer, which draws above it, takes them). */
  constructor(
    host: CoverHost<V>,
    create: () => V,
    onKey: (command: Command) => void,
    first?: (event: { preventDefault(): void }, input: KeyInput) => boolean,
  ) {
    this.#onKey = onKey;
    this.#top = new TopView<V>(host, {
      create,
      page: pictureOffPage,
      onInput: (event, input) => {
        if (!first?.(event, input)) this.intercept(event, input);
      },
    });
  }

  /** Turn the cover on or off; while on, calling again lifts it back above any view added since. */
  set(on: boolean): void {
    this.#on = on;
    if (on) this.#top.show();
    else this.#top.hide();
  }

  /**
   * For the App's own page (and the cover's): while on, a physical key is swallowed before the page
   * sees it. Space and the media play/pause key go to the core as play/pause and leave the picture off;
   * any other key only brings the picture back. True when it swallowed the key.
   */
  intercept(event: { preventDefault(): void }, input: KeyInput): boolean {
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
    const view = this.#top.view;
    if (!this.#on || !view) return;
    void view.webContents.executeJavaScript(volumeScript(percent)).catch(() => {});
  }

  fit(): void {
    this.#top.fit();
  }
}
