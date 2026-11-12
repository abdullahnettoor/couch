import type { Command, GridItem, RemoteId, ScreenPayload } from "../../../shared/protocol.ts";
import type { Source } from "../core.ts";
import type { MetadataService } from "../metadata-service.ts";
import { backTo, type Page, type PageBack, type PageContext } from "./page.ts";

/** What the "Show and film details" page asks of the core. */
export interface DetailsPageHost {
  details: Pick<MetadataService, "settings" | "setKey" | "setEnabled" | "refresh">;
  /** The phone that last sent a command, if it is still connected. */
  connectedPhone(): RemoteId | undefined;
}

/**
 * The "Show and film details" Settings page: its rows, key entry (typed on a phone, never put in the
 * Screen state), Refresh and Credits.
 */
export class DetailsPage implements Page {
  #ctx: PageContext;
  #h: DetailsPageHost;
  /** A TMDB key being typed on a phone. Kept out of the Screen state and snapshots. */
  #draft = "";

  constructor(ctx: PageContext, host: DetailsPageHost) {
    this.#ctx = ctx;
    this.#h = host;
  }

  payload(): Pick<ScreenPayload, "details"> {
    return { details: this.#h.details.settings() };
  }

  back(): PageBack {
    return backTo(this.#ctx, "settingsLibrary");
  }

  leave(): void {
    this.cancel();
  }

  grid(): GridItem[] {
    const s = this.#h.details.settings();
    const rows: Omit<GridItem, "r" | "c">[] = [
      { id: "own-key", label: "Use my own key", action: "details:own-key", initial: true },
      ...(s.hasOwnKey
        ? [{ id: "remove-key", label: "Remove my key", action: "details:remove-key" }]
        : []),
      { id: "toggle", label: "Online details", action: "details:toggle" },
      { id: "refresh", label: "Refresh details", action: "details:refresh" },
      { id: "credits", label: "Credits", action: "details:credits" },
    ];
    return rows.map((row, r) => ({ ...row, r, c: 0 }));
  }

  /** Actions on the "Show and film details" page. */
  action(action: string, from: Source = "screen"): boolean {
    if (!action.startsWith("details:")) return false;
    switch (action) {
      case "details:own-key": {
        // Typed where OK was pressed: a field on the Screen, or the phone's typing sheet.
        const phone = this.#h.connectedPhone();
        if (from === "screen") this.startTyping(from);
        else if (phone !== undefined) this.startTyping(phone);
        else this.#ctx.toast("Open Couch's Remote on your phone to type the key");
        break;
      }
      case "details:remove-key":
        this.#h.details.setKey(undefined);
        this.#ctx.toast("Using the built-in key");
        break;
      case "details:toggle":
        this.#h.details.setEnabled(!this.#h.details.settings().enabled);
        break;
      case "details:refresh":
        this.#h.details.refresh();
        this.#ctx.toast("Refreshing details");
        break;
      case "details:credits":
        this.#ctx.go("credits");
        break;
      default:
        return false;
    }
    return true;
  }

  startTyping(source: Source): void {
    this.#ctx.startTyping(source, "tmdbKey");
    this.#draft = "";
  }

  /** The page was left (or its typing sheet closed): forget the key being typed. */
  cancel(): void {
    this.#ctx.stopTyping();
    this.#draft = "";
  }

  /** Typing the household's TMDB key: the text never goes into the Screen state. */
  typeKey(command: Command, from: Source): void {
    const owner = this.#ctx.state.typingBy;
    switch (command.command) {
      case "typeOpen":
        if (owner !== undefined && owner !== from) return;
        this.startTyping(from);
        break;
      case "typeText":
        if (owner === from) this.#draft = command.args?.text ?? "";
        break;
      case "typeSubmit":
        if (owner !== from) return;
        this.#ctx.stopTyping();
        if (this.#draft.trim()) {
          this.#h.details.setKey(this.#draft);
          this.#ctx.toast("TMDB key saved");
        }
        this.#draft = "";
        break;
      case "typeCancel":
        if (owner !== from) return;
        this.#ctx.stopTyping();
        this.#draft = "";
        break;
    }
  }
}
