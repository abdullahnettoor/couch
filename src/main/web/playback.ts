import type { PlaybackReport } from "../apps/app.ts";
import type { TrackList } from "../../shared/protocol.ts";

export type { PlaybackReport };

/** A video narrower than this share of the window is a preview or thumbnail, not what is playing. */
const MAIN_VIDEO_SHARE = 0.4;

/**
 * Page script (an async expression) that finds the page's playing video and the site's
 * media-session title and artwork. `tracks` is an adapter's script (an expression); its answer
 * is added when it works. Artwork is whatever the page names (else the adapter's `artwork` expression; the title likewise from `title` when the media session has none); `composeReport` keeps only the App's own. `active` is an adapter's expression that is false
 * while the App shows no real playback (a home-page preview), so nothing is reported then.
 */
export function playbackProbe(
  options: {
    tracks?: string;
    active?: string;
    artwork?: string;
    title?: string;
    speeds?: number[];
    prompt?: string;
  } = {},
): string {
  const { tracks, active, artwork, title, speeds, prompt } = options;
  return `(async () => {
  ${active ? `try { if (!(${active})) return undefined; } catch (e) { return undefined; }` : ""}
  var area = window.innerWidth * window.innerHeight;
  var best = null, bestArea = 0;
  Array.prototype.forEach.call(document.querySelectorAll("video"), function (v) {
    if (!(v.readyState > 0) || !isFinite(v.duration) || !(v.duration > 0)) return;
    var r = v.getBoundingClientRect();
    var a = r.width * r.height;
    if (a < area * ${MAIN_VIDEO_SHARE} || a <= bestArea) return;
    best = v; bestArea = a;
  });
  if (!best) return undefined;
  var report = {
    position: Math.floor(best.currentTime),
    duration: Math.floor(best.duration),
    paused: !!best.paused,
  };
  if (best.ended) report.ended = true;
  ${speeds?.length ? `report.speed = best.playbackRate || 1; report.speeds = ${JSON.stringify(speeds)};` : ""}
  try {
    var meta = navigator.mediaSession && navigator.mediaSession.metadata;
    if (meta) {
      if (meta.title) report.title = String(meta.title);
      var pic = null, size = -1;
      (meta.artwork || []).forEach(function (art) {
        if (!art || typeof art.src !== "string" || art.src.indexOf("https:") !== 0) return;
        var s = parseInt(String(art.sizes || "0").split("x")[0], 10) || 0;
        if (s > size) { pic = art.src; size = s; }
      });
      if (pic) report.artwork = pic;
    }
  } catch (e) {}
  ${title ? `if (!report.title) { try { var named = ${title}; if (typeof named === "string" && named) report.title = named; } catch (e) {} }` : ""}
  ${artwork ? `if (!report.artwork) { try { var own = ${artwork}; if (typeof own === "string") report.artwork = own; } catch (e) {} }` : ""}
  ${prompt ? `try { var p = ${prompt}; if (p && typeof p.label === "string") report.prompt = { id: p.id, label: p.label }; } catch (e) {}` : ""}
  ${tracks ? `try { var t = await (${tracks}); if (t) report.tracks = t; } catch (e) {}` : ""}
  return report;
})()`;
}

/** Whether an artwork URL is https on one of the App's own hosts (a listed domain or a subdomain of it). Every Remote fetches it. */
export function ownArtwork(url: string, hosts: string[]): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** What an adapter's `tracks` script answers; `canSeek: false` says its seek control isn't on the page; `speed` and `speeds` say what its speed control offers. */
export interface TrackReport {
  speed?: number;
  speeds?: number[];
  subtitles: TrackList;
  audio: TrackList;
  canSeek?: boolean;
}

/**
 * The probe's report plus what the adapter adds. The seek bar is live only when the adapter can
 * seek and hasn't said its seek control is missing; otherwise it is read-only and the phone's
 * ±10 s stay on the App's keys.
 */
export function composeReport(
  found: PlaybackReport | undefined,
  tracks: TrackReport | undefined,
  adapterSeeks: boolean,
  artworkHosts: string[] = [],
): PlaybackReport | undefined {
  if (!found) return undefined;
  const { tracks: _own, artwork, ...rest } = found;
  return {
    ...rest,
    ...(artwork && ownArtwork(artwork, artworkHosts) ? { artwork } : {}),
    ...(adapterSeeks && tracks?.canSeek !== false ? { canSeek: true } : {}),
    ...(tracks?.speeds?.length ? { speed: tracks.speed ?? 1, speeds: tracks.speeds } : {}),
    ...(tracks ? { tracks: { subtitles: tracks.subtitles, audio: tracks.audio } } : {}),
  };
}

export function sameReport(a: PlaybackReport | undefined, b: PlaybackReport | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Where a skip of `seconds` lands, for an App that seeks through its adapter; undefined when nothing is playing. */
export function skipTarget(
  report: PlaybackReport | undefined,
  seconds: number,
): number | undefined {
  if (!report) return undefined;
  return Math.min(report.duration, Math.max(0, report.position + seconds));
}
