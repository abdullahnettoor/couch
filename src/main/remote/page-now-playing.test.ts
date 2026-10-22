import vm from "node:vm";
import { beforeEach, describe, expect, test } from "vite-plus/test";
import { REMOTE_PAGE } from "./page.ts";

interface El {
  id: string;
  hidden: boolean;
  textContent: string;
  innerHTML: string;
  attrs: Record<string, string>;
  handlers: Record<string, (e?: unknown) => void>;
  classes: Set<string>;
  style: Record<string, unknown>;
}

/** Runs the page's script against a minimal DOM (elements by id) and a fake socket. */
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
      innerHTML: "",
      attrs,
      handlers: {},
      classes: new Set((attrs.class ?? "").split(" ")),
      style: { setProperty() {} },
    });
  }
  const proxy = (e: El) =>
    new Proxy(e, {
      get(t, k: string) {
        if (k in t) return (t as never)[k];
        if (k === "addEventListener") return (n: string, f: () => void) => (t.handlers[n] = f);
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
        if (k === "getBoundingClientRect") return () => ({ left: 0, width: 1 });
        return () => {};
      },
      set(t, k: string, v) {
        (t as unknown as Record<string, unknown>)[k] = v;
        return true;
      },
    });
  const proxies = new Map([...els].map(([k, v]) => [k, proxy(v)]));
  const sent: string[] = [];
  const sockets: { onmessage?: (e: { data: string }) => void; onopen?: () => void }[] = [];
  let docClick: ((e: unknown) => void) | undefined;
  const bodyClasses = new Set<string>();
  const document = {
    getElementById: (id: string) => proxies.get(id),
    querySelectorAll: () => [],
    addEventListener: (n: string, f: (e: unknown) => void) => {
      if (n === "click") docClick = f;
    },
    body: {
      classList: {
        toggle: (c: string, on: boolean) => (on ? bodyClasses.add(c) : bodyClasses.delete(c)),
      },
    },
  };
  class WS {
    onmessage?: (e: { data: string }) => void;
    onopen?: () => void;
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
  const send = (o: unknown) => sockets[0]!.onmessage!({ data: JSON.stringify(o) });
  const base = {
    type: "snapshot",
    where: "Netflix",
    remotes: 1,
    layout: "app",
    typing: "none",
    volume: 42,
    muted: false,
  };
  const playing = (nowPlaying: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    send({
      ...base,
      nowPlaying: {
        title: "The Long Way Home",
        folder: "Netflix",
        position: 100,
        duration: 1000,
        paused: false,
        subtitlesOn: false,
        canSeek: true,
        ...nowPlaying,
      },
      ...extra,
    });
  /** Clicks an element the way a finger does: its own handler, then the document's delegate. */
  const tap = (id: string) => {
    const el = els.get(id)!;
    el.handlers.click?.();
    docClick?.({
      target: { closest: () => (el.attrs["data-cmd"] ? proxies.get(id) : null) },
    });
  };
  const tapRow = (cmd: string, args: unknown) =>
    docClick?.({
      target: {
        closest: () => ({
          getAttribute: (n: string) =>
            n === "data-cmd" ? cmd : n === "data-args" ? JSON.stringify(args) : "1",
          disabled: false,
        }),
      },
    });
  return {
    els,
    sent,
    send,
    base,
    playing,
    tap,
    tapRow,
    bodyClasses,
    open: () => sockets[0]!.onopen!(),
  };
}

let page: ReturnType<typeof loadPage>;
beforeEach(() => {
  page = loadPage();
  page.open();
});
const hidden = (id: string) => page.els.get(id)!.hidden;
const commands = () => page.sent.map((s) => JSON.parse(s));

describe("the page's markup", () => {
  test("the top bar has Back, Home and Mute, in both views", () => {
    const bars = REMOTE_PAGE.match(/data-cmd="mute"/g) ?? [];
    expect(bars.length).toBe(2);
    expect(REMOTE_PAGE.match(/data-cmd="back" aria-label="Back" data-i="backArrow"/g)?.length).toBe(
      3,
    );
  });
});

describe("Now Playing", () => {
  test("replaces the Remote while a video plays, with no D-pad on it", () => {
    page.send({ ...page.base, layout: "home" });
    expect(hidden("nowp")).toBe(true);
    expect(hidden("controls")).toBe(false);
    page.playing({});
    expect(hidden("nowp")).toBe(false);
    expect(hidden("controls")).toBe(true);
    expect(hidden("npad")).toBe(true);
    expect(page.bodyClasses.has("np")).toBe(true);
    expect(page.els.get("np-title")!.textContent).toBe("The Long Way Home");
    expect(page.els.get("np-line")!.textContent).toBe("Netflix");
  });

  test("shows only the buttons the App supports", () => {
    page.playing({ canSeek: true });
    expect(hidden("chip-subs")).toBe(true);
    expect(hidden("chip-aud")).toBe(true);
    expect(hidden("chip-spd")).toBe(true);
    expect(hidden("chip-pad")).toBe(false);
    page.playing({
      subtitles: [
        { id: "off", label: "Off", on: false },
        { id: "en", label: "English", on: true },
      ],
      audio: [{ id: "a", label: "Español", on: true }],
      speed: 1.25,
      speeds: [0.5, 1, 1.25],
    });
    expect(hidden("chip-subs")).toBe(false);
    expect(page.els.get("chip-subs-t")!.textContent).toBe("English");
    expect(page.els.get("chip-aud-t")!.textContent).toBe("Español");
    expect(page.els.get("chip-spd-t")!.textContent).toBe("1.25×");
  });

  test("the Library (no canSeek) has Subtitles, no D-pad, and Subtitles toggles", () => {
    page.playing({ canSeek: undefined, subtitlesOn: true });
    expect(hidden("chip-subs")).toBe(false);
    expect(hidden("chip-pad")).toBe(true);
    page.tap("chip-subs");
    expect(commands()).toEqual([{ type: "command", command: "subtitles" }]);
  });

  test("Speed opens a list and picking a row sends setSpeed and closes it", () => {
    page.playing({ speed: 1, speeds: [0.5, 1, 1.5] });
    page.tap("chip-spd");
    expect(hidden("np-sheet")).toBe(false);
    expect(page.els.get("np-rows")!.innerHTML).toContain("1.5×");
    page.tapRow("setSpeed", { speed: 1.5 });
    expect(commands()).toEqual([{ type: "command", command: "setSpeed", args: { speed: 1.5 } }]);
    expect(hidden("np-sheet")).toBe(true);
  });

  test("a prompt shows its label and sends pressPrompt", () => {
    page.playing({});
    expect(hidden("np-prompt")).toBe(true);
    page.playing({ prompt: { id: "skipIntro", label: "Skip Intro" } });
    expect(hidden("np-prompt")).toBe(false);
    expect(page.els.get("np-prompt")!.textContent).toBe("Skip Intro");
    page.tap("np-prompt");
    expect(commands()).toEqual([
      { type: "command", command: "pressPrompt", args: { id: "skipIntro" } },
    ]);
    page.playing({});
    expect(hidden("np-prompt")).toBe(true);
  });

  test("mute state shows in the volume pill", () => {
    page.playing({}, { muted: true });
    expect(page.els.get("np-vol-n")!.textContent).toBe("Muted");
    page.playing({}, { muted: false });
    expect(page.els.get("np-vol-n")!.textContent).toBe("42");
  });

  test("D-pad switches to the D-pad view and back, and resets when the video ends", () => {
    page.playing({});
    page.tap("chip-pad");
    expect(hidden("npad")).toBe(false);
    expect(hidden("nowp")).toBe(true);
    page.tap("npad-back");
    expect(hidden("nowp")).toBe(false);
    page.tap("chip-pad");
    page.send({ ...page.base });
    expect(hidden("npad")).toBe(true);
    expect(hidden("controls")).toBe(false);
    page.playing({});
    expect(hidden("nowp")).toBe(false);
  });

  test("with no artwork it shows the App's logo and name on its colour", () => {
    page.playing({ app: { id: "netflix", label: "Netflix", icon: "<svg id=x></svg>" } });
    const art = page.els.get("np-art")!;
    expect(art.attrs["data-app"]).toBe("netflix");
    expect(art.classes.has("has")).toBe(false);
    expect(page.els.get("np-face")!.innerHTML).toBe("<svg id=x></svg><span>Netflix</span>");
    page.playing({
      artwork: "https://x/y.jpg",
      app: { id: "netflix", label: "Netflix", icon: "" },
    });
    expect(art.classes.has("has")).toBe(true);
  });

  test("tap on the artwork plays or pauses; swipes seek and change volume", () => {
    page.playing({});
    const art = page.els.get("np-art")!.handlers;
    const ev = (x: number, y: number) => ({ clientX: x, clientY: y, pointerId: 1, target: {} });
    art.pointerdown!(ev(100, 100));
    art.pointerup!(ev(102, 101));
    art.pointerdown!(ev(100, 100));
    art.pointermove!(ev(180, 102));
    art.pointerup!(ev(180, 102));
    art.pointerdown!(ev(100, 100));
    art.pointermove!(ev(100, 40));
    art.pointerup!(ev(100, 40));
    expect(commands().map((c) => [c.command, c.args])).toEqual([
      ["playpause", undefined],
      ["seekBy", { seconds: 10 }],
      ["volUp", undefined],
      ["volUp", undefined],
    ]);
  });
});
