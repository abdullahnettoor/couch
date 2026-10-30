import { afterEach, describe, expect, test } from "vite-plus/test";
import { startHarness, type Harness } from "./testing/harness.ts";

let h: Harness;
afterEach(() => h.stop());

describe("Mute reaches every phone, whoever asked for it", () => {
  test("a phone's mute updates every phone, keeps the level, and unmute restores it", async () => {
    h = await startHarness();
    const a = await h.connectPhone();
    const b = await h.connectPhone();
    const level = a.last!.volume;
    await a.press("mute");
    await b.waitFor(() => b.last?.muted === true);
    expect(a.last?.muted).toBe(true);
    expect(a.last?.volume).toBe(level);
    expect(h.player.volume).toBe(0);
    await a.press("mute");
    await b.waitFor(() => b.last?.muted === false);
    expect(h.player.volume).toBe(level);
  });

  test("mute from Quick settings updates the phone", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    await phone.press("quickSettings");
    await new Promise((r) => setTimeout(r, 30));
    h.app.screenCommand({ command: "quickPick", args: { item: "vol:mute" } });
    await phone.waitFor(() => phone.last?.muted === true);
    h.app.screenCommand({ command: "quickPick", args: { item: "vol:mute" } });
    await phone.waitFor(() => phone.last?.muted === false);
  });

  test("mute from the Screen's own keyboard updates the phone", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    h.app.screenCommand({ command: "mute" });
    await phone.waitFor(() => phone.last?.muted === true);
  });
});
