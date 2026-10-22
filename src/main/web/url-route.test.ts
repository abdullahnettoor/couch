import { expect, test } from "vite-plus/test";
import { urlRoute } from "./url-route.ts";

test("a URL-only route says home from the address alone", () => {
  const route = urlRoute((url) => url.pathname === "/browse");
  const tracker = route.tracker();
  expect(tracker.update("https://www.netflix.com/browse", route.idle)).toEqual({ home: true });
  expect(tracker.update("https://www.netflix.com/title/1", route.idle)).toEqual({ home: false });
});
