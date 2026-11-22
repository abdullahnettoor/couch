/** BitChord's Cloudflare Pages deploy: the address Couch loads. The production domain serves an unrelated page for now. */
export const BITCHORD_PAGES = "https://bitchord-8bw.pages.dev";
const BITCHORD_PRODUCTION = "https://bitchord.in";

/** The address to load: BITCHORD_SITE (a development server, say) wins when it is an https or local http address. */
export function bitchordSite(env: Record<string, string | undefined> = {}): string {
  const raw = env.BITCHORD_SITE;
  if (raw) {
    try {
      const url = new URL(raw);
      if (url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "localhost"))
        return url.origin;
    } catch {}
  }
  return BITCHORD_PAGES;
}

/** BitChord's own origins: the site Couch loads and BitChord's production domain. */
export function bitchordOrigins(site: string): string[] {
  return [...new Set([new URL(site).origin, BITCHORD_PAGES, BITCHORD_PRODUCTION])];
}

export function isBitchordHome(url: URL): boolean {
  return url.pathname === "/" || url.pathname === "/home";
}

export function isBitchordSearchUrl(url: string): boolean {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") === "/search";
  } catch {
    return false;
  }
}

/** BitChord's own search address for typed text: `/search?q=…` on the site Couch loaded. */
export function bitchordSearchUrlFor(site: string, text: string): string {
  const q = text.trim();
  return q ? `${site}/search?q=${encodeURIComponent(q)}` : `${site}/search`;
}

/** Page script: whether BitChord's search field shows the query of this search address, which it follows once its router has drawn the search. */
export function bitchordSearchRoutedScript(url: string): string {
  const q = new URL(url).searchParams.get("q") ?? "";
  return `(function(q){try{var i=document.querySelector('input[aria-label="Search"]');return !!i&&i.value===q}catch(e){return false}})(${JSON.stringify(q)})`;
}
