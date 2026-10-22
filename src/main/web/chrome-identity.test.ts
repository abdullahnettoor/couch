import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { chromeIdentity } from "./chrome-identity.ts";

// Under Electron `process.versions.chrome` exists; plain Node (the test runner) has none.
const had = Object.getOwnPropertyDescriptor(process.versions, "chrome");
beforeEach(() => {
  Object.defineProperty(process.versions, "chrome", { value: "139.0.7258.5", configurable: true });
});
afterEach(() => {
  if (had) Object.defineProperty(process.versions, "chrome", had);
  else delete (process.versions as Record<string, unknown>).chrome;
});

test("presents the Chrome this Electron is built on", () => {
  const id = chromeIdentity();
  const major = process.versions.chrome!.split(".")[0];
  expect(id.userAgent).toContain(`Chrome/${process.versions.chrome}`);
  expect(id.userAgent).toContain("Macintosh");
  expect(id.userAgent).not.toMatch(/Electron|Couch/);
  expect(id.metadata).toMatchObject({
    brands: expect.arrayContaining([{ brand: "Google Chrome", version: major }]),
    fullVersion: process.versions.chrome,
    platform: "macOS",
  });
});

test("takes the version it is given", () => {
  expect(chromeIdentity("140.0.1.2").userAgent).toContain("Chrome/140.0.1.2");
});

test("leaves every request's headers as they are", () => {
  const headers = { "User-Agent": "x", "sec-ch-ua": "y", Accept: "*/*" };
  expect(chromeIdentity().headersFor(new URL("https://www.netflix.com/"), headers)).toBe(headers);
});
