import { describe, expect, test } from "vite-plus/test";
import { cdpCookieSource } from "./couch-cdp-source.ts";

describe("the DevTools cookie source", () => {
  test("asks Network.getAllCookies once, maps the answer, and closes the session", async () => {
    const sent: string[] = [];
    let closed = 0;
    const src = cdpCookieSource(() => ({
      send: async (m) => (
        sent.push(m),
        { cookies: [{ name: "a", value: "v", domain: ".netflix.com", partitionKey: "k" }] }
      ),
      close: () => void closed++,
    }));
    expect(await src.get()).toMatchObject([{ name: "a", partitioned: true }]);
    expect(sent).toEqual(["Network.getAllCookies"]);
    expect(closed).toBe(1);
  });

  test("a failing session still closes and the read fails", async () => {
    let closed = 0;
    const src = cdpCookieSource(() => ({
      send: async () => {
        throw new Error("no");
      },
      close: () => void closed++,
    }));
    await expect(src.get()).rejects.toThrow();
    expect(closed).toBe(1);
  });
});
