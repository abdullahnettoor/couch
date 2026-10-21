import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { FileStore } from "./ports/store.ts";
import { FakeWebApp } from "./ports/fakes.ts";
import { startHarness, type Harness } from "./testing/harness.ts";

let h: Harness;
afterEach(() => h.stop());

const weather = new FakeWebApp("weather", "Weather", {
  typeLabel: "Search places",
  showVolume: true,
});
const entry = {
  id: "weather",
  label: "Weather",
  icon: "<svg></svg>",
  action: "app:open:weather",
  web: true,
};

async function start() {
  h = await startHarness(undefined, { apps: [{ entry, app: weather }] });
  weather.calls.length = 0;
  weather.atHome = true;
  const phone = await h.connectPhone();
  const focus = async (id: string) => {
    for (let i = 0; i < 20 && h.screen.last.focusedId !== id; i++) {
      const { grid, focusedId } = h.screen.last;
      const cur = grid.find((x) => x.id === focusedId)!;
      const t = grid.find((x) => x.id === id)!;
      await phone.press(t.r > cur.r ? "down" : t.r < cur.r ? "up" : t.c > cur.c ? "right" : "left");
    }
  };
  return { phone, focus };
}

describe("a second web App", () => {
  test("appears on Home and opens on OK", async () => {
    const { phone, focus } = await start();
    expect(h.screen.last.grid.map((i) => i.id)).toContain("weather");
    await focus("weather");
    const s = await phone.press("ok");
    expect(s.view).toBe("app");
    expect(s.where).toBe("Weather");
    expect(weather.calls.map((c) => c.call)).toEqual(["show"]);
    expect(h.youtube.calls.filter((c) => c.call === "show")).toHaveLength(0);
  });

  test("gets keys, play/pause and seek; YouTube gets none", async () => {
    const { phone, focus } = await start();
    await focus("weather");
    await phone.press("ok");
    await phone.press("down");
    await phone.press("ok");
    await phone.press("playpause");
    await phone.press({ command: "seekBy", args: { seconds: 10 } });
    expect(weather.calls.map((c) => c.call)).toEqual([
      "show",
      "sendKey",
      "sendKey",
      "playPause",
      "seekBy",
    ]);
    expect(weather.calls.filter((c) => c.call === "sendKey").map((c) => c.args[0])).toEqual([
      "down",
      "ok",
    ]);
    expect(
      h.youtube.calls
        .map((c) => c.call)
        .filter((c) => c !== "setOutputDevice" && c !== "setVolume"),
    ).toEqual([]);
  });

  test("Back at its home asks Leave Weather?; deeper Back goes to the App", async () => {
    const { phone, focus } = await start();
    await focus("weather");
    await phone.press("ok");
    weather.atHome = false;
    let s = await phone.press("back");
    expect(s.view).toBe("app");
    expect(s.confirm).toBeUndefined();
    weather.atHome = true;
    s = await phone.press("back");
    expect(s.confirm?.title).toBe("Leave Weather?");
    expect(weather.calls.filter((c) => c.call === "showConfirm").at(-1)?.args[0]).toMatchObject({
      title: "Leave Weather?",
    });
    s = await phone.press("right");
    s = await phone.press("ok");
    expect(s.view).toBe("home");
    expect(weather.calls.map((c) => c.call)).toContain("hide");
  });

  test("drives the phone's capabilities from the front App", async () => {
    const { phone, focus } = await start();
    await focus("weather");
    const s = await phone.press("ok");
    expect(s.layout).toBe("app");
    expect(s.typeLabel).toBe("Search places");
    expect(s.typeAvailable).toBe(true);
    expect(s.showVolume).toBe(true);
    expect(s.showSkip).toBe(false);
    await phone.press("home");
    await focus("youtube");
    const y = await phone.press("ok");
    expect(y.showSkip).toBe(true);
    expect(y.typeLabel).toBe("Search YouTube");
  });

  test("receives Couch's volume and the chosen sound output", async () => {
    const { phone } = await start();
    await phone.press({ command: "volSet", args: { percent: 40 } });
    expect(weather.volume).toBe(40);
    await h.stop();
    const store = new FileStore(mkdtempSync(join(tmpdir(), "couch-sound-")));
    store.write("sound", { volume: 55, output: h.mac.outputDevices[1] });
    h = await startHarness(store, { apps: [{ entry, app: weather }] });
    await vi.waitFor(() => expect(weather.outputName).toBe("L27h-4A"));
    expect(weather.volume).toBe(55);
  });

  test("an App that can't reach the chosen output says so once, by its name", async () => {
    weather.outputFound = false;
    const store = new FileStore(mkdtempSync(join(tmpdir(), "couch-sound-")));
    store.write("sound", {
      volume: 55,
      output: { uid: "30AEC067-0000-0000-1A24-0104B53C2278", name: "L27h-4A" },
    });
    h = await startHarness(store, { apps: [{ entry, app: weather }] });
    const said = () =>
      h.screen.payloads.filter(
        (p) => p.state.toast === "Weather can't play to L27h-4A · using System default",
      ).length;
    await vi.waitFor(() => expect(said()).toBeGreaterThan(0));
    const before = said();
    weather.emit({ type: "output", name: "L27h-4A", ok: false });
    await new Promise((r) => setTimeout(r, 30));
    expect(said()).toBe(before);
  });

  test("a load failure shows the error screen for that App", async () => {
    const { phone, focus } = await start();
    await focus("weather");
    await phone.press("ok");
    weather.emit({ type: "failed" });
    await phone.waitFor(() => phone.last?.view === "appError");
    expect(phone.last?.where).toBe("Weather");
    await phone.press("ok");
    expect(weather.calls.map((c) => c.call)).toContain("restart");
  });
});
