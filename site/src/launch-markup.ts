/**
 * The first look's live TV (ticket 145), written into index.html at build time (vite.config.ts); src/launch.ts makes
 * it work. Over the Home screenshot: Couch's live Home (src/mocks.ts launchHome, each tile with a real button laid
 * over it), the face an App grows from when it opens, each App's view, the Home (Back) button and the hint.
 *  - YouTube opens the launch video (LAUNCH_VIDEO, src/config.ts): with an id, YouTube's own player, cued, over the
 *    video's thumbnail (a local file, saved by scripts/launch-thumb.mjs); the player's URL is only in a data
 *    attribute until the visitor opens YouTube. Without an id (the placeholder), a Couch-made poster, "Launch video",
 *    "Coming soon to YouTube", and nothing on the page refers to YouTube's servers.
 *  - Library: a glimpse of Couch's Library (the Library section's screenshot). Continue: Couch's player on Big Buck
 *    Bunny (src/shots/player.webp). Netflix: a card saying what it opens; nothing from Netflix.
 * Read by vite.config.ts at build time (node), never shipped as script.
 */
import { appById, launchHome, mark } from "./mocks.ts";

export interface LaunchOptions {
  /** The YouTube video id, or "" for the placeholder. */
  id: string;
  title: string;
  /** The thumbnail's URL in the build (root-relative) and a smaller copy, when there is one. */
  thumb?: { src: string; small?: string };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
/** Phosphor's caret-left (regular; MIT, public/licenses/), as Couch's "‹ Home". */
const caretLeft = `<svg viewBox="0 0 256 256" aria-hidden="true"><path d="M165.66,202.34a8,8,0,0,1-11.32,11.32l-80-80a8,8,0,0,1,0-11.32l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z"/></svg>`;
/** Phosphor's mouse-simple and hand-tap (regular; MIT, public/licenses/), for the overlay. */
const mouseIcon = `<svg viewBox="0 0 256 256" aria-hidden="true"><path d="M144,16H112A64.07,64.07,0,0,0,48,80v96a64.07,64.07,0,0,0,64,64h32a64.07,64.07,0,0,0,64-64V80A64.07,64.07,0,0,0,144,16Zm48,160a48.05,48.05,0,0,1-48,48H112a48.05,48.05,0,0,1-48-48V80a48.05,48.05,0,0,1,48-48h32a48.05,48.05,0,0,1,48,48ZM136,64v48a8,8,0,0,1-16,0V64a8,8,0,0,1,16,0Z"/></svg>`;
const tapIcon = `<svg viewBox="0 0 256 256" aria-hidden="true"><path d="M56,76a60,60,0,0,1,120,0,8,8,0,0,1-16,0,44,44,0,0,0-88,0,8,8,0,1,1-16,0Zm140,44a27.9,27.9,0,0,0-13.36,3.39A28,28,0,0,0,144,106.7V76a28,28,0,0,0-56,0v80l-3.82-6.13a28,28,0,0,0-48.41,28.17l29.32,50A8,8,0,1,0,78.89,220L49.6,170a12,12,0,1,1,20.78-12l.14.23,18.68,30A8,8,0,0,0,104,184V76a12,12,0,0,1,24,0v68a8,8,0,1,0,16,0V132a12,12,0,0,1,24,0v20a8,8,0,0,0,16,0v-4a12,12,0,0,1,24,0v36c0,21.61-7.1,36.3-7.16,36.42a8,8,0,0,0,3.58,10.73A7.9,7.9,0,0,0,208,232a8,8,0,0,0,7.16-4.42c.37-.73,8.85-18,8.85-43.58V148A28,28,0,0,0,196,120Z"/></svg>`;

/**
 * The overlay over the whole Screen as the TV comes into place: how to use it, large (src/launch.ts shows it; the
 * toolbar's description carries the same for screen readers, so it is hidden from them). Keys and mouse, or touch,
 * by media query.
 */
export const VEIL = {
  key: { title: "Use the arrow keys or your mouse", sub: "Enter or click opens a tile" },
  touch: { title: "Tap a tile to open it" },
  remote: { title: "Use the Remote below, or tap a tile" },
};
export const NETFLIX_LINE = "Netflix opens Netflix's own website, signed in with your account.";
const veil = `<div class="lv-veil" aria-hidden="true">`
  + `<div class="lv-veil-key"><div class="lv-veil-glyphs"><span class="lv-key">←</span><span class="lv-key">→</span><span class="lv-veil-or">or</span>${mouseIcon}</div>`
  + `<p class="lv-veil-title">${VEIL.key.title}</p><p class="lv-veil-sub">${VEIL.key.sub}</p></div>`
  + `<div class="lv-veil-touch"><div class="lv-veil-glyphs">${tapIcon}</div><p class="lv-veil-title lv-veil-tap">${VEIL.touch.title}</p><p class="lv-veil-title lv-veil-remote">${VEIL.remote.title}</p></div></div>`;

/** The Screen's pictures: 16:10, as wide as the first-look TV's Screen. */
const SIZES = "(max-width: 700px) calc(100vw - 50px), min(calc(100vw - 66px), calc((100vh - 122px) * 1.6), 1582px)";

/**
 * The player's address: YouTube's privacy-enhanced embed, inline on phones, cued and not autoplaying: it shows
 * YouTube's own thumbnail and play button, and the visitor's press on that is what starts it, so the play counts as a
 * YouTube view (YouTube: "Embedded videos that are autoplayed don't increment video views").
 */
export const embedUrl = (id: string) => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0&playsinline=1`;

/** The hint over the Screen: by keys and mouse, or by touch; and on YouTube, while the scroll is moving the highlight. */
export function hints(video: boolean) {
  return {
    key: "Use ← → or your mouse. Press Enter to open.",
    touch: "Tap a tile.",
    ytKey: video ? "Press Enter or click to watch the launch video." : "Press Enter or click to open YouTube.",
    ytTouch: video ? "Tap YouTube to watch the launch video." : "Tap YouTube to open it.",
  };
}

/** Everything inside the TV after the screenshot. */
export function launchScreen(o: LaunchOptions): string {
  const video = !!o.id;
  const labels = {
    youtube: video ? `Open YouTube: ${o.title}` : "Open YouTube",
    netflix: "Open Netflix",
    library: "Open the Library",
    continue: "Continue Big Buck Bunny (2008), 7 min left",
  };
  const faceMark = (id: string) => `<span class="lv-open-mark" data-for="${id}">${mark(appById(id))}</span>`;
  const open = `<div class="lv-open" aria-hidden="true">${["youtube", "netflix", "library"].map(faceMark).join("")}`
    + `<img class="lv-open-art" src="/src/shots/launch-continue.webp" width="420" height="238" alt="" loading="lazy" decoding="async" /></div>`;
  let youtube: string;
  if (!video) {
    // the poster: Couch's own light (the icon's sofa-and-Screen glow, the hero's picture and its two sizes) in a dark, warm room
    youtube = `<div class="lv-view lv-poster" data-view="youtube"><div class="lv-light" aria-hidden="true"><img src="/src/shots/couch-glow.webp" srcset="/src/shots/couch-glow-480.webp 480w, /src/shots/couch-glow.webp 832w" sizes="(max-width: 700px) 45vw, 480px" width="832" height="688" alt="" loading="lazy" decoding="async" /></div>`
      + `<div class="lv-text"><p class="lv-title">Launch video</p><p class="lv-meta">Coming soon to YouTube</p></div></div>`;
  } else {
    const t = o.thumb!;
    const set = t.small ? ` srcset="${t.small} 640w, ${t.src} 1280w" sizes="${SIZES}"` : "";
    youtube = `<div class="lv-view" data-view="youtube"><img class="lv-thumb" src="${t.src}"${set} width="1280" height="720" alt="" loading="lazy" decoding="async" /></div>`;
  }
  // the Library screenshot has Couch's own "‹ Home" (top left): an invisible button over it is the view's Home
  const libHome = `<button class="lv-libhome" type="button" aria-label="Home"></button>`;
  const library = `<div class="lv-view" data-view="library">${libHome}<img src="/src/shots/library.webp" srcset="/src/shots/library-640.webp 640w, /src/shots/library-1280.webp 1280w, /src/shots/library.webp 1920w" sizes="${SIZES}" width="1920" height="1200" alt="Couch's Library: the Films shelf with Big Buck Bunny, Sintel and Tears of Steel" loading="lazy" decoding="async" /></div>`;
  const player = `<div class="lv-view" data-view="continue"><img src="/src/shots/player.webp" srcset="/src/shots/player-640.webp 640w, /src/shots/player.webp 1280w" sizes="${SIZES}" width="1280" height="800" alt="Couch's player: Big Buck Bunny (2008) at 2:04, 7:52 left, with its controls" loading="lazy" decoding="async" /></div>`;
  // Netflix's signed-in home inside Couch (a friend's account, the profile picture painted out; README, screenshots)
  const netflix = `<div class="lv-view" data-view="netflix"><img src="/src/shots/netflix.webp" srcset="/src/shots/netflix-640.webp 640w, /src/shots/netflix-1280.webp 1280w, /src/shots/netflix.webp 1920w" sizes="${SIZES}" width="1920" height="1206" alt="${NETFLIX_LINE}" loading="lazy" decoding="async" />`
    + `<p class="lv-caption" aria-hidden="true">${NETFLIX_LINE}</p></div>`;
  const back = `<button class="lv-back" type="button" aria-label="Back to Home">${caretLeft}Home</button>`;
  const h = hints(video);
  const hint = `<p class="lv-hint" id="lv-hint" data-key="${esc(h.key)}" data-touch="${esc(h.touch)}" data-yt-key="${esc(h.ytKey)}" data-yt-touch="${esc(h.ytTouch)}"></p>`;
  const mode = video ? `data-mode="video" data-embed="${esc(embedUrl(o.id))}" data-title="${esc(o.title)}"` : `data-mode="placeholder"`;
  return `<div class="lv" data-launch ${mode} role="group" aria-roledescription="TV" aria-label="Couch on the Screen">${launchHome(labels)}${open}${youtube}${library}${player}${netflix}${back}${hint}${veil}</div>`;
}

/** What the phone Remote's caption says for the highlighted tile, and in an opened App. */
export const REMOTE_CAPTIONS: Record<string, string> = {
  continue: "Big Buck Bunny · Tap OK to resume",
  library: "Your own films · Tap OK to open",
  netflix: "Netflix, with your own account · Tap OK",
  youtube: "YouTube · Tap OK to watch the launch video",
  open: "Tap Back to go Home",
};

/**
 * Phones (the layout where the TV pins just below the nav): a small Couch Remote under the TV that drives it. Couch's
 * own D-pad (src/couch-ui/remote.css: .pad, .dir, .ok; only Left, Right and OK, the keys that do something here) and a
 * Back key; the caption says what OK will do. Hidden without script and off the phone layout (style.css), inert until
 * the TV comes to life (src/launch.ts).
 */
export function launchRemote(o: LaunchOptions): string {
  const caps: Record<string, string> = { ...REMOTE_CAPTIONS, youtube: o.id ? REMOTE_CAPTIONS.youtube! : "YouTube · Tap OK to open" };
  const dir = (cls: string, cmd: string, label: string, path: string) => `<button class="dir ${cls}" type="button" data-cmd="${cmd}" aria-label="${label}"><svg class="i" viewBox="0 0 256 256" aria-hidden="true"><path d="${path}"/></svg></button>`;
  const left = dir("l", "left", "Left", "M168,48V208a8,8,0,0,1-13.66,5.66l-80-80a8,8,0,0,1,0-11.32l80-80A8,8,0,0,1,168,48Z");
  const right = dir("r", "right", "Right", "M181.66,133.66l-80,80A8,8,0,0,1,88,208V48a8,8,0,0,1,13.66-5.66l80,80A8,8,0,0,1,181.66,133.66Z");
  const back = `<button class="fl-back" type="button" data-cmd="back" aria-label="Back">${caretLeft}Back</button>`;
  const data = Object.entries(caps).map(([k, v]) => `data-cap-${k}="${esc(v)}"`).join(" ");
  return `<div class="fl-remote-wrap" data-remote ${data} inert><div class="cr fl-remote" role="group" aria-label="Remote">${back}<div class="pad">${left}${right}<button class="ok" type="button" data-cmd="ok" aria-label="OK">OK</button></div></div>`
    + `<p class="fl-cap" aria-hidden="true">${esc(caps.continue!)}</p><p class="fl-live" aria-live="polite"></p></div>`;
}
