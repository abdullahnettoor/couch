import type { RouteSignals } from "../../web/web-app.ts";

const SEARCH = "https://www.netflix.com/search";

/** Netflix's own hosts: the site and the CDNs its pages, art and video come from. */
const OWN_HOSTS = ["netflix.com", "nflxext.com", "nflximg.net", "nflxso.net", "nflxvideo.net"];

/** True only for Netflix's own https hosts; `www.netflix.com.evil.example` and look-alikes are not. */
export function isNetflixOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return false;
    return OWN_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/**
 * Whether Netflix is at its home: the signed-in browse page with no title modal open (a modal puts
 * `?jbv=` in the address), the profile picker, or the signed-out landing and login pages (a signed-out
 * `/browse` is sent to login, so nothing Netflix-side comes before it). Everything else (the player,
 * search, a title page, genres) is somewhere Back should go back from.
 */
export function isNetflixHome(url: URL): boolean {
  // Pages under a country (`/in/`) or country-language (`/in-hi/`) prefix have the same shape.
  const path = url.pathname.replace(/^\/[a-z]{2}(-[a-z]{2,4})?(?=\/|$)/i, "").replace(/\/+$/, "");
  if (path === "") return true;
  if (["/profilesgate", "/login"].includes(path.toLowerCase())) return true;
  return path === "/browse" && !url.searchParams.has("jbv");
}

export function isNetflixSearchUrl(url: string): boolean {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") === "/search";
  } catch {
    return false;
  }
}

export function netflixSearchUrlFor(text: string): string {
  const q = text.trim();
  return q ? `${SEARCH}?q=${encodeURIComponent(q)}` : SEARCH;
}

/** Past this many pixels down, browse is no longer "at the top" (Netflix's header is sticky, so a few pixels are noise). */
const SCROLLED_PX = 50;

/** Runs in the Netflix page: how far it is scrolled, and whether a modal is open over it (Netflix leaves a closed one in the page, unrendered). */
const PAGE_SCRIPT = `(function(){var m=document.querySelectorAll('[aria-modal="true"],[data-uia="modal-container"],.previewModal--container');var open=false;for(var i=0;i<m.length;i++){if(m[i].getClientRects().length>0)open=true}return {y:Math.round(window.scrollY||0),modal:open}})()`;

interface NetflixPage {
  y: number;
  modal: boolean;
}

/**
 * Netflix's route: home is `/browse` (or the picker, login, landing) scrolled to the top with no modal
 * open. `scrolled` is set when the address says home but the page is scrolled down, which Back answers
 * by scrolling up, not by leaving. Only changes are announced.
 */
export function netflixRoute(): RouteSignals {
  return {
    script: PAGE_SCRIPT,
    idle: { y: 0, modal: false } satisfies NetflixPage,
    tracker: () => {
      let last: string | undefined;
      return {
        update: (url, page: NetflixPage | null) => {
          let urlHome: boolean;
          try {
            urlHome = isNetflixHome(new URL(url));
          } catch {
            return undefined;
          }
          const modal = page?.modal === true;
          const down = (page?.y ?? 0) > SCROLLED_PX;
          const route = {
            home: urlHome && !modal && !down,
            scrolled: urlHome && !modal && down,
            url,
          };
          const key = `${route.home}|${route.scrolled}|${url}`;
          if (key === last) return undefined;
          last = key;
          return route;
        },
      };
    },
  };
}
