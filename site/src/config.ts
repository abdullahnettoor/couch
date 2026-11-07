/** Placeholder: replace with the real Gumroad product URL once it exists. */
export const GUMROAD_URL = "https://abdullahnettoor.gumroad.com/l/couch";
export const GITHUB_URL = "https://github.com/abdullahnettoor/couch";
export const RELEASES_URL = "https://github.com/abdullahnettoor/couch/releases";
/** "or download free from GitHub": the newest stable release's .dmg. Keep it exactly this (site README, "Publishing"). */
export const DOWNLOAD_URL = `${RELEASES_URL}/latest/download/Couch-arm64.dmg`;
/** The Couch for Windows card links here: a GitHub issue where people add a 👍 if they'd use it. */
export const WINDOWS_ISSUE_URL = `${GITHUB_URL}/issues/34`;
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
 * The launch video in the first-look TV (ticket 145): opening YouTube on the TV plays it. Empty `id`: placeholder mode
 * (YouTube opens to a Couch-made poster, "Launch video", "Coming soon to YouTube"; nothing is fetched from YouTube, at
 * build time or ever). With an `id` (the part after watch?v=): YouTube opens to YouTube's own player for it, cued, over
 * the video's thumbnail (saved into the build by scripts/launch-thumb.mjs; pnpm build runs it); nothing is requested
 * from YouTube until the visitor opens YouTube. `title` is the video's title, as on YouTube. Today a stand-in (a PumpOS
 * video) until Couch's own is out. COUCH_LAUNCH_ID (and COUCH_LAUNCH_THUMB, a local picture) override them for a
 * build; the tests use them.
 */
export const LAUNCH_VIDEO: { id: string; title: string } = { id: "Hy7ry2TbjIg", title: "PumpOS | The operating system for fuel retail" };

/**
 * The hero intro (ticket 139). "sequence": the logo plays first, then the headline, text and buttons arrive.
 * "logo-only": the copy is there from the first paint and the morph plays only in the logo area; the glowing
 * picture comes in when the morph ends. A skip shows everything at once in both. Built in at build time
 * (vite.config.ts); COUCH_INTRO_MODE overrides it for a build (the intro tests build both).
 */
export type IntroMode = "sequence" | "logo-only";
export const INTRO_MODE: IntroMode = "sequence";
