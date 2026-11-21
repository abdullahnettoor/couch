import type { HeadersHandler, ResponseHeadersHandler } from "../../web/request-hooks.ts";

const MUSIC = "https://music.youtube.com";
const VIDEO = "https://www.youtube.com";

type Rule = { set?: Record<string, string>; remove?: string[]; cors: boolean };

/** What BitChord's browser extension does to a request to this address, or undefined when it leaves it alone. */
function ruleFor(address: string): Rule | undefined {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  const origin = (o: string) => ({ Origin: o, Referer: `${o}/`, "X-Origin": o });
  if (url.hostname === "music.youtube.com" && url.pathname.startsWith("/youtubei/"))
    return { set: origin(MUSIC), cors: true };
  if (url.hostname === "www.youtube.com") {
    if (url.pathname.startsWith("/youtubei/")) return { set: origin(VIDEO), cors: true };
    if (/^\/(sw\.js_data|iframe_api|s\/player\/)/.test(url.pathname)) return { cors: true };
  }
  if (url.hostname === "googlevideo.com" || url.hostname.endsWith(".googlevideo.com")) {
    if (url.searchParams.get("c") === "VISIONOS")
      return { remove: ["Origin", "Referer"], cors: true };
    return { set: { Origin: VIDEO, Referer: `${VIDEO}/` }, cors: true };
  }
  return undefined;
}

const named = (headers: Record<string, unknown>, name: string) =>
  Object.keys(headers).filter((k) => k.toLowerCase() === name.toLowerCase());

/** Request headers for BitChord's partition only: YouTube's Origin, Referer and X-Origin where its player needs them. */
export const bitchordRequestHeaders: HeadersHandler = ({ url, requestHeaders }) => {
  const rule = ruleFor(url);
  if (!rule) return requestHeaders;
  const headers = { ...requestHeaders };
  for (const name of rule.remove ?? []) for (const k of named(headers, name)) delete headers[k];
  for (const [name, value] of Object.entries(rule.set ?? {})) {
    for (const k of named(headers, name)) delete headers[k];
    headers[name] = value;
  }
  return headers;
};

/** Response headers for BitChord's partition only: permissive CORS on YouTube's player traffic. */
export const bitchordResponseHeaders: ResponseHeadersHandler = ({ url, responseHeaders }) => {
  if (!ruleFor(url)?.cors) return responseHeaders;
  const headers = { ...responseHeaders };
  for (const name of ["Access-Control-Allow-Origin", "Access-Control-Expose-Headers"])
    for (const k of named(headers, name)) delete headers[k];
  headers["Access-Control-Allow-Origin"] = ["*"];
  headers["Access-Control-Expose-Headers"] = ["*"];
  return headers;
};
