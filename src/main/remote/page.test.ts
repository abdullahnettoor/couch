import { expect, test } from "vite-plus/test";
import { REMOTE_PAGE } from "./page.ts";

test("the page shows the first-pairing message when the listener flags it and does not connect", () => {
  expect(REMOTE_PAGE).toContain("window.COUCH_UNPAIRED");
  expect(REMOTE_PAGE).toContain("Open Couch on the Mac once to pair a phone.");
});
