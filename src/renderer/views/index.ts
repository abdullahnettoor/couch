import { HOME_ITEMS } from "../../shared/home-grid.ts";
import { ADD_PHONE_ITEMS, SETTINGS_ITEMS } from "../../shared/settings-grid.ts";
import type { GridItem, View } from "../../shared/protocol.ts";
import type { ViewModule } from "./dom.ts";
import * as addPhone from "./add-phone.ts";
import * as home from "./home.ts";
import * as library from "./library.ts";
import * as libraryFolders from "./library-folders.ts";
import * as settings from "./settings.ts";

/** One entry per view: how to draw it and the grid it reports. Tickets add their own lines. */
export const VIEWS: Partial<Record<View, ViewModule & { grid?: GridItem[] }>> = {
  home: { ...home, grid: HOME_ITEMS },
  settings: { ...settings, grid: SETTINGS_ITEMS },
  addPhone: { ...addPhone, grid: ADD_PHONE_ITEMS },
  // Library views: the core builds their grids from disk.
  library: { ...library },
  folder: { ...library },
  libraryFolders: { ...libraryFolders },
};
