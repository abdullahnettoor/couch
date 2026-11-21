import { FIELD_BLURRED, FIELD_FOCUSED } from "./page-focus.ts";
import { CONFIRM_MESSAGE } from "./web-hud.ts";

/** The name of the script message handler Couch's scripts post to (`window.webkit.messageHandlers[name]`). */
export const MESSAGE_HANDLER_NAME = "couch";

/** The only messages Couch's own scripts post through the `couch` message handler. */
export type PageMessage =
  | { type: "route"; url: string; page: Record<string, string | number | boolean | null> | null }
  | { type: "console"; message: string }
  /** Couch's own wake of a player's bar: a real mouse-moved event at this point (client coordinates). */
  | { type: "wake-pointer"; x: number; y: number }
  /** A real mouse press on the page: the household used the App's own controls. */
  | { type: "input" }
  /** An App's bridge request from its page (BitChord's): the envelope the page posted, checked only for shape. */
  | { type: "bridge"; request: BridgeRequest };

/** The envelope BitChord's page sends its host; the answering module judges the protocol and the method. */
export interface BridgeRequest {
  channel: "bitchord-bridge";
  protocol: number;
  direction: "to-extension";
  id: string;
  method: string;
  params: Record<string, unknown>;
}

const MAX_URL = 4096;
const MAX_CONSOLE = 64;
const MAX_PAGE_KEYS = 16;
const MAX_COORD = 16384;
const MAX_BRIDGE_ID = 128;
const MAX_BRIDGE_METHOD = 64;

const isPrimitive = (v: unknown): v is string | number | boolean | null =>
  v === null || ["string", "number", "boolean"].includes(typeof v);

function hasOnly(o: object, keys: string[]): boolean {
  return Object.keys(o).every((k) => keys.includes(k));
}

/** Validates a message body against the schema; anything else (extra fields, wrong types, other kinds) is undefined. */
export function parsePageMessage(body: unknown): PageMessage | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const m = body as Record<string, unknown>;
  if (m.type === "route") {
    if (!hasOnly(m, ["type", "url", "page"])) return undefined;
    if (typeof m.url !== "string" || m.url.length > MAX_URL || !m.url.startsWith("https://"))
      return undefined;
    const page = m.page ?? null;
    if (page !== null) {
      if (typeof page !== "object" || Array.isArray(page)) return undefined;
      const entries = Object.values(page);
      if (Object.keys(page).length > MAX_PAGE_KEYS || !entries.every(isPrimitive)) return undefined;
    }
    return {
      type: "route",
      url: m.url,
      page: page as Record<string, string | number | boolean | null> | null,
    };
  }
  if (m.type === "console") {
    if (!hasOnly(m, ["type", "message"])) return undefined;
    if (typeof m.message !== "string" || m.message.length > MAX_CONSOLE) return undefined;
    if (
      !CONFIRM_MESSAGE.test(m.message) &&
      m.message !== FIELD_FOCUSED &&
      m.message !== FIELD_BLURRED
    )
      return undefined;
    return { type: "console", message: m.message };
  }
  if (m.type === "input") {
    return hasOnly(m, ["type"]) ? { type: "input" } : undefined;
  }
  if (m.type === "bridge") {
    if (!hasOnly(m, ["type", "request"])) return undefined;
    const r = m.request as Record<string, unknown> | null;
    if (typeof r !== "object" || r === null || Array.isArray(r)) return undefined;
    if (!hasOnly(r, ["channel", "protocol", "direction", "id", "method", "params"]))
      return undefined;
    if (r.channel !== "bitchord-bridge" || r.direction !== "to-extension") return undefined;
    if (typeof r.protocol !== "number") return undefined;
    if (typeof r.id !== "string" || r.id.length > MAX_BRIDGE_ID) return undefined;
    if (typeof r.method !== "string" || r.method.length > MAX_BRIDGE_METHOD) return undefined;
    const params = r.params ?? {};
    if (typeof params !== "object" || params === null || Array.isArray(params)) return undefined;
    return {
      type: "bridge",
      request: { ...(r as unknown as BridgeRequest), params: params as Record<string, unknown> },
    };
  }
  if (m.type === "wake-pointer") {
    if (!hasOnly(m, ["type", "x", "y"])) return undefined;
    const inRange = (n: unknown): n is number =>
      typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= MAX_COORD;
    if (!inRange(m.x) || !inRange(m.y)) return undefined;
    return { type: "wake-pointer", x: m.x, y: m.y };
  }
  return undefined;
}
