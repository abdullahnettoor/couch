import { afterEach, describe, expect, test } from "vite-plus/test";
import { FakeWebApp } from "./ports/fakes.ts";
import { startHarness, type Harness } from "./testing/harness.ts";

let h: Harness;
afterEach(() => h.stop());

const entry = {
  id: "tube",
  label: "Tube",
  icon: "<svg></svg>",
  action: "app:open:tube",
  web: true,
};

describe("the Screen says when playback is on screen", () => {
  test("a web App's video counts, its browse pages and Home don't", async () => {
    const tube = new FakeWebApp("tube", "Tube", {});
    h = await startHarness(undefined, { apps: [{ entry, app: tube }] });
    const phone = await h.connectPhone();
    expect(h.screen.last.playing).toBe(false);
    for (let i = 0; i < 20 && h.screen.last.state.view !== "app"; i++) {
      const { grid, focusedId } = h.screen.last;
      const cur = grid.find((x) => x.id === focusedId)!;
      const t = grid.find((x) => x.id === "tube")!;
      if (cur.id === t.id) await phone.press("ok");
      else
        await phone.press(
          t.r > cur.r ? "down" : t.r < cur.r ? "up" : t.c > cur.c ? "right" : "left",
        );
    }
    expect(h.screen.last.state.view).toBe("app");
    expect(h.screen.last.playing).toBe(false);
    tube.emit({
      type: "playback",
      playback: { position: 30, duration: 600, paused: false, title: "Cat video" },
    });
    await phone.waitFor(() => phone.last?.nowPlaying !== undefined);
    expect(h.screen.last.playing).toBe(true);
    await phone.press({ command: "setPictureOff", args: { on: true } });
    expect(h.screen.last.playing).toBe(true);
    tube.emit({ type: "playback", playback: undefined });
    await phone.waitFor(() => phone.last?.nowPlaying === undefined);
    expect(h.screen.last.playing).toBe(false);
  });
});
