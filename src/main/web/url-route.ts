import type { RouteSignals } from "./web-app.ts";

/** A route for a website App: home is decided from the address alone, no page script. */
export function urlRoute(isHome: (url: URL) => boolean): RouteSignals {
  return {
    script: "null",
    idle: null,
    tracker: () => ({
      update: (url) => {
        try {
          return { home: isHome(new URL(url)) };
        } catch {
          return undefined;
        }
      },
    }),
  };
}
