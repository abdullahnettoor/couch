/** Credential and connection headers a page must never set on a bridged request (this session has no credentials, and the host sets the rest). */
const DENIED = /^(authorization|cookie2?|host|connection|content-length|transfer-encoding|x-goog-authuser|proxy-.*|sec-.*)$/i;

/** The page's headers without the denied ones, matched case-insensitively. Non-string values are dropped. */
export function pageHeaders(given: unknown): Record<string, string> {
  const headers: Record<string, string> = {};
  if (given && typeof given === "object")
    for (const [k, v] of Object.entries(given))
      if (typeof v === "string" && !DENIED.test(k)) headers[k] = v;
  return headers;
}
