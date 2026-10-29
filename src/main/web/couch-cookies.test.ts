import { describe, expect, test } from "vite-plus/test";
import { cdpCookies, couchNetflixCookies, type ElectronCookie } from "./couch-cookies.ts";

const SECRET = "fake-secret-value-123";
const base: ElectronCookie = {
  name: "n",
  value: SECRET,
  domain: ".netflix.com",
  path: "/",
  secure: false,
  httpOnly: false,
  session: true,
  sameSite: "unspecified",
};

describe("mapping Couch's Chromium cookies to the bridge's shape", () => {
  test("only netflix.com and its subdomains; lookalikes are rejected", () => {
    const names = (domains: string[]) =>
      couchNetflixCookies(domains.map((domain, i) => ({ ...base, name: `c${i}`, domain }))).map(
        (c) => c.domain,
      );
    expect(
      names([
        ".netflix.com",
        "www.netflix.com",
        "netflix.com",
        "WWW.NETFLIX.COM",
        "evilnetflix.com",
        "netflix.com.evil.org",
        ".notnetflix.com",
        "example.org",
        "",
      ]),
    ).toEqual([".netflix.com", "www.netflix.com", "netflix.com", "WWW.NETFLIX.COM"]);
  });

  test("flags, name, value, domain and path carry over", () => {
    const [c] = couchNetflixCookies([
      { ...base, name: "A", path: "/browse", secure: true, httpOnly: true },
    ]);
    expect(c).toMatchObject({
      name: "A",
      value: SECRET,
      domain: ".netflix.com",
      path: "/browse",
      secure: true,
      httpOnly: true,
    });
  });

  test("expirationDate (seconds) becomes expires (milliseconds); a session cookie has none", () => {
    const [persistent, session] = couchNetflixCookies([
      { ...base, session: false, expirationDate: 1_900_000_000.5 },
      { ...base, name: "s", session: true },
    ]);
    expect(persistent?.expires).toBe(1_900_000_000_500);
    expect("expires" in session!).toBe(false);
  });

  test("a persistent cookie without a usable date is a session cookie", () => {
    const [a, b] = couchNetflixCookies([
      { ...base, session: false },
      { ...base, name: "x", session: false, expirationDate: Number.NaN },
    ]);
    expect("expires" in a!).toBe(false);
    expect("expires" in b!).toBe(false);
  });

  test("SameSite: lax and strict carry over; unspecified is lax (Chromium's default); only no_restriction is none", () => {
    const out = couchNetflixCookies(
      (["lax", "strict", "unspecified", "no_restriction"] as const).map((sameSite, i) => ({
        ...base,
        name: `c${i}`,
        sameSite,
      })),
    );
    expect(out.map((c) => c.sameSite)).toEqual(["lax", "strict", "lax", "none"]);
  });

  test("a cookie without a SameSite value at all is lax", () => {
    const { sameSite: _unused, ...bare } = base;
    expect(couchNetflixCookies([bare])[0]?.sameSite).toBe("lax");
  });

  test("partitioned (CHIPS) cookies are never copied", () => {
    const out = couchNetflixCookies([
      { ...base, name: "plain" },
      { ...base, name: "chips", partitioned: true },
    ]);
    expect(out.map((c) => c.name)).toEqual(["plain"]);
  });
});

describe("reading the DevTools Network.getAllCookies answer", () => {
  const raw = (o: Record<string, unknown>) => ({
    name: "n",
    value: SECRET,
    domain: ".netflix.com",
    path: "/",
    expires: -1,
    secure: true,
    httpOnly: true,
    session: true,
    ...o,
  });

  test("maps flags, expiry (seconds) and SameSite; a missing SameSite is lax", () => {
    const out = couchNetflixCookies(
      cdpCookies({
        cookies: [
          raw({ name: "a", sameSite: "Strict", session: false, expires: 1_900_000_000 }),
          raw({ name: "b", sameSite: "None" }),
          raw({ name: "c" }),
          raw({ name: "d", sameSite: "Lax" }),
        ],
      }),
    );
    expect(out.map((c) => c.sameSite)).toEqual(["strict", "none", "lax", "lax"]);
    expect(out[0]).toMatchObject({ secure: true, httpOnly: true, expires: 1_900_000_000_000 });
    expect("expires" in out[1]!).toBe(false);
  });

  test("a cookie with a partitionKey (object or string) is marked partitioned and dropped", () => {
    const out = couchNetflixCookies(
      cdpCookies({
        cookies: [
          raw({ name: "plain" }),
          raw({
            name: "o",
            partitionKey: { topLevelSite: "https://x.com", hasCrossSiteAncestor: false },
          }),
          raw({ name: "s", partitionKey: "https://x.com" }),
        ],
      }),
    );
    expect(out.map((c) => c.name)).toEqual(["plain"]);
  });

  test("an answer of an unexpected shape throws (the copy fails closed)", () => {
    expect(() => cdpCookies({})).toThrow();
    expect(() => cdpCookies(null)).toThrow();
  });
});
