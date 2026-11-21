import { describe, expect, test } from "vite-plus/test";
import { APP_ENTRIES } from "../index.ts";
import { parsePageMessage } from "../../web/webkit-messages.ts";
import type { BridgeNetwork } from "./bitchord-bridge.ts";
import { bitchordDescription } from "./bitchord-web.ts";
import { BITCHORD_PAGES, bitchordSite } from "./bitchord-route.ts";

const net: BridgeNetwork = {
  request: () => Promise.reject(new Error("no network")),
  manifest: () => Promise.resolve('{"version":"0.4.9"}'),
};
const desc = (env: Record<string, string | undefined> = {}) =>
  bitchordDescription("130.0.0.0", net, env);

describe("the BitChord description", () => {
  test("loads the Pages deploy, on a persistent partition of its own, as plain Chrome", () => {
    const d = desc();
    expect(d.url).toBe(`${BITCHORD_PAGES}/home`);
    expect(d.partition).toBe("persist:bitchord");
    expect(d.identity.userAgent).toContain("Chrome/130.0.0.0");
    expect(d.drm).toBeUndefined();
  });

  test("its own origins are the Pages deploy and the production domain, nothing else", () => {
    const d = desc();
    expect(d.isOwnOrigin(BITCHORD_PAGES)).toBe(true);
    expect(d.isOwnOrigin("https://bitchord.in")).toBe(true);
    for (const other of [
      "https://www.youtube.com",
      "https://bitchord-8bw.pages.dev.evil.example",
      "http://bitchord-8bw.pages.dev",
      "https://evil.pages.dev",
    ])
      expect(d.isOwnOrigin(other)).toBe(false);
  });

  test("BITCHORD_SITE overrides the address; a bad one is ignored", () => {
    expect(bitchordSite({ BITCHORD_SITE: "http://localhost:5173/x" })).toBe(
      "http://localhost:5173",
    );
    expect(desc({ BITCHORD_SITE: "https://dev.example/" }).url).toBe("https://dev.example/home");
    expect(desc({ BITCHORD_SITE: "https://dev.example/" }).isOwnOrigin("https://dev.example")).toBe(
      true,
    );
    expect(bitchordSite({ BITCHORD_SITE: "http://evil.example" })).toBe(BITCHORD_PAGES);
    expect(bitchordSite({ BITCHORD_SITE: "nonsense" })).toBe(BITCHORD_PAGES);
  });

  test("its home is the site's first pages; anything else is somewhere Back goes back from", () => {
    const tracker = desc().route.tracker();
    const home = (url: string) => tracker.update(url, null)?.home;
    expect(home(`${BITCHORD_PAGES}/home`)).toBe(true);
    expect(home(`${BITCHORD_PAGES}/album/x`)).toBe(false);
  });

  test("the description answers a page's bridge ping through its bridge", async () => {
    expect(
      await desc().bridge!({
        channel: "bitchord-bridge",
        protocol: 1,
        direction: "to-extension",
        id: "a",
        method: "ping",
        params: {},
      }),
    ).toMatchObject({ ok: true, id: "a", result: { version: "0.4.9", browser: "chromium" } });
  });

  test("its relay forwards only same-window, same-origin bridge requests to the host", () => {
    const [relay] = desc().preloads;
    expect(relay!.func).toContain("event.source !== window");
    expect(relay!.func).toContain("event.origin !== location.origin");
    expect(relay!.func).toContain("bitchord-bridge");
    expect(relay!.func).toContain("couchHost.send");
  });

  test("it has the request and response rules", () => {
    expect(desc().requests?.onBeforeSendHeaders).toBeTypeOf("function");
    expect(desc().requests?.onHeadersReceived).toBeTypeOf("function");
  });
});

describe("BitChord on Home", () => {
  test("is an App that starts off", () => {
    const entry = APP_ENTRIES.find((e) => e.id === "bitchord");
    expect(entry).toMatchObject({ label: "BitChord", web: true, action: "app:open:bitchord" });
    expect(entry!.onByDefault).toBeFalsy();
    expect(entry!.icon).toContain("<svg");
  });
});

describe("a bridge page message", () => {
  const request = {
    channel: "bitchord-bridge",
    protocol: 1,
    direction: "to-extension",
    id: "a",
    method: "ping",
    params: {},
  };
  test("passes when shaped like BitChord's envelope", () => {
    expect(parsePageMessage({ type: "bridge", request })).toEqual({ type: "bridge", request });
  });
  test.each([
    ["another channel", { ...request, channel: "x" }],
    ["a response", { ...request, direction: "to-page" }],
    ["an extra field", { ...request, extra: 1 }],
    ["no id", { ...request, id: undefined }],
    ["a long method", { ...request, method: "m".repeat(200) }],
    ["array params", { ...request, params: [] }],
    ["a string protocol", { ...request, protocol: "1" }],
  ])("is dropped with %s", (_name, bad) => {
    expect(parsePageMessage({ type: "bridge", request: bad })).toBeUndefined();
  });
  test("is dropped with extra top-level fields or no request", () => {
    expect(parsePageMessage({ type: "bridge", request, more: 1 })).toBeUndefined();
    expect(parsePageMessage({ type: "bridge" })).toBeUndefined();
  });
});
