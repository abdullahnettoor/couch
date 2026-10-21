/**
 * Whether YouTube TV is on its home screen. Only Home has the bare `#/` route; watch, search, browse tabs
 * and channels have their own. A Short keeps Home's URL (its player opens over it), so the page says so.
 */
export function isYouTubeHome(url: string, shortsOpen: boolean): boolean {
  if (shortsOpen) return false;
  const hash = url.includes("#") ? url.slice(url.indexOf("#")) : "";
  return /^(#\/?(\?.*)?)?$/.test(hash);
}

/** Runs in the YouTube page: is the Shorts player on screen? */
export const SHORTS_OPEN_SCRIPT = `(function(){var s=document.querySelector('ytlr-shorts-page');return !!s&&s.getBoundingClientRect().width>0})()`;

/** Tracks where YouTube is and reports every change of URL or Shorts state (not only Home entering or leaving). */
export class RouteTracker {
  #key: string | undefined;
  /** The route to announce for this URL and Shorts state, or undefined when nothing changed. */
  update(url: string, shortsOpen: boolean): { home: boolean } | undefined {
    const key = `${shortsOpen ? "S" : "-"}${url}`;
    if (key === this.#key) return undefined;
    this.#key = key;
    return { home: isYouTubeHome(url, shortsOpen) };
  }
}
