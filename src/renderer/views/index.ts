import { HOME_ITEMS } from "../../shared/home-grid.ts";
import { ADD_PHONE_ITEMS, SETTINGS_ITEMS } from "../../shared/settings-grid.ts";
import { YOUTUBE_ERROR_ITEMS } from "../../shared/youtube-grid.ts";
import type { GridItem, View } from "../../shared/protocol.ts";
import type { ViewModule } from "./dom.ts";
import * as addPhone from "./add-phone.ts";
import * as credits from "./credits.ts";
import * as details from "./details.ts";
import * as fixMatch from "./fix-match.ts";
import * as home from "./home.ts";
import * as library from "./library.ts";
import * as librarySearch from "./library-search.ts";
import * as libraryFolders from "./library-folders.ts";
import * as player from "./player.ts";
import * as settings from "./settings.ts";
import * as show from "./show.ts";
import * as youtube from "./youtube.ts";
import * as youtubeError from "./youtube-error.ts";

/** One entry per view: how to draw it and the grid it reports. Tickets add their own lines. */
export const VIEWS: Partial<Record<View, ViewModule & { grid?: GridItem[] }>> = {
  home: { ...home, grid: HOME_ITEMS },
  settings: { ...settings, grid: SETTINGS_ITEMS },
  addPhone: { ...addPhone, grid: ADD_PHONE_ITEMS },
  youtube: { ...youtube, grid: [] },
  youtubeError: { ...youtubeError, grid: YOUTUBE_ERROR_ITEMS },
  // Library views: the core builds their grids from disk.
  library: { ...library },
  folder: { ...library },
  libraryFolders: { ...libraryFolders },
  librarySearch: { ...librarySearch },
  player: { ...player },
  details: { ...details },
  show: { ...show },
  fixMatch: { ...fixMatch },
  credits: {
    ...credits,
    grid: [{ id: "done", r: 0, c: 0, label: "Done", action: "back", initial: true }],
  },
};
