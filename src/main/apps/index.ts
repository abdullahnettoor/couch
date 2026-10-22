import { iconSvg } from "../../shared/icons.ts";
import { YOUTUBE_MARK } from "./youtube/icon.ts";

/** One App on Home: what the tile shows and what OK on it does. Pure data, safe for the renderer. */
export interface AppEntry {
  id: string;
  label: string;
  /** The tile's icon, as SVG markup. */
  icon: string;
  action: string;
  /** A web App core hands the Screen to; false for a built-in that opens one of Couch's own views. */
  web: boolean;
  /** The App has add-ons, listed on its settings page. */
  addons?: boolean;
}

/** The Apps on Home, in order. Each ticket adding an App adds its entry here. */
export const APP_ENTRIES: AppEntry[] = [
  {
    id: "youtube",
    label: "YouTube",
    icon: YOUTUBE_MARK,
    action: "app:open:youtube",
    web: true,
    addons: true,
  },
  { id: "library", label: "Library", icon: iconSvg("folder"), action: "open:library", web: false },
];

export const OPEN_APP = "app:open:";
export const RESTART_APP = "app:restart:";

export function appEntry(id: string | undefined): AppEntry | undefined {
  return APP_ENTRIES.find((e) => e.id === id);
}
