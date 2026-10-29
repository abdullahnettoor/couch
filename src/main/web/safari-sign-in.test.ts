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
