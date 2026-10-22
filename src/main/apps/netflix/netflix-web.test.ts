import { expect, test } from "vite-plus/test";
import { seekPlan } from "../../web/seek-plan.ts";
import { netflixDescription } from "./netflix-web.ts";

const desc = netflixDescription("130.0.6723.58");

test("Netflix is a Chrome website on its own session that needs Widevine", () => {
  expect(desc.partition).toBe("persist:netflix");
  expect(desc.url).toBe("https://www.netflix.com/browse");
  expect(desc.drm).toBe(true);
  expect(desc.identity.userAgent).toContain("Chrome/130.0.6723.58");
  expect(desc.identity.userAgent).not.toMatch(/Electron|Cobalt|TV/);
  expect(desc.focus).toBeDefined();
  expect(desc.addons).toEqual([]);
});

test("Skip is one Left or Right key in the player, nothing to commit", () => {
  expect(seekPlan(desc, -10, false)).toEqual({ keys: ["left"], commit: false });
  expect(seekPlan(desc, 10, true)).toEqual({ keys: ["right"], commit: false });
});

test("its route says home from the address alone", () => {
  const tracker = desc.route.tracker();
  expect(tracker.update("https://www.netflix.com/browse", null)).toEqual({ home: true });
  expect(tracker.update("https://www.netflix.com/watch/1", null)).toEqual({ home: false });
});

test("typing searches Netflix", () => {
  expect(desc.search?.placeholder).toBe("Search Netflix");
  expect(desc.search?.urlFor("dark")).toBe("https://www.netflix.com/search?q=dark");
  expect(desc.search?.isSearchUrl("https://www.netflix.com/search?q=dark")).toBe(true);
});
