import { describe, expect, test } from "vite-plus/test";
import type { BridgeRequest } from "../../web/webkit-messages.ts";
import {
  BitChordBridge,
  FALLBACK_EXTENSION_VERSION,
  type BridgeNetwork,
} from "./bitchord-bridge.ts";

const BOTGUARD = "https://www.youtube.com/api/jnn/v1/GenerateIT";

function setup(options: { manifest?: () => Promise<string> } = {}) {
  const requests: Array<Parameters<BridgeNetwork["request"]>[0]> = [];
  let manifests = 0;
  let reply = { contentType: "application/json", bytes: new TextEncoder().encode('["ok"]') };
  const net: BridgeNetwork = {
    request: async (init) => {
      requests.push(init);
      return { status: 200, headers: { "x-a": "1" }, url: init.url, ...reply };
    },
    manifest: () => {
      manifests++;
      return options.manifest
        ? options.manifest()
        : Promise.resolve('{"version":"0.5.1","files":{}}');
    },
  };
  const bridge = new BitChordBridge(net);
  const ask = (method: string, params: Record<string, unknown> = {}, protocol = 1) =>
    bridge.answer({
      channel: "bitchord-bridge",
      protocol,
      direction: "to-extension",
      id: "r1",
      method,
      params,
    } as BridgeRequest);
  return { ask, requests, manifests: () => manifests, setReply: (r: typeof reply) => (reply = r) };
}

const error = (code: string) =>
  expect.objectContaining({ ok: false, error: expect.objectContaining({ code }) });

describe("the BitChord bridge", () => {
  test("ping reports Chromium, protocol 1, yt and lyrics, with the version the site publishes", async () => {
    const { ask } = setup();
    expect(await ask("ping")).toEqual({
      channel: "bitchord-bridge",
      protocol: 1,
      direction: "to-page",
      id: "r1",
      ok: true,
      result: {
        version: "0.5.1",
        protocol: 1,
        browser: "chromium",
        capabilities: ["yt", "lyrics"],
      },
    });
  });

  test("the published version is read once and cached", async () => {
    const { ask, manifests } = setup();
    await ask("ping");
    await ask("ping");
    expect(manifests()).toBe(1);
  });

  test.each([
    ["the site can't be reached", () => Promise.reject(new Error("offline"))],
    ["the manifest is not JSON", () => Promise.resolve("<html>")],
    ["the version is not a version", () => Promise.resolve('{"version":"1.0; drop"}')],
  ])("ping falls back to the known version when %s", async (_name, manifest) => {
    const { ask } = setup({ manifest });
    expect(await ask("ping")).toMatchObject({
      ok: true,
      result: { version: FALLBACK_EXTENSION_VERSION },
    });
  });

  test.each(["yt.authState", "yt.setConnected", "yt.selectChannel"])(
    "%s answers the signed-out state",
    async (m) => {
      const { ask } = setup();
      expect(await ask(m, { connected: true })).toMatchObject({
        ok: true,
        result: {
          browserSignedIn: false,
          connected: false,
          signedIn: false,
          accounts: [],
          active: null,
          problem: null,
        },
      });
    },
  );

  test("an unsigned fetch of BotGuard goes out with YouTube's Origin and Referer, whatever the page set", async () => {
    const { ask, requests } = setup();
    const answer = await ask("yt.fetch", {
      url: BOTGUARD,
      method: "POST",
      headers: {
        "Content-Type": "application/json+protobuf",
        origin: "https://evil.example",
        Referer: "x",
      },
      body: "[1]",
    });
    expect(requests).toEqual([
      {
        url: BOTGUARD,
        method: "POST",
        headers: {
          "Content-Type": "application/json+protobuf",
          Origin: "https://www.youtube.com",
          Referer: "https://www.youtube.com/",
        },
        body: "[1]",
      },
    ]);
    expect(answer).toMatchObject({
      ok: true,
      result: {
        status: 200,
        headers: { "x-a": "1" },
        url: BOTGUARD,
        bodyEncoding: "text",
        body: '["ok"]',
      },
    });
  });

  test("a text request body is sent as text and a base64 one as bytes", async () => {
    const { ask, requests } = setup();
    await ask("yt.fetch", { url: BOTGUARD, method: "POST", body: "AQID", bodyEncoding: "base64" });
    expect(requests[0]!.body).toEqual(Uint8Array.from([1, 2, 3]));
  });

  test("a response that isn't text crosses as base64", async () => {
    const { ask, setReply } = setup();
    setReply({ contentType: "application/x-protobuf", bytes: Uint8Array.from([1, 2, 3]) });
    expect(await ask("yt.fetch", { url: BOTGUARD })).toMatchObject({
      ok: true,
      result: { bodyEncoding: "base64", body: "AQID" },
    });
  });

  test("a signed fetch is unauthenticated, and goes nowhere", async () => {
    const { ask, requests } = setup();
    expect(await ask("yt.fetch", { url: BOTGUARD, auth: "cookies" })).toEqual(
      error("unauthenticated"),
    );
    expect(requests).toEqual([]);
  });

  test.each([
    "https://www.youtube.com/youtubei/v1/player",
    "https://www.youtube.com/api/jnnx/",
    "http://www.youtube.com/api/jnn/v1/Create",
    "https://www.youtube.com.evil.example/api/jnn/",
    "https://evil.example/?https://www.youtube.com/api/jnn/",
    "file:///etc/passwd",
  ])("a fetch of %s is forbidden, and goes nowhere", async (url) => {
    const { ask, requests } = setup();
    expect(await ask("yt.fetch", { url })).toEqual(error("forbidden"));
    expect(requests).toEqual([]);
  });

  test("a fetch with no address is forbidden", async () => {
    const { ask } = setup();
    expect(await ask("yt.fetch", {})).toEqual(error("forbidden"));
  });

  test("a network failure is a network error", async () => {
    const net: BridgeNetwork = {
      request: () => Promise.reject(new Error("down")),
      manifest: () => Promise.reject(new Error("down")),
    };
    const answer = await new BitChordBridge(net).answer({
      channel: "bitchord-bridge",
      protocol: 1,
      direction: "to-extension",
      id: "r1",
      method: "yt.fetch",
      params: { url: BOTGUARD },
    });
    expect(answer).toEqual(error("network"));
  });

  test("another protocol version gets the protocol error, for any method", async () => {
    const { ask } = setup();
    expect(await ask("ping", {}, 2)).toEqual(error("protocol"));
    expect(await ask("yt.authState", {}, 0)).toEqual(error("protocol"));
  });

  test.each([
    "lyrics.fetch",
    "lyrics.permissions",
    "spotify.status",
    "discord.status",
    "addon.list",
    "nope",
  ])("%s is unsupported", async (method) => {
    const { ask } = setup();
    expect(await ask(method, { url: "https://lrclib.net/" })).toEqual(error("unsupported"));
  });

  test("every answer carries the request's id", async () => {
    const { ask } = setup();
    expect(await ask("nope")).toMatchObject({
      id: "r1",
      direction: "to-page",
      channel: "bitchord-bridge",
      protocol: 1,
    });
  });
});
