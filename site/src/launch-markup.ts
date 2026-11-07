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
  const library = `<div class="lv-view" data-view="library"><img src="/src/shots/library.webp" srcset="/src/shots/library-640.webp 640w, /src/shots/library-1280.webp 1280w, /src/shots/library.webp 1920w" sizes="${SIZES}" width="1920" height="1200" alt="Couch's Library: the Films shelf with Big Buck Bunny, Sintel and Tears of Steel" loading="lazy" decoding="async" /></div>`;
  const player = `<div class="lv-view" data-view="continue"><img src="/src/shots/player.webp" srcset="/src/shots/player-640.webp 640w, /src/shots/player.webp 1280w" sizes="${SIZES}" width="1280" height="800" alt="Couch's player: Big Buck Bunny (2008) at 2:04, 7:52 left, with its controls" loading="lazy" decoding="async" /></div>`;
  const netflix = `<div class="lv-view" data-view="netflix"><div class="lv-card">${faceMark("netflix")}<p>Netflix opens Netflix's own website, signed in with your account.</p></div></div>`;
  const back = `<button class="lv-back" type="button" aria-label="Back to Home">${caretLeft}Home</button>`;
  const h = hints(video);
  const hint = `<p class="lv-hint" id="lv-hint" data-key="${esc(h.key)}" data-touch="${esc(h.touch)}" data-yt-key="${esc(h.ytKey)}" data-yt-touch="${esc(h.ytTouch)}"></p>`;
  const mode = video ? `data-mode="video" data-embed="${esc(embedUrl(o.id))}" data-title="${esc(o.title)}"` : `data-mode="placeholder"`;
  return `<div class="lv" data-launch ${mode} role="group" aria-roledescription="TV" aria-label="Couch on the Screen">${launchHome(labels)}${open}${youtube}${library}${player}${netflix}${back}${hint}</div>`;
}
