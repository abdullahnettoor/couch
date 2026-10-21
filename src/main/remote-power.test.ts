import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { REMOTE_PAGE } from "./remote/page.ts";

type El = {
  id: string;
  hidden: boolean;
  textContent: string;
  handlers: Record<string, (e?: unknown) => void>;
  attrs: Record<string, string>;
};

/** Runs the page's script against a minimal DOM: elements by id with `hidden`, text and click handlers. */
function loadPage() {
  const html = REMOTE_PAGE.slice(0, REMOTE_PAGE.indexOf("<script>"));
  const script = REMOTE_PAGE.slice(
    REMOTE_PAGE.indexOf("<script>") + 8,
    REMOTE_PAGE.indexOf("</script>"),
  );
  const els = new Map<string, El>();
  for (const m of html.matchAll(/<(\w+)([^>]*?\sid="([^"]+)"[^>]*)>/g)) {
    const attrs: Record<string, string> = {};
    for (const a of m[2]!.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]!] = a[2]!;
    els.set(m[3]!, {
      id: m[3]!,
      hidden: /\shidden[\s>]/.test(m[0]),
      textContent: "",
      handlers: {},
      attrs,
    });
  }
  const proxy = (e: El) =>
    new Proxy(e, {
      get(t, k: string) {
        if (k in t) return (t as never)[k];
        if (k === "addEventListener") return (n: string, f: () => void) => (t.handlers[n] = f);
        if (k === "getAttribute") return (n: string) => t.attrs[n] ?? null;
        if (k === "setAttribute") return (n: string, v: string) => (t.attrs[n] = v);
        if (k === "classList") return { toggle() {}, add() {}, remove() {} };
        if (k === "style") return {};
        if (k === "disabled") return false;
        if (k === "getBoundingClientRect") return () => ({ left: 0, width: 1 });
        return () => {};
      },
      set(t, k: string, v) {
        (t as Record<string, unknown>)[k] = v;
        return true;
      },
    });
  const proxies = new Map([...els].map(([k, v]) => [k, proxy(v)]));
  const sent: string[] = [];
  const sockets: {
    onmessage?: (e: { data: string }) => void;
    onopen?: () => void;
    onclose?: () => void;
  }[] = [];
  let docClick: ((e: unknown) => void) | undefined;
  const document = {
    getElementById: (id: string) => proxies.get(id),
    querySelectorAll: () => [],
    addEventListener: (n: string, f: (e: unknown) => void) => {
      if (n === "click") docClick = f;
    },
    body: { classList: { toggle() {} } },
  };
  class WS {
    onmessage?: (e: { data: string }) => void;
    onopen?: () => void;
    onclose?: () => void;
    constructor() {
      sockets.push(this);
    }
    send(m: string) {
      sent.push(m);
    }
  }
  vm.runInNewContext(script, {
    document,
    WebSocket: WS,
    location: { search: "", protocol: "http:", host: "x", pathname: "/" },
    history: { replaceState() {} },
    localStorage: { getItem: () => "k", setItem() {} },
    navigator: {},
    URLSearchParams,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    encodeURIComponent,
    Number,
    String,
    console,
  });
  const tap = (id: string) => {
    const el = els.get(id)!;
    el.handlers.click?.();
    docClick?.({ target: { closest: () => (el.attrs["data-cmd"] ? proxies.get(id) : null) } });
  };
  const send = (o: unknown) => sockets[0]!.onmessage!({ data: JSON.stringify(o) });
  const snapshot = { type: "snapshot", where: "Home", remotes: 1, layout: "home", typing: "none" };
  return { els, sent, tap, send, snapshot, open: () => sockets[0]!.onopen!() };
}

let page: ReturnType<typeof loadPage>;
beforeEach(() => {
  vi.useFakeTimers();
  page = loadPage();
  page.open();
});
afterEach(() => vi.useRealTimers());

const sentCommands = (p: typeof page) => p.sent.map((s) => JSON.parse(s));

describe("Remote page power states", () => {
  test("off shows the Power page and Power sends only power", () => {
    page.send({ type: "power", state: "off" });
    expect(page.els.get("pw")!.hidden).toBe(false);
    expect(page.els.get("pw-title")!.textContent).toBe("Couch is off");
    expect(page.els.get("pw-btn")!.hidden).toBe(false);
    page.tap("pw-btn");
    expect(sentCommands(page)).toEqual([{ type: "command", command: "power" }]);
  });

  test("starting shows a spinner and no button, then Couch's snapshot shows the Remote", () => {
    page.send({ type: "power", state: "starting" });
    expect(page.els.get("pw-title")!.textContent).toBe("Starting Couch…");
    expect(page.els.get("pw-spin")!.hidden).toBe(false);
    expect(page.els.get("pw-btn")!.hidden).toBe(true);
    page.send(page.snapshot);
    expect(page.els.get("pw")!.hidden).toBe(true);
  });

  test("on shows the Remote", () => {
    page.send({ type: "power", state: "off" });
    page.send({ type: "power", state: "on" });
    expect(page.els.get("pw")!.hidden).toBe(true);
  });

  test("a failed start says so, then returns to off", () => {
    page.send({ type: "power", state: "off", failed: true });
    expect(page.els.get("pw-title")!.textContent).toBe("Couch didn't start");
    vi.advanceTimersByTime(4100);
    expect(page.els.get("pw-title")!.textContent).toBe("Couch is off");
    expect(page.els.get("pw-btn")!.hidden).toBe(false);
  });

  test("the top-bar Power asks first; Cancel sends nothing, Turn off sends power", () => {
    page.send(page.snapshot);
    expect(page.els.get("pw")!.hidden).toBe(true);
    expect(page.els.get("confirm")!.hidden).toBe(true);
    page.tap("pbtn");
    page.send(page.snapshot);
    expect(page.els.get("confirm")!.hidden).toBe(false);
    expect(page.sent).toEqual([]);
    page.tap("confirm-cancel");
    expect(page.els.get("confirm")!.hidden).toBe(true);
    expect(page.sent).toEqual([]);
    page.tap("pbtn");
    page.tap("confirm-off");
    expect(page.els.get("confirm")!.hidden).toBe(true);
    expect(sentCommands(page)).toEqual([{ type: "command", command: "power" }]);
  });
});
