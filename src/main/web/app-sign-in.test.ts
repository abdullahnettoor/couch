import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { createAppSignIn } from "./app-sign-in.ts";
import type { WebKitCookie } from "./webkit-bridge.ts";

const SECRET = "fake-secret-value-123";
afterEach(() => vi.restoreAllMocks());

describe("sign out", () => {
  test("goes to the App", async () => {
    let signedOut = 0;
    const signIn = createAppSignIn({
      target: { setCookies: async () => {}, signOut: async () => void signedOut++ },
    });
    await signIn.signOut();
    expect(signedOut).toBe(1);
  });
});

describe("a sign out during a copy cancels it, whatever the outcome", () => {
  test("a read that rejects after the sign out is cancelled, not failed", async () => {
    let fail!: (e: Error) => void;
    const signIn = createAppSignIn({
      couch: { get: () => new Promise((_, rej) => (fail = rej)) },
      target: { setCookies: async () => {}, signOut: async () => {} },
    });
    for (const start of [() => signIn.copyFromCouch!.copy()]) {
      const running = start();
      await signIn.signOut();
      fail(new Error("boom"));
      expect(await running).toEqual({ ok: false, reason: "cancelled" });
    }
  });

  test("a write that finishes or fails after the sign out is cancelled", async () => {
    for (const refuse of [false, true]) {
      let finish!: () => void;
      const signIn = createAppSignIn({
        couch: {
          get: async () => [
            {
              name: "NetflixId",
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
    const signIn = createAppSignIn({
      couch: { get },
      target: {
        setCookies: async (c) => void (set.push(c), order.push("set")),
        signOut: async () => void order.push("signOut"),
      },
    });
    return { signIn, set, order };
  }
  const all = async () => [
    chromium(".netflix.com", "NetflixId"),
    chromium("evilnetflix.com", "b"),
    chromium("www.netflix.com", "c"),
  ];

  test("copies only the Netflix cookies, mapped, and counts them", async () => {
    const t = makeCopy(all);
    expect(await t.signIn.copyFromCouch!.copy()).toEqual({ ok: true, count: 2 });
    expect(t.set[0]).toEqual([
      {
        domain: ".netflix.com",
        name: "NetflixId",
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
    const refusing = createAppSignIn({
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
    const sign = createAppSignIn({
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
    const signIn = createAppSignIn({
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
    expect(
      createAppSignIn({ target: { setCookies: async () => {}, signOut: async () => {} } })
        .copyFromCouch,
    ).toBeUndefined();
  });

  test("asking for the cookies reads, never changes: the source only needs `get`", async () => {
    const calls: unknown[] = [];
    const t = makeCopy(async () => (calls.push("get"), all()));
    await t.signIn.copyFromCouch!.copy();
    expect(calls).toEqual(["get"]);
  });
});

describe("only Netflix's authentication cookies are a sign-in", () => {
  const cookie = (name: string, over: Record<string, unknown> = {}) => ({
    name,
    value: SECRET,
    domain: ".netflix.com",
    path: "/",
    session: true,
    sameSite: "lax" as const,
    ...over,
  });
  const make = (cookies: ReturnType<typeof cookie>[]) => {
    const set: WebKitCookie[][] = [];
    const signIn = createAppSignIn({
      couch: { get: async () => cookies },
      target: { setCookies: async (c) => void set.push(c), signOut: async () => {} },
    });
    return { signIn: signIn.copyFromCouch!, set };
  };

  test("anonymous cookies alone: not available, and copy finds none", async () => {
    const t = make([cookie("nfvdid"), cookie("OptanonConsent"), cookie("flwssn")]);
    expect(await t.signIn.available()).toBe(false);
    expect(await t.signIn.copy()).toEqual({ ok: false, reason: "none" });
    expect(t.set).toEqual([]);
  });

  test("an auth cookie (either name) is available, and copy takes the whole filtered set", async () => {
    for (const name of ["NetflixId", "SecureNetflixId"]) {
      const t = make([cookie("nfvdid"), cookie(name)]);
      expect(await t.signIn.available()).toBe(true);
      expect(await t.signIn.copy()).toEqual({ ok: true, count: 2 });
      expect(t.set[0]!.map((c) => c.name)).toEqual(["nfvdid", name]);
    }
  });

  test("a partitioned or lookalike-domain auth cookie is not a sign-in", async () => {
    expect(await make([cookie("NetflixId", { partitioned: true })]).signIn.available()).toBe(false);
    expect(
      await make([cookie("NetflixId", { domain: "evilnetflix.com" })]).signIn.available(),
    ).toBe(false);
  });

  test("the value is never consulted", async () => {
    expect(await make([cookie("nfvdid", { value: "NetflixId" })]).signIn.available()).toBe(false);
    expect(await make([cookie("NetflixId", { value: "" })]).signIn.available()).toBe(true);
  });
});
