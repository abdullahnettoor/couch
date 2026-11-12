import type { View } from "../../shared/protocol.ts";
import type { ViewModule } from "./dom.ts";
import * as about from "./about.ts";
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

/** One entry per view: how to draw it. The core builds the grids. */
export const VIEWS: Partial<Record<View, ViewModule>> = {
  home,
  settings,
  settingsRemotes: settingsGroup,
  settingsLibrary: settingsGroup,
  settingsApps: settingsGroup,
  addPhone,
  app,
  appError,
  library,
  folder: library,
  libraryFolders,
  librarySearch,
  player,
  details,
  soundOutput,
  settingsHome,
  about,
  addons,
  show,
  fixMatch,
  credits,
};
