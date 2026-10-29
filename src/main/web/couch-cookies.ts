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
  sameSite?: "unspecified" | "no_restriction" | "lax" | "strict";
}

/** Where Couch's own Chromium cookies come from (Electron's `session.cookies` on the Netflix partition, read only). */
export interface CouchCookieSource {
  get(filter: Record<string, never>): Promise<ElectronCookie[]>;
}

/** The Netflix cookies of Electron's list, in the WebKit bridge's shape. */
export function couchNetflixCookies(cookies: ElectronCookie[]): WebKitCookie[] {
  const out: WebKitCookie[] = [];
  for (const c of cookies) {
    if (!c.domain || !isNetflixDomain(c.domain)) continue;
    const cookie: WebKitCookie = {
      domain: c.domain,
      name: c.name,
      path: c.path || "/",
      value: c.value,
      secure: c.secure === true,
      httpOnly: c.httpOnly === true,
      sameSite: c.sameSite === "lax" || c.sameSite === "strict" ? c.sameSite : "none",
    };
    if (!c.session && typeof c.expirationDate === "number" && Number.isFinite(c.expirationDate)) {
      cookie.expires = Math.round(c.expirationDate * 1000);
    }
    out.push(cookie);
  }
  return out;
}
