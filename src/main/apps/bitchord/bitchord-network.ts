import type { BridgeNetwork } from "./bitchord-bridge.ts";

type Fetch = (url: string, init?: Record<string, unknown>) => Promise<Response>;

/** The bridge's network over a `fetch` (the App's own session's): no cookies sent, the site's manifest read from `site`. */
export function bridgeNetwork(fetch: Fetch, site: string): BridgeNetwork {
  return {
    async request({ url, method, headers, body }) {
      const init = body === undefined ? { method, headers } : { method, headers, body };
      const response = await fetch(url, { ...init, credentials: "omit" });
      const out: Record<string, string> = {};
      response.headers.forEach((value, name) => (out[name] = value));
      return {
        status: response.status,
        headers: out,
        url: response.url,
        contentType: response.headers.get("content-type") ?? "",
        bytes: new Uint8Array(await response.arrayBuffer()),
      };
    },
    async manifest() {
      const response = await fetch(`${site}/downloads/extension.json`, { credentials: "omit" });
      if (!response.ok) throw new Error(`manifest ${response.status}`);
      return response.text();
    },
  };
}
