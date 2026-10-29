import { AVAILABILITY_TIMEOUT_MS } from "../apps/availability.ts";
import { cdpCookies, type CouchCookieSource } from "./couch-cookies.ts";

/** A throwaway DevTools session on a page of the partition (never navigated, so no page loads and nothing is requested). */
export interface CdpSession {
  send(method: string): Promise<unknown>;
  close(): void;
}

/**
 * Couch's Chromium cookies through `Network.getAllCookies`, which reports each cookie's partition key (Electron's
 * `cookies.get` does not). Read only; the session is closed after every read, and any failure (or a read slower than the limit) fails the read.
 */
export function cdpCookieSource(
  open: () => CdpSession,
  timeoutMs = AVAILABILITY_TIMEOUT_MS,
): CouchCookieSource {
  return {
    async get() {
      const session = open();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("cookie read timed out")), timeoutMs);
        });
        return cdpCookies(await Promise.race([session.send("Network.getAllCookies"), timeout]));
      } finally {
        clearTimeout(timer);
        session.close();
      }
    },
  };
}
