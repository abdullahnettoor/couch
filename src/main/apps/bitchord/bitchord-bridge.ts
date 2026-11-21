import type { BridgeRequest } from "../../web/webkit-messages.ts";

export type { BridgeRequest };
export const BRIDGE_CHANNEL = "bitchord-bridge";
export const BRIDGE_PROTOCOL = 1;
/** The version answered when the site's published one can't be read. */
export const FALLBACK_EXTENSION_VERSION = "0.4.4";

const BOTGUARD = /^https:\/\/www\.youtube\.com\/api\/jnn\//;
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
    const url = params.url;
    if (typeof url !== "string" || !BOTGUARD.test(url))
      return fail("forbidden", "Couch only serves YouTube's BotGuard endpoint.");
    const headers: Record<string, string> = {};
    if (params.headers && typeof params.headers === "object")
      for (const [k, v] of Object.entries(params.headers))
        if (typeof v === "string" && !/^(origin|referer)$/i.test(k)) headers[k] = v;
    headers.Origin = "https://www.youtube.com";
    headers.Referer = "https://www.youtube.com/";
    const body =
      typeof params.body !== "string"
        ? undefined
        : params.bodyEncoding === "base64"
          ? Uint8Array.from(Buffer.from(params.body, "base64"))
          : params.body;
    const response = await this.#net.request({
      url,
      method: typeof params.method === "string" ? params.method : "GET",
      headers,
      body,
    });
    const textual = TEXTUAL.test(response.contentType);
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
