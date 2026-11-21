import { afterEach, describe, expect, test } from "vite-plus/test";
import { APP_ENTRIES } from "./apps/index.ts";
import type { WelcomeQuestion } from "./apps/app.ts";
import { HomeApps } from "./core/home-apps.ts";
import { FakeWebApp } from "./ports/fakes.ts";
import { MemoryStore } from "./ports/store.ts";
import { startHarness, type Harness } from "./testing/harness.ts";

let h: Harness;
afterEach(() => h?.stop());

const lab = new FakeWebApp("lab", "Lab", {});
const entry = {
  id: "lab",
  label: "Lab",
  icon: "<svg></svg>",
  action: "app:open:lab",
  web: true,
  beta: true,
  onByDefault: true,
};

const start = async (beta: boolean, store = new MemoryStore()) => {
  h = await startHarness(store, { beta, apps: [{ entry, app: lab }] });
  lab.atHome = true;
  return { store, phone: await h.connectPhone() };
};
const homeIds = () => h.screen.last.grid.map((i) => i.id);
const listed = () => h.screen.last.homeApps?.map((a) => a.id) ?? [];
const view = () => h.screen.last.state.view;

describe("beta Apps", () => {
  test("on Stable a beta App is hidden from Home, the App list and the Remote, and can't be opened", async () => {
    const { phone } = await start(false);
    expect(homeIds()).not.toContain("lab");
    expect(homeIds()).not.toContain("bitchord");
    expect(listed()).not.toContain("lab");
    expect(listed()).not.toContain("bitchord");
    expect(h.screen.last.homeApps?.some((a) => a.beta)).toBe(false);
    const s = await phone.press({ command: "openApp", args: { app: "lab" } });
    expect(s.view).toBe("home");
    expect(lab.calls.filter((c) => c.call === "show")).toHaveLength(0);
    expect(s.apps?.map((a) => a.id)).not.toContain("lab");
  });

  test("on Beta it is listed, marked Beta, and opens", async () => {
    const { phone } = await start(true);
    expect(listed()).toContain("lab");
    expect(h.screen.last.homeApps?.find((a) => a.id === "lab")?.beta).toBe(true);
    expect(h.screen.last.homeApps?.find((a) => a.id === "youtube")?.beta).toBeUndefined();
    const s = await phone.press({ command: "openApp", args: { app: "lab" } });
    expect(s.view).toBe("app");
  });

  test("switching the channel updates Home at once", async () => {
    await start(true);
    expect(homeIds()).toContain("lab");
    h.updates.setBeta(false);
    await h.settle();
    expect(homeIds()).not.toContain("lab");
    h.updates.setBeta(true);
    await h.settle();
    expect(homeIds()).toContain("lab");
  });

  test("an open beta App sends the Screen Home when the channel goes to Stable", async () => {
    const { phone } = await start(true);
    await phone.press({ command: "openApp", args: { app: "lab" } });
    expect(view()).toBe("app");
    h.updates.setBeta(false);
    await h.settle();
    expect(view()).toBe("home");
  });

  test("its on/off and place are kept while hidden", async () => {
    const store = new MemoryStore();
    const saved = { order: ["lab", "youtube", "netflix", "library", "bitchord"], hidden: ["lab"] };
    store.write("home.apps", saved);
    await start(true, store);
    expect(h.screen.last.homeApps?.find((a) => a.id === "lab")?.shown).toBe(false);
    h.updates.setBeta(false);
    await h.settle();
    expect(listed()).not.toContain("lab");
    expect(store.read("home.apps", {})).toEqual(saved);
    h.updates.setBeta(true);
    await h.settle();
    expect(listed()[0]).toBe("lab");
    expect(h.screen.last.homeApps?.find((a) => a.id === "lab")?.shown).toBe(false);
  });

  test("a beta App still asking its welcome question doesn't open once the channel goes to Stable", async () => {
    let answerQuestion: (q: WelcomeQuestion | undefined) => void = () => {};
    const slow = new FakeWebApp("lab", "Lab", {
      welcome: {
        question: () => new Promise((resolve) => (answerQuestion = resolve)),
        answer: async () => undefined,
      },
    });
    h = await startHarness(new MemoryStore(), { beta: true, apps: [{ entry, app: slow }] });
    const phone = await h.connectPhone();
    await phone.press({ command: "openApp", args: { app: "lab" } });
    h.updates.setBeta(false);
    await h.settle();
    answerQuestion(undefined);
    await h.settle();
    expect(view()).toBe("home");
    expect(slow.calls.filter((c) => c.call === "show")).toHaveLength(0);
  });

  test("turning Apps on or off and moving them on Stable keeps a hidden beta App's place and switch", () => {
    const store = new MemoryStore();
    store.write("home.apps", {
      order: ["youtube", "lab", "netflix", "library", "bitchord"],
      hidden: ["lab"],
    });
    let beta = false;
    const apps = new HomeApps({
      store,
      known: () => [...APP_ENTRIES, entry],
      betaChannel: () => beta,
      toast: () => {},
      hidden: () => {},
      changed: () => {},
      hasSignIn: () => false,
      hasCouchCopy: () => false,
      playback: () => undefined,
    });
    expect(apps.rows().map((r) => r.id)).toEqual(["youtube", "netflix", "library"]);
    expect(apps.setShown("lab", true)).toBe(false);
    apps.move("netflix", -1);
    expect(apps.setShown("library", false)).toBe(true);
    expect(apps.rows().map((r) => r.id)).toEqual(["netflix", "youtube", "library"]);
    beta = true;
    expect(apps.rows().map((r) => [r.id, r.shown])).toEqual([
      ["netflix", true],
      ["lab", false],
      ["youtube", true],
      ["library", false],
      ["bitchord", true],
    ]);
  });
});
