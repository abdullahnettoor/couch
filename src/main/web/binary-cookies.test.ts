import { describe, expect, test } from "vite-plus/test";
import { netflixCookies, parseBinaryCookies } from "./binary-cookies.ts";

const le32 = (v: number) => [0, 8, 16, 24].map((s) => (v >>> s) & 0xff);
const be32 = (v: number) => [24, 16, 8, 0].map((s) => (v >>> s) & 0xff);
const le64 = (v: number) => [...Buffer.from(new Float64Array([v]).buffer)];

function cookie(o: {
  url: string;
  name: string;
  path: string;
  value: string;
  flags: number;
  exp: number;
}) {
  const strs = [o.url, o.name, o.path, o.value].map((s) => [...Buffer.from(s), 0]);
  let off = 56;
  const offs = strs.map((s) => {
    const at = off;
    off += s.length;
    return at;
  });
  return [
    ...le32(off),
    ...le32(0),
    ...le32(o.flags),
    ...le32(0),
    ...offs.flatMap(le32),
    ...Array.from({ length: 8 }, () => 0),
    ...le64(o.exp),
    ...le64(0),
    ...strs.flat(),
  ];
}

function page(cookies: number[][]) {
  let off = 8 + 4 * cookies.length + 4;
  const offsets = cookies.map((c) => {
    const at = off;
    off += c.length;
    return at;
  });
  return [
    0,
    0,
    1,
    0,
    ...le32(cookies.length),
    ...offsets.flatMap(le32),
    ...le32(0),
    ...cookies.flat(),
  ];
}

const file = (pages: number[][]) =>
  Buffer.from([
    ...Buffer.from("cook"),
    ...be32(pages.length),
    ...pages.flatMap((p) => be32(p.length)),
    ...pages.flat(),
  ]);

const p1 = page([
  cookie({
    url: ".netflix.com",
    name: "FAKE1",
    path: "/",
    value: "fake-value-1",
    flags: 5,
    exp: 800_000_000,
  }),
  cookie({ url: ".example.org", name: "other", path: "/", value: "nope", flags: 0, exp: 0 }),
]);
const p2 = page([
  cookie({
    url: "www.netflix.com",
    name: "FAKE2",
    path: "/browse",
    value: "fake-value-2",
    flags: 1,
    exp: 0,
  }),
  cookie({ url: ".notnetflix.com", name: "x", path: "/", value: "y", flags: 0, exp: 0 }),
]);

describe("Safari's binarycookies parser", () => {
  test("reads every cookie across pages with fields, flags and expiry", () => {
    const all = parseBinaryCookies(file([p1, p2]));
    expect(all).toHaveLength(4);
    expect(all[0]).toEqual({
      domain: ".netflix.com",
      name: "FAKE1",
      path: "/",
      value: "fake-value-1",
      secure: true,
      httpOnly: true,
      // Mac absolute time counts from 2001-01-01
      expires: (800_000_000 + 978_307_200) * 1000,
    });
    expect(all[2]).toMatchObject({ path: "/browse", secure: true, httpOnly: false });
    expect(all[2]!.expires).toBeUndefined();
  });

  test("a bad magic is rejected", () => {
    expect(() => parseBinaryCookies(Buffer.from("nope1234"))).toThrow();
  });

  test("truncated input is rejected at every length", () => {
    const whole = file([p1, p2]);
    for (let n = 0; n < whole.length; n += 7)
      expect(() => parseBinaryCookies(whole.subarray(0, n))).toThrow();
  });

  test("only netflix.com and its subdomains are kept", () => {
    const kept = netflixCookies(parseBinaryCookies(file([p1, p2])));
    expect(kept.map((c) => c.name)).toEqual(["FAKE1", "FAKE2"]);
  });
});
