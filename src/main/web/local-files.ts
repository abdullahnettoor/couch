import type { BeforeRequestHandler } from "./request-hooks.ts";

/**
 * A web App's page may never load a local file. Couch keeps its own pictures (Home wallpaper photos
 * among them) as `file:` URLs for the Screen alone, so an App's session cancels every one.
 */
export const blockLocalFiles: BeforeRequestHandler = (details) =>
  details.url.toLowerCase().startsWith("file:") ? { cancel: true } : undefined;
