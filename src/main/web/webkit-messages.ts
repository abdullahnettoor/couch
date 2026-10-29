import { FIELD_BLURRED, FIELD_FOCUSED } from "./page-focus.ts";
import { CONFIRM_MESSAGE } from "./web-hud.ts";

/** The only messages Couch's own scripts post through the `couch` message handler. */
export type PageMessage =
  | { type: "route"; url: string; page: Record<string, string | number | boolean | null> | null }
  | { type: "console"; message: string };

const MAX_URL = 4096;
const MAX_CONSOLE = 64;
const MAX_PAGE_KEYS = 16;

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
  return undefined;
}
