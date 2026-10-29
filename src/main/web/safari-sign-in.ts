import { netflixCookies, parseBinaryCookies } from "./binary-cookies.ts";
import type { AppSignIn, SignInResult } from "../apps/app.ts";
import { couchNetflixCookies, type CouchCookieSource } from "./couch-cookies.ts";
import type { WebKitCookie } from "./webkit-bridge.ts";

export interface SafariSignInOptions {
  /** Where Safari keeps its cookie file, newest location first. */
  paths: string[];
  read(path: string): Promise<Buffer>;
  /** Couch's own Chromium cookies for Netflix, read only. Absent: no "Copy sign-in from Couch". */
  couch?: CouchCookieSource;
  target: {
    setCookies(cookies: WebKitCookie[]): Promise<void>;
    signOut(): Promise<void>;
  };
}

/** Safari's cookie file, in its sandbox container and then the older place. */
export function safariCookiePaths(home: string): string[] {
  return [
    `${home}/Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies`,
    `${home}/Library/Cookies/Cookies.binarycookies`,
  ];
}

/**
 * Settings → Apps → <App>: import the Netflix cookies from Safari, or sign out. Cookie values pass from the
 * file to the App's store and nowhere else: results and errors never carry them.
 */
export function createSafariSignIn(o: SafariSignInOptions): AppSignIn {
  // Sign out bumps `generation` before anything else, so an import whose read was in flight can no longer write.
  // Writes and sign outs run one at a time, so a sign out never overlaps cookies still going into the store.
  let generation = 0;
  let tail: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work, work);
    tail = run.catch(() => {});
    return run;
  };
  const write = (mine: number, cookies: WebKitCookie[]) =>
    inTurn(async (): Promise<SignInResult> => {
      if (generation !== mine) return { ok: false, reason: "cancelled" };
      try {
        await o.target.setCookies(cookies);
      } catch {
        return { ok: false, reason: "failed" };
      }
      return { ok: true, count: cookies.length };
    });
  const couch = o.couch;
  const copyFromCouch: AppSignIn["copyFromCouch"] = couch && {
    async available() {
      try {
        return couchNetflixCookies(await couch.get({})).length > 0;
      } catch {
        return false;
      }
    },
    async copy() {
      const mine = generation;
      let cookies: WebKitCookie[];
      try {
        cookies = couchNetflixCookies(await couch.get({}));
      } catch {
        return { ok: false, reason: "failed" };
      }
      if (generation !== mine) return { ok: false, reason: "cancelled" };
      if (cookies.length === 0) return { ok: false, reason: "none" };
      return write(mine, cookies);
    },
  };
  return {
    ...(copyFromCouch ? { copyFromCouch } : {}),
    async importSignIn() {
      const mine = generation;
      let data: Buffer | undefined;
      let blocked = false;
      for (const path of o.paths) {
        try {
          data = await o.read(path);
          break;
        } catch (e) {
          const code = (e as { code?: unknown }).code;
          if (code === "EPERM" || code === "EACCES") blocked = true;
          else if (code !== "ENOENT") return { ok: false, reason: "failed" };
        }
      }
      if (generation !== mine) return { ok: false, reason: "cancelled" };
      if (!data) return { ok: false, reason: blocked ? "permission" : "none" };
      let cookies: WebKitCookie[];
      try {
        cookies = netflixCookies(parseBinaryCookies(data));
      } catch {
        return { ok: false, reason: "failed" };
      }
      if (cookies.length === 0) return { ok: false, reason: "none" };
      return write(mine, cookies);
    },
    signOut() {
      generation++;
      return inTurn(() => o.target.signOut());
    },
  };
}
