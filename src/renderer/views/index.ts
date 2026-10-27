import { HOME_ITEMS } from "../../shared/home-grid.ts";
import {
  ADD_PHONE_ITEMS,
  LIBRARY_ITEMS,
  REMOTES_ITEMS,
  SETTINGS_ITEMS,
} from "../../shared/settings-grid.ts";
import { APP_ERROR_ITEMS } from "../../shared/app-grid.ts";
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
import * as addons from "./addons.ts";
import * as settingsHome from "./settings-home.ts";
import * as soundOutput from "./sound-output.ts";
import * as settings from "./settings.ts";
import * as settingsGroup from "./settings-group.ts";
import * as show from "./show.ts";
import * as app from "./app.ts";
import * as appError from "./app-error.ts";

/** One entry per view: how to draw it and the grid it reports. Tickets add their own lines. */
export const VIEWS: Partial<Record<View, ViewModule & { grid?: GridItem[] }>> = {
  home: { ...home, grid: HOME_ITEMS },
  settings: { ...settings, grid: SETTINGS_ITEMS },
  settingsRemotes: { ...settingsGroup, grid: REMOTES_ITEMS },
  settingsLibrary: { ...settingsGroup, grid: LIBRARY_ITEMS },
  settingsApps: { ...settingsGroup },
  addPhone: { ...addPhone, grid: ADD_PHONE_ITEMS },
  app: { ...app, grid: [] },
  appError: { ...appError, grid: APP_ERROR_ITEMS },
  // Library views: the core builds their grids from disk.
  library: { ...library },
  folder: { ...library },
  libraryFolders: { ...libraryFolders },
  librarySearch: { ...librarySearch },
  player: { ...player },
  details: { ...details },
  soundOutput: { ...soundOutput },
  settingsHome: { ...settingsHome },
  addons: { ...addons },
  show: { ...show },
  fixMatch: { ...fixMatch },
  credits: {
    ...credits,
    grid: [{ id: "done", r: 0, c: 0, label: "Done", action: "back", initial: true }],
  },
};
