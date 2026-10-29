import type { AppSignIn, SignInResult } from "../apps/app.ts";
import { couchNetflixCookies, hasNetflixSignIn, type CouchCookieSource } from "./couch-cookies.ts";
import type { WebKitCookie } from "./webkit-bridge.ts";

export interface AppSignInOptions {
  /** Couch's own Chromium cookies for Netflix, read only. Absent: no "Copy sign-in from Couch". */
  couch?: CouchCookieSource;
  target: {
    setCookies(cookies: WebKitCookie[]): Promise<void>;
    signOut(): Promise<void>;
  };
}

/**
 * Settings → Apps → <App>: copy the sign-in from Couch's own Chromium, or sign out. Cookie values pass from
 * Chromium to the App's store and nowhere else: results and errors never carry them.
 */
export function createAppSignIn(o: AppSignInOptions): AppSignIn {
  // Sign out bumps `generation` before anything else, so a copy whose read was in flight can no longer write.
  // Writes and sign outs run one at a time, so a sign out never overlaps cookies still going into the store.
  const CANCELLED: SignInResult = { ok: false, reason: "cancelled" };
  let generation = 0;
  let tail: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work, work);
    tail = run.catch(() => {});
    return run;
  };
  const write = (mine: number, cookies: WebKitCookie[]) =>
    inTurn(async (): Promise<SignInResult> => {
      if (generation !== mine) return CANCELLED;
      let failed = false;
      try {
        await o.target.setCookies(cookies);
      } catch {
        failed = true;
      }
      // A sign out that came during the write is queued behind it and clears afterwards: the copy is cancelled either way.
      if (generation !== mine) return CANCELLED;
      return failed ? { ok: false, reason: "failed" } : { ok: true, count: cookies.length };
    });
  const couch = o.couch;
  const copyFromCouch: AppSignIn["copyFromCouch"] = couch && {
    async available() {
      try {
        return hasNetflixSignIn(await couch.get());
      } catch {
        return false;
      }
    },
    async copy() {
      const mine = generation;
      let cookies: WebKitCookie[] | undefined;
      try {
        const all = await couch.get();
        cookies = hasNetflixSignIn(all) ? couchNetflixCookies(all) : [];
      } catch {
        cookies = undefined;
      }
      if (generation !== mine) return CANCELLED;
      if (!cookies) return { ok: false, reason: "failed" };
      if (cookies.length === 0) return { ok: false, reason: "none" };
      return write(mine, cookies);
    },
  };
  return {
    ...(copyFromCouch ? { copyFromCouch } : {}),
    signOut() {
      generation++;
      return inTurn(() => o.target.signOut());
    },
  };
}
