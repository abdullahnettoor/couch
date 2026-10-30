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

/** True only for YouTube's own origin; `www.youtube.com.evil.example` and look-alikes are not. */
export function isYouTubeOrigin(origin: string): boolean {
  try {
    return new URL(origin).origin === "https://www.youtube.com";
  } catch {
    return false;
  }
}

/** The address that reopens a video at `position`: YouTube TV's watch URL with the video id and whole seconds; undefined for anything but a watch page. */
export function youtubeResumeUrl(url: string, position: number): string | undefined {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.hostname !== "www.youtube.com") return undefined;
    const tv = /^\/tv\/?$/.test(u.pathname) && /^#\/watch(?:\/|\?|$)/.test(u.hash);
    if (!tv && u.pathname !== "/watch") return undefined;
    const query = tv ? u.hash.slice(u.hash.indexOf("?") + 1) : u.search;
    const id = (
      tv && !u.hash.includes("?") ? new URLSearchParams() : new URLSearchParams(query)
    ).get("v");
    if (!id || !/^[\w-]{11}$/.test(id)) return undefined;
    const t = Number.isFinite(position) ? Math.max(0, Math.floor(position)) : 0;
    return `https://www.youtube.com/tv#/watch?v=${id}&t=${t}`;
  } catch {
    return undefined;
  }
}
