/**
 * The launch video in the first-look TV (ticket 145), written into index.html at build time (vite.config.ts); the
 * sequence and the play facade run in src/launch.ts. Two modes, from LAUNCH_VIDEO.id (src/config.ts):
 *  - placeholder (no id): the TV ends on a Couch-made poster, "Launch video", "Coming soon to YouTube", and under the
 *    TV a "Subscribe on YouTube" link. Nothing on the page refers to YouTube's servers.
 *  - video (an id): the TV ends on a muted, looping teaser of the video (the site's own file, public/launch/<id>.mp4,
 *    made by scripts/launch-teaser.mjs) with "Watch with sound" and a pause button; without the teaser (reduced
 *    motion, Save-Data, or it fails) on the video's thumbnail (a local file, saved by scripts/launch-thumb.mjs), its
 *    title and a play button. Under the TV "Subscribe on YouTube", "Watch on YouTube" and the privacy line. The
 *    player's URL is only in a data attribute until the visitor presses "Watch with sound" or play.
 * Read by vite.config.ts at build time (node), never shipped as script.
 */
import data from "./couch-ui/data.json" with { type: "json" };
import { appById, launchHome, mark } from "./mocks.ts";

export interface LaunchOptions {
  /** The YouTube video id, or "" for the placeholder. */
  id: string;
  title: string;
  channel: string;
  /** The thumbnail's URL in the build (root-relative) and a smaller copy, when there is one. */
  thumb?: { src: string; small?: string };
  /** The teaser's URLs in the build (root-relative): an MP4, and a WebM when there is one. */
  teaser?: { mp4: string; webm?: string };
  /** Phosphor's YouTube mark (the inner paths of a 256 × 256 SVG). */
  youtubeMark: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const playPath = (data.icons as Record<string, string>).play;
/** Phosphor's speaker-high and pause (fill weight, like Couch's play; MIT, public/licenses/). */
const soundPath = `<path d="M160,32.25V223.69a8.29,8.29,0,0,1-3.91,7.18,8,8,0,0,1-9-.56l-65.57-51A4,4,0,0,1,80,176.16V79.84a4,4,0,0,1,1.55-3.15l65.57-51a8,8,0,0,1,10,.16A8.27,8.27,0,0,1,160,32.25ZM60,80H32A16,16,0,0,0,16,96v64a16,16,0,0,0,16,16H60a4,4,0,0,0,4-4V84A4,4,0,0,0,60,80Zm126.77,20.84a8,8,0,0,0-.72,11.3,24,24,0,0,1,0,31.72,8,8,0,1,0,12,10.58,40,40,0,0,0,0-52.88A8,8,0,0,0,186.74,100.84Zm40.89-26.17a8,8,0,1,0-11.92,10.66,64,64,0,0,1,0,85.34,8,8,0,1,0,11.92,10.66,80,80,0,0,0,0-106.66Z"/>`;
const pausePath = `<path d="M216,48V208a16,16,0,0,1-16,16H160a16,16,0,0,1-16-16V48a16,16,0,0,1,16-16h40A16,16,0,0,1,216,48ZM96,32H56A16,16,0,0,0,40,48V208a16,16,0,0,0,16,16H96a16,16,0,0,0,16-16V48A16,16,0,0,0,96,32Z"/>`;
const svg = (path: string, cls = "") => `<svg${cls ? ` class="${cls}"` : ""} viewBox="0 0 256 256" aria-hidden="true">${path}</svg>`;

/** The player's address: YouTube's privacy-enhanced embed, playing at once (the press is the visitor's), inline on phones. */
export const embedUrl = (id: string) => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0&playsinline=1`;
export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;

/** Everything inside the TV after the screenshot: the live Home, the opening App, and the poster or the facade. */
export function launchScreen(o: LaunchOptions): string {
  const yt = appById("youtube");
  const open = `<div class="lv-open" aria-hidden="true"><span class="lv-open-mark">${mark(yt)}</span></div>`;
  let end: string;
  if (!o.id) {
    // the poster: Couch's own light (the icon's sofa-and-Screen glow, the hero's picture and its two sizes) in a dark, warm room
    end = `<div class="lv-end lv-poster"><div class="lv-light" aria-hidden="true"><img src="/src/shots/couch-glow.webp" srcset="/src/shots/couch-glow-480.webp 480w, /src/shots/couch-glow.webp 832w" sizes="(max-width: 700px) 45vw, 480px" width="832" height="688" alt="" loading="lazy" decoding="async" /></div>`
      + `<div class="lv-text"><p class="lv-title">Launch video</p><p class="lv-meta">Coming soon to YouTube</p></div></div>`;
  } else {
    const t = o.thumb!;
    const set = t.small ? ` srcset="${t.small} 640w, ${t.src} 1280w" sizes="(max-width: 700px) calc(100vw - 50px), min(calc(100vw - 66px), calc((100vh - 122px) * 1.6), 1582px)"` : "";
    end = `<div class="lv-end lv-facade"><img class="lv-thumb" src="${t.src}"${set} width="1280" height="720" alt="" loading="lazy" decoding="async" />`
      + `<div class="lv-text"><p class="lv-title">${esc(o.title)}</p></div>`
      + `<button class="lv-play" type="button" aria-label="Play the launch video: ${esc(o.title)}"><svg viewBox="0 0 256 256" aria-hidden="true">${playPath}</svg></button>`
      + (o.teaser ? teaser(o.teaser, o.title) : "") + `</div>`;
  }
  const mode = o.id ? `data-mode="video" data-embed="${esc(embedUrl(o.id))}" data-title="${esc(o.title)}"` : `data-mode="placeholder"`;
  return `<div class="lv" data-launch ${mode}>${launchHome()}${open}${end}</div>`;
}

/**
 * The muted teaser over the thumbnail: no src until the TV is near (src/launch.ts sets it from data-mp4), shown only
 * once it plays; its controls are a pause toggle and "Watch with sound", which loads YouTube's player in its place.
 */
function teaser(t: NonNullable<LaunchOptions["teaser"]>, title: string): string {
  return `<div class="lv-teaser"><video class="lv-video" muted loop playsinline preload="none" disablepictureinpicture disableremoteplayback tabindex="-1" aria-hidden="true" data-mp4="${esc(t.mp4)}"${t.webm ? ` data-webm="${esc(t.webm)}"` : ""}></video>`
    + `<div class="lv-ctrl"><button class="lv-pause" type="button" aria-label="Pause the preview">${svg(pausePath, "lv-i-pause")}${svg(playPath, "lv-i-play")}</button>`
    + `<button class="lv-sound" type="button" aria-label="Watch with sound: ${esc(title)}">${svg(soundPath)}Watch with sound</button></div></div>`;
}

/** Under the TV: the links (always there, so they work without script) and, with a video, the privacy line. */
export function launchUnder(o: LaunchOptions): string {
  const ytIcon = `<svg class="i" viewBox="0 0 256 256" aria-hidden="true" fill="currentColor">${o.youtubeMark}</svg>`;
  const playIcon = `<svg class="i" viewBox="0 0 256 256" aria-hidden="true" fill="currentColor">${playPath}</svg>`;
  const subscribe = `<a href="${esc(o.channel)}" rel="noopener">${ytIcon}Subscribe on YouTube</a>`;
  if (!o.id) return `<div class="lv-under"><p class="lv-links">${subscribe}</p></div>`;
  return `<div class="lv-under"><p class="lv-links">${subscribe}<a class="lv-quiet" href="${esc(watchUrl(o.id))}" rel="noopener">${playIcon}Watch on YouTube</a></p>`
    + `<p class="lv-note">${o.teaser ? "The preview on the Screen comes from this site. YouTube loads only when you press Watch with sound or play." : "The launch video plays from YouTube and loads only when you press play."}</p></div>`;
}
