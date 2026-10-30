import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { PAGE_HTML, runPage } from "./page-runner.ts";

interface El {
  hidden: boolean;
  textContent: string;
  attrs: Record<string, string>;
  classes: Set<string>;
}

const KEY = "pairing-secret-123";

/** The page's script against a minimal DOM, a fake socket and a fake localStorage. */
function loadPage(stored: Record<string, string> = {}) {
  const store = new Map(Object.entries({ "couch-key": KEY, ...stored }));
  const writes: [string, string][] = [];
  const els = new Map<string, El>();
  for (const m of PAGE_HTML.matchAll(/<(\w+)([^>]*?\sid="([^"]+)"[^>]*)>/g)) {
    const attrs: Record<string, string> = {};
    for (const a of m[2]!.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]!] = a[2]!;
    els.set(m[3]!, {
      hidden: /\shidden[\s>]/.test(m[0]),
      textContent: "",
      attrs,
      classes: new Set((attrs.class ?? "").split(" ")),
    });
  }
  const proxy = (e: El) =>
    new Proxy(e, {
      get(t, k: string) {
        if (k in t) return (t as never)[k];
        if (k === "getAttribute") return (n: string) => t.attrs[n] ?? null;
        if (k === "setAttribute") return (n: string, v: string) => (t.attrs[n] = v);
        if (k === "classList")
          return {
            toggle: (c: string, on?: boolean) =>
              (on ?? !t.classes.has(c)) ? t.classes.add(c) : t.classes.delete(c),
            add: (c: string) => t.classes.add(c),
            remove: (c: string) => t.classes.delete(c),
          };
        if (k === "disabled") return false;
        return () => {};
      },
      set(t, k: string, v) {
        (t as unknown as Record<string, unknown>)[k] = v;
        return true;
      },
    });
  const proxies = new Map([...els].map(([k, v]) => [k, proxy(v)]));
  let docClick: ((e: unknown) => void) | undefined;
  const body = new Set<string>();
  const document = {
    getElementById: (id: string) => proxies.get(id),
    querySelectorAll: () => [],
    addEventListener: (n: string, f: (e: unknown) => void) => {
      if (n === "click") docClick = f;
    },
    body: {
      classList: { toggle: (c: string, on: boolean) => (on ? body.add(c) : body.delete(c)) },
    },
  };
  const { sent, sockets } = runPage({
    document,
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
        writes.push([k, v]);
      },
    },
  });
  const sock = (i = 0) => sockets[i] as unknown as Record<string, (e?: unknown) => void>;
  const text = (id: string) => els.get(id)!.textContent;
  const tapCmd = (cmd: string) =>
    docClick?.({
      target: { closest: () => ({ getAttribute: (n: string) => (n === "data-cmd" ? cmd : null) }) },
    });
  const message = (o: unknown) => sock().onmessage!({ data: JSON.stringify(o) });
  return { els, body, sent, sockets, sock, text, tapCmd, message, writes };
}

const snapshot = (extra: Record<string, unknown> = {}) => ({
  type: "snapshot",
  where: "Home",
  layout: "home",
  typing: "none",
  volume: 30,
  muted: false,
  remotes: 1,
  ...extra,
});
const playing = {
  title: "Dark",
  folder: "Shows",
  position: 100,
  duration: 1000,
  paused: false,
  subtitlesOn: false,
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the Remote while it connects", () => {
  test("a cached snapshot is drawn at full brightness before the socket opens", () => {
    const p = loadPage({
      "couch-last": JSON.stringify(snapshot({ where: "Netflix", nowPlaying: playing })),
    });
    expect(p.sockets).toHaveLength(1);
    expect(p.text("np-title")).toBe("Dark");
    expect(p.els.get("nowp")!.hidden).toBe(false);
    expect(p.body.has("off")).toBe(false);
    expect(p.els.get("conn")!.hidden).toBe(false);
  });

  test("a cached question, toast or typing sheet is never replayed", () => {
    const p = loadPage({
      "couch-last": JSON.stringify(
        snapshot({
          typing: "you",
          toast: { id: 1, text: "Old" },
          confirm: { phone: true, title: "Old?", buttons: ["Yes"], focus: 0 },
        }),
      ),
    });
    expect(p.els.get("sheet")!.hidden).toBe(true);
    expect(p.els.get("ask")!.hidden).toBe(true);
    expect(p.text("phone-toast")).toBe("");
  });

  test("with nothing cached, the idle layout shows undimmed with the hint", () => {
    const p = loadPage();
    expect(p.body.has("idle")).toBe(true);
    expect(p.body.has("off")).toBe(false);
    expect(p.els.get("conn")!.hidden).toBe(false);
    expect(p.text("status")).toBe("Connecting…");
    expect(p.els.get("pw")!.hidden).toBe(true);
  });

  test("the hint hides once connected", () => {
    const p = loadPage();
    p.sock().onopen!();
    expect(p.els.get("conn")!.hidden).toBe(true);
    expect(p.text("status")).toBe("Connected");
  });

  test("a dropped connection shows the hint again, without dimming", () => {
    const p = loadPage();
    p.sock().onopen!();
    p.message(snapshot());
    p.sock().onclose!();
    expect(p.els.get("conn")!.hidden).toBe(false);
    expect(p.body.has("off")).toBe(false);
    vi.advanceTimersByTime(400);
    expect(p.sockets).toHaveLength(2);
  });

  test("Couch off, as the Listener reports it, still dims and shows the power button", () => {
    const p = loadPage();
    p.sock().onopen!();
    p.message({ type: "power", state: "off" });
    expect(p.body.has("off")).toBe(true);
    expect(p.els.get("pw")!.hidden).toBe(false);
    expect(p.els.get("pw-btn")!.hidden).toBe(false);
    expect(p.els.get("conn")!.hidden).toBe(true);
    p.message(snapshot());
    expect(p.body.has("off")).toBe(false);
  });

  test("taps while connecting are sent once connected", () => {
    const p = loadPage();
    p.tapCmd("playpause");
    expect(p.sent).toEqual([]);
    vi.advanceTimersByTime(500);
    p.sock().onopen!();
    expect(p.sent.map((m) => JSON.parse(m).command)).toEqual(["playpause"]);
  });

  test("taps still waiting after 2 s are dropped with a toast", () => {
    const p = loadPage();
    p.tapCmd("playpause");
    vi.advanceTimersByTime(2100);
    p.sock().onopen!();
    expect(p.sent).toEqual([]);
    expect(p.text("phone-toast")).toBe("Couldn't reach Couch");
  });

  test("the power command is never queued", () => {
    const p = loadPage();
    p.tapCmd("power");
    p.sock().onopen!();
    expect(p.sent).toEqual([]);
  });

  test("after a few failed tries it says it can't reach Couch, still undimmed", () => {
    const p = loadPage();
    for (let i = 0; i < 3; i++) {
      p.sock(i).onclose!();
      vi.advanceTimersByTime(9000);
    }
    expect(p.els.get("banner")!.hidden).toBe(false);
    expect(p.body.has("off")).toBe(false);
  });
});

describe("what the Remote keeps in localStorage", () => {
  test("it keeps the last snapshot, and nothing holds the pairing key", () => {
    const p = loadPage();
    p.sock().onopen!();
    p.message(snapshot({ where: "Netflix", nowPlaying: playing, toast: { id: 2, text: "Hi" } }));
    vi.advanceTimersByTime(1100);
    const saved = p.writes.filter(([k]) => k === "couch-last");
    expect(saved).toHaveLength(1);
    expect(JSON.parse(saved[0]![1]).nowPlaying.title).toBe("Dark");
    expect(saved[0]![1]).not.toContain("Hi");
    expect(p.writes.every(([, v]) => !v.includes(KEY))).toBe(true);
  });
});
