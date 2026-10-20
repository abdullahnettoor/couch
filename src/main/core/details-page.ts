import type { Command, GridItem, RemoteId, ScreenState, View } from "../../shared/protocol.ts";
import type { Source } from "./core.ts";
import type { MetadataService } from "./metadata-service.ts";

/** What the "Show and film details" page asks of the core. */
export interface DetailsPageHost {
  details: MetadataService;
  /** The phone that last sent a command, if it is still connected. */
  connectedPhone(): RemoteId | undefined;
  /** A phone starts typing the key: it owns the typing sheet, for the key only. */
  startTyping(remote: RemoteId): void;
  setView(view: View): void;
  toast(text: string): void;
}

/**
 * The "Show and film details" Settings page: its rows, key entry (typed on a phone, never put in the
 * Screen state), Refresh and Credits.
 */
export class DetailsPage {
  #state: ScreenState;
  #h: DetailsPageHost;
  /** A TMDB key being typed on a phone. Kept out of the Screen state and snapshots. */
  #draft = "";

  constructor(state: ScreenState, host: DetailsPageHost) {
    this.#state = state;
    this.#h = host;
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
  action(action: string): boolean {
    if (!action.startsWith("details:")) return false;
    switch (action) {
      case "details:own-key": {
        // The key is typed on a phone's typing sheet.
        const phone = this.#h.connectedPhone();
        if (phone !== undefined) this.startTyping(phone);
        else this.#h.toast("Open Couch's Remote on your phone to type the key");
        break;
      }
      case "details:remove-key":
        this.#h.details.setKey(undefined);
        this.#h.toast("Using the built-in key");
        break;
      case "details:toggle":
        this.#h.details.setEnabled(!this.#h.details.settings().enabled);
        break;
      case "details:refresh":
        this.#h.details.refresh();
        this.#h.toast("Refreshing details");
        break;
      case "details:credits":
        this.#h.setView("credits");
        break;
      default:
        return false;
    }
    return true;
  }

  startTyping(remote: RemoteId): void {
    this.#h.startTyping(remote);
    this.#draft = "";
  }

  /** The page was left (or its typing sheet closed): forget the key being typed. */
  cancel(): void {
    this.#state.typingBy = undefined;
    this.#draft = "";
  }

  /** Typing the household's TMDB key: the text never goes into the Screen state. */
  typeKey(command: Command, from: Source): void {
    const owner = this.#state.typingBy;
    switch (command.command) {
      case "typeOpen":
        if (from === "screen" || (owner !== undefined && owner !== from)) return;
        this.startTyping(from);
        break;
      case "typeText":
        if (owner === from) this.#draft = command.args?.text ?? "";
        break;
      case "typeSubmit":
        if (owner !== from) return;
        this.#state.typingBy = undefined;
        if (this.#draft.trim()) {
          this.#h.details.setKey(this.#draft);
          this.#h.toast("TMDB key saved");
        }
        this.#draft = "";
        break;
      case "typeCancel":
        if (owner !== from) return;
        this.#state.typingBy = undefined;
        this.#draft = "";
        break;
    }
  }
}
