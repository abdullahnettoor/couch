import { expect, test } from "vite-plus/test";
import { heroVideo } from "../shared/home-grid.ts";

const videos = [{ path: "/a" }, { path: "/b" }, { path: "/c" }];

test("the hero follows the focused video", () => {
  expect(heroVideo(videos, "/c")?.path).toBe("/c");
});

test("the hero is the newest when focus is elsewhere", () => {
  expect(heroVideo(videos, "youtube")?.path).toBe("/a");
  expect(heroVideo(videos, undefined)?.path).toBe("/a");
});

test("no in-progress video, no hero", () => {
  expect(heroVideo([], "youtube")).toBeUndefined();
});
