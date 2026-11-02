/** Placeholder: replace with the real Gumroad product URL once it exists. */
export const GUMROAD_URL = "https://abdullahnettoor.gumroad.com/l/couch";
export const GITHUB_URL = "https://github.com/abdullahnettoor/couch";
export const RELEASES_URL = "https://github.com/abdullahnettoor/couch/releases";
export const SITE_URL = "https://couch.abdullahnettoor.com";

/**
 * Couch elsewhere (ticket 143): the footer lists exactly these, in this order, and nothing else. Add a link here
 * when an account exists; `icon` picks a drawn mark from vite.config.ts (SOCIAL_ICONS), or none for a text link.
 */
export interface SocialLink { label: string; href: string; icon?: "github" }
export const SOCIAL: readonly SocialLink[] = [
  { label: "GitHub", href: GITHUB_URL, icon: "github" },
];

/**
 * The hero intro (ticket 139). "sequence": the logo plays first, then the headline, text and buttons arrive.
 * "logo-only": the copy is there from the first paint and the morph plays only in the logo area; the glowing
 * picture comes in when the morph ends. A skip shows everything at once in both. Built in at build time
 * (vite.config.ts); COUCH_INTRO_MODE overrides it for a build (the intro tests build both).
 */
export type IntroMode = "sequence" | "logo-only";
export const INTRO_MODE: IntroMode = "sequence";
