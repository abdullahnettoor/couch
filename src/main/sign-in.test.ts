import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import type { AppEntry } from "./apps/index.ts";
import type { AppSignIn, SignInResult } from "./apps/app.ts";
import { createSafariSignIn } from "./web/safari-sign-in.ts";
import type { WebKitCookie } from "./web/webkit-bridge.ts";
import { syntheticCookie, syntheticCookieFile } from "./testing/binary-cookies.ts";
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
    expect(note).toContain("Restart Couch");
  });

  test("the phone gets the same explanation: a short title and the steps", async () => {
    const { app } = setup({ ok: false, reason: "permission" });
    h = await startHarness(undefined, { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    expect(phone.last?.signInNote).toBeUndefined();
    await openMenu(phone, "Cinema");
    await pick(phone, "Import Safari sign-in");
    const note = phone.last!.signInNote!;
    expect(note.title).toBe("Couch needs Full Disk Access");
    expect(note.steps).toHaveLength(2);
    expect(note.steps[0]).toContain("Full Disk Access");
    expect(note.steps[0]).toContain("Couch");
    expect(note.steps[1]).toContain("Restart Couch");
    // the Screen says the same steps
    for (const step of note.steps) expect(h.screen.last.appMenu?.note).toContain(step);
  });

  test("the phone's explanation goes when the menu closes", async () => {
    const { app } = setup({ ok: false, reason: "permission" });
    h = await startHarness(undefined, { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    await pick(phone, "Import Safari sign-in");
    expect(phone.last?.signInNote).toBeDefined();
    await phone.press("back");
    await phone.settle();
    expect(phone.last?.signInNote).toBeUndefined();
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

describe("the Settings path with the real Safari sign-in", () => {
  test("sign out pressed while Safari's file is still being read wins", async () => {
    let release!: (b: Buffer) => void;
    const calls: string[] = [];
    const signIn = createSafariSignIn({
      paths: ["/fake"],
      read: () => new Promise<Buffer>((r) => (release = r)),
      target: {
        setCookies: async () => void calls.push("set"),
        signOut: async () => void calls.push("signOut"),
      },
    });
    const app = new FakeWebApp("weather", "Cinema", { signIn });
    h = await startHarness(undefined, { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    await focus(phone, "Import Safari sign-in");
    await phone.press("ok");
    await pick(phone, "Sign out");
    release(syntheticCookieFile([syntheticCookie(".netflix.com", "a", SECRET)]));
    await h.settle();
    await phone.settle();
    expect(calls).toEqual(["signOut"]);
    expect(h.screen.last.state.toast).toBe("Signed out of Cinema");
  });
});

describe("a cookie value reaches the App's store and nothing else", () => {
  const errors = (): Array<[string, Error | ({ code: string } & Error)]> => [
    [
      "a read that fails with the value in its message",
      Object.assign(new Error(SECRET), { code: "EIO" }),
    ],
    [
      "a blocked read with the value in its message",
      Object.assign(new Error(SECRET), { code: "EPERM" }),
    ],
  ];

  async function run(o: {
    read?: () => Promise<Buffer>;
    setCookies?: (cookies: WebKitCookie[]) => Promise<void>;
    signOut?: () => Promise<void>;
    press: "Import Safari sign-in" | "Sign out";
  }) {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const writes = ["stdout", "stderr"].map((k) =>
      vi.spyOn(process[k as "stdout" | "stderr"], "write").mockImplementation(() => true),
    );
    const received: WebKitCookie[][] = [];
    const signIn = createSafariSignIn({
      paths: ["/fake"],
      read: o.read ?? (async () => file),
      target: {
        setCookies: async (c) => {
          received.push(c);
          await o.setCookies?.(c);
        },
        signOut: o.signOut ?? (async () => {}),
      },
    });
    const app = new FakeWebApp("weather", "Cinema", { signIn });
    const dir = mkdtempSync(join(tmpdir(), "couch-signin-"));
    h = await startHarness(new FileStore(dir), { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    await pick(phone, o.press);
    const stores = readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8"));
    expect(stores.length).toBeGreaterThan(0);
    const elsewhere = JSON.stringify([
      stores,
      h.screen.payloads,
      phone.snapshots,
      spies.map((s) => s.mock.calls),
      writes.map((s) => s.mock.calls),
    ]);
    vi.restoreAllMocks();
    return { received, elsewhere, toast: h.screen.last.state.toast };
  }

  const file = syntheticCookieFile([
    syntheticCookie(".netflix.com", "NetflixId", SECRET),
    syntheticCookie(".example.org", "other", SECRET),
  ]);

  test("success: the target gets it; no log, Store, Screen payload or phone snapshot does", async () => {
    const r = await run({ press: "Import Safari sign-in" });
    expect(JSON.stringify(r.received)).toContain(SECRET);
    expect(r.toast).toBe("Imported 1 Cinema cookie");
    expect(r.elsewhere).not.toContain(SECRET);
  });

  test.each(errors())("%s", async (_name, error) => {
    const r = await run({
      press: "Import Safari sign-in",
      read: async () => {
        throw error;
      },
    });
    expect(r.received).toEqual([]);
    expect(r.elsewhere).not.toContain(SECRET);
  });

  test("a native store that refuses with the value in its error", async () => {
    const r = await run({
      press: "Import Safari sign-in",
      setCookies: async () => {
        throw new Error(`refused ${SECRET}`);
      },
    });
    expect(r.toast).toBe("Couldn't import the Safari sign-in");
    expect(r.elsewhere).not.toContain(SECRET);
  });

  test("a damaged file that still holds the value", async () => {
    const r = await run({
      press: "Import Safari sign-in",
      read: async () => file.subarray(0, file.length - 30),
    });
    expect(r.received).toEqual([]);
    expect(r.toast).toBe("Couldn't import the Safari sign-in");
    expect(r.elsewhere).not.toContain(SECRET);
  });

  test("a file with no Netflix cookies, whose other cookies hold the value", async () => {
    const r = await run({
      press: "Import Safari sign-in",
      read: async () => syntheticCookieFile([syntheticCookie(".example.org", "o", SECRET)]),
    });
    expect(r.received).toEqual([]);
    expect(r.toast).toBe("No Cinema sign-in found in Safari");
    expect(r.elsewhere).not.toContain(SECRET);
  });

  test("sign out failing with the value in its error", async () => {
    const r = await run({
      press: "Sign out",
      signOut: async () => {
        throw new Error(SECRET);
      },
    });
    expect(r.toast).toBe("Couldn't sign out of Cinema");
    expect(r.elsewhere).not.toContain(SECRET);
  });
});
