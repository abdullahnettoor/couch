/**
 * The launch video in the first-look TV (ticket 145), written into index.html at build time (vite.config.ts); the
 * sequence and the play facade run in src/launch.ts. Two modes, from LAUNCH_VIDEO.id (src/config.ts):
 *  - placeholder (no id): the TV ends on a Couch-made poster, "Launch video", "Coming soon to YouTube", and under the
 *    TV a "Subscribe on YouTube" link. Nothing on the page refers to YouTube's servers.
 *  - video (an id): the TV ends on the video's thumbnail (a local file, saved by scripts/launch-thumb.mjs), its
 *    title and a play button; under the TV "Watch on YouTube", "Subscribe" and the privacy line. The player's URL
 *    is only in a data attribute until the visitor presses play.
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
  /** Phosphor's YouTube mark (the inner paths of a 256 × 256 SVG). */
  youtubeMark: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const playPath = (data.icons as Record<string, string>).play;

/** The player's address: YouTube's privacy-enhanced embed, playing at once (the press is the visitor's), inline on phones. */
export const embedUrl = (id: string) => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0&playsinline=1`;
export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;

/** Everything inside the TV after the screenshot: the live Home, the opening App, and the poster or the facade. */
export function launchScreen(o: LaunchOptions): string {
  const yt = appById("youtube");
  const open = `<div class="lv-open" aria-hidden="true"><span class="lv-open-mark">${mark(yt)}</span></div>`;
  let end: string;
  if (!o.id) {
    // the poster: Couch's own light (the icon's sofa-and-Screen glow, the hero's picture) in a dark, warm room
    end = `<div class="lv-end lv-poster"><div class="lv-light" aria-hidden="true"><img src="/src/shots/couch-glow.webp" width="832" height="688" alt="" loading="lazy" decoding="async" /></div>`
      + `<div class="lv-text"><p class="lv-title">Launch video</p><p class="lv-meta">Coming soon to YouTube</p></div></div>`;
  } else {
    const t = o.thumb!;
    const set = t.small ? ` srcset="${t.small} 640w, ${t.src} 1280w" sizes="(max-width: 1048px) calc(100vw - 66px), 982px"` : "";
    end = `<div class="lv-end lv-facade"><img class="lv-thumb" src="${t.src}"${set} width="1280" height="720" alt="" loading="lazy" decoding="async" />`
      + `<div class="lv-text"><p class="lv-title">${esc(o.title)}</p></div>`
      + `<button class="lv-play" type="button" aria-label="Play the launch video: ${esc(o.title)}"><svg viewBox="0 0 256 256" aria-hidden="true">${playPath}</svg></button></div>`;
  }
  const mode = o.id ? `data-mode="video" data-embed="${esc(embedUrl(o.id))}" data-title="${esc(o.title)}"` : `data-mode="placeholder"`;
  return `<div class="lv" data-launch ${mode}>${launchHome()}${open}${end}</div>`;
}

/** Under the TV: the links (always there, so they work without script) and, with a video, the privacy line. */
export function launchUnder(o: LaunchOptions): string {
  const ytIcon = `<svg class="i" viewBox="0 0 256 256" aria-hidden="true" fill="currentColor">${o.youtubeMark}</svg>`;
  const playIcon = `<svg class="i" viewBox="0 0 256 256" aria-hidden="true" fill="currentColor">${playPath}</svg>`;
  const subscribe = (label: string) => `<a href="${esc(o.channel)}" rel="noopener">${ytIcon}${label}</a>`;
  if (!o.id) return `<div class="lv-under"><p class="lv-links">${subscribe("Subscribe on YouTube")}</p></div>`;
  return `<div class="lv-under"><p class="lv-links"><a href="${esc(watchUrl(o.id))}" rel="noopener">${playIcon}Watch on YouTube</a>${subscribe("Subscribe")}</p>`
    + `<p class="lv-note">The launch video plays from YouTube and loads only when you press play.</p></div>`;
}
