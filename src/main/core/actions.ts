import type { View } from "../../shared/protocol.ts";

/** What an action handler may do to the core. */
export interface ActionContext {
  open(view: View): void;
  toast(text: string): void;
  forgetAllPhones(): void;
  openYouTube(): void;
  retryYouTube(): void;
  restartYouTube(): void;
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
  "open:youtube": (ctx) => ctx.openYouTube(),
};

const youtubeActions: Record<string, ActionHandler> = {
  "youtube:retry": (ctx) => ctx.retryYouTube(),
  "settings:restart-youtube": (ctx) => ctx.restartYouTube(),
};

const settingsActions: Record<string, ActionHandler> = {
  "settings:add-phone": (ctx) => ctx.open("addPhone"),
  "settings:forget-phones": (ctx) => ctx.forgetAllPhones(),
  "settings:library-folders": (ctx) => ctx.open("libraryFolders"),
  "settings:details": (ctx) => ctx.open("details"),
  "settings:quit": (ctx) => ctx.quit(),
};

export const ACTIONS: Record<string, ActionHandler> = {
  ...homeActions,
  ...settingsActions,
  ...youtubeActions,
};

/** Where Back goes from each view. A view with no entry ignores Back. */
export const BACK_TARGETS: Partial<Record<View, View>> = {
  settings: "home",
  addPhone: "settings",
  youtubeError: "home",
  libraryFolders: "settings",
  details: "settings",
  credits: "details",
  library: "home",
  show: "library",
};
