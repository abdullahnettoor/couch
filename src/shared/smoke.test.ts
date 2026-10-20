import { expect, test } from "vite-plus/test";
import { Channel } from "./ipc.ts";

test("channels are namespaced", () => {
  expect(Object.values(Channel).every((c) => c.startsWith("couch:"))).toBe(true);
});
