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
  test("the top bar has Back, Home and Mute, in all three views", () => {
    const bars = REMOTE_PAGE.match(/data-cmd="mute"/g) ?? [];
    expect(bars.length).toBe(3);
    expect(REMOTE_PAGE.match(/data-cmd="back" aria-label="Back" data-i="backArrow"/g)?.length).toBe(
      3,
    );
  });
});

describe("the idle Remote", () => {
  const idle = (extra: Record<string, unknown>) =>
    page.send({ ...page.base, typeAvailable: false, ...extra });
  const card = { title: "Dark", left: "38 min left" };

  test("has the top bar, the D-pad and the volume pill, and no Play/Pause or slider", () => {
    const main = REMOTE_PAGE.slice(
      REMOTE_PAGE.indexOf('<main id="controls">'),
      REMOTE_PAGE.indexOf("</main>"),
    );
    expect(main).toContain('data-cmd="back"');
    expect(main).toContain('data-cmd="home"');
    expect(main).toContain('data-cmd="mute"');
    expect(main).toContain('data-cmd="ok"');
    expect(main).toContain('data-cmd="volUp"');
    expect(main).not.toContain("playpause");
    expect(main).not.toContain("vslider");
  });

  test("Home with Continue watching shows that card; without it, no card", () => {
    idle({ layout: "home", where: "Home", continueCard: card });
    expect(hidden("cw")).toBe(false);
    expect(hidden("search")).toBe(true);
    expect(hidden("fixbtn")).toBe(true);
    idle({ layout: "home", where: "Home" });
    expect(hidden("cw")).toBe(true);
    expect(hidden("search")).toBe(true);
  });

  test("a web App shows its Type label as the one card", () => {
    idle({ typeLabel: "Search Netflix", typeAvailable: true });
    expect(hidden("search")).toBe(false);
    expect(page.els.get("search-label")!.textContent).toBe("Search Netflix");
    expect(hidden("cw")).toBe(true);
  });

  test("Library shows Search; Fix match shows where it does today", () => {
    idle({ layout: "librarySearch", typeLabel: "Search Library", typeAvailable: true });
    expect(page.els.get("search-label")!.textContent).toBe("Search Library");
    idle({ layout: "other", fixAvailable: true });
    expect(hidden("fixbtn")).toBe(false);
  });

  test("Library with both Fix match and Search available shows only Fix match", () => {
    idle({
      layout: "librarySearch",
      typeLabel: "Search Library",
      typeAvailable: true,
      fixAvailable: true,
    });
    expect(hidden("fixbtn")).toBe(false);
    expect(hidden("search")).toBe(true);
  });

  test("Back is hidden on Home with no question, and shown with a question or on any other page", () => {
    const backs = () => ["id-back", "np-back", "pad-back"].map(hidden);
    idle({ layout: "home", where: "Home" });
    expect(backs()).toEqual([true, true, true]);
    expect(hidden("gear")).toBe(false);
    idle({
      layout: "home",
      where: "Home",
      confirm: { title: "Turn off?", buttons: ["Stay"], focus: 0 },
    });
    expect(backs()).toEqual([false, false, false]);
    idle({ layout: "home", where: "Home" });
    expect(backs()).toEqual([true, true, true]);
    for (const layout of ["app", "other", "librarySearch"]) {
      idle({ layout });
      expect(backs()).toEqual([false, false, false]);
    }
  });

  test("Settings and other pages show no card", () => {
    idle({ layout: "other", where: "Settings", view: "settings" });
    expect(hidden("cw")).toBe(true);
    expect(hidden("search")).toBe(true);
    expect(hidden("fixbtn")).toBe(true);
  });

  test("the gear shows only on Home and sends openSettings", () => {
    idle({ layout: "home", where: "Home" });
    expect(hidden("gear")).toBe(false);
    page.tap("gear");
    expect(commands()).toEqual([{ type: "command", command: "openSettings" }]);
    idle({ layout: "app" });
    expect(hidden("gear")).toBe(true);
    idle({ layout: "other", view: "settings" });
    expect(hidden("gear")).toBe(true);
  });

  test("the volume pill shows the level and Muted, and Mute marks pressed", () => {
    idle({ volume: 30 });
    expect(page.els.get("id-vol-n")!.textContent).toBe("30");
    idle({ muted: true });
    expect(page.els.get("id-vol-n")!.textContent).toBe("Muted");
  });

  test("uses the fixed no-scroll layout", () => {
    idle({ layout: "home" });
    expect(page.bodyClasses.has("idle")).toBe(true);
    page.playing({});
    expect(page.bodyClasses.has("idle")).toBe(false);
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

  test("the Library has the same buttons: Subtitles and Audio open lists, and the D-pad button", () => {
    const off = { id: "off", label: "Off", on: false };
    page.playing({
      canSeek: undefined,
      subtitles: [off, { id: "2", label: "English", on: true }],
      audio: [{ id: "1", label: "Malayalam", on: true }],
    });
    expect(hidden("chip-subs")).toBe(false);
    expect(hidden("chip-aud")).toBe(false);
    expect(hidden("chip-pad")).toBe(false);
    page.tap("chip-subs");
    expect(hidden("np-sheet")).toBe(false);
    expect(page.els.get("np-rows")!.innerHTML).toContain("Off");
    page.tapRow("setTrack", { kind: "subtitles", track: "off" });
    expect(commands()).toEqual([
      { type: "command", command: "setTrack", args: { kind: "subtitles", track: "off" } },
    ]);
    page.tap("chip-pad");
    expect(hidden("npad")).toBe(false);
  });

  test("a Library video without subtitle or audio tracks hides those buttons", () => {
    page.playing({ canSeek: undefined });
    expect(hidden("chip-subs")).toBe(true);
    expect(hidden("chip-aud")).toBe(true);
    expect(hidden("chip-pad")).toBe(false);
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

  test("a Library video's art key shows its picture from /thumb, key-checked", () => {
    page.playing({
      artKey: "tmdb-backdrop-abc",
      app: { id: "library", label: "Library", icon: "" },
    });
    const art = page.els.get("np-art")!;
    expect(art.classes.has("has")).toBe(true);
    expect(art.style.backgroundImage).toContain("/thumb/tmdb-backdrop-abc.jpg?key=");
    page.playing({ app: { id: "library", label: "Library", icon: "" } });
    expect(art.classes.has("has")).toBe(false);
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

  test("the volume swipe's toast counts steps once, even when snapshots arrive mid-gesture", () => {
    page.playing({}, { volume: 40 });
    const art = page.els.get("np-art")!.handlers;
    const ev = (y: number) => ({ clientX: 100, clientY: y, pointerId: 1, target: {} });
    const toast = page.els.get("np-toast")!;
    art.pointerdown!(ev(100));
    art.pointermove!(ev(40));
    expect(toast.textContent).toBe("Volume 50");
    page.playing({}, { volume: 45 });
    art.pointermove!(ev(10));
    expect(toast.textContent).toBe("Volume 55");
    art.pointerup!(ev(10));
  });
});
