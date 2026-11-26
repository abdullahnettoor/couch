import { describe, expect, test } from "vite-plus/test";
import { PAGE_HTML, runPage } from "./page-runner.ts";

interface El {
  id: string;
  hidden: boolean;
  attrs: Record<string, string>;
  handlers: Record<string, (e?: unknown) => void>;
  classes: Set<string>;
  [key: string]: unknown;
}

/** The page's script on a minimal DOM, with a clock, animation frames and vibration under the test's control. */
function load() {
  const els = new Map<string, El>();
  for (const m of PAGE_HTML.matchAll(/<(\w+)([^>]*?\sid="([^"]+)"[^>]*)>/g)) {
    const attrs: Record<string, string> = {};
    for (const a of m[2]!.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]!] = a[2]!;
    els.set(m[3]!, {
      id: m[3]!,
      hidden: /\shidden[\s>]/.test(m[0]),
      attrs,
      handlers: {},
      classes: new Set((attrs.class ?? "").split(" ")),
      style: { setProperty() {} },
    });
  }
  const proxy = (e: El) =>
    new Proxy(e, {
      get(t, k: string) {
        if (k in t) return t[k];
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
        t[k] = v;
        return true;
      },
    });
  const proxies = new Map([...els].map(([k, v]) => [k, proxy(v)]));
  let docClick: ((e: unknown) => void) | undefined;

  let now = 1_000_000;
  const timers: Array<{ at: number; fn: () => void; dead: boolean }> = [];
  const frames: Array<(() => void) | undefined> = [];
  const buzzes: unknown[] = [];
  const advance = (ms: number) => {
    const target = now + ms;
    for (;;) {
      const next = timers.filter((t) => !t.dead && t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      now = next.at;
      next.dead = true;
      next.fn();
    }
    now = target;
  };
  const frame = () => {
    const due = frames.splice(0);
    for (const f of due) f?.();
  };

  const document = {
    getElementById: (id: string) => proxies.get(id),
    querySelectorAll: () => [],
    addEventListener: (n: string, f: (e: unknown) => void) => {
      if (n === "click") docClick = f;
    },
    body: { classList: { toggle() {} } },
  };
  const { sent, sockets } = runPage({
    document,
    Date: { now: () => now },
    setTimeout: (fn: () => void, ms: number) => {
      const t = { at: now + ms, fn, dead: false };
      timers.push(t);
      return t;
    },
    clearTimeout: (t?: { dead: boolean }) => {
      if (t) t.dead = true;
    },
    requestAnimationFrame: (fn: () => void) => frames.push(fn),
    cancelAnimationFrame: (id: number) => {
      frames[id - 1] = undefined;
    },
    navigator: { vibrate: (p: unknown) => buzzes.push(p) },
  });
  sockets[0]!.onopen?.();
  const snapshot = (extra: Record<string, unknown> = {}) =>
    sockets[0]!.onmessage!({
      data: JSON.stringify({
        type: "snapshot",
        where: "Home",
        layout: "home",
        typing: "none",
        volume: 30,
        muted: false,
        remotes: 1,
        typeAvailable: true,
        pointerAvailable: true,
        pointer: true,
        ...extra,
      }),
    });
  snapshot();
  const surface = els.get("tsurface")!;
  const down = (x: number, y: number, id = 1) =>
    surface.handlers.pointerdown?.({ pointerId: id, clientX: x, clientY: y });
  const move = (x: number, y: number, id = 1) =>
    surface.handlers.pointermove?.({ pointerId: id, clientX: x, clientY: y });
  const up = (x: number, y: number, id = 1) =>
    surface.handlers.pointerup?.({ pointerId: id, clientX: x, clientY: y });
  const commands = () =>
    sent.map((m) => JSON.parse(m) as { command: string; args?: Record<string, number> });
  const pointerCommands = () => commands().filter((c) => c.command.startsWith("pointer"));
  const tap = (id: string) => {
    const el = els.get(id)!;
    el.handlers.click?.();
    docClick?.({
      target: { closest: () => (el.attrs["data-cmd"] ? proxies.get(id) : null) },
    });
  };
  return {
    els,
    snapshot,
    down,
    move,
    up,
    advance,
    frame,
    buzzes,
    commands,
    pointerCommands,
    tap,
    sent,
  };
}

describe("the Remote's touchpad", () => {
  test("it shows in Pointer mode, in place of the D-pad, and offers the way back", () => {
    const p = load();
    expect(p.els.get("tpad")!.hidden).toBe(false);
    expect(p.els.get("controls")!.hidden).toBe(true);
    expect(p.els.get("ptoggle")!.hidden).toBe(true);
    p.snapshot({ pointer: undefined });
    expect(p.els.get("tpad")!.hidden).toBe(true);
    expect(p.els.get("controls")!.hidden).toBe(false);
    expect(p.els.get("ptoggle")!.hidden).toBe(false);
  });

  test("the toggle asks for Pointer mode on, and the touchpad's D-pad button for it off", () => {
    const p = load();
    p.tap("tp-dpad");
    expect(p.commands().at(-1)).toEqual({
      type: "command",
      command: "pointerMode",
      args: { on: false },
    });
    p.snapshot({ pointer: undefined });
    p.tap("ptoggle");
    expect(p.commands().at(-1)).toEqual({
      type: "command",
      command: "pointerMode",
      args: { on: true },
    });
  });

  test("with no pointer to use, no toggle is offered", () => {
    const p = load();
    p.snapshot({ pointer: undefined, pointerAvailable: undefined });
    expect(p.els.get("ptoggle")!.hidden).toBe(true);
    expect(p.els.get("tpad")!.hidden).toBe(true);
  });

  test("a drag past the slop sends moves, coalesced to one per animation frame", () => {
    const p = load();
    p.down(100, 100);
    p.move(104, 100);
    expect(p.pointerCommands()).toEqual([]);
    p.move(130, 100);
    p.move(150, 110);
    p.move(170, 120);
    expect(p.pointerCommands()).toEqual([]);
    p.frame();
    const moves = p.pointerCommands();
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ command: "pointerMove", args: { dx: 40, dy: 20 } });
    p.move(180, 120);
    p.frame();
    expect(p.pointerCommands()).toHaveLength(2);
  });

  test("lifting mid-frame sends what is owed at once, and a drag never clicks", () => {
    const p = load();
    p.down(100, 100);
    p.move(160, 100);
    p.move(200, 100);
    p.up(200, 100);
    expect(p.pointerCommands().map((c) => c.command)).toEqual(["pointerMove"]);
    expect(p.pointerCommands()[0]!.args).toEqual({ dx: 40, dy: 0 });
    p.advance(2000);
    expect(p.pointerCommands().map((c) => c.command)).toEqual(["pointerMove"]);
  });

  test("a drag that comes back to where it began still never clicks", () => {
    const p = load();
    p.down(100, 100);
    p.move(160, 100);
    p.move(100, 100);
    p.up(100, 100);
    expect(p.pointerCommands().map((c) => c.command)).not.toContain("pointerClick");
  });

  test("a quick lift with almost no movement is a tap: a click, and a short vibration", () => {
    const p = load();
    p.down(100, 100);
    p.advance(120);
    p.move(103, 102);
    p.up(103, 102);
    expect(p.pointerCommands()).toEqual([{ type: "command", command: "pointerClick" }]);
    expect(p.buzzes).toEqual([12]);
  });

  test("a press that is held a little and let go is neither a tap nor a long press", () => {
    const p = load();
    p.down(100, 100);
    p.advance(400);
    p.up(100, 100);
    expect(p.pointerCommands()).toEqual([]);
  });

  test("holding still for about 500 ms right-clicks, vibrates, and the lift adds no click", () => {
    const p = load();
    p.down(100, 100);
    p.advance(450);
    expect(p.pointerCommands()).toEqual([]);
    p.advance(100);
    expect(p.pointerCommands()).toEqual([{ type: "command", command: "pointerRightClick" }]);
    expect(p.buzzes).toEqual([12]);
    p.up(100, 100);
    expect(p.pointerCommands()).toHaveLength(1);
  });

  test("moving before 500 ms cancels the long press", () => {
    const p = load();
    p.down(100, 100);
    p.advance(300);
    p.move(160, 100);
    p.advance(1000);
    expect(p.pointerCommands().map((c) => c.command)).not.toContain("pointerRightClick");
  });

  test("only the first finger counts", () => {
    const p = load();
    p.down(100, 100, 1);
    p.down(300, 300, 2);
    p.move(400, 400, 2);
    p.frame();
    expect(p.pointerCommands()).toEqual([]);
  });

  test("the touchpad's top row keeps Back, Home, volume and Type", () => {
    const p = load();
    for (const [id, command] of [
      ["tp-back", "back"],
      ["tp-type", "typeOpen"],
    ] as const) {
      p.tap(id);
      expect(p.commands().at(-1)?.command).toBe(command);
    }
  });

  test("reaching the Screen's edge vibrates this phone once per arrival", () => {
    const p = load();
    p.snapshot({ edgeCue: 1 });
    expect(p.buzzes).toEqual([12]);
    p.snapshot({ edgeCue: 1 });
    expect(p.buzzes).toEqual([12]);
    p.snapshot({ edgeCue: 2 });
    expect(p.buzzes).toEqual([12, 12]);
    p.snapshot({ edgeCue: undefined });
    expect(p.buzzes).toHaveLength(2);
  });

  test("in Now Playing the D-pad button opens the touchpad, which has its way back", () => {
    const p = load();
    p.snapshot({
      layout: "app",
      nowPlaying: {
        title: "T",
        folder: "F",
        position: 1,
        duration: 10,
        paused: false,
        subtitlesOn: false,
        active: true,
      },
    });
    expect(p.els.get("tpad")!.hidden).toBe(true);
    expect(p.els.get("nowp")!.hidden).toBe(false);
    p.els.get("chip-pad")!.handlers.click!();
    expect(p.els.get("tpad")!.hidden).toBe(false);
    expect(p.els.get("npad")!.hidden).toBe(true);
    expect(p.els.get("tp-now")!.hidden).toBe(false);
    p.els.get("tp-now")!.handlers.click!();
    expect(p.els.get("nowp")!.hidden).toBe(false);
    expect(p.els.get("tpad")!.hidden).toBe(true);
  });
});
