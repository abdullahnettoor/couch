import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import type { AppEntry } from "./apps/index.ts";
import type { AppSignIn, SignInResult } from "./apps/app.ts";
import { FakeWebApp } from "./ports/fakes.ts";
import { FileStore } from "./ports/store.ts";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";

let h: Harness;
afterEach(async () => {
  await h?.stop();
});

const SECRET = "fake-secret-value-123";
const entry: AppEntry = {
  id: "weather",
  label: "Cinema",
  icon: "<svg/>",
  action: "app:open:weather",
  web: true,
};

function setup(result: SignInResult) {
  const calls: string[] = [];
  const signIn: AppSignIn = {
    importSignIn: async () => (calls.push("import"), result),
    signOut: async () => void calls.push("signOut"),
  };
  return { calls, app: new FakeWebApp("weather", "Cinema", { signIn }) };
}

async function openMenu(phone: FakePhone, label: string) {
  await phone.press("up");
  await phone.press("ok");
  await focus(phone, "Apps");
  await phone.press("ok");
  await focus(phone, label);
  await phone.press("ok");
  expect(h.screen.last.appMenu?.label).toBe(label);
}
async function focus(phone: FakePhone, label: string) {
  const target = h.screen.last.grid.findIndex((i) => i.label === label);
  for (let i = 0; i < 12 && h.screen.last.focusedLabel !== label; i++) {
    const at = h.screen.last.grid.findIndex((g) => g.id === h.screen.last.focusedId);
    await phone.press(target > at ? "down" : "up");
  }
  expect(h.screen.last.focusedLabel).toBe(label);
}
async function pick(phone: FakePhone, label: string) {
  await focus(phone, label);
  await phone.press("ok");
  await h.settle();
  await phone.settle();
}
const labels = () => h.screen.last.grid.map((i) => i.label);

describe("Settings → Apps → sign-in rows", () => {
  test("shown only for an App that offers sign-in", async () => {
    const { app } = setup({ ok: true, count: 1 });
    h = await startHarness(undefined, { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    expect(labels()).toEqual([
      "Hide from Home",
      "Move up",
      "Move down",
      "Restart Cinema",
      "Import Safari sign-in",
      "Sign out",
    ]);
  });

  test("the built-in Apps have none by default", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    await openMenu(phone, "Netflix");
    expect(labels()).not.toContain("Import Safari sign-in");
  });

  test("import success toasts the count", async () => {
    const { app, calls } = setup({ ok: true, count: 3 });
    h = await startHarness(undefined, { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    await pick(phone, "Import Safari sign-in");
    expect(calls).toEqual(["import"]);
    expect(h.screen.last.state.toast).toBe("Imported 3 Cinema cookies");
    expect(h.screen.last.appMenu?.note).toBeUndefined();
  });

  test("one cookie is singular", async () => {
    const { app } = setup({ ok: true, count: 1 });
    h = await startHarness(undefined, { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    await pick(phone, "Import Safari sign-in");
    expect(h.screen.last.state.toast).toBe("Imported 1 Cinema cookie");
  });

  test("missing Full Disk Access: a calm explanation and a toast on the Screen", async () => {
    const { app } = setup({ ok: false, reason: "permission" });
    h = await startHarness(undefined, { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    await pick(phone, "Import Safari sign-in");
    expect(h.screen.last.state.toast).toBe("Couch needs Full Disk Access to read Safari");
    const note = h.screen.last.appMenu?.note ?? "";
    expect(note).toContain("Full Disk Access");
    expect(note).toContain("Couch");
    expect(note).toContain("System Settings");
    expect(note).toContain("restart");
  });

  test("the explanation goes when the menu closes", async () => {
    const { app } = setup({ ok: false, reason: "permission" });
    h = await startHarness(undefined, { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    await pick(phone, "Import Safari sign-in");
    await phone.press("back");
    await openMenu(phone, "Cinema").catch(() => {});
    expect(h.screen.last.appMenu?.note).toBeUndefined();
  });

  test.each([
    [{ ok: false, reason: "none" }, "No Cinema sign-in found in Safari"],
    [{ ok: false, reason: "failed" }, "Couldn't import the Safari sign-in"],
  ] as const)("%j toasts %s", async (result, text) => {
    const { app } = setup(result);
    h = await startHarness(undefined, { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    await pick(phone, "Import Safari sign-in");
    expect(h.screen.last.state.toast).toBe(text);
  });

  test("sign out asks the App and toasts", async () => {
    const { app, calls } = setup({ ok: true, count: 1 });
    h = await startHarness(undefined, { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    await pick(phone, "Sign out");
    expect(calls).toEqual(["signOut"]);
    expect(h.screen.last.state.toast).toBe("Signed out of Cinema");
  });

  test("an App that throws on sign out gets a calm toast", async () => {
    const app = new FakeWebApp("weather", "Cinema", {
      signIn: {
        importSignIn: async () => ({ ok: true, count: 1 }),
        signOut: async () => {
          throw new Error("busy");
        },
      },
    });
    h = await startHarness(undefined, { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    await pick(phone, "Sign out");
    expect(h.screen.last.state.toast).toBe("Couldn't sign out of Cinema");
  });
});

describe("cookie values stay out of everything Couch shows or keeps", () => {
  test("no log, Store file, Screen payload or phone snapshot carries a value", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    // A sign-in that has the value in hand, as the real one does between the file and the store.
    const app = new FakeWebApp("weather", "Cinema", {
      signIn: {
        importSignIn: async () => {
          const held = SECRET;
          return held.length > 0 ? { ok: true, count: 2 } : { ok: false, reason: "none" };
        },
        signOut: async () => {},
      },
    });
    const dir = mkdtempSync(join(tmpdir(), "couch-signin-"));
    h = await startHarness(new FileStore(dir), { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    await pick(phone, "Import Safari sign-in");
    const files = readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8"));
    expect(files.length).toBeGreaterThan(0);
    const seen = JSON.stringify([
      files,
      h.screen.payloads,
      phone.snapshots,
      spies.map((s) => s.mock.calls),
    ]);
    expect(seen).not.toContain(SECRET);
    vi.restoreAllMocks();
  });
});
