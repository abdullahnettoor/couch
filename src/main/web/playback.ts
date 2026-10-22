import type { PlaybackReport } from "../apps/app.ts";

export type { PlaybackReport };

/** A video narrower than this share of the window is a preview or thumbnail, not what is playing. */
const MAIN_VIDEO_SHARE = 0.4;

/**
 * Page script (an async expression) that finds the page's playing video and the site's
 * media-session title and artwork. `tracks` is an adapter's script (an expression); its answer
 * is added when it works. `active` is an adapter's expression that is false
 * while the App shows no real playback (a home-page preview), so nothing is reported then.
 */
export function playbackProbe(tracks?: string, active?: string): string {
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
  ${tracks ? `try { var t = await (${tracks}); if (t) report.tracks = t; } catch (e) {}` : ""}
  return report;
})()`;
}

export function sameReport(a: PlaybackReport | undefined, b: PlaybackReport | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
