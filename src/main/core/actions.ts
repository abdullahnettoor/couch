import { OPEN_APP, RESTART_APP } from "../apps/index.ts";
import { PLAYBACK_APP, SIGN_IN_APP } from "./home-apps.ts";
import { SETTINGS_APP } from "../../shared/settings-grid.ts";
import type { View } from "../../shared/protocol.ts";

/** What an action handler may do to the core. */
export interface ActionContext {
  open(view: View): void;
  openAppMenu(id: string): void;
  toast(text: string): void;
  forgetAllPhones(): void;
  openApp(id: string): void;
  retryApp(): void;
  restartApp(id: string): void;
  copySignInFromCouch(id: string): void;
  signOut(id: string): void;
  switchPlayback(id: string): void;
  toggleListener(): void;
  quit(): void;
}

export type ActionHandler = (ctx: ActionContext) => void;

/**
 * What OK does on a focused item, by the item's `action`. Each ticket adds its entries
 * in its own function below and spreads it into ACTIONS.
 */
const homeActions: Record<string, ActionHandler> = {
  "open:settings": (ctx) => ctx.open("settings"),
  "open:library": (ctx) => ctx.open("library"),
};

const appActions: Record<string, ActionHandler> = {
  "app:retry": (ctx) => ctx.retryApp(),
};

/** `app:open:<id>` and `app:restart:<id>` for any App. */
function appAction(action: string): ActionHandler | undefined {
  if (action.startsWith(OPEN_APP)) return (ctx) => ctx.openApp(action.slice(OPEN_APP.length));
  if (action.startsWith(SETTINGS_APP))
    return (ctx) => ctx.openAppMenu(action.slice(SETTINGS_APP.length));
  if (action.startsWith(SIGN_IN_APP)) {
    const [verb, id = ""] = action.slice(SIGN_IN_APP.length).split(":");
    if (verb === "couch") return (ctx) => ctx.copySignInFromCouch(id);
    if (verb === "out") return (ctx) => ctx.signOut(id);
    return undefined;
  }
  if (action.startsWith(PLAYBACK_APP))
    return (ctx) => ctx.switchPlayback(action.slice(PLAYBACK_APP.length));
  if (action.startsWith(RESTART_APP))
    return (ctx) => ctx.restartApp(action.slice(RESTART_APP.length));
  return undefined;
}

const settingsActions: Record<string, ActionHandler> = {
  "settings:remotes": (ctx) => ctx.open("settingsRemotes"),
  "settings:library": (ctx) => ctx.open("settingsLibrary"),
  "settings:home": (ctx) => ctx.open("settingsHome"),
  "settings:apps": (ctx) => ctx.open("settingsApps"),
  "settings:add-phone": (ctx) => ctx.open("addPhone"),
  "settings:forget-phones": (ctx) => ctx.forgetAllPhones(),
  "settings:library-folders": (ctx) => ctx.open("libraryFolders"),
  "settings:details": (ctx) => ctx.open("details"),
  "settings:sound": (ctx) => ctx.open("soundOutput"),
  "settings:addons": (ctx) => ctx.open("addons"),
  "settings:listener": (ctx) => ctx.toggleListener(),
  "settings:quit": (ctx) => ctx.quit(),
};

export const ACTIONS: Record<string, ActionHandler> = {
  ...homeActions,
  ...settingsActions,
  ...appActions,
};

export function actionFor(action: string): ActionHandler | undefined {
  return ACTIONS[action] ?? appAction(action);
}

/** Where Back goes from each view. A view with no entry ignores Back. */
export const BACK_TARGETS: Partial<Record<View, View>> = {
  settings: "home",
  settingsRemotes: "settings",
  settingsLibrary: "settings",
  settingsApps: "settings",
  addPhone: "settingsRemotes",
  appError: "home",
  libraryFolders: "settingsLibrary",
  details: "settingsLibrary",
  soundOutput: "settings",
  settingsHome: "settings",
  addons: "settingsApps",
  credits: "details",
  library: "home",
  show: "library",
};
