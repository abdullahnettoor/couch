import { netflixCookies, parseBinaryCookies } from "./binary-cookies.ts";
import type { AppSignIn } from "../apps/app.ts";
import type { WebKitCookie } from "./webkit-bridge.ts";

export interface SafariSignInOptions {
  /** Where Safari keeps its cookie file, newest location first. */
  paths: string[];
  read(path: string): Promise<Buffer>;
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
  return {
    async importSignIn() {
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
      if (!data) return { ok: false, reason: blocked ? "permission" : "none" };
      let cookies: WebKitCookie[];
      try {
        cookies = netflixCookies(parseBinaryCookies(data));
      } catch {
        return { ok: false, reason: "failed" };
      }
      if (cookies.length === 0) return { ok: false, reason: "none" };
      try {
        await o.target.setCookies(cookies);
      } catch {
        return { ok: false, reason: "failed" };
      }
      return { ok: true, count: cookies.length };
    },
    signOut: () => o.target.signOut(),
  };
}
