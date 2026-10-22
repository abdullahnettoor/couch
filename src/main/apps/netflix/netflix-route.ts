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
