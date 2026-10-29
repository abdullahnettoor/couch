import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import type { AppEntry } from "./apps/index.ts";
import type { AppSignIn, SignInResult } from "./apps/app.ts";
import { createAppSignIn } from "./web/app-sign-in.ts";
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

function setup() {
  const calls: string[] = [];
  const signIn: AppSignIn = {
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
    signOut: async () => void calls.push("signOut"),
  };
  return { calls, app: new FakeWebApp("weather", "Cinema", { signIn }) };
}

describe("Settings → Apps → Copy sign-in from Couch", () => {
  test("shown, between Restart and Sign out, when Couch's Chromium holds a sign-in", async () => {
    const { app } = setupCopy(true);
    h = await startHarness(undefined, { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    await h.settle();
    const rows = labels();
    expect(rows.indexOf("Copy sign-in from Couch")).toBeGreaterThan(rows.indexOf("Restart Cinema"));
    expect(rows.indexOf("Copy sign-in from Couch")).toBe(rows.indexOf("Sign out") - 1);
  });

  test("not shown when Chromium holds no sign-in", async () => {
    const { app } = setupCopy(false);
    h = await startHarness(undefined, { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    await h.settle();
    expect(labels()).not.toContain("Copy sign-in from Couch");
    expect(labels()).toContain("Sign out");
  });

  function setupAnswers() {
    const pending: Array<(v: boolean) => void> = [];
    const signIn: AppSignIn = {
      copyFromCouch: {
        available: () => new Promise<boolean>((res) => pending.push(res)),
        copy: async () => ({ ok: true, count: 1 }),
      },
      signOut: async () => {},
    };
    return { pending, app: new FakeWebApp("weather", "Cinema", { signIn }) };
  }
  const reopen = async (phone: FakePhone) => {
    await focus(phone, "Cinema");
    await phone.press("ok");
    expect(h.screen.last.appMenu?.label).toBe("Cinema");
  };
  const answer = async (fn: () => void) => {
    fn();
    await h.settle();
  };

  test("reopening the menu after the cookies are gone hides the row at once and keeps it hidden", async () => {
    const { app, pending } = setupAnswers();
    h = await startHarness(undefined, { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    await answer(() => pending[0]!(true));
    expect(labels()).toContain("Copy sign-in from Couch");
    await phone.press("back");
    await reopen(phone);
    expect(labels()).not.toContain("Copy sign-in from Couch");
    await answer(() => pending[1]!(false));
    expect(labels()).not.toContain("Copy sign-in from Couch");
  });

  test("an older, slower answer cannot override the newest one", async () => {
    const { app, pending } = setupAnswers();
    h = await startHarness(undefined, { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    await phone.press("back");
    await reopen(phone);
    await answer(() => pending[1]!(false));
    await answer(() => pending[0]!(true));
    expect(labels()).not.toContain("Copy sign-in from Couch");
  });

  test("the newest answer wins when the older one arrives first", async () => {
    const { app, pending } = setupAnswers();
    h = await startHarness(undefined, { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    await phone.press("back");
    await reopen(phone);
    await answer(() => pending[0]!(true));
    expect(labels()).not.toContain("Copy sign-in from Couch");
    await answer(() => pending[1]!(true));
    expect(labels()).toContain("Copy sign-in from Couch");
  });

  test("not shown for an App with no Couch source", async () => {
    const { app } = setup();
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
    expect(phone.last?.toast).toEqual({ text: "Copied 3 Cinema cookies", id: expect.any(Number) });
    expect(phone.last?.signInNote).toBeUndefined();
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

  test("leaving Settings during a delayed copy still tells the phone", async () => {
    let finish!: () => void;
    const signIn: AppSignIn = {
      copyFromCouch: {
        available: async () => true,
        copy: () => new Promise((res) => (finish = () => res({ ok: true, count: 3 }))),
      },
      signOut: async () => {},
    };
    const app = new FakeWebApp("weather", "Cinema", { signIn });
    h = await startHarness(undefined, { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    await h.settle();
    await focus(phone, "Copy sign-in from Couch");
    await phone.press("ok");
    await phone.press("back");
    await phone.press("back");
    await phone.press("back");
    expect(h.screen.last.state.view).not.toBe("settingsApps");
    finish();
    await h.settle();
    await phone.settle();
    expect(phone.last?.toast?.text).toBe("Copied 3 Cinema cookies");
    expect(h.screen.last.state.toast).toBe("Copied 3 Cinema cookies");
  });

  test("every Screen toast reaches the phone, with a new id each time", async () => {
    const { app } = setupCopy(true);
    h = await startHarness(undefined, { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    await h.settle();
    const first = phone.last?.toast;
    expect(first?.text).toBe(h.screen.last.state.toast);
    await pick(phone, "Copy sign-in from Couch");
    expect(phone.last?.toast?.text).toBe("Copied 3 Cinema cookies");
    expect(phone.last?.toast?.id).not.toBe(first?.id);
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
    const signIn = createAppSignIn({
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

  const toasts = () =>
    h.screen.payloads
      .map((p) => p.state.toast)
      .filter((t, i, all): t is string => !!t && t !== "Phone connected" && t !== all[i - 1]);

  async function openCopy(signIn: AppSignIn) {
    const app = new FakeWebApp("weather", "Cinema", { signIn });
    h = await startHarness(undefined, { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    await h.settle();
    await focus(phone, "Copy sign-in from Couch");
    await phone.press("ok");
    return phone;
  }

  test("sign out pressed while the read is failing: no error toast, only the sign out", async () => {
    let fail!: (e: Error) => void;
    const calls: string[] = [];
    const signIn = createAppSignIn({
      couch: { get: afterMenuOpens(() => new Promise((_, rej) => (fail = rej))) },
      target: {
        setCookies: async () => void calls.push("set"),
        signOut: async () => void calls.push("signOut"),
      },
    });
    const phone = await openCopy(signIn);
    await pick(phone, "Sign out");
    fail(new Error("boom"));
    await h.settle();
    await phone.settle();
    expect(calls).toEqual(["signOut"]);
    expect(toasts()).toEqual(["Signed out of Cinema"]);
  });

  test("sign out pressed while the cookies are being written: no Copied toast, no error", async () => {
    for (const refuse of [false, true]) {
      let finish!: () => void;
      const calls: string[] = [];
      const signIn = createAppSignIn({
        couch: { get: async () => [cookie("a")] },
        target: {
          setCookies: () =>
            new Promise<void>((res, rej) => {
              calls.push("set");
              finish = () => (refuse ? rej(new Error("refused")) : res());
            }),
          signOut: async () => void calls.push("signOut"),
        },
      });
      const phone = await openCopy(signIn);
      await h.settle();
      await focus(phone, "Sign out");
      await phone.press("ok");
      finish();
      await h.settle();
      await phone.settle();
      expect(calls).toEqual(["set", "signOut"]);
      expect(toasts()).toEqual(["Signed out of Cinema"]);
      await h.stop();
    }
  });

  test("partitioned cookies never reach the target", async () => {
    const r = await run({
      get: async () => [cookie("plain"), { ...cookie("chips"), partitioned: true }],
    });
    expect(r.toast).toBe("Copied 1 Cinema cookie");
    expect(r.received[0]!.map((c) => c.name)).toEqual(["plain"]);
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
    const signIn = createAppSignIn({
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
