import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import type { AppEntry } from "./apps/index.ts";
import type { AppSignIn, SignInResult } from "./apps/app.ts";
import { createSafariSignIn } from "./web/safari-sign-in.ts";
import type { WebKitCookie } from "./web/webkit-bridge.ts";
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

function setupCopy(available: boolean, result: SignInResult = { ok: true, count: 3 }) {
  const calls: string[] = [];
  const signIn: AppSignIn = {
    copyFromCouch: {
      available: async () => available,
      copy: async () => (calls.push("copy"), result),
    },
    importSignIn: async () => (calls.push("import"), { ok: true, count: 1 }),
    signOut: async () => void calls.push("signOut"),
  };
  return { calls, app: new FakeWebApp("weather", "Cinema", { signIn }) };
}

describe("Settings → Apps → Copy sign-in from Couch", () => {
  test("shown first, above Import Safari sign-in, when Couch's Chromium holds a sign-in", async () => {
    const { app } = setupCopy(true);
    h = await startHarness(undefined, { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    await h.settle();
    const rows = labels();
    expect(rows.indexOf("Copy sign-in from Couch")).toBeGreaterThan(rows.indexOf("Restart Cinema"));
    expect(rows.indexOf("Copy sign-in from Couch")).toBe(rows.indexOf("Import Safari sign-in") - 1);
  });

  test("not shown when Chromium holds no sign-in", async () => {
    const { app } = setupCopy(false);
    h = await startHarness(undefined, { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    await h.settle();
    expect(labels()).not.toContain("Copy sign-in from Couch");
    expect(labels()).toContain("Import Safari sign-in");
  });

  test("not shown for an App with no Couch source", async () => {
    const { app } = setup({ ok: true, count: 1 });
    h = await startHarness(undefined, { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    await h.settle();
    expect(labels()).not.toContain("Copy sign-in from Couch");
  });

  test("copying toasts the count on the Screen and the phone gets the same", async () => {
    const { app, calls } = setupCopy(true, { ok: true, count: 3 });
    h = await startHarness(undefined, { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    await h.settle();
    await pick(phone, "Copy sign-in from Couch");
    expect(calls).toEqual(["copy"]);
    expect(h.screen.last.state.toast).toBe("Copied 3 Cinema cookies");
    expect(phone.last?.signInNote).toEqual({ title: "Copied 3 Cinema cookies", steps: [] });
    expect(h.screen.last.appMenu?.note).toBeUndefined();
  });

  test("one cookie is singular", async () => {
    const { app } = setupCopy(true, { ok: true, count: 1 });
    h = await startHarness(undefined, { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    await h.settle();
    await pick(phone, "Copy sign-in from Couch");
    expect(h.screen.last.state.toast).toBe("Copied 1 Cinema cookie");
  });

  test("none and failure get calm toasts; a cancelled copy is silent", async () => {
    for (const [result, toast] of [
      [{ ok: false, reason: "none" }, "No Cinema sign-in found in Couch"],
      [{ ok: false, reason: "failed" }, "Couldn't copy the sign-in from Couch"],
      [{ ok: false, reason: "cancelled" }, undefined],
    ] as const) {
      const { app } = setupCopy(true, result);
      h = await startHarness(undefined, { apps: [{ entry, app }] });
      const phone = await h.connectPhone();
      await openMenu(phone, "Cinema");
      await h.settle();
      await pick(phone, "Copy sign-in from Couch");
      if (toast) expect(h.screen.last.state.toast).toBe(toast);
      else expect(h.screen.last.state.toast).not.toMatch(/Copied/);
      expect(phone.last?.signInNote).toBeUndefined();
      await h.stop();
    }
  });

  test("the phone's note goes when the menu closes", async () => {
    const { app } = setupCopy(true);
    h = await startHarness(undefined, { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    await h.settle();
    await pick(phone, "Copy sign-in from Couch");
    expect(phone.last?.signInNote).toBeDefined();
    await phone.press("back");
    expect(phone.last?.signInNote).toBeUndefined();
  });
});

describe("the Settings path with the real copy", () => {
  // The first read is the menu asking whether a sign-in exists; the copy is the second.
  const afterMenuOpens = <T>(next: () => Promise<T[]>) => {
    let reads = 0;
    return async () => (reads++ === 0 ? ([cookie("probe")] as T[]) : next());
  };

  const cookie = (name: string, domain = ".netflix.com") => ({
    name,
    value: SECRET,
    domain,
    path: "/",
    secure: true,
    httpOnly: true,
    session: true,
    sameSite: "lax" as const,
  });

  test("sign out pressed while Chromium's cookies are still being read wins", async () => {
    let release!: (c: ReturnType<typeof cookie>[]) => void;
    const calls: string[] = [];
    const signIn = createSafariSignIn({
      paths: [],
      read: async () => Buffer.alloc(0),
      couch: { get: afterMenuOpens(() => new Promise((r) => (release = r))) },
      target: {
        setCookies: async () => void calls.push("set"),
        signOut: async () => void calls.push("signOut"),
      },
    });
    const app = new FakeWebApp("weather", "Cinema", { signIn });
    h = await startHarness(undefined, { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    await h.settle();
    await focus(phone, "Copy sign-in from Couch");
    await phone.press("ok");
    await pick(phone, "Sign out");
    release([cookie("a")]);
    await h.settle();
    await phone.settle();
    expect(calls).toEqual(["signOut"]);
    expect(h.screen.last.state.toast).toBe("Signed out of Cinema");
  });

  async function run(o: {
    get: () => Promise<ReturnType<typeof cookie>[]>;
    setCookies?: (c: WebKitCookie[]) => Promise<void>;
  }) {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const writes = ["stdout", "stderr"].map((k) =>
      vi.spyOn(process[k as "stdout" | "stderr"], "write").mockImplementation(() => true),
    );
    const received: WebKitCookie[][] = [];
    const signIn = createSafariSignIn({
      paths: [],
      read: async () => Buffer.alloc(0),
      couch: { get: afterMenuOpens(o.get) },
      target: {
        setCookies: async (c) => {
          received.push(c);
          await o.setCookies?.(c);
        },
        signOut: async () => {},
      },
    });
    const app = new FakeWebApp("weather", "Cinema", { signIn });
    const dir = mkdtempSync(join(tmpdir(), "couch-copy-"));
    h = await startHarness(new FileStore(dir), { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    await h.settle();
    await pick(phone, "Copy sign-in from Couch");
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

  test("success: only the target gets the value; only Netflix cookies; nothing else leaks", async () => {
    const r = await run({
      get: async () => [
        cookie("a"),
        cookie("b", "evilnetflix.com"),
        cookie("c", "www.netflix.com"),
      ],
    });
    expect(r.toast).toBe("Copied 2 Cinema cookies");
    expect(r.received).toHaveLength(1);
    expect(r.received[0]!.map((c) => c.name)).toEqual(["a", "c"]);
    expect(JSON.stringify(r.received)).toContain(SECRET);
    expect(r.elsewhere).not.toContain(SECRET);
  });

  test("a source that fails with the value in its error", async () => {
    const r = await run({
      get: async () => {
        throw new Error(`boom ${SECRET}`);
      },
    });
    expect(r.toast).toBe("Couldn't copy the sign-in from Couch");
    expect(r.received).toEqual([]);
    expect(r.elsewhere).not.toContain(SECRET);
  });

  test("a native store that refuses with the value in its error", async () => {
    const r = await run({
      get: async () => [cookie("a")],
      setCookies: async () => {
        throw new Error(`refused ${SECRET}`);
      },
    });
    expect(r.toast).toBe("Couldn't copy the sign-in from Couch");
    expect(r.elsewhere).not.toContain(SECRET);
  });

  test("only lookalike cookies: nothing is set", async () => {
    const r = await run({ get: async () => [cookie("a", "evilnetflix.com")] });
    expect(r.toast).toBe("No Cinema sign-in found in Couch");
    expect(r.received).toEqual([]);
    expect(r.elsewhere).not.toContain(SECRET);
  });
});
