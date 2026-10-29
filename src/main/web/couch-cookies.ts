import { isNetflixDomain } from "./binary-cookies.ts";
import type { WebKitCookie } from "./webkit-bridge.ts";

/** The part of an Electron `Cookie` that Couch reads. `expirationDate` is Unix seconds and absent for a session cookie. */
export interface ElectronCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  session?: boolean;
  expirationDate?: number;
  /** True for a CHIPS cookie (it has a partition key). Electron's own cookie list never says so; the DevTools one does. */
  partitioned?: boolean;
  sameSite?: "unspecified" | "no_restriction" | "lax" | "strict";
}

/**
 * Where Couch's own Chromium cookies come from, read only. It must tell partitioned cookies apart
 * (`partitioned`): Electron's `cookies.get` cannot, so the real source reads through DevTools `Network.getAllCookies`.
 */
export interface CouchCookieSource {
  get(): Promise<ElectronCookie[]>;
}

/** Reads a DevTools `Network.getAllCookies` answer into `ElectronCookie`s, keeping the partition flag. Throws on a shape it does not know. */
export function cdpCookies(answer: unknown): ElectronCookie[] {
  const list = (answer as { cookies?: unknown } | null)?.cookies;
  if (!Array.isArray(list)) throw new Error("unexpected cookie answer");
  return list.map((raw): ElectronCookie => {
    const c = raw as Record<string, unknown>;
    const site = typeof c.sameSite === "string" ? c.sameSite.toLowerCase() : "";
    const cookie: ElectronCookie = {
      name: String(c.name),
      value: String(c.value),
      domain: typeof c.domain === "string" ? c.domain : undefined,
      path: typeof c.path === "string" ? c.path : undefined,
      secure: c.secure === true,
      httpOnly: c.httpOnly === true,
      session: c.session === true,
      sameSite: site === "none" ? "no_restriction" : site === "strict" ? "strict" : "lax",
      partitioned: c.partitionKey !== undefined && c.partitionKey !== null,
    };
    if (typeof c.expires === "number" && c.expires > 0) cookie.expirationDate = c.expires;
    return cookie;
  });
}

/** The Netflix cookies of Electron's list, in the WebKit bridge's shape. */
export function couchNetflixCookies(cookies: ElectronCookie[]): WebKitCookie[] {
  const out: WebKitCookie[] = [];
  for (const c of cookies) {
    if (c.partitioned || !c.domain || !isNetflixDomain(c.domain)) continue;
    const cookie: WebKitCookie = {
      domain: c.domain,
      name: c.name,
      path: c.path || "/",
      value: c.value,
      secure: c.secure === true,
      httpOnly: c.httpOnly === true,
      // Chromium treats a cookie without a SameSite attribute as Lax; only an explicit no_restriction is none.
      sameSite:
        c.sameSite === "no_restriction" ? "none" : c.sameSite === "strict" ? "strict" : "lax",
    };
    if (!c.session && typeof c.expirationDate === "number" && Number.isFinite(c.expirationDate)) {
      cookie.expires = Math.round(c.expirationDate * 1000);
    }
    out.push(cookie);
  }
  return out;
}
