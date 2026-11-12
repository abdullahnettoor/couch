import type { GridItem, ScreenPayload } from "../../../shared/protocol.ts";
import type { HomePage } from "../home-page.ts";
import { backTo, type Page, type PageBack, type PageContext } from "./page.ts";

export type SettingsHomeHost = Pick<HomePage, "grid" | "payload" | "action" | "watch" | "refresh">;

/** Settings → Home: the wallpaper page. Entering it watches the Mac's desktop picture and reads the Mac in full. */
export class SettingsHomePage implements Page {
  #ctx: PageContext;
  #h: SettingsHomeHost;

  constructor(ctx: PageContext, host: SettingsHomeHost) {
    this.#ctx = ctx;
    this.#h = host;
  }

  grid(): GridItem[] {
    return this.#h.grid();
  }

  /** The focused tile previews as the wallpaper without being saved. */
  payload(focused?: string): Partial<ScreenPayload> {
    return { home: this.#h.payload(focused) };
  }

  action(action: string): boolean {
    return this.#h.action(action);
  }

  enter(): void {
    this.#h.watch(true);
    this.#h.refresh(true);
  }

  back(): PageBack {
    return backTo(this.#ctx, "settings");
  }
}
