import { afterEach, describe, expect, test } from "vite-plus/test";
import { MemoryStore } from "./ports/store.ts";
import { parseCommand } from "./remote/server.ts";
import { startHarness, type Harness } from "./testing/harness.ts";

let h: Harness;
afterEach(async () => {
  await h?.stop();
});

const ids = (apps?: Array<{ id: string }>) => apps?.map((a) => a.id);

describe("Remote quick actions: the Apps row", () => {
  test("the snapshot lists the shown Apps in Home order, with label and icon, on Home", async () => {
    const store = new MemoryStore();
    store.write("home.apps", { order: ["library", "youtube", "netflix"], hidden: ["netflix"] });
    h = await startHarness(store);
    const phone = await h.connectPhone();
    expect(phone.last?.view).toBe("home");
    expect(ids(phone.last?.apps)).toEqual(["library", "youtube"]);
    expect(phone.last?.apps?.map((a) => a.label)).toEqual(["Library", "YouTube"]);
    expect(phone.last?.apps?.every((a) => a.icon.startsWith("<svg"))).toBe(true);
  });

  test("openApp opens a shown App, as OK on its tile would", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    await phone.press({ command: "openApp", args: { app: "youtube" } });
    expect(phone.last?.view).toBe("app");
    expect(phone.last?.where).toBe("YouTube");
    expect(phone.last?.apps).toBeUndefined();
  });

  test("openApp opens the Library too", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    await phone.press({ command: "openApp", args: { app: "library" } });
    expect(phone.last?.view).toBe("library");
  });

  test("a hidden or unknown id is refused", async () => {
    const store = new MemoryStore();
    store.write("home.apps", { order: ["youtube", "netflix", "library"], hidden: ["netflix"] });
    h = await startHarness(store);
    const phone = await h.connectPhone();
    await phone.press({ command: "openApp", args: { app: "netflix" } });
    expect(phone.last?.view).toBe("home");
    await phone.press({ command: "openApp", args: { app: "nope" } });
    expect(phone.last?.view).toBe("home");
    await phone.press({ command: "openApp" });
    expect(phone.last?.view).toBe("home");
  });

  test("a stale openApp away from Home does nothing", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    await phone.press({ command: "openApp", args: { app: "library" } });
    await phone.press({ command: "openApp", args: { app: "youtube" } });
    expect(phone.last?.view).toBe("library");
  });

  test("a Remote's openApp takes only a short string id", () => {
    expect(parseCommand('{"type":"command","command":"openApp","args":{"app":"youtube"}}')).toEqual(
      {
        command: "openApp",
        args: { app: "youtube" },
      },
    );
    expect(parseCommand('{"type":"command","command":"openApp","args":{"app":5}}')).toBeUndefined();
    expect(parseCommand('{"type":"command","command":"openApp","args":{"x":"a"}}')).toBeUndefined();
  });
});
