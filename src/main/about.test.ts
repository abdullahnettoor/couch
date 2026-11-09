import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";
import { devUpdates } from "./ports/updates.ts";
import { NOT_INSTALLED } from "./core/pages/about-page.ts";
import { SUPPORT_URL } from "../shared/links.ts";

let h: Harness;
afterEach(() => h.stop());

const last = () => h.screen.last;
const labels = () => last().grid.map((i) => i.label);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function openAbout(options: Parameters<typeof startHarness>[1] = {}): Promise<FakePhone> {
  h = await startHarness(undefined, options);
  const phone = await h.connectPhone();
  await phone.press("openSettings");
  for (let i = 0; i < 12 && last().focusedLabel !== "About"; i++) await phone.press("down");
  await phone.press("ok");
  expect(last().state.view).toBe("about");
  return phone;
}

async function focus(phone: FakePhone, label: string) {
  for (let i = 0; i < 6 && last().focusedLabel !== label; i++) await phone.press("down");
  expect(last().focusedLabel).toBe(label);
}

/** Lets the core's change reach the Screen. */
async function changed(phone: FakePhone) {
  await phone.settle();
}

describe("Settings → About", () => {
  test("About sits just above Quit Couch; it shows the version and build, Check for updates and Beta updates", async () => {
    const phone = await openAbout();
    expect(last().about?.version).toBe("0.2.0 (12)");
    expect(labels()).toEqual([
      "Check for updates",
      "Beta updates",
      "Run setup again",
      "Support Couch",
    ]);
    expect(last().focusedLabel).toBe("Check for updates");
    expect(last().about?.beta).toBe(false);
    expect(last().back?.label).toBe("Settings");
    await phone.press("back");
    expect(last().state.view).toBe("settings");
    const rows = labels();
    expect(rows.indexOf("About")).toBe(rows.indexOf("Quit Couch") - 1);
  });

  test("Check for updates checks at once and shows each step; OK while checking does nothing", async () => {
    const phone = await openAbout();
    expect(last().about?.check).toBeUndefined();
    await phone.press("ok");
    expect(h.updater.checks).toBe(1);
    expect(last().about?.check).toBe("Checking…");
    await phone.press("ok");
    expect(h.updater.checks).toBe(1);
    h.updater.notAvailable();
    await changed(phone);
    expect(last().about?.check).toBe("Up to date");
    await phone.press("ok");
    h.updater.fail("offline");
    await changed(phone);
    expect(last().about?.check).toBe("Couldn't check. Try again later.");
    await phone.press("ok");
    h.updater.available();
    await changed(phone);
    expect(last().about?.check).toBe("Downloading…");
    expect(labels()).toEqual([
      "Check for updates",
      "Beta updates",
      "Run setup again",
      "Support Couch",
    ]);
    h.updater.download("Couch 0.2.1");
    await changed(phone);
    expect(last().about?.check).toBe("0.2.1 is ready");
    expect(labels()).toEqual([
      "Check for updates",
      "Restart to update",
      "Beta updates",
      "Run setup again",
      "Support Couch",
    ]);
  });

  test("Restart to update asks first; Cancel leaves Couch running, Restart installs", async () => {
    const phone = await openAbout();
    await phone.press("ok");
    h.updater.download("Couch 0.2.1");
    await changed(phone);
    await focus(phone, "Restart to update");
    await phone.press("ok");
    expect(last().state.confirm?.title).toBe("Restart to update?");
    expect(last().state.confirm?.body).toBe("Couch closes and opens again on 0.2.1.");
    expect(last().state.confirm?.buttons).toEqual(["Cancel", "Restart"]);
    await phone.press("ok");
    expect(last().state.confirm).toBeUndefined();
    expect(h.updater.installs).toBe(0);
    await phone.press("ok");
    await phone.press("right");
    await phone.press("ok");
    expect(h.updater.installs).toBe(1);
  });

  test("Beta updates turns On, is kept, points the updater at the beta feed and checks", async () => {
    const phone = await openAbout();
    h.betaFeed.version = "0.2.1-beta.1";
    await focus(phone, "Beta updates");
    await phone.press("ok");
    expect(last().about?.beta).toBe(true);
    expect(last().about?.version).toBe("0.2.0 (12) · Beta");
    expect(h.store.read("updates", {})).toEqual({ beta: true });
    expect(h.updater.feed).toContain("/beta-feed/beta-darwin-arm64.json");
    await flush();
    await changed(phone);
    expect(h.updater.checks).toBe(1);
    h.updater.available();
    await changed(phone);
    expect(last().about?.check).toBe("Downloading 0.2.1-beta.1…");
  });

  test("the old macOS default starts Beta updates On", async () => {
    await openAbout({ legacyBeta: true });
    expect(last().about?.beta).toBe(true);
    expect(h.store.read("updates", {})).toEqual({ beta: true });
  });

  test("Beta updates switched while an update is ready waits for the next start, and says so", async () => {
    const phone = await openAbout();
    await phone.press("ok");
    h.updater.download("Couch 0.2.1");
    await changed(phone);
    await focus(phone, "Beta updates");
    await phone.press("ok");
    expect(last().about?.beta).toBe(true);
    expect(last().about?.hint).toBe("Beta updates start next time Couch opens");
    expect(h.updater.feeds).toHaveLength(1);
  });

  test("run from the repo: the version shows, and Check for updates says updates need the installed app", async () => {
    const phone = await openAbout({
      updates: (store) => devUpdates({ store, version: "0.2.0" }),
    });
    expect(last().about?.version).toBe("0.2.0");
    expect(last().about?.check).toBe("Only in the installed Couch.app");
    await phone.press("ok");
    expect(last().state.toast).toBe(NOT_INSTALLED);
    expect(h.updater.checks).toBe(0);
  });
});

describe("Home's update icon", () => {
  test("is there only once an update is ready, left of the gear, and opens About on Restart to update", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    expect(last().grid.some((i) => i.id === "update")).toBe(false);
    expect(phone.last?.updateReady).toBeUndefined();
    h.app.core.handle({ command: "openUpdate" }, "screen");
    expect(last().state.view).toBe("home");
    h.updater.available();
    await phone.settle();
    expect(last().grid.some((i) => i.id === "update")).toBe(false);
    h.updater.download("Couch 0.2.1");
    await phone.settle();
    expect(last().grid.find((i) => i.id === "update")).toMatchObject({ r: 0, c: -1 });
    expect(phone.last?.updateReady).toBe(true);
    await phone.press("up");
    expect(last().focusedId).toBe("settings");
    await phone.press("left");
    expect(last().focusedId).toBe("update");
    await phone.press("ok");
    expect(last().state.view).toBe("about");
    expect(last().focusedLabel).toBe("Restart to update");
  });

  test("the phone's update icon opens About on Restart to update too", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    h.updater.download("Couch 0.2.1");
    await phone.settle();
    await phone.press("openUpdate");
    expect(last().state.view).toBe("about");
    expect(last().focusedLabel).toBe("Restart to update");
  });
});

describe("Settings → About → Support Couch", () => {
  test("lists Support Couch with its line; OK opens a panel with the address and Back closes it", async () => {
    const phone = await openAbout();
    expect(labels()).toContain("Support Couch");
    expect(last().about?.support).toEqual({
      line: "Couch is free and open source. If it's earned a place on your TV, you can buy me a coffee.",
      url: SUPPORT_URL,
      short: "buymeacoffee.com/abdullahnettoor",
      open: false,
    });
    await focus(phone, "Support Couch");
    await phone.press("ok");
    expect(last().state.view).toBe("about");
    expect(last().about?.support.open).toBe(true);
    expect(labels()).toEqual(["Close"]);
    await phone.press("back");
    expect(last().about?.support.open).toBe(false);
    expect(last().state.view).toBe("about");
    expect(labels()).toContain("Support Couch");
    expect(last().focusedLabel).toBe("Support Couch");
  });

  test("OK on Close closes the panel too, and leaving About forgets it", async () => {
    const phone = await openAbout();
    await focus(phone, "Support Couch");
    await phone.press("ok");
    await phone.press("ok");
    expect(last().about?.support.open).toBe(false);
    await phone.press("ok");
    expect(last().about?.support.open).toBe(true);
    await phone.press("home");
    await phone.press("openSettings");
    for (let i = 0; i < 12 && last().focusedLabel !== "About"; i++) await phone.press("down");
    await phone.press("ok");
    expect(last().about?.support.open).toBe(false);
  });

  test("the phone's snapshot carries the link on About, and nowhere else", async () => {
    const phone = await openAbout();
    expect(phone.last?.link).toEqual({ label: "Support Couch", url: SUPPORT_URL });
    await phone.press("back");
    expect(phone.last?.link).toBeUndefined();
    await phone.press("home");
    expect(phone.last?.link).toBeUndefined();
  });

  test("nothing else in the app mentions the address", { timeout: 30_000 }, () => {
    const hits = execFileSync("git", ["grep", "--untracked", "-l", "buymeacoffee", "--", "src"], {
      cwd: join(import.meta.dirname, "..", ".."),
      encoding: "utf8",
    })
      .split("\n")
      .filter((f) => f && !f.endsWith(".test.ts") && !f.endsWith("page-tour.json"));
    expect(hits).toEqual(["src/shared/links.ts"]);
  });
});
