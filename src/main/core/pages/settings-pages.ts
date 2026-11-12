import type { GridItem, ScreenPayload } from "../../../shared/protocol.ts";
import {
  ADD_PHONE_ITEMS,
  LIBRARY_ITEMS,
  REMOTES_ITEMS,
  SETTINGS_ITEMS,
} from "../../../shared/settings-grid.ts";
import type { MetadataService } from "../metadata-service.ts";
import type { SoundOutput } from "../sound-output.ts";
import { backTo, type Page, type PageBack, type PageContext } from "./page.ts";

/** A Settings Page with no actions of its own: its rows are the global `settings:*` actions. */
abstract class MenuPage implements Page {
  protected ctx: PageContext;

  constructor(ctx: PageContext) {
    this.ctx = ctx;
  }

  abstract grid(): GridItem[];
  abstract back(): PageBack | undefined;

  payload(): Partial<ScreenPayload> {
    return {};
  }

  action(_action: string): boolean {
    return false;
  }
}

/** What Settings and Settings → Library show: the details settings, and the sound output summary on Settings. */
export interface SettingsHost {
  details: Pick<MetadataService, "settings">;
  sound: Pick<SoundOutput, "payload">;
}

/** Settings: the group rows. */
export class SettingsPage extends MenuPage {
  #h: SettingsHost;

  constructor(ctx: PageContext, host: SettingsHost) {
    super(ctx);
    this.#h = host;
  }

  grid(): GridItem[] {
    return SETTINGS_ITEMS;
  }

  override payload(): Partial<ScreenPayload> {
    return { details: this.#h.details.settings(), sound: this.#h.sound.payload() };
  }

  back(): PageBack {
    return backTo(this.ctx, "home");
  }
}

export interface RemotesPageHost {
  /** The listener's login item and whether a listener is running. */
  listener(): { available: boolean; on: boolean; running: boolean };
  /** Reads the login item again from the Mac. */
  refresh(): void;
}

/** Settings → Remotes and Devices: refreshes the listener's login item on entering. */
export class RemotesPage extends MenuPage {
  #h: RemotesPageHost;

  constructor(ctx: PageContext, host: RemotesPageHost) {
    super(ctx);
    this.#h = host;
  }

  grid(): GridItem[] {
    return REMOTES_ITEMS;
  }

  override payload(): Partial<ScreenPayload> {
    return { listener: { ...this.#h.listener() } };
  }

  enter(): void {
    this.#h.refresh();
  }

  back(): PageBack {
    return backTo(this.ctx, "settings");
  }
}

/** Settings → Add a phone. */
export class AddPhonePage extends MenuPage {
  grid(): GridItem[] {
    return ADD_PHONE_ITEMS;
  }

  back(): PageBack {
    return backTo(this.ctx, "settingsRemotes");
  }
}

/** Settings → Library: Library folders and the details page. */
export class LibrarySettingsPage extends MenuPage {
  #h: Pick<SettingsHost, "details">;

  constructor(ctx: PageContext, host: Pick<SettingsHost, "details">) {
    super(ctx);
    this.#h = host;
  }

  grid(): GridItem[] {
    return LIBRARY_ITEMS;
  }

  override payload(): Partial<ScreenPayload> {
    return { details: this.#h.details.settings() };
  }

  back(): PageBack {
    return backTo(this.ctx, "settings");
  }
}

/** Credits: the details page's Done. */
export class CreditsPage extends MenuPage {
  #h: Pick<SettingsHost, "details">;

  constructor(ctx: PageContext, host: Pick<SettingsHost, "details">) {
    super(ctx);
    this.#h = host;
  }

  grid(): GridItem[] {
    return [{ id: "done", r: 0, c: 0, label: "Done", action: "back", initial: true }];
  }

  override payload(): Partial<ScreenPayload> {
    return { details: this.#h.details.settings() };
  }

  back(): PageBack {
    return backTo(this.ctx, "details");
  }
}

export interface LibraryFoldersHost {
  folders(): string[];
  /** The Mac's folder picker, then the usual save and scan. */
  add(): void;
  remove(folder: string): void;
}

const ADD = "library:add";
const REMOVE = "library:remove:";

/** Settings → Library folders: Add folder, then one row per folder (OK removes it). */
export class LibraryFoldersPage extends MenuPage {
  #h: LibraryFoldersHost;

  constructor(ctx: PageContext, host: LibraryFoldersHost) {
    super(ctx);
    this.#h = host;
  }

  grid(): GridItem[] {
    return [
      { id: "add", r: 0, c: 0, label: "Add folder", action: ADD, initial: true },
      ...this.#h.folders().map((f, i) => ({
        id: f,
        r: i + 1,
        c: 0,
        label: f,
        action: `${REMOVE}${f}`,
      })),
    ];
  }

  override payload(): Partial<ScreenPayload> {
    return { library: { heading: "Library folders", entries: [], folders: this.#h.folders() } };
  }

  override action(action: string): boolean {
    if (action === ADD) this.#h.add();
    else if (action.startsWith(REMOVE)) this.#h.remove(action.slice(REMOVE.length));
    else return false;
    return true;
  }

  back(): PageBack {
    return backTo(this.ctx, "settingsLibrary");
  }
}
