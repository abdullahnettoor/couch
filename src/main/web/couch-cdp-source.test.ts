import { describe, expect, test, vi } from "vite-plus/test";
import { AVAILABILITY_TIMEOUT_MS } from "../apps/availability.ts";
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

describe("a read that never answers", () => {
  test("fails within the limit and closes the session once", async () => {
    vi.useFakeTimers();
    try {
      let closed = 0;
      const src = cdpCookieSource(() => ({
        send: () => new Promise<unknown>(() => {}),
        close: () => void closed++,
      }));
      const read = src.get().then(
        () => "ok",
        () => "failed",
      );
      await vi.advanceTimersByTimeAsync(AVAILABILITY_TIMEOUT_MS - 1);
      expect(closed).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(await read).toBe("failed");
      expect(closed).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
