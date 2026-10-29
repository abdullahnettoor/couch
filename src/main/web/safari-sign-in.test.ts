import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { createSafariSignIn } from "./safari-sign-in.ts";
import type { WebKitCookie } from "./webkit-bridge.ts";

const le32 = (v: number) => [0, 8, 16, 24].map((s) => (v >>> s) & 0xff);
const be32 = (v: number) => [24, 16, 8, 0].map((s) => (v >>> s) & 0xff);
function cookie(url: string, name: string, value: string) {
  const strs = [url, name, "/", value].map((s) => [...Buffer.from(s), 0]);
  let off = 56;
  const offs = strs.map((s) => ((off += s.length), off - s.length));
  return [
    ...le32(off),
    ...le32(0),
    ...le32(5),
    ...le32(0),
    ...offs.flatMap(le32),
    ...Array.from({ length: 24 }, () => 0),
    ...strs.flat(),
  ];
}
function fileOf(cookies: number[][]) {
  let off = 8 + 4 * cookies.length + 4;
  const offsets = cookies.map((c) => ((off += c.length), off - c.length));
  const page = [
    0,
    0,
    1,
    0,
    ...le32(cookies.length),
    ...offsets.flatMap(le32),
    ...le32(0),
    ...cookies.flat(),
  ];
  return Buffer.from([...Buffer.from("cook"), ...be32(1), ...be32(page.length), ...page]);
}
const SECRET = "fake-secret-value-123";
const sample = fileOf([
  cookie(".netflix.com", "a", SECRET),
  cookie(".example.org", "b", SECRET),
  cookie("www.netflix.com", "c", SECRET),
]);

function make(read: (path: string) => Promise<Buffer>) {
  const set: WebKitCookie[][] = [];
  let signedOut = 0;
  const signIn = createSafariSignIn({
    paths: ["/fake/one", "/fake/two"],
    read,
    target: {
      setCookies: async (c) => void set.push(c),
      signOut: async () => void signedOut++,
    },
  });
  return { signIn, set, signedOut: () => signedOut };
}
const err = (code: string) => Object.assign(new Error(code), { code });

afterEach(() => vi.restoreAllMocks());

describe("importing Safari's sign-in", () => {
  test("keeps only Netflix cookies, sets them with their flags, and counts them", async () => {
    const t = make(async () => sample);
    expect(await t.signIn.importSignIn()).toEqual({ ok: true, count: 2 });
    expect(t.set[0]!.map((c) => [c.domain, c.name, c.secure, c.httpOnly])).toEqual([
      [".netflix.com", "a", true, true],
      ["www.netflix.com", "c", true, true],
    ]);
  });

  test("falls back to the older cookie path when the first is missing", async () => {
    const t = make(async (p) => {
      if (p === "/fake/one") throw err("ENOENT");
      return sample;
    });
    expect(await t.signIn.importSignIn()).toEqual({ ok: true, count: 2 });
  });

  test.each(["EPERM", "EACCES"])("%s means Full Disk Access is missing", async (code) => {
    const t = make(async () => {
      throw err(code);
    });
    expect(await t.signIn.importSignIn()).toEqual({ ok: false, reason: "permission" });
    expect(t.set).toEqual([]);
  });

  test("no file anywhere is `none`; a file with no Netflix cookies is `none`", async () => {
    expect(
      await make(async () => {
        throw err("ENOENT");
      }).signIn.importSignIn(),
    ).toEqual({ ok: false, reason: "none" });
    const other = fileOf([cookie(".example.org", "b", SECRET)]);
    const t = make(async () => other);
    expect(await t.signIn.importSignIn()).toEqual({ ok: false, reason: "none" });
    expect(t.set).toEqual([]);
  });

  test("a damaged file or a store that refuses is `failed`", async () => {
    expect(await make(async () => Buffer.from("garbage!")).signIn.importSignIn()).toEqual({
      ok: false,
      reason: "failed",
    });
    const t = make(async () => sample);
    const refusing = createSafariSignIn({
      paths: ["/x"],
      read: async () => sample,
      target: {
        setCookies: async () => {
          throw new Error("nope");
        },
        signOut: async () => {},
      },
    });
    expect(await refusing.importSignIn()).toEqual({ ok: false, reason: "failed" });
    expect(t.set).toEqual([]);
  });

  test("a value never reaches the console or a result", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const results = [
      await make(async () => sample).signIn.importSignIn(),
      await make(async () => {
        throw err("EPERM");
      }).signIn.importSignIn(),
      await make(async () => Buffer.from("garbage!")).signIn.importSignIn(),
    ];
    expect(JSON.stringify(results)).not.toContain(SECRET);
    expect(JSON.stringify(spies.map((s) => s.mock.calls))).not.toContain(SECRET);
  });

  test("sign out goes to the App", async () => {
    const t = make(async () => sample);
    await t.signIn.signOut();
    expect(t.signedOut()).toBe(1);
  });

  test("sign out during a held-back Safari read wins: nothing is written afterwards", async () => {
    let release!: (b: Buffer) => void;
    const order: string[] = [];
    const signIn = createSafariSignIn({
      paths: ["/x"],
      read: () => new Promise<Buffer>((r) => (release = r)),
      target: {
        setCookies: async () => void order.push("set"),
        signOut: async () => void order.push("signOut"),
      },
    });
    const importing = signIn.importSignIn();
    await signIn.signOut();
    release(sample);
    expect(await importing).toEqual({ ok: false, reason: "cancelled" });
    expect(order).toEqual(["signOut"]);
  });

  test("sign out waits for cookies already being written, then clears them", async () => {
    let finish!: () => void;
    const order: string[] = [];
    const signIn = createSafariSignIn({
      paths: ["/x"],
      read: async () => sample,
      target: {
        setCookies: () => new Promise<void>((r) => (finish = r)).then(() => void order.push("set")),
        signOut: async () => void order.push("signOut"),
      },
    });
    const importing = signIn.importSignIn();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    const out = signIn.signOut();
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual([]);
    finish();
    await Promise.all([importing, out]);
    expect(order).toEqual(["set", "signOut"]);
  });

  test("an import started after a sign out works again", async () => {
    const t = make(async () => sample);
    await t.signIn.signOut();
    expect(await t.signIn.importSignIn()).toEqual({ ok: true, count: 2 });
  });

  test("Safari's file has no SameSite field: the cookies handed over carry none, so WebKit's default applies", async () => {
    const t = make(async () => sample);
    await t.signIn.importSignIn();
    for (const c of t.set[0]!)
      expect(Object.keys(c).sort()).toEqual([
        "domain",
        "httpOnly",
        "name",
        "path",
        "secure",
        "value",
      ]);
  });
});

describe("a sign out during an import or a copy cancels it, whatever the outcome", () => {
  test("a read that rejects after the sign out is cancelled, not failed", async () => {
    let fail!: (e: Error) => void;
    const signIn = createSafariSignIn({
      paths: ["/p"],
      read: () => new Promise((_, rej) => (fail = rej)),
      couch: { get: () => new Promise((_, rej) => (fail = rej)) },
      target: { setCookies: async () => {}, signOut: async () => {} },
    });
    for (const start of [() => signIn.importSignIn(), () => signIn.copyFromCouch!.copy()]) {
      const running = start();
      await signIn.signOut();
      fail(new Error("boom"));
      expect(await running).toEqual({ ok: false, reason: "cancelled" });
    }
  });

  test("a write that finishes or fails after the sign out is cancelled", async () => {
    for (const refuse of [false, true]) {
      let finish!: () => void;
      const signIn = createSafariSignIn({
        paths: [],
        read: async () => Buffer.alloc(0),
        couch: {
          get: async () => [
            {
              name: "a",
              value: SECRET,
              domain: ".netflix.com",
              path: "/",
              session: true,
              sameSite: "lax" as const,
            },
          ],
        },
        target: {
          setCookies: () =>
            new Promise<void>(
              (res, rej) => (finish = () => (refuse ? rej(new Error("x")) : res())),
            ),
          signOut: async () => {},
        },
      });
      const copying = signIn.copyFromCouch!.copy();
      await new Promise((r) => setTimeout(r, 0));
      const out = signIn.signOut();
      finish();
      await out;
      expect(await copying).toEqual({ ok: false, reason: "cancelled" });
    }
  });
});

describe("copying Couch's own Chromium sign-in", () => {
  const chromium = (domain: string, name: string) => ({
    name,
    value: SECRET,
    domain,
    path: "/",
    secure: true,
    httpOnly: true,
    session: false,
    expirationDate: 1_900_000_000,
    sameSite: "lax" as const,
  });
  function makeCopy(get: () => Promise<ReturnType<typeof chromium>[]>) {
    const set: WebKitCookie[][] = [];
    const order: string[] = [];
    const signIn = createSafariSignIn({
      paths: [],
      read: async () => {
        throw err("ENOENT");
      },
      couch: { get },
      target: {
        setCookies: async (c) => void (set.push(c), order.push("set")),
        signOut: async () => void order.push("signOut"),
      },
    });
    return { signIn, set, order };
  }
  const all = async () => [
    chromium(".netflix.com", "a"),
    chromium("evilnetflix.com", "b"),
    chromium("www.netflix.com", "c"),
  ];

  test("copies only the Netflix cookies, mapped, and counts them", async () => {
    const t = makeCopy(all);
    expect(await t.signIn.copyFromCouch!.copy()).toEqual({ ok: true, count: 2 });
    expect(t.set[0]).toEqual([
      {
        domain: ".netflix.com",
        name: "a",
        path: "/",
        value: SECRET,
        secure: true,
        httpOnly: true,
        expires: 1_900_000_000_000,
        sameSite: "lax",
      },
      expect.objectContaining({ domain: "www.netflix.com", name: "c" }),
    ]);
  });

  test("available only when Chromium holds Netflix cookies", async () => {
    expect(await makeCopy(all).signIn.copyFromCouch!.available()).toBe(true);
    expect(
      await makeCopy(async () => [chromium("example.org", "x")]).signIn.copyFromCouch!.available(),
    ).toBe(false);
    expect(await makeCopy(async () => []).signIn.copyFromCouch!.available()).toBe(false);
    expect(
      await makeCopy(async () => {
        throw new Error(SECRET);
      }).signIn.copyFromCouch!.available(),
    ).toBe(false);
  });

  test("no Netflix cookies is `none`; an unreadable source or refusing store is `failed`", async () => {
    const none = makeCopy(async () => [chromium("example.org", "x")]);
    expect(await none.signIn.copyFromCouch!.copy()).toEqual({ ok: false, reason: "none" });
    expect(none.set).toEqual([]);
    const broken = makeCopy(async () => {
      throw new Error(SECRET);
    });
    expect(await broken.signIn.copyFromCouch!.copy()).toEqual({ ok: false, reason: "failed" });
    const refusing = createSafariSignIn({
      paths: [],
      read: async () => Buffer.alloc(0),
      couch: { get: all },
      target: {
        setCookies: async () => {
          throw new Error(SECRET);
        },
        signOut: async () => {},
      },
    });
    const r = await refusing.copyFromCouch!.copy();
    expect(r).toEqual({ ok: false, reason: "failed" });
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  test("the store refusing sets nothing and reports no count (all or nothing)", async () => {
    const set: WebKitCookie[][] = [];
    const sign = createSafariSignIn({
      paths: [],
      read: async () => Buffer.alloc(0),
      couch: { get: all },
      target: {
        setCookies: async (c) => {
          set.push(c);
          throw new Error("a cookie was rejected");
        },
        signOut: async () => {},
      },
    });
    expect(await sign.copyFromCouch!.copy()).toEqual({ ok: false, reason: "failed" });
    expect(set).toHaveLength(1);
    expect(set[0]).toHaveLength(2);
  });

  test("sign out during a held-back read wins: nothing is written afterwards", async () => {
    let release!: (c: Awaited<ReturnType<typeof all>>) => void;
    const t = makeCopy(() => new Promise((r) => (release = r)));
    const copying = t.signIn.copyFromCouch!.copy();
    await t.signIn.signOut();
    release(await all());
    expect(await copying).toEqual({ ok: false, reason: "cancelled" });
    expect(t.order).toEqual(["signOut"]);
  });

  test("sign out waits for a copy already being written, then clears", async () => {
    let finish!: () => void;
    const order: string[] = [];
    const signIn = createSafariSignIn({
      paths: [],
      read: async () => Buffer.alloc(0),
      couch: { get: all },
      target: {
        setCookies: () => new Promise<void>((r) => (finish = r)).then(() => void order.push("set")),
        signOut: async () => void order.push("signOut"),
      },
    });
    const copying = signIn.copyFromCouch!.copy();
    await new Promise((r) => setTimeout(r, 0));
    const out = signIn.signOut();
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual([]);
    finish();
    await Promise.all([copying, out]);
    expect(order).toEqual(["set", "signOut"]);
  });

  test("without a Couch source there is no copy", () => {
    expect(make(async () => sample).signIn.copyFromCouch).toBeUndefined();
  });

  test("asking for the cookies reads, never changes: the source only needs `get`", async () => {
    const calls: unknown[] = [];
    const t = makeCopy(async () => (calls.push("get"), all()));
    await t.signIn.copyFromCouch!.copy();
    expect(calls).toEqual(["get"]);
  });
});
