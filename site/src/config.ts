/** Placeholder: replace with the real Gumroad product URL once it exists. */
export const GUMROAD_URL = "https://abdullahnettoor.gumroad.com/l/couch";
export const GITHUB_URL = "https://github.com/abdullahnettoor/couch";
export const RELEASES_URL = "https://github.com/abdullahnettoor/couch/releases";
export const SITE_URL = "https://couch.abdullahnettoor.com";
/** How to add a web App to Couch (the Apps section and "Why I made Couch" link here). */
export const ADD_APP_URL = `${GITHUB_URL}/blob/main/CONTRIBUTING.md#add-a-web-app`;

/**
 * Elsewhere (ticket 143): the footer lists exactly these, in this order, and nothing else, as icons only. `label`
 * is the link's accessible name (and its tooltip); `icon` picks a Phosphor brand mark from vite.config.ts
 * (SOCIAL_ICONS). A link without an icon is shown as its label.
 */
export interface SocialLink { label: string; href: string; icon?: "github" | "x" | "linkedin" | "youtube" }
export const SOCIAL: readonly SocialLink[] = [
  { label: "Couch on GitHub", href: GITHUB_URL, icon: "github" },
  { label: "Abdullah Nettoor on X", href: "https://x.com/abdullahnettoor", icon: "x" },
  { label: "Abdullah Nettoor on LinkedIn", href: "https://www.linkedin.com/in/abdullahnettoor", icon: "linkedin" },
  { label: "Abdullah Nettoor on YouTube", href: "https://www.youtube.com/@abdullahnettoor", icon: "youtube" },
];

/**
 * The hero intro (ticket 139). "sequence": the logo plays first, then the headline, text and buttons arrive.
 * "logo-only": the copy is there from the first paint and the morph plays only in the logo area; the glowing
 * picture comes in when the morph ends. A skip shows everything at once in both. Built in at build time
 * (vite.config.ts); COUCH_INTRO_MODE overrides it for a build (the intro tests build both).
 */
export type IntroMode = "sequence" | "logo-only";
export const INTRO_MODE: IntroMode = "sequence";
