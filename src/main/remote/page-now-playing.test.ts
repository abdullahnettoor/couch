import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { ICON_PATHS } from "../../shared/icons.ts";
import { REMOTE_PAGE } from "./page.ts";
import { PAGE_HTML, runPage } from "./page-runner.ts";

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
  const els = new Map<string, El>();
  for (const m of PAGE_HTML.matchAll(/<(\w+)([^>]*?\sid="([^"]+)"[^>]*)>/g)) {
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
  let docClick: ((e: unknown) => void) | undefined;
  const bodyClasses = new Set<string>();
  const muteButtons = [0, 1, 2].map(() => ({
    pressed: "",
    innerHTML: "",
    classes: new Set<string>(),
    classList: {
      toggle(this: { owner: { classes: Set<string> } }, c: string, on: boolean) {
        if (on) this.owner.classes.add(c);
        else this.owner.classes.delete(c);
      },
      owner: undefined as unknown as { classes: Set<string> },
    },
    setAttribute(n: string, v: string) {
      if (n === "aria-pressed") this.pressed = v;
    },
  }));
  for (const b of muteButtons) b.classList.owner = b;
  const document = {
    getElementById: (id: string) => proxies.get(id),
    querySelectorAll: (sel: string) => (sel === ".mutebtn" ? muteButtons : []),
    addEventListener: (n: string, f: (e: unknown) => void) => {
      if (n === "click") docClick = f;
    },
    body: {
      classList: {
        toggle: (c: string, on: boolean) => (on ? bodyClasses.add(c) : bodyClasses.delete(c)),
      },
    },
  };
  const { sent, sockets } = runPage({ document });
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
    muteButtons,
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

  test("an App title's card shows its saved art (fetched from Couch by key) and the App's badge", () => {
    const art = "0123456789abcdef0123456789abcdef01234567";
    idle({
      layout: "home",
      where: "Home",
      continueCard: {
        ...card,
        thumbKey: art,
        app: { id: "netflix", label: "Netflix", icon: "<svg>n</svg>" },
      },
    });
    expect(hidden("cw")).toBe(false);
    expect(page.els.get("cw-pic")!.style.backgroundImage).toBe(`url(/thumb/${art}.jpg?key=${"k"})`);
    expect(hidden("cw-app")).toBe(false);
    expect(page.els.get("cw-app")!.innerHTML).toBe("<svg>n</svg>");
    idle({ layout: "home", where: "Home", continueCard: card });
    expect(hidden("cw-app")).toBe(true);
  });

  test("holding the card removes it from Continue watching, and the tap after the hold does not resume", () => {
    vi.useFakeTimers();
    try {
      // The page takes its timers when it loads, so it loads again under the fake ones.
      page = loadPage();
      page.open();
      idle({ layout: "home", where: "Home", continueCard: card });
      const cw = page.els.get("cw")!;
      cw.handlers.pointerdown!();
      vi.advanceTimersByTime(800);
      expect(commands().at(-1)).toMatchObject({ command: "forgetContinue" });
      const sent = page.sent.length;
      cw.handlers.pointerup!();
      cw.handlers.click!({ stopImmediatePropagation() {} });
      expect(page.sent).toHaveLength(sent);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a quick tap on the card resumes", () => {
    vi.useFakeTimers();
    try {
      // The page takes its timers when it loads, so it loads again under the fake ones.
      page = loadPage();
      page.open();
      idle({ layout: "home", where: "Home", continueCard: card });
      const cw = page.els.get("cw")!;
      cw.handlers.pointerdown!();
      vi.advanceTimersByTime(100);
      cw.handlers.pointerup!();
      vi.advanceTimersByTime(1000);
      expect(commands().some((c) => c.command === "forgetContinue")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
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

  test("the update icon shows beside the gear on Home only while an update is ready", () => {
    idle({ layout: "home", where: "Home" });
    expect(hidden("upd")).toBe(true);
    idle({ layout: "home", where: "Home", updateReady: true });
    expect(hidden("upd")).toBe(false);
    expect(hidden("gear")).toBe(false);
    idle({ layout: "other", where: "Settings", view: "settings", updateReady: true });
    expect(hidden("upd")).toBe(true);
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
    idle({ volume: 30, muted: true });
    expect(page.els.get("id-vol-n")!.textContent).toBe("0");
    expect(page.els.get("id-vol")!.classes.has("muted")).toBe(true);
    idle({ volume: 30, muted: false });
    expect(page.els.get("id-vol-n")!.textContent).toBe("30");
    expect(page.els.get("id-vol")!.classes.has("muted")).toBe(false);
  });

  test("Mute shows the muted icon and marks pressed, then the speaker again", () => {
    idle({ muted: true });
    for (const b of page.muteButtons) {
      expect(b.innerHTML).toContain(ICON_PATHS.speakerMute);
      expect(b.pressed).toBe("true");
      expect(b.classes.has("on")).toBe(true);
    }
    idle({ muted: false });
    for (const b of page.muteButtons) {
      expect(b.innerHTML).toContain(ICON_PATHS.speaker);
      expect(b.innerHTML).not.toContain(ICON_PATHS.speakerMute);
      expect(b.pressed).toBe("false");
    }
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
  });

  describe("compact chips", () => {
    const off = { id: "off", label: "Off", on: false };
    const aria = (id: string) => page.els.get(id)!.attrs["aria-label"];
    const lit = (id: string) => page.els.get(id)!.classes.has("on");
    const t = (id: string) => page.els.get(id)!.textContent;

    test("subtitles on show the language code, lit; off show the icon only, unlit", () => {
      page.playing({ subtitles: [off, { id: "1", label: "English", lang: "en-US", on: true }] });
      expect(t("chip-subs-t")).toBe("EN");
      expect(lit("chip-subs")).toBe(true);
      expect(aria("chip-subs")).toBe("Subtitles: English");
      page.playing({
        subtitles: [
          { ...off, on: true },
          { id: "1", label: "English", on: false },
        ],
      });
      expect(t("chip-subs-t")).toBe("");
      expect(lit("chip-subs")).toBe(false);
      expect(aria("chip-subs")).toBe("Subtitles: Off");
    });

    test("a plain On switch (YouTube) is lit with no code", () => {
      page.playing({
        subtitles: [off, { id: "on", label: "On", on: true }],
      });
      expect(t("chip-subs-t")).toBe("");
      expect(lit("chip-subs")).toBe(true);
    });

    test("audio shows its tag's code, or the label's first letters without one", () => {
      page.playing({ audio: [{ id: "a", label: "Arabic stereo", lang: "ar", on: true }] });
      expect(t("chip-aud-t")).toBe("AR");
      expect(aria("chip-aud")).toBe("Audio: Arabic stereo");
      page.playing({ audio: [{ id: "a", label: "Español", on: true }] });
      expect(t("chip-aud-t")).toBe("ES");
      expect(lit("chip-aud")).toBe(false);
    });

    test("the same code shows for variants; the sheet keeps the full labels", () => {
      page.playing({ subtitles: [off, { id: "2", label: "English (CC)", on: true }] });
      expect(t("chip-subs-t")).toBe("EN");
      page.tap("chip-subs");
      expect(page.els.get("np-rows")!.innerHTML).toContain("English (CC)");
    });

    test("speed shows the icon only at 1×, and the speed, lit, otherwise", () => {
      page.playing({ speed: 1, speeds: [1, 1.5] });
      expect(t("chip-spd-t")).toBe("");
      expect(lit("chip-spd")).toBe(false);
      expect(aria("chip-spd")).toBe("Speed 1×");
      page.playing({ speed: 1.5, speeds: [1, 1.5] });
      expect(t("chip-spd-t")).toBe("1.5×");
      expect(lit("chip-spd")).toBe(true);
      expect(aria("chip-spd")).toBe("Speed 1.5×");
    });
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
    expect(page.els.get("np-vol-n")!.textContent).toBe("0");
    expect(page.els.get("np-vol")!.classes.has("muted")).toBe(true);
    for (const b of page.muteButtons) expect(b.innerHTML).toContain(ICON_PATHS.speakerMute);
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

  test("a Library video shows its TMDB art, never the Up Next frame, and the logo without art", () => {
    const upNext = [{ title: "Film", playing: true, thumbKey: "frame-1" }];
    const library = { id: "library", label: "Library", icon: "" };
    const art = page.els.get("np-art")!;
    page.playing({ artKey: "tmdb-poster-abc", app: library }, { upNext });
    expect(art.style.backgroundImage).toContain("/thumb/tmdb-poster-abc.jpg?key=");
    expect(art.style.backgroundImage).not.toContain("frame-1");
    page.playing({ app: library }, { upNext });
    expect(art.classes.has("has")).toBe(false);
    expect(art.style.backgroundImage).toBe("");
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

describe("Picture off on Now Playing", () => {
  const chip = () => page.els.get("chip-pic")!;

  test("an icon-only toggle: monitor when the picture is on; one tap asks the Screen to black out", () => {
    page.playing({});
    expect(hidden("chip-pic")).toBe(false);
    expect(chip().innerHTML).toContain(ICON_PATHS.monitorPlay);
    expect(chip().attrs["aria-label"]).toBe("Picture off");
    expect(chip().attrs["aria-pressed"]).toBe("false");
    page.tap("chip-pic");
    expect(commands().at(-1)).toMatchObject({ command: "setPictureOff", args: { on: true } });
    expect(hidden("np-sheet")).toBe(true);
  });

  test("while picture-off is on it shows the slashed monitor, lit, and one tap turns it back on", () => {
    page.playing({}, { pictureOff: true });
    expect(chip().innerHTML).toContain(ICON_PATHS.monitorSlash);
    expect(chip().attrs["aria-label"]).toBe("Picture off");
    expect(chip().attrs["aria-pressed"]).toBe("true");
    expect(chip().classes.has("on")).toBe(true);
    page.tap("chip-pic");
    expect(commands().at(-1)).toMatchObject({ command: "setPictureOff", args: { on: false } });
  });

  test("the lit state clears with the snapshot", () => {
    page.playing({}, { pictureOff: true });
    page.playing({}, { pictureOff: false });
    expect(chip().innerHTML).toContain(ICON_PATHS.monitorPlay);
    expect(chip().classes.has("on")).toBe(false);
  });
});

describe("Quick settings on the phone", () => {
  test("the idle top bar and Now Playing both have a Quick settings button that sends the command", () => {
    expect(REMOTE_PAGE).toContain('id="qs" data-cmd="quickSettings"');
    page.send({ ...page.base, layout: "home", view: "home" });
    page.tap("qs");
    page.playing({});
    page.tap("chip-qs");
    expect(commands().filter((c) => c.command === "quickSettings")).toHaveLength(2);
  });

  test("while the drawer is open the phone shows the D-pad, even over Now Playing", () => {
    page.playing({});
    expect(hidden("npad")).toBe(true);
    page.playing({}, { quickSettings: true });
    expect(hidden("npad")).toBe(false);
    expect(hidden("nowp")).toBe(true);
    page.playing({}, { quickSettings: false });
    expect(hidden("npad")).toBe(true);
  });
});

describe("Closing Quick settings from the phone's D-pad", () => {
  test("the D-pad bar shown while the drawer is open has its own Quick settings toggle", () => {
    page.playing({}, { quickSettings: true });
    expect(hidden("npad")).toBe(false);
    expect(page.els.get("npad-qs")?.attrs["data-cmd"]).toBe("quickSettings");
    page.tap("npad-qs");
    expect(commands().at(-1)).toMatchObject({ command: "quickSettings" });
  });

  test("the D-pad's return button closes the drawer instead of only leaving the pad", () => {
    page.playing({}, { quickSettings: true });
    page.tap("npad-back");
    expect(commands().filter((c) => c.command === "quickSettings")).toHaveLength(1);
  });

  test("without the drawer the return button still just goes back to Now Playing", () => {
    page.playing({});
    page.tap("chip-pad");
    page.tap("npad-back");
    expect(commands().filter((c) => c.command === "quickSettings")).toEqual([]);
  });
});

describe("the phone's general toast", () => {
  const toast = () => page.els.get("phone-toast")!;
  const home = (extra: Record<string, unknown>) =>
    page.send({ ...page.base, layout: "home", where: "Home", ...extra });
  beforeEach(() => {
    vi.useFakeTimers();
    page = loadPage();
    page.open();
  });
  afterEach(() => vi.useRealTimers());

  test("a snapshot's toast shows as a calm status message and dismisses by itself", () => {
    expect(PAGE_HTML).toMatch(/id="phone-toast"[^>]*role="status"[^>]*aria-live="polite"/);
    home({ toast: { text: "Copied 3 Netflix cookies", id: 1 } });
    expect(toast().textContent).toBe("Copied 3 Netflix cookies");
    expect(toast().classes.has("show")).toBe(true);
    vi.advanceTimersByTime(4000);
    expect(toast().classes.has("show")).toBe(false);
  });

  test("the same id is not shown twice; a new id is", () => {
    home({ toast: { text: "A", id: 1 } });
    vi.advanceTimersByTime(4000);
    home({ toast: { text: "A", id: 1 } });
    expect(toast().classes.has("show")).toBe(false);
    home({ toast: { text: "B", id: 2 } });
    expect(toast().textContent).toBe("B");
    expect(toast().classes.has("show")).toBe(true);
  });

  test("it shows in any view, also while Now Playing is up", () => {
    page.playing({}, { toast: { text: "Phone connected", id: 5 } });
    expect(toast().textContent).toBe("Phone connected");
    expect(toast().classes.has("show")).toBe(true);
  });
});

describe("a question with answers on the phone", () => {
  const question = {
    title: "Netflix now plays in sharper quality",
    body: "It needs its own sign-in.",
    buttons: ["Copy sign-in from Couch", "Sign in on Netflix", "Keep using Chromium"],
    focus: 0,
    phone: true,
  };
  const ask = (confirm: unknown) =>
    page.send({ ...page.base, layout: "home", where: "Home", typeAvailable: false, confirm });

  test("shows the title, the line and every answer, the first one focused", () => {
    ask(question);
    expect(hidden("ask")).toBe(false);
    const el = page.els.get("ask-title")!;
    expect(el.textContent).toBe(question.title);
    expect(page.els.get("ask-body")!.textContent).toBe(question.body);
    const html = page.els.get("ask-btns")!.innerHTML;
    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html).toContain("Copy sign-in from Couch");
    expect(html).toContain("Keep using Chromium");
    expect(html.match(/hero/g)).toHaveLength(1);
    expect(html.indexOf("hero")).toBeLessThan(html.indexOf("Sign in on Netflix"));
  });

  test("an answer is sent by its place, with the question it answers", () => {
    ask(question);
    const html = page.els.get("ask-btns")!.innerHTML;
    expect(html).toContain('data-cmd="confirmAnswer"');
    const args = [...html.matchAll(/data-args="([^"]*)"/g)].map((m) =>
      JSON.parse(m[1]!.replace(/&quot;/g, '"').replace(/&amp;/g, "&")),
    );
    expect(args).toEqual([0, 1, 2].map((index) => ({ index, text: question.title })));
  });

  test("goes when the question does, and other questions get no buttons", () => {
    ask(question);
    ask(undefined);
    expect(hidden("ask")).toBe(true);
    ask({ title: "Quit Couch?", buttons: ["Cancel", "Quit"], focus: 0 });
    expect(hidden("ask")).toBe(true);
  });
});

describe("the Apps row", () => {
  const icon = (n: string) => `<svg class="i" data-n="${n}"></svg>`;
  const apps = ["YouTube", "Netflix", "Library"].map((label) => ({
    id: label.toLowerCase(),
    label,
    icon: icon(label),
  }));
  const home = (extra: Record<string, unknown> = {}) =>
    page.send({
      ...page.base,
      layout: "home",
      where: "Home",
      typeAvailable: false,
      apps,
      ...extra,
    });
  const buttons = () => [
    ...page.els
      .get("apps")!
      .innerHTML.matchAll(/<button[^>]*aria-label="([^"]+)"[^>]*>(.*?)<\/button>/g),
  ];

  test("sits in the idle controls above the D-pad, in its own block", () => {
    const main = REMOTE_PAGE.slice(
      REMOTE_PAGE.indexOf('<main id="controls">'),
      REMOTE_PAGE.indexOf("</main>"),
    );
    expect(main.indexOf('id="apps"')).toBeGreaterThan(-1);
    expect(main.indexOf('id="apps"')).toBeLessThan(main.indexOf('id="dpad"'));
  });

  test("one labelled button per shown App, in Home order, with its icon", () => {
    home();
    expect(hidden("apps")).toBe(false);
    expect(buttons().map((m) => m[1])).toEqual(["Open YouTube", "Open Netflix", "Open Library"]);
    const html = page.els.get("apps")!.innerHTML;
    expect(html.indexOf("YouTube")).toBeLessThan(html.indexOf("Netflix"));
    expect(html.indexOf("Netflix")).toBeLessThan(html.indexOf("Library"));
    expect(html).toContain('data-n="Netflix"');
    expect(html).toContain('<span class="n">Library</span>');
  });

  test("a tap sends openApp with the App's id", () => {
    home();
    const html = page.els.get("apps")!.innerHTML;
    const args = html
      .match(/data-args="([^"]+)"/g)!
      .map((a) => JSON.parse(a.slice(11, -1).replace(/&quot;/g, '"')));
    expect(args).toEqual([{ app: "youtube" }, { app: "netflix" }, { app: "library" }]);
    page.tapRow("openApp", args[1]);
    expect(commands()).toEqual([{ type: "command", command: "openApp", args: { app: "netflix" } }]);
  });

  test("a label with markup is escaped", () => {
    home({ apps: [{ id: "x", label: '<b>"x"', icon: icon("x") }] });
    expect(page.els.get("apps")!.innerHTML).not.toContain("<b>");
    expect(page.els.get("apps")!.innerHTML).toContain("&lt;b&gt;&quot;x&quot;");
  });

  test("scrolls sideways past 4 Apps, and centres up to 4", () => {
    home();
    expect(page.els.get("apps")!.classes.has("few")).toBe(true);
    home({ apps: [1, 2, 3, 4, 5].map((n) => ({ id: `a${n}`, label: `A${n}`, icon: icon("a") })) });
    expect(page.els.get("apps")!.classes.has("few")).toBe(false);
    expect(REMOTE_PAGE).toMatch(/\.apps \{[^}]*overflow-x:auto/);
  });

  test("shown on any idle view, hidden while playing and with no Apps", () => {
    home();
    expect(hidden("apps")).toBe(false);
    page.playing({}, { layout: "app", apps });
    expect(hidden("apps")).toBe(true);
    home({ apps: [] });
    expect(hidden("apps")).toBe(true);
    page.send({ ...page.base, layout: "app", typing: "none", apps });
    expect(hidden("apps")).toBe(false);
    page.send({ ...page.base, layout: "other", where: "Library", apps });
    expect(hidden("apps")).toBe(false);
  });

  test("dims and stops taps when Couch is off, like the rest of the controls", () => {
    home();
    page.send({ type: "power", state: "off" });
    expect(page.bodyClasses.has("off")).toBe(true);
    expect(REMOTE_PAGE).toMatch(/\.off main \{[^}]*pointer-events:none/);
  });

  test("the row is not redrawn when only the volume changes", () => {
    home();
    const el = page.els.get("apps")!;
    el.innerHTML = "marker";
    home({ volume: 50 });
    expect(el.innerHTML).toBe("marker");
  });
});
