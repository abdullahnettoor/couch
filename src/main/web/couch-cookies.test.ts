import { describe, expect, test } from "vite-plus/test";
import { couchNetflixCookies, type ElectronCookie } from "./couch-cookies.ts";

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

  test("SameSite: lax and strict carry over; unspecified and no_restriction set none", () => {
    const out = couchNetflixCookies(
      (["lax", "strict", "unspecified", "no_restriction"] as const).map((sameSite, i) => ({
        ...base,
        name: `c${i}`,
        sameSite,
      })),
    );
    expect(out.map((c) => c.sameSite)).toEqual(["lax", "strict", "none", "none"]);
  });

  test("a cookie without a SameSite value at all is none", () => {
    const { sameSite: _unused, ...bare } = base;
    expect(couchNetflixCookies([bare])[0]?.sameSite).toBe("none");
  });
});
