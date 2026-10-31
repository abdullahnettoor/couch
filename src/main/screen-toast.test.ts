import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { startHarness, type Harness } from "./testing/harness.ts";

let h: Harness;
beforeEach(async () => (h = await startHarness()));
afterEach(() => h.stop());

test("the app can show a quiet toast on the Screen", () => {
  h.app.toast("Couldn't update the phone connection; will retry");
  expect(h.screen.last.state.toast).toBe("Couldn't update the phone connection; will retry");
});
