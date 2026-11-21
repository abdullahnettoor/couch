import { describe, expect, test } from "vite-plus/test";
import { bridgeNetwork } from "./bitchord-network.ts";

describe("the bridge's network", () => {
  test("never follows a redirect, for a request or the manifest", async () => {
    const seen: Array<Record<string, unknown> | undefined> = [];
    const net = bridgeNetwork(async (_url, init) => {
      seen.push(init);
      return new Response("{}", { status: 200 });
    }, "https://site.example");
    await net.request({ url: "https://lrclib.net/x", method: "GET", headers: {} });
    await net.manifest();
    expect(seen.map((i) => i?.redirect)).toEqual(["manual", "manual"]);
  });

  test("a redirected manifest is a failure", async () => {
    const net = bridgeNetwork(
      async () =>
        new Response(null, { status: 302, headers: { location: "https://evil.example" } }),
      "https://site.example",
    );
    await expect(net.manifest()).rejects.toThrow();
  });
});
