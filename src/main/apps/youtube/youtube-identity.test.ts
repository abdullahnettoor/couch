import { expect, test } from "vite-plus/test";
import { applyToRequestHeaders, buildIdentity } from "./youtube-identity.ts";

const id = buildIdentity("1.0.0", "arm64", 2026);

test("user agent follows Cobalt's format with Couch as the device brand", () => {
  expect(id.userAgent).toContain("Cobalt/19.lts.4.248512-gold (unlike Gecko)");
  expect(id.userAgent).toContain("Starboard/12, Couch_DESKTOP_arm64_2026/1.0.0 (Couch, macOS)");
});

test("google hosts get the client hints, others the generic agent", () => {
  const g = applyToRequestHeaders(id, new URL("https://www.youtube.com/tv"), {
    "User-Agent": "x",
    "sec-ch-ua": "chrome",
    Accept: "*/*",
  });
  expect(g["User-Agent"]).toBe(id.userAgent);
  expect(g["sec-ch-ua"]).toBe('"Couch";v="19"');
  expect(g["sec-ch-ua-platform"]).toBe('"Starboard"');
  expect(g.Accept).toBe("*/*");
  const o = applyToRequestHeaders(id, new URL("https://example.com/"), { "sec-ch-ua": "c" });
  expect(o["User-Agent"]).toBe("Couch/1.0.0");
  expect(o["sec-ch-ua"]).toBeUndefined();
});
