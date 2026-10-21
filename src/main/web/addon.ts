import type { Store } from "../ports/store.ts";
import type { BeforeRequestHandler, HeadersHandler } from "./request-hooks.ts";

/** What an add-on may do to the requests a web App's session makes. It never touches `session.webRequest` itself. */
export interface AddonRequests {
  onBeforeRequest?: BeforeRequestHandler;
  onBeforeSendHeaders?: HeadersHandler;
}

/** An optional change to one web App's page, turned on or off in Settings. */
export interface Addon {
  id: string;
  label: string;
  /** One line shown under the label in Settings. */
  description: string;
  /** The web App it belongs to (its id, e.g. "youtube"). */
  app: string;
  defaultOn: boolean;
  /** Main-world function source (`function () { ... }`) run before the page's scripts, after `couchHooks` exists. */
  page?: string;
  requests?: AddonRequests;
}

export type AddonChoices = Record<string, boolean>;

/** The add-ons that are on: the household's choice, else the default. */
export function enabledAddons(addons: Addon[], choices: AddonChoices): Addon[] {
  return addons.filter((a) => choices[a.id] ?? a.defaultOn);
}

export function readChoices(store: Store, app: string): AddonChoices {
  const doc = store.read<Record<string, unknown>>("addons", {});
  const mine = doc?.[app];
  return mine && typeof mine === "object" && !Array.isArray(mine) ? (mine as AddonChoices) : {};
}

/** Saves one choice; the document keeps only choices that differ from the add-on's default. */
export function writeChoice(
  store: Store,
  addons: Addon[],
  app: string,
  id: string,
  on: boolean,
): void {
  const doc = store.read<Record<string, AddonChoices>>("addons", {});
  const choices = { ...readChoices(store, app) };
  const addon = addons.find((a) => a.id === id);
  if (addon && addon.defaultOn === on) delete choices[id];
  else choices[id] = on;
  store.write("addons", { ...doc, [app]: choices });
}
