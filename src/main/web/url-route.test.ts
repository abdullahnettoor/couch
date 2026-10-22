import { expect, test } from "vite-plus/test";
import { urlRoute } from "./url-route.ts";

test("a URL-only route says home from the address alone", () => {
  const route = urlRoute((url) => url.pathname === "/browse");
  const tracker = route.tracker();
  expect(tracker.update("https://www.netflix.com/browse", route.idle)).toMatchObject({
    home: true,
  });
  expect(tracker.update("https://www.netflix.com/title/1", route.idle)).toMatchObject({
    home: false,
  });
});

test("an unchanged address is not announced again", () => {
  const route = urlRoute((url) => url.pathname === "/browse");
  const tracker = route.tracker();
  const url = "https://www.netflix.com/browse";
  expect(tracker.update(url, route.idle)).toMatchObject({ home: true });
  expect(tracker.update(url, route.idle)).toBeUndefined();
  expect(tracker.update("https://www.netflix.com/search", route.idle)).toMatchObject({
    home: false,
  });
  expect(tracker.update(url, route.idle)).toMatchObject({ home: true });
});
