/**
 * The screenshot slot manifest: every product picture on the page, in one typed place.
 * Read at build time by vite.config.ts, which writes the <img> into index.html
 * ({{slot:name}}) or swaps it in for a CSS mock (<!--mock:name-->…<!--/mock-->).
 * A replacement file src/shots/slot-<name>.(png|jpg|webp) overrides `file` and keeps the
 * alt text, size and loading priority declared here. See the README.
 */
export interface Slot {
  /** Interim picture in src/shots/, or null while a CSS mock stands in. */
  file: string | null;
  /** Alt text, kept when the picture is replaced. */
  alt: string;
  /** Intrinsic size of the picture (also what a replacement should be cropped to). */
  width: number;
  height: number;
  /** "eager" for anything in the first viewport; everything else "lazy". */
  loading: "eager" | "lazy";
}

const SCREEN = { width: 1920, height: 1080 } as const;
const PHONE = { width: 1080, height: 2280 } as const;

export const slots = {
  "hero-screen": {
    file: null, ...SCREEN, loading: "eager",
    alt: "Couch Home on the Screen, with a clock and the YouTube, Netflix and Library Apps",
  },
  "hero-remote": {
    file: null, ...PHONE, loading: "eager",
    alt: "The Remote on a phone, with Apps, a D-pad and volume controls",
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
    file: "library.jpg", width: 1400, height: 787, loading: "lazy",
    alt: "The Library on the Screen, with a highlighted test video and its picture",
  },
  "privacy-screen": {
    file: "settings.jpg", width: 1400, height: 787, loading: "lazy",
    alt: "Couch Settings, with Remotes and Devices, Library, Sound output, Apps and Home",
  },
  "setup-remotes": {
    file: "remotes.jpg", width: 1400, height: 787, loading: "lazy",
    alt: "Remotes and Devices in Settings, with Add a phone highlighted",
  },
  "setup-player": {
    file: "player.jpg", width: 1400, height: 909, loading: "lazy",
    alt: "A test video playing in the Library, with playback, subtitle and volume controls",
  },
} as const satisfies Record<string, Slot>;

export type SlotName = keyof typeof slots;
