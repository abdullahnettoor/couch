import type { RouteSignals } from "./web-app.ts";

/** A route for a website App: home is decided from the address alone, no page script. Only a change is announced. */
export function urlRoute(isHome: (url: URL) => boolean): RouteSignals {
  return {
    script: "null",
    idle: null,
    tracker: () => {
      let last: string | undefined;
      return {
        update: (url) => {
          try {
            const home = isHome(new URL(url));
            const key = `${home}|${url}`;
            if (key === last) return undefined;
            last = key;
            return { home, url };
          } catch {
            return undefined;
          }
        },
      };
    },
  };
}
