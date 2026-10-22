import { describe, expect, test } from "vite-plus/test";
import { FakeClock } from "../ports/fakes.ts";
import { MemoryStore } from "../ports/store.ts";
import { IdleUnloader } from "./idle-unload.ts";

const MIN = 60_000;

function setup(setting?: unknown) {
  const clock = new FakeClock();
  const store = new MemoryStore();
  if (setting !== undefined) store.write("webApps", setting);
  const unloader = new IdleUnloader(clock, store);
  const unloaded: string[] = [];
  const track = (id: string, loaded = false) =>
    unloader.track(id, () => unloaded.push(id), { loaded });
  return { clock, store, unloaded, track };
}

describe("idle unload", () => {
  test("the most recent App (YouTube at launch) stays loaded, however long it is hidden", () => {
    const t = setup();
    t.track("youtube", true);
    t.clock.advance(60 * MIN);
    expect(t.unloaded).toEqual([]);
  });

  test("an App that is not the front or most recent unloads after 10 minutes hidden", () => {
    const t = setup();
    const youtube = t.track("youtube", true);
    const netflix = t.track("netflix");
    netflix.shown();
    netflix.hidden();
    youtube.shown();
    youtube.hidden();
    t.clock.advance(10 * MIN - 1);
    expect(t.unloaded).toEqual([]);
    t.clock.advance(1);
    expect(t.unloaded).toEqual(["netflix"]);
    t.clock.advance(60 * MIN);
    expect(t.unloaded).toEqual(["netflix"]);
  });

  test("the front App never unloads", () => {
    const t = setup();
    const youtube = t.track("youtube", true);
    const netflix = t.track("netflix");
    netflix.shown();
    t.clock.advance(60 * MIN);
    expect(t.unloaded).toEqual([]);
    netflix.hidden();
    youtube.shown();
    t.clock.advance(60 * MIN);
    expect(t.unloaded).toEqual([]);
  });

  test("the timeout is idleUnloadMinutes in the webApps document", () => {
    const t = setup({ idleUnloadMinutes: 2 });
    const youtube = t.track("youtube", true);
    const netflix = t.track("netflix");
    netflix.shown();
    netflix.hidden();
    youtube.shown();
    youtube.hidden();
    t.clock.advance(2 * MIN - 1);
    expect(t.unloaded).toEqual([]);
    t.clock.advance(1);
    expect(t.unloaded).toEqual(["netflix"]);
  });

  test("an App that is shown again before the timeout is kept", () => {
    const t = setup();
    const youtube = t.track("youtube", true);
    const netflix = t.track("netflix");
    netflix.shown();
    netflix.hidden();
    youtube.shown();
    youtube.hidden();
    netflix.shown();
    t.clock.advance(9 * MIN);
    netflix.hidden();
    t.clock.advance(60 * MIN);
    expect(t.unloaded).toEqual(["youtube"]);
  });

  test("an App unloaded earlier counts as loaded again when shown", () => {
    const t = setup({ idleUnloadMinutes: 1 });
    const youtube = t.track("youtube", true);
    const netflix = t.track("netflix");
    netflix.shown();
    netflix.hidden();
    youtube.shown();
    youtube.hidden();
    t.clock.advance(MIN);
    expect(t.unloaded).toEqual(["netflix"]);
    netflix.shown();
    netflix.hidden();
    youtube.shown();
    youtube.hidden();
    t.clock.advance(MIN);
    expect(t.unloaded).toEqual(["netflix", "netflix"]);
  });
});
