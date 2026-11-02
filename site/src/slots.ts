/**
 * The screenshot slot manifest: every product picture on the page, in one typed place.
 * Read at build time by vite.config.ts, which writes the <img> into index.html
 * ({{slot:name}}) or swaps it in for a CSS mock (<!--mock:name-->…<!--/mock-->).
 * A replacement file src/shots/slot-<name>.(png|jpg|webp) overrides `file` and keeps the
 * alt text, size and loading priority declared here. See the README.
 */
export interface Slot {
  /** Picture in src/shots/, or null while a CSS mock stands in. */
  file: string | null;
  /** Alt text, kept when the picture is replaced. */
  alt: string;
  /** Intrinsic size of the picture (also what a replacement should be cropped to). */
  width: number;
  height: number;
  /** "eager" for anything in the first viewport; everything else "lazy". */
  loading: "eager" | "lazy";
  /** Smaller copies of `file`, named <stem>-<width>.webp (scripts/shots.mjs), and the width the slot is shown at. */
  srcset?: { widths: readonly number[]; sizes: string };
}

const SCREEN = { width: 1920, height: 1080 } as const;
const PHONE = { width: 1080, height: 2280 } as const;
const SHOT = { ...SCREEN, loading: "lazy" } as const;
/** Home and the Library at the Mac display's own 16:10, so no crop cuts through their UI (scripts/shots.mjs). */
const SHOT_16X10 = { width: 1920, height: 1200, loading: "lazy" } as const;
const widths = [640, 1280] as const;

// The real Couch, from the ticket 140 shoot (scripts/shots.mjs). The films are Blender's open films (© Blender
// Foundation, CC BY 3.0) and the posters and backdrops come from TMDB; the footer and /licenses/ credit both.
export const slots = {
  "hero-screen": {
    file: "home.webp", ...SHOT_16X10, srcset: { widths, sizes: "(max-width: 1048px) calc(100vw - 66px), 982px" },
    alt: "Couch Home on the Screen: Big Buck Bunny under Continue watching, its picture filling the Screen with Resume and From start, and the YouTube, Netflix and Library Apps below",
  },
  "remote-screen": {
    file: null, ...SCREEN, loading: "lazy",
    alt: "Couch Home during phone pairing, with a QR code or a connected phone and a highlighted App",
  },
  "remote-phone": {
    file: null, ...PHONE, loading: "lazy",
    alt: "A phone pairing with Couch, then showing the Remote and its D-pad",
  },
  "apps-screen": {
    file: null, ...SCREEN, loading: "lazy",
    alt: "Couch Home with the YouTube, Netflix and Library Apps and unfinished videos",
  },
  "library-screen": {
    file: "library.webp", ...SHOT_16X10, srcset: { widths, sizes: "(max-width: 880px) calc(100vw - 58px), min(50vw, 640px)" },
    alt: "The Library on the Screen: a Films shelf with the posters of Big Buck Bunny, Sintel and Tears of Steel, and the highlighted film's details above",
  },
  "privacy-screen": {
    file: "settings.webp", ...SHOT, srcset: { widths, sizes: "(max-width: 700px) calc(100vw - 80px), min(40vw, 460px)" },
    alt: "Couch Settings: Remotes and Devices with one phone connected, Library, Sound output, Apps, Home and Quit Couch",
  },
  "setup-remotes": {
    file: "remotes.webp", ...SHOT, srcset: { widths, sizes: "(max-width: 700px) calc(100vw - 82px), min(30vw, 340px)" },
    alt: "Remotes and Devices in Settings, with Add a phone highlighted to show the QR code",
  },
  "setup-player": {
    file: "player.webp", ...SHOT, srcset: { widths, sizes: "(max-width: 700px) calc(100vw - 82px), min(30vw, 340px)" },
    alt: "Big Buck Bunny playing full screen in Couch's player",
  },
} as const satisfies Record<string, Slot>;

export type SlotName = keyof typeof slots;
