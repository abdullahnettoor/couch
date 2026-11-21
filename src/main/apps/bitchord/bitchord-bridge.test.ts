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

  test.each(["spotify.status", "discord.status", "addon.list", "nope"])(
    "%s is unsupported",
    async (method) => {
      const { ask } = setup();
      expect(await ask(method, { url: "https://lrclib.net/" })).toEqual(error("unsupported"));
    },
  );

  describe("lyrics", () => {
    const LRCLIB = "https://lrclib.net/api/search?q=a";

    test("lyrics.fetch gets a listed host and returns its text", async () => {
      const { ask, requests } = setup();
      expect(await ask("lyrics.fetch", { url: LRCLIB, headers: { "x-a": "b" } })).toMatchObject({
        ok: true,
        result: { status: 200, url: LRCLIB, bodyEncoding: "text", body: '["ok"]' },
      });
      expect(requests).toEqual([{ url: LRCLIB, method: "GET", headers: { "x-a": "b" } }]);
    });

    test.each([
      "https://example.com/lyrics",
      "https://evil.lrclib.net/x",
      "https://lrclib.net.evil.com/x",
      "http://lrclib.net/x",
      "https://lrclib.net:8443/x",
      "https://www.youtube.com/api/jnn/v1/GenerateIT",
      "not a url",
    ])("lyrics.fetch refuses %s and fetches nothing", async (url) => {
      const { ask, requests } = setup();
      expect(await ask("lyrics.fetch", { url })).toEqual(error("forbidden"));
      expect(requests).toEqual([]);
    });

    test("lyrics.fetch refuses a missing url", async () => {
      const { ask, requests } = setup();
      expect(await ask("lyrics.fetch", {})).toEqual(error("forbidden"));
      expect(requests).toEqual([]);
    });

    test("a body that isn't text crosses as base64", async () => {
      const { ask, setReply } = setup();
      setReply({ contentType: "application/octet-stream", bytes: new Uint8Array([1, 2, 3]) });
      expect(await ask("lyrics.fetch", { url: LRCLIB })).toMatchObject({
        result: { bodyEncoding: "base64", body: "AQID" },
      });
    });

    test("html and a missing content type count as text", async () => {
      const { ask, setReply } = setup();
      setReply({ contentType: "text/html; charset=utf-8", bytes: new TextEncoder().encode("<p>") });
      expect(await ask("lyrics.fetch", { url: LRCLIB })).toMatchObject({
        result: { bodyEncoding: "text", body: "<p>" },
      });
      setReply({ contentType: "", bytes: new TextEncoder().encode("la") });
      expect(await ask("lyrics.fetch", { url: LRCLIB })).toMatchObject({
        result: { bodyEncoding: "text", body: "la" },
      });
    });

    test("a request body is sent as text, or as bytes when base64", async () => {
      const { ask, requests } = setup();
      await ask("lyrics.fetch", { url: LRCLIB, method: "POST", body: "q" });
      await ask("lyrics.fetch", {
        url: LRCLIB,
        method: "POST",
        body: "AQID",
        bodyEncoding: "base64",
      });
      expect(requests[0]!.body).toBe("q");
      expect(requests[1]!.body).toEqual(new Uint8Array([1, 2, 3]));
    });

    test("Apple Music requests carry Apple's Origin and Referer, Musixmatch its cookie", async () => {
      const { ask, requests } = setup();
      await ask("lyrics.fetch", {
        url: "https://amp-api.music.apple.com/v1/x",
        headers: { origin: "https://x" },
      });
      await ask("lyrics.fetch", { url: "https://apic.musixmatch.com/ws/1.1/x" });
      expect(requests[0]!.headers).toEqual({
        Origin: "https://music.apple.com",
        Referer: "https://music.apple.com/",
      });
      expect(requests[1]!.headers).toEqual({ Cookie: "mxm_bab=AB" });
    });

    test("a network failure answers network", async () => {
      const bridge = new BitChordBridge({
        request: () => Promise.reject(new Error("offline")),
        manifest: () => Promise.reject(new Error("x")),
      });
      const answer = await bridge.answer({
        channel: "bitchord-bridge",
        protocol: 1,
        direction: "to-extension",
        id: "r1",
        method: "lyrics.fetch",
        params: { url: LRCLIB },
      } as BridgeRequest);
      expect(answer).toEqual(error("network"));
    });

    test("lyrics.permissions grants every requested listed host and no other", async () => {
      const { ask, requests } = setup();
      expect(
        await ask("lyrics.permissions", {
          origins: ["https://lrclib.net", "https://genius.com", "https://example.com", "junk", 4],
        }),
      ).toMatchObject({
        ok: true,
        result: { granted: ["https://lrclib.net", "https://genius.com"] },
      });
      expect(await ask("lyrics.permissions", {})).toMatchObject({ result: { granted: [] } });
      expect(requests).toEqual([]);
    });

    test("lyrics.requestPermissions answers empty", async () => {
      const { ask } = setup();
      expect(
        await ask("lyrics.requestPermissions", { origins: ["https://lrclib.net"] }),
      ).toMatchObject({
        ok: true,
        result: {},
      });
    });
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

describe("the bridge's allowlists hold", () => {
  const LRCLIB = "https://lrclib.net/api/search?q=a";
  function routed(routes: Record<string, { status: number; location?: string }>) {
    const requests: Array<Parameters<BridgeNetwork["request"]>[0]> = [];
    const net: BridgeNetwork = {
      request: async (init) => {
        requests.push(init);
        const hop = routes[init.url];
        return {
          status: hop?.status ?? 200,
          headers: (hop?.location ? { location: hop.location } : {}) as Record<string, string>,
          url: init.url,
          contentType: "application/json",
          bytes: new TextEncoder().encode('["ok"]'),
        };
      },
      manifest: () => Promise.resolve('{"version":"0.5.1"}'),
    };
    const bridge = new BitChordBridge(net);
    const ask = (method: string, params: Record<string, unknown>) =>
      bridge.answer({
        channel: "bitchord-bridge",
        protocol: 1,
        direction: "to-extension",
        id: "r1",
        method,
        params,
      } as BridgeRequest);
    return { ask, requests };
  }

  test("a BotGuard redirect is a failure, and is not followed", async () => {
    const { ask, requests } = routed({
      [BOTGUARD]: { status: 302, location: "https://evil.example/x" },
    });
    expect(await ask("yt.fetch", { url: BOTGUARD })).toEqual(error("forbidden"));
    expect(requests.map((r) => r.url)).toEqual([BOTGUARD]);
  });

  test("a lyric redirect to a listed host is followed, and the next hop is checked first", async () => {
    const { ask, requests } = routed({
      [LRCLIB]: { status: 302, location: "https://genius.com/x" },
    });
    expect(await ask("lyrics.fetch", { url: LRCLIB })).toMatchObject({
      ok: true,
      result: { status: 200, url: "https://genius.com/x" },
    });
    expect(requests.map((r) => r.url)).toEqual([LRCLIB, "https://genius.com/x"]);
  });

  test.each([
    "https://evil.example/x",
    "http://lrclib.net/x",
    "https://user:pw@lrclib.net/x",
    "https://www.youtube.com/api/jnn/v1/x",
  ])("a lyric redirect to %s is forbidden and never fetched", async (location) => {
    const { ask, requests } = routed({ [LRCLIB]: { status: 301, location } });
    expect(await ask("lyrics.fetch", { url: LRCLIB })).toEqual(error("forbidden"));
    expect(requests.map((r) => r.url)).toEqual([LRCLIB]);
  });

  test("a lyric redirect chain stops after three hops", async () => {
    const hop = (n: number) => `https://lrclib.net/h${n}`;
    const { ask, requests } = routed({
      [LRCLIB]: { status: 302, location: hop(1) },
      [hop(1)]: { status: 302, location: hop(2) },
      [hop(2)]: { status: 302, location: hop(3) },
      [hop(3)]: { status: 302, location: hop(4) },
    });
    expect(await ask("lyrics.fetch", { url: LRCLIB })).toEqual(error("forbidden"));
    expect(requests).toHaveLength(4);
  });

  test("a lyric redirect with no location is forbidden", async () => {
    const { ask } = routed({ [LRCLIB]: { status: 302 } });
    expect(await ask("lyrics.fetch", { url: LRCLIB })).toEqual(error("forbidden"));
  });

  test.each([
    "https://www.youtube.com/api/jnn/../../redirect?url=https://evil.example",
    "https://www.youtube.com/api/jnn/%2e%2e/redirect",
    "https://www.youtube.com/api/jnn/..%2fredirect",
    "https://user:pw@www.youtube.com/api/jnn/v1/x",
    "https://www.youtube.com:444/api/jnn/v1/x",
    "https://www.youtube.com@evil.example/api/jnn/v1/x",
  ])("the BotGuard address %s is forbidden", async (url) => {
    const { ask, requests } = routed({});
    expect(await ask("yt.fetch", { url })).toEqual(error("forbidden"));
    expect(requests).toEqual([]);
  });

  test("the BotGuard address is fetched in its normalised form", async () => {
    const { ask, requests } = routed({});
    await ask("yt.fetch", { url: "https://www.youtube.com/api/jnn/a/../v1/x?y=1" });
    expect(requests.map((r) => r.url)).toEqual(["https://www.youtube.com/api/jnn/v1/x?y=1"]);
  });

  test("a lyric address with userinfo is forbidden", async () => {
    const { ask, requests } = routed({});
    expect(await ask("lyrics.fetch", { url: "https://u:p@lrclib.net/x" })).toEqual(
      error("forbidden"),
    );
    expect(requests).toEqual([]);
  });

  const SMUGGLED = {
    Authorization: "Bearer x",
    "proxy-authorization": "x",
    COOKIE: "sid=1",
    Cookie2: "x",
    Host: "evil.example",
    Connection: "keep-alive",
    "Content-Length": "9",
    "Transfer-Encoding": "chunked",
    "Proxy-Foo": "x",
    "Sec-Fetch-Site": "same-origin",
    "sec-ch-ua": "x",
    "X-Goog-AuthUser": "0",
    "Content-Type": "application/json",
    "X-Keep": "yes",
  };

  test("a signed-looking yt.fetch goes out without the credential headers", async () => {
    const { ask, requests } = routed({});
    await ask("yt.fetch", { url: BOTGUARD, headers: SMUGGLED });
    expect(requests[0]!.headers).toEqual({
      "Content-Type": "application/json",
      "X-Keep": "yes",
      Origin: "https://www.youtube.com",
      Referer: "https://www.youtube.com/",
    });
  });

  test("a lyric fetch goes out without the credential headers, and the cookie is Couch's", async () => {
    const { ask, requests } = routed({});
    await ask("lyrics.fetch", { url: LRCLIB, headers: SMUGGLED });
    await ask("lyrics.fetch", {
      url: "https://apic.musixmatch.com/ws/1.1/x",
      headers: SMUGGLED,
    });
    expect(requests[0]!.headers).toEqual({ "Content-Type": "application/json", "X-Keep": "yes" });
    expect(requests[1]!.headers).toEqual({
      "Content-Type": "application/json",
      "X-Keep": "yes",
      Cookie: "mxm_bab=AB",
    });
  });
});
