/**
 * Whether YouTube TV is on its home screen. Only Home has the bare `#/` route; watch, search, browse tabs
 * and channels have their own. A Short keeps Home's URL (its player opens over it), so the page says so.
 */
export function isYouTubeHome(url: string, shortsOpen: boolean): boolean {
  if (shortsOpen) return false;
  const hash = url.includes("#") ? url.slice(url.indexOf("#")) : "";
  return /^(#\/?(\?.*)?)?$/.test(hash);
}

/** Runs in the YouTube page: is the Shorts player on screen, and is the guide expanded (it is a 99 px rail when closed, 325 px open)? */
export const PAGE_STATE_SCRIPT = `(function(){var v=function(e){return !!e&&e.getBoundingClientRect().width>0};
var s=document.querySelector('ytlr-shorts-page'),g=document.querySelector('ytlr-guide-response');
return {shorts:v(s),guide:!!g&&g.getBoundingClientRect().width>200}})()`;

export interface PageState {
  shorts: boolean;
  guide: boolean;
}

/** Tracks where YouTube is and reports every change of URL, Shorts player or guide (not only Home entering or leaving). */
export class RouteTracker {
  #key: string | undefined;
  /** The route to announce for this URL and page state, or undefined when nothing changed. */
  update(
    url: string,
    page: PageState,
  ): { home: boolean; shorts: boolean; guideOpen: boolean } | undefined {
    const key = `${page.shorts ? "S" : "-"}${page.guide ? "G" : "-"}${url}`;
    if (key === this.#key) return undefined;
    this.#key = key;
    return { home: isYouTubeHome(url, page.shorts), shorts: page.shorts, guideOpen: page.guide };
  }
}
