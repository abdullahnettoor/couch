import { OPEN_APP } from "../apps/index.ts";
import type { View } from "../../shared/protocol.ts";

/** What an action handler may do to the core. */
export interface ActionContext {
  open(view: View): void;
  toast(text: string): void;
  forgetAllPhones(): void;
  /** Settings → About, focused on Restart to update (Home's update icon). */
  openUpdate(): void;
  openApp(id: string): void;
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
  "open:update": (ctx) => ctx.openUpdate(),
};

/** `app:open:<id>` opens any App. */
function appAction(action: string): ActionHandler | undefined {
  if (action.startsWith(OPEN_APP)) return (ctx) => ctx.openApp(action.slice(OPEN_APP.length));
  return undefined;
}

const settingsActions: Record<string, ActionHandler> = {
  "settings:remotes": (ctx) => ctx.open("settingsRemotes"),
  "settings:library": (ctx) => ctx.open("settingsLibrary"),
  "settings:home": (ctx) => ctx.open("settingsHome"),
  "settings:about": (ctx) => ctx.open("about"),
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
};

export function actionFor(action: string): ActionHandler | undefined {
  return ACTIONS[action] ?? appAction(action);
}
