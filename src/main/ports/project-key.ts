declare const __COUCH_TMDB_TOKEN__: string | undefined;

/** The project's TMDB key, injected into the main bundle at build time from COUCH_TMDB_TOKEN ("" when not set). */
export const PROJECT_TMDB_KEY: string =
  typeof __COUCH_TMDB_TOKEN__ === "string" ? __COUCH_TMDB_TOKEN__ : "";
