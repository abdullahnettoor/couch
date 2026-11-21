import { pageHeaders } from "./bitchord-headers.ts";
import { lyricHeaders, lyricUrl, LYRIC_ORIGINS } from "./bitchord-lyrics.ts";
import type { BridgeRequest } from "../../web/webkit-messages.ts";

export type { BridgeRequest };
export const BRIDGE_CHANNEL = "bitchord-bridge";
export const BRIDGE_PROTOCOL = 1;
/** The version answered when the site's published one can't be read. */
export const FALLBACK_EXTENSION_VERSION = "0.4.4";

const MAX_LYRIC_HOPS = 3;

/** The normalised BotGuard address, or undefined: https, exactly www.youtube.com, no userinfo or port, a path under /api/jnn/. */
function botguardUrl(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.hostname !== "www.youtube.com") return undefined;
    if (u.username || u.password || u.port) return undefined;
    if (!u.pathname.startsWith("/api/jnn/") || /%2f|%5c/i.test(u.pathname)) return undefined;
    return u.href;
  } catch {
    return undefined;
  }
}
const SIGNED_OUT = {
  browserSignedIn: false,
  connected: false,
  signedIn: false,
  accounts: [],
  active: null,
  problem: null,
};

/** What BitChord's `HttpResponse` carries: textual bodies as text, anything else as base64. */
export interface BridgeHttpResponse {
  status: number;
  headers: Record<string, string>;
  url: string;
  bodyEncoding: "text" | "base64";
  body: string;
}

/** The network the bridge answers with; the host supplies Chromium's, tests a fake. */
export interface BridgeNetwork {
  /** An unsigned, cookie-less request. */
  request(init: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string | Uint8Array;
  }): Promise<{
    status: number;
    headers: Record<string, string>;
    url: string;
    bytes: Uint8Array;
    contentType: string;
  }>;
  /** The site's published extension manifest, as text. */
  manifest(): Promise<string>;
}

export type BridgeErrorCode =
  | "unsupported"
  | "forbidden"
  | "protocol"
  | "network"
  | "unauthenticated"
  | "permission"
  | "internal";

export type BridgeResponse =
  | {
      channel: typeof BRIDGE_CHANNEL;
      protocol: 1;
      direction: "to-page";
      id: string;
      ok: true;
      result: unknown;
    }
  | {
      channel: typeof BRIDGE_CHANNEL;
      protocol: 1;
      direction: "to-page";
      id: string;
      ok: false;
      error: { code: BridgeErrorCode; message: string };
    };

const TEXTUAL = /json|text|javascript|xml/i;
const LYRIC_TEXTUAL = /^$|json|text|javascript|xml|html/i;

const isRedirect = (status: number) => status >= 300 && status < 400;
const resolve = (location: string, base: URL): string => {
  try {
    return new URL(location, base).href;
  } catch {
    return "";
  }
};

/** The BitChord bridge: Couch's stand-in for BitChord's browser extension, signed out. */
export class BitChordBridge {
  #net: BridgeNetwork;
  #version: Promise<string> | undefined;

  constructor(net: BridgeNetwork) {
    this.#net = net;
  }

  #extensionVersion(): Promise<string> {
    this.#version ??= this.#net
      .manifest()
      .then((text) => {
        const version = (JSON.parse(text) as { version?: unknown }).version;
        if (typeof version === "string" && /^\d+(\.\d+){0,3}$/.test(version)) return version;
        throw new Error("no version");
      })
      .catch(() => FALLBACK_EXTENSION_VERSION);
    return this.#version;
  }

  /** The envelope to post back to the page for this request. Never throws. */
  async answer(request: BridgeRequest): Promise<BridgeResponse> {
    const reply = (
      rest:
        | { ok: true; result: unknown }
        | { ok: false; error: { code: BridgeErrorCode; message: string } },
    ) =>
      ({
        channel: BRIDGE_CHANNEL,
        protocol: BRIDGE_PROTOCOL,
        direction: "to-page",
        id: request.id,
        ...rest,
      }) as BridgeResponse;
    const fail = (code: BridgeErrorCode, message: string) =>
      reply({ ok: false, error: { code, message } });
    if (request.protocol !== BRIDGE_PROTOCOL)
      return fail(
        "protocol",
        `Couch speaks bridge protocol ${BRIDGE_PROTOCOL}, not ${String(request.protocol)}.`,
      );
    try {
      switch (request.method) {
        case "ping":
          return reply({
            ok: true,
            result: {
              version: await this.#extensionVersion(),
              protocol: BRIDGE_PROTOCOL,
              browser: "chromium",
              capabilities: ["yt", "lyrics"],
            },
          });
        case "yt.authState":
        case "yt.setConnected":
        case "yt.selectChannel":
          return reply({ ok: true, result: SIGNED_OUT });
        case "yt.fetch":
          return await this.#ytFetch(request.params, reply, fail);
        case "lyrics.fetch":
          return await this.#lyricsFetch(request.params, reply, fail);
        case "lyrics.permissions": {
          const asked = request.params.origins;
          const granted = Array.isArray(asked)
            ? asked.filter((o): o is string => typeof o === "string" && LYRIC_ORIGINS.includes(o))
            : [];
          return reply({ ok: true, result: { granted } });
        }
        case "lyrics.requestPermissions":
          return reply({ ok: true, result: {} });
        default:
          return fail("unsupported", `${request.method} isn't served by Couch.`);
      }
    } catch (e) {
      return fail("network", e instanceof Error ? e.message : String(e));
    }
  }

  async #ytFetch(
    params: Record<string, unknown>,
    reply: (r: { ok: true; result: unknown }) => BridgeResponse,
    fail: (code: BridgeErrorCode, message: string) => BridgeResponse,
  ): Promise<BridgeResponse> {
    if (params.auth) return fail("unauthenticated", "Couch's BitChord is signed out.");
    const url = botguardUrl(params.url);
    if (!url) return fail("forbidden", "Couch only serves YouTube's BotGuard endpoint.");
    const headers = pageHeaders(params.headers);
    for (const k of Object.keys(headers)) if (/^(origin|referer)$/i.test(k)) delete headers[k];
    headers.Origin = "https://www.youtube.com";
    headers.Referer = "https://www.youtube.com/";
    const response = await this.#hop(url, params, headers);
    if (isRedirect(response.status))
      return fail("forbidden", "Couch doesn't follow redirects from BotGuard.");
    return this.#answer(response, TEXTUAL, reply);
  }

  async #lyricsFetch(
    params: Record<string, unknown>,
    reply: (r: { ok: true; result: unknown }) => BridgeResponse,
    fail: (code: BridgeErrorCode, message: string) => BridgeResponse,
  ): Promise<BridgeResponse> {
    let target = lyricUrl(params.url);
    if (!target) return fail("forbidden", "Couch only serves BitChord's listed lyric hosts.");
    const given = pageHeaders(params.headers);
    let current = params;
    for (let hops = 0; ; hops++) {
      const response = await this.#hop(
        target.href,
        current,
        lyricHeaders(target.origin, given),
      );
      if (!isRedirect(response.status)) return this.#answer(response, LYRIC_TEXTUAL, reply);
      const location = response.headers.location ?? response.headers.Location;
      const next = hops < MAX_LYRIC_HOPS && location ? lyricUrl(resolve(location, target)) : undefined;
      if (!next) return fail("forbidden", "Couch only follows redirects to BitChord's lyric hosts.");
      // As fetch does: 307 and 308 keep the method and body, the others become a plain GET.
      if (response.status !== 307 && response.status !== 308)
        current = { ...current, method: "GET", body: undefined };
      target = next;
    }
  }

  #hop(url: string, params: Record<string, unknown>, headers: Record<string, string>) {
    const body =
      typeof params.body !== "string"
        ? undefined
        : params.bodyEncoding === "base64"
          ? Uint8Array.from(Buffer.from(params.body, "base64"))
          : params.body;
    return this.#net.request({
      url,
      method: typeof params.method === "string" ? params.method : "GET",
      headers,
      body,
    });
  }

  #answer(
    response: Awaited<ReturnType<BridgeNetwork["request"]>>,
    textualType: RegExp,
    reply: (r: { ok: true; result: unknown }) => BridgeResponse,
  ): BridgeResponse {
    const textual = textualType.test(response.contentType);
    return reply({
      ok: true,
      result: {
        status: response.status,
        headers: response.headers,
        url: response.url,
        bodyEncoding: textual ? "text" : "base64",
        body: textual
          ? Buffer.from(response.bytes).toString("utf8")
          : Buffer.from(response.bytes).toString("base64"),
      } satisfies BridgeHttpResponse,
    });
  }
}
