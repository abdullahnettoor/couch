import { cdpCookies, type CouchCookieSource } from "./couch-cookies.ts";

/** A throwaway DevTools session on a page of the partition (never navigated, so no page loads and nothing is requested). */
export interface CdpSession {
  send(method: string): Promise<unknown>;
  close(): void;
}

/**
 * Couch's Chromium cookies through `Network.getAllCookies`, which reports each cookie's partition key (Electron's
 * `cookies.get` does not). Read only; the session is closed after every read, and any failure fails the read.
 */
export function cdpCookieSource(open: () => CdpSession): CouchCookieSource {
  return {
    async get() {
      const session = open();
      try {
        return cdpCookies(await session.send("Network.getAllCookies"));
      } finally {
        session.close();
      }
    },
  };
}
