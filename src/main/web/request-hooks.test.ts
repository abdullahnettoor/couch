import { describe, expect, test, vi } from "vite-plus/test";
import { applyToRequestHeaders, buildIdentity } from "../apps/youtube/youtube-identity.ts";
import { releaseRequestHooks, requestHooksFor, type HookSession } from "./request-hooks.ts";

function fakeSession() {
  const registered = { headers: 0, before: 0 };
  let headersListener: any;
  let beforeListener: any;
  const ses: HookSession = {
    webRequest: {
      onBeforeSendHeaders: (l: any) => ((headersListener = l), registered.headers++),
      onBeforeRequest: (l: any) => ((beforeListener = l), registered.before++),
    },
  };
  const sendHeaders = (url: string, requestHeaders: Record<string, string>) =>
    new Promise<Record<string, string>>((res) =>
      headersListener({ url, requestHeaders }, (r: any) => res(r.requestHeaders)),
    );
  const beforeRequest = (url: string) =>
    new Promise<any>((res) => beforeListener({ url }, (r: any) => res(r)));
  return { ses, registered, sendHeaders, beforeRequest };
}

describe("request hooks", () => {
  test("two header handlers on one event both run, in order, and the identity survives", async () => {
    const { ses, registered, sendHeaders } = fakeSession();
    const id = buildIdentity("1.0.0");
    const hooks = requestHooksFor(ses);
    hooks.onBeforeSendHeaders((d) => applyToRequestHeaders(id, new URL(d.url), d.requestHeaders));
    hooks.onBeforeSendHeaders((d) => ({ ...d.requestHeaders, "X-Second": "yes" }));
    const out = await sendHeaders("https://www.youtube.com/tv", { "User-Agent": "Chrome" });
    expect(out["X-Second"]).toBe("yes");
    expect(out["User-Agent"]).toBe(id.userAgent);
    expect(registered.headers).toBe(1);
  });

  test("the same session always gets the same hooks, with one listener per event", () => {
    const { ses, registered } = fakeSession();
    requestHooksFor(ses).onBeforeRequest(() => undefined);
    requestHooksFor(ses).onBeforeRequest(() => undefined);
    expect(registered.before).toBe(1);
  });

  test("a handler can block, and later handlers are skipped", async () => {
    const { ses, beforeRequest } = fakeSession();
    const hooks = requestHooksFor(ses);
    let later = false;
    hooks.onBeforeRequest((d) => (d.url.includes("ads") ? { cancel: true } : undefined));
    hooks.onBeforeRequest(() => ((later = true), undefined));
    expect(await beforeRequest("https://x.test/ads")).toEqual({ cancel: true });
    expect(later).toBe(false);
    expect(await beforeRequest("https://x.test/ok")).toEqual({});
    expect(later).toBe(true);
  });

  test("a handler can redirect, and a removed handler stops running", async () => {
    const { ses, beforeRequest } = fakeSession();
    const hooks = requestHooksFor(ses);
    const off = hooks.onBeforeRequest(() => ({ redirectURL: "https://x.test/b" }));
    expect(await beforeRequest("https://x.test/a")).toEqual({ redirectURL: "https://x.test/b" });
    off();
    expect(await beforeRequest("https://x.test/a")).toEqual({});
  });

  test("a throwing handler is skipped: later handlers still run and the request still goes through", async () => {
    const { ses, beforeRequest, sendHeaders } = fakeSession();
    const hooks = requestHooksFor(ses);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    hooks.onBeforeRequest(() => {
      throw new Error("boom");
    });
    hooks.onBeforeRequest((d) => (d.url.includes("ads") ? { cancel: true } : undefined));
    hooks.onBeforeSendHeaders(() => {
      throw new Error("boom");
    });
    hooks.onBeforeSendHeaders((d) => ({ ...d.requestHeaders, "X-Second": "yes" }));
    expect(await beforeRequest("https://x.test/ads")).toEqual({ cancel: true });
    expect(await beforeRequest("https://x.test/ok")).toEqual({});
    expect(await sendHeaders("https://x.test/", { A: "1" })).toEqual({ A: "1", "X-Second": "yes" });
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe("releasing a session's hooks", () => {
  function holder() {
    const held: Record<string, unknown> = {};
    const ses: HookSession = {
      webRequest: {
        onBeforeSendHeaders: (l: any) => void (held.headers = l),
        onBeforeRequest: (l: any) => void (held.before = l),
      },
    };
    return { ses, held };
  }

  test("once no handler is left the session's listeners are cleared", () => {
    const { ses, held } = holder();
    const off = requestHooksFor(ses).onBeforeRequest(() => undefined);
    releaseRequestHooks(ses);
    expect(typeof held.before).toBe("function");
    off();
    releaseRequestHooks(ses);
    expect(held).toEqual({ before: null, headers: null });
  });

  test("a session is hooked afresh after a release", () => {
    const { ses, held } = holder();
    requestHooksFor(ses);
    releaseRequestHooks(ses);
    requestHooksFor(ses).onBeforeRequest(() => undefined);
    expect(typeof held.before).toBe("function");
  });
});
