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
function loadPage(
  stored: Record<string, string> = {},
  loc: { search?: string; unpaired?: boolean } = {},
) {
  const store = new Map(Object.entries({ "couch-key": KEY, ...stored }));
  const writes: [string, string][] = [];
  const removed: string[] = [];
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
    window: loc.unpaired ? { COUCH_UNPAIRED: true } : undefined,
    location: { search: loc.search ?? "", protocol: "http:", host: "x", pathname: "/" },
    localStorage: {
      removeItem: (k: string) => {
        store.delete(k);
        removed.push(k);
      },
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
  return { els, body, sent, sockets, sock, text, tapCmd, message, writes, removed };
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

/** A cache entry as the page writes it; the hash is read from a real run so the test does not recompute it. */
function cacheFor(fields: Record<string, unknown>, key = KEY) {
  return JSON.stringify({
    v: 1,
    h: hashOf(key),
    view: "idle",
    paused: false,
    volume: 30,
    muted: false,
    power: "on",
    ...fields,
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the Remote while it connects", () => {
  test("a cached snapshot is drawn at full brightness before the socket opens", () => {
    const p = loadPage({
      "couch-last": cacheFor({ view: "np", title: "Dark" }),
    });
    expect(p.sockets).toHaveLength(1);
    expect(p.text("np-title")).toBe("Dark");
    expect(p.els.get("nowp")!.hidden).toBe(false);
    expect(p.body.has("off")).toBe(false);
    expect(p.els.get("conn")!.hidden).toBe(false);
  });

  test("a cached question, toast or typing sheet is never replayed", () => {
    const p = loadPage({
      "couch-last": cacheFor({
        typing: "you",
        toast: { id: 1, text: "Old" },
        confirm: { phone: true, title: "Old?", buttons: ["Yes"], focus: 0 },
      }),
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

  test("safe taps while connecting are sent after the first snapshot, not on open", () => {
    const p = loadPage();
    p.tapCmd("playpause");
    p.tapCmd("volUp");
    vi.advanceTimersByTime(500);
    p.sock().onopen!();
    expect(p.sent).toEqual([]);
    p.message(snapshot());
    expect(p.sent.map((m) => JSON.parse(m).command)).toEqual(["playpause", "volUp"]);
  });

  test("seek by, mute and volume down are queued too", () => {
    const p = loadPage();
    p.tapCmd("volDown");
    p.tapCmd("mute");
    p.tapCmd("seekBy");
    p.sock().onopen!();
    p.message(snapshot());
    expect(p.sent.map((m) => JSON.parse(m).command)).toEqual(["volDown", "mute", "seekBy"]);
  });

  test.each([
    "up",
    "down",
    "left",
    "right",
    "ok",
    "back",
    "home",
    "menu",
    "confirmAnswer",
    "resume",
  ])("%s while disconnected is dropped with the toast, never queued", (cmd) => {
    const p = loadPage();
    p.tapCmd(cmd);
    expect(p.text("phone-toast")).toBe("Couldn't reach Couch");
    p.sock().onopen!();
    p.message(snapshot());
    expect(p.sent).toEqual([]);
  });

  test("a navigation tap does not drop a queued volume tap", () => {
    const p = loadPage();
    p.tapCmd("volUp");
    p.tapCmd("ok");
    p.sock().onopen!();
    p.message(snapshot());
    expect(p.sent.map((m) => JSON.parse(m).command)).toEqual(["volUp"]);
  });

  test("a queued tap waits for the first snapshot even when the screen changed meanwhile", () => {
    const p = loadPage({
      "couch-last": cacheFor({ view: "np", title: "Dark" }),
    });
    p.tapCmd("playpause");
    p.sock().onopen!();
    expect(p.sent).toEqual([]);
    p.message(snapshot({ where: "Home" }));
    expect(p.sent.map((m) => JSON.parse(m).command)).toEqual(["playpause"]);
  });

  test("a queue left over from a dropped socket is not sent on the next open before a snapshot", () => {
    const p = loadPage();
    p.tapCmd("volUp");
    p.sock(0).onclose!();
    vi.advanceTimersByTime(400);
    p.sock(1).onopen!();
    expect(p.sent).toEqual([]);
    vi.advanceTimersByTime(2100);
    p.sock(1).onmessage!({ data: JSON.stringify(snapshot()) });
    expect(p.sent).toEqual([]);
  });

  test("each queued tap expires on its own after 2 s", () => {
    const p = loadPage();
    p.tapCmd("volUp");
    vi.advanceTimersByTime(1500);
    p.tapCmd("volDown");
    vi.advanceTimersByTime(600);
    expect(p.text("phone-toast")).toBe("Couldn't reach Couch");
    p.sock().onopen!();
    p.message(snapshot());
    expect(p.sent.map((m) => JSON.parse(m).command)).toEqual(["volDown"]);
  });

  test("repeated taps keep their own clocks and none outlives 2 s", () => {
    const p = loadPage();
    for (let i = 0; i < 4; i++) {
      p.tapCmd("volUp");
      vi.advanceTimersByTime(900);
    }
    p.sock().onopen!();
    p.message(snapshot());
    expect(p.sent).toHaveLength(2);
  });

  test("the power command is never queued", () => {
    const p = loadPage();
    p.tapCmd("power");
    p.sock().onopen!();
    p.message(snapshot());
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

const hashOf = (key: string) => {
  const p = loadPage({ "couch-key": key });
  p.sock().onopen!();
  p.message(snapshot());
  vi.advanceTimersByTime(1100);
  return JSON.parse(p.writes.find(([k]) => k === "couch-last")![1]).h as string;
};

describe("what the Remote keeps in localStorage", () => {
  test("it keeps only the display fields, bound to a hash of the key", () => {
    const p = loadPage();
    p.sock().onopen!();
    p.message(
      snapshot({
        where: "Netflix",
        nowPlaying: {
          ...playing,
          artwork: "https://occ-0.nflxso.net/a.jpg",
          artKey: "abc",
          app: { id: "netflix", label: "Netflix", icon: "<svg/>" },
          subtitles: [{ id: "1", label: "English" }],
        },
        upNext: [{ title: "Secret next" }],
        continueCard: { title: "Secret card", left: "3 min" },
        folders: ["Private"],
        history: ["Hist"],
        toast: { id: 2, text: "Hi" },
      }),
    );
    vi.advanceTimersByTime(1100);
    const saved = p.writes.filter(([k]) => k === "couch-last");
    expect(saved).toHaveLength(1);
    const o = JSON.parse(saved[0]![1]);
    expect(Object.keys(o).sort()).toEqual(
      ["app", "art", "h", "muted", "paused", "power", "title", "v", "view", "volume"].sort(),
    );
    expect(o).toMatchObject({
      view: "np",
      app: { id: "netflix", label: "Netflix" },
      title: "Dark",
      art: "https://occ-0.nflxso.net/a.jpg",
      paused: false,
      volume: 30,
      muted: false,
      power: "on",
    });
    const raw = saved[0]![1];
    for (const secret of ["Secret", "Private", "Hist", 'Hi"', "abc", "svg", "English", KEY])
      expect(raw).not.toContain(secret);
    expect(p.writes.every(([, v]) => !v.includes(KEY))).toBe(true);
  });

  test("an idle snapshot is cached as the idle view", () => {
    const p = loadPage();
    p.sock().onopen!();
    p.message(snapshot({ upNext: [{ title: "Nope" }] }));
    vi.advanceTimersByTime(1100);
    const o = JSON.parse(p.writes.find(([k]) => k === "couch-last")![1]);
    expect(o.view).toBe("idle");
    expect(o.title).toBeUndefined();
    expect(p.writes.map(([, v]) => v).join()).not.toContain("Nope");
  });

  test("a cache for this key draws the view at full brightness", () => {
    const p = loadPage({
      "couch-last": cacheFor({
        view: "np",
        title: "Dark",
        paused: true,
        app: { id: "yt", label: "YouTube" },
      }),
    });
    expect(p.text("np-title")).toBe("Dark");
    expect(p.els.get("nowp")!.hidden).toBe(false);
    expect(p.body.has("off")).toBe(false);
    expect(p.text("id-vol-n")).toBe("30");
  });

  test("a cache with a hash for another key is ignored and cleared", () => {
    const p = loadPage({ "couch-last": cacheFor({ view: "np", title: "Dark" }, "other-key") });
    expect(p.text("np-title")).toBe("");
    expect(p.body.has("idle")).toBe(true);
    expect(p.removed).toContain("couch-last");
  });

  test("a cache with no key is ignored and cleared", () => {
    const p = loadPage({ "couch-key": "", "couch-last": cacheFor({ view: "np", title: "Dark" }) });
    expect(p.text("np-title")).toBe("");
    expect(p.removed).toContain("couch-last");
  });

  test("an old-format cache is ignored and cleared", () => {
    const p = loadPage({ "couch-last": JSON.stringify(snapshot({ upNext: [{ title: "Old" }] })) });
    expect(p.removed).toContain("couch-last");
    expect(p.body.has("idle")).toBe(true);
  });

  test("a new pairing key from the link clears the old cache and cancels pending writes", () => {
    const p = loadPage(
      { "couch-last": cacheFor({ view: "np", title: "Dark" }) },
      { search: "?key=fresh-key" },
    );
    expect(p.text("np-title")).toBe("");
    expect(p.removed).toContain("couch-last");
    p.sock().onopen!();
    p.message(snapshot());
    vi.advanceTimersByTime(1100);
    expect(JSON.parse(p.writes.filter(([k]) => k === "couch-last").at(-1)![1]).h).toBe(
      hashOf("fresh-key"),
    );
  });

  test("the unpaired page clears the cache", () => {
    const p = loadPage(
      { "couch-last": cacheFor({ view: "np", title: "Dark" }) },
      { unpaired: true },
    );
    expect(p.removed).toContain("couch-last");
    expect(p.sockets).toHaveLength(0);
  });

  test("a snapshot waiting to be saved is never written after the cache is cleared", () => {
    const p = loadPage({ "couch-key": "" });
    p.sock().onopen!();
    p.message(snapshot({ nowPlaying: playing }));
    vi.advanceTimersByTime(1100);
    expect(p.writes.filter(([k]) => k === "couch-last")).toEqual([]);
  });
});
