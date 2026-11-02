/** Placeholder: replace with the real Gumroad product URL once it exists. */
export const GUMROAD_URL = "https://abdullahnettoor.gumroad.com/l/couch";
export const GITHUB_URL = "https://github.com/abdullahnettoor/couch";
export const RELEASES_URL = "https://github.com/abdullahnettoor/couch/releases";
export const SITE_URL = "https://couch.abdullahnettoor.com";

/**
 * The hero intro (ticket 139). "sequence": the logo plays first, then the headline, text and buttons arrive.
 * "logo-only": the copy is there from the first paint and the morph plays only in the logo area; the glowing
 * picture comes in when the morph ends. A skip shows everything at once in both. Built in at build time
 * (vite.config.ts); COUCH_INTRO_MODE overrides it for a build (the intro tests build both).
 */
export type IntroMode = "sequence" | "logo-only";
export const INTRO_MODE: IntroMode = "sequence";
