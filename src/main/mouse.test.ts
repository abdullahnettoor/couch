import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { startHarness, type Harness } from "./testing/harness.ts";

describe("mouse focus (Screen only)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await startHarness();
  });
  afterEach(() => h.stop());

  test("focusAt from the Screen moves focus to that cell, then OK activates it", () => {
    h.app.screenCommand({ command: "focusAt", args: { r: 1, c: 2 } });
    expect(h.screen.last.focusedLabel).toBe("Library");
    h.app.screenCommand({ command: "focusAt", args: { r: 0, c: 0 } });
    expect(h.screen.last.focusedLabel).toBe("Settings");
    h.app.screenCommand({ command: "ok" });
    expect(h.screen.last.state.view).toBe("settings");
  });

  test("focusAt on a cell with no item changes nothing", () => {
    h.app.screenCommand({ command: "focusAt", args: { r: 9, c: 9 } });
    expect(h.screen.last.focusedLabel).toBe("YouTube");
  });

  test("a phone cannot send focusAt", async () => {
    const phone = await h.connectPhone();
    phone.send({ command: "focusAt", args: { r: 1, c: 1 } } as never);
    await phone.settle();
    expect(h.screen.last.focusedLabel).toBe("YouTube");
    h.app.core.handle({ command: "focusAt", args: { r: 1, c: 1 } }, "some-phone");
    expect(h.screen.last.focusedLabel).toBe("YouTube");
  });
});
