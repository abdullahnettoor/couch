import { describe, expect, test } from "vite-plus/test";
import type { YouTubeEvent } from "../ports/youtube.ts";
import type { WebKitKey } from "./webkit-bridge.ts";
import { FLAG, WebKitKeyboard, domKey } from "./webkit-keyboard.ts";
import { KEY_CASES } from "./keyboard-policy.cases.ts";

let nextId = 1;
const byId = new Map<number, WebKitKey>();
const key = (over: Partial<WebKitKey> & { chars?: string }): WebKitKey => {
  const k = make(over);
  if (k.id > 0) byId.set(k.id, k);
  return k;
};
const make = (over: Partial<WebKitKey> & { chars?: string }): WebKitKey => ({
  id: nextId++,
  down: true,
  keyCode: 0,
  characters: over.chars ?? "",
  charactersIgnoringModifiers: over.chars ?? "",
  flags: 0,
  repeat: false,
  ...over,
});
const A = key({ keyCode: 0, chars: "a" });
const ARROW = FLAG.numericPad | FLAG.function;

function setup(opts: { gate?: (input: { key: string }) => boolean } = {}) {
  const out: YouTubeEvent[] = [];
  const replayed: WebKitKey[] = [];
  const answers: Array<[number, boolean]> = [];
  const state = { capturing: false, field: false, clipboard: "pasted" };
  const gate = opts.gate;
  const keyboard = new WebKitKeyboard({
    emit: (e) => out.push(e),
    answer: (id, replay) => {
      answers.push([id, replay]);
      if (replay) replayed.push(byId.get(id)!);
    },
    gate: gate ? (_e, input) => gate(input) : undefined,
    capturing: () => state.capturing,
    fieldFocused: () => state.field,
    readClipboard: () => state.clipboard,
  });
  return { keyboard, out, replayed, answers, state };
}

describe("domKey", () => {
  test("names the keys the way a KeyboardEvent does", () => {
    expect(domKey(key({ keyCode: 126, chars: "\uF700", flags: ARROW }))).toBe("ArrowUp");
    expect(domKey(key({ keyCode: 125, flags: ARROW }))).toBe("ArrowDown");
    expect(domKey(key({ keyCode: 123, flags: ARROW }))).toBe("ArrowLeft");
    expect(domKey(key({ keyCode: 124, flags: ARROW }))).toBe("ArrowRight");
    expect(domKey(key({ keyCode: 36, chars: "\r" }))).toBe("Enter");
    expect(domKey(key({ keyCode: 76, chars: "\u0003" }))).toBe("Enter");
    expect(domKey(key({ keyCode: 53, chars: "\u001b" }))).toBe("Escape");
    expect(domKey(key({ keyCode: 51, chars: "\u007f" }))).toBe("Backspace");
    expect(domKey(key({ keyCode: 48, chars: "\t" }))).toBe("Tab");
    expect(domKey(key({ keyCode: 49, chars: " " }))).toBe(" ");
  });
  test("letters keep their case and ignore Control and Command's own characters", () => {
    expect(domKey(key({ keyCode: 4, chars: "H", flags: FLAG.shift }))).toBe("H");
    expect(
      domKey({ ...A, characters: "\u0001", charactersIgnoringModifiers: "a", flags: FLAG.control }),
    ).toBe("a");
    expect(
      domKey({ ...A, characters: "f", charactersIgnoringModifiers: "f", flags: FLAG.command }),
    ).toBe("f");
  });
});

describe("Couch's keys go to the core, the rest go to the page", () => {
  test.each([
    [126, "up", ARROW],
    [125, "down", ARROW],
    [123, "left", ARROW],
    [124, "right", ARROW],
    [36, "ok", 0],
    [53, "back", 0],
    [49, "playpause", 0],
  ] as const)("key code %i is the %s command, swallowed", (keyCode, command, flags) => {
    const { keyboard, out, replayed } = setup();
    const chars = keyCode === 36 ? "\r" : keyCode === 53 ? "\u001b" : keyCode === 49 ? " " : "";
    keyboard.handle(key({ keyCode, chars, flags }));
    expect(out).toEqual([{ type: "key", command }]);
    expect(replayed).toEqual([]);
  });

  test("h and m are Home and Menu, in both cases", () => {
    const { keyboard, out } = setup();
    keyboard.handle(key({ keyCode: 4, chars: "h" }));
    keyboard.handle(key({ keyCode: 4, chars: "H", flags: FLAG.shift }));
    keyboard.handle(key({ keyCode: 46, chars: "m" }));
    expect(out).toEqual([
      { type: "key", command: "home" },
      { type: "key", command: "home" },
      { type: "key", command: "menu" },
    ]);
  });

  test("a key up of a Couch key does nothing, and is not replayed", () => {
    const { keyboard, out, replayed } = setup();
    keyboard.handle(key({ keyCode: 126, down: false, flags: ARROW }));
    expect(out).toEqual([]);
    expect(replayed).toEqual([]);
  });

  test("any other key, down and up, is replayed to the page and says physical input happened", () => {
    const { keyboard, out, replayed } = setup();
    keyboard.handle(key({ keyCode: 0, chars: "a" }));
    keyboard.handle(key({ keyCode: 0, chars: "a", down: false }));
    expect(replayed.map((k) => [k.keyCode, k.down])).toEqual([
      [0, true],
      [0, false],
    ]);
    expect(out).toEqual([{ type: "input" }]);
  });

  test("a replayed key is the very key that came in", () => {
    const { keyboard, replayed } = setup();
    const k = key({ keyCode: 8, chars: "c", flags: FLAG.shift, repeat: true });
    keyboard.handle(k);
    expect(replayed).toEqual([k]);
  });

  test("Control, Option or Command with a Couch key is the page's", () => {
    const { keyboard, out, replayed } = setup();
    keyboard.handle(key({ keyCode: 36, chars: "\r", flags: FLAG.control }));
    keyboard.handle(key({ keyCode: 4, chars: "h", flags: FLAG.option }));
    expect(out.filter((e) => e.type === "key")).toEqual([]);
    expect(replayed).toHaveLength(2);
  });

  test("/ and ⌘F open the search bar and don't reach the page", () => {
    const { keyboard, out, replayed } = setup();
    keyboard.handle(key({ keyCode: 44, chars: "/" }));
    keyboard.handle(key({ keyCode: 3, chars: "f", flags: FLAG.command, id: 0 }));
    expect(out).toEqual([{ type: "find" }, { type: "find" }]);
    expect(replayed).toEqual([]);
  });

  test("a Command key that was not swallowed is never replayed (it already reached the view)", () => {
    const { keyboard, replayed } = setup();
    keyboard.handle(key({ keyCode: 9, chars: "v", flags: FLAG.command, id: 0 }));
    expect(replayed).toEqual([]);
  });
});

describe("a text field in the page has focus", () => {
  test("everything but Escape and ⌘F is the field's: h, m, Space, / and Enter are typed", () => {
    const { keyboard, out, replayed, state } = setup();
    state.field = true;
    for (const k of [
      key({ keyCode: 4, chars: "h" }),
      key({ keyCode: 46, chars: "m" }),
      key({ keyCode: 49, chars: " " }),
      key({ keyCode: 44, chars: "/" }),
      key({ keyCode: 36, chars: "\r" }),
    ])
      keyboard.handle(k);
    expect(replayed).toHaveLength(5);
    expect(out.every((e) => e.type === "input")).toBe(true);
  });

  test("Escape stays Back and ⌘F stays find", () => {
    const { keyboard, out, replayed, state } = setup();
    state.field = true;
    keyboard.handle(key({ keyCode: 53, chars: "\u001b" }));
    keyboard.handle(key({ keyCode: 3, chars: "f", flags: FLAG.command, id: 0 }));
    expect(out).toEqual([{ type: "key", command: "back" }, { type: "find" }]);
    expect(replayed).toEqual([]);
  });
});

describe("Couch is capturing typed text (its own search sheet)", () => {
  test("keys become edits for the core and never reach the page", () => {
    const { keyboard, out, replayed, state } = setup();
    state.capturing = true;
    keyboard.handle(key({ keyCode: 4, chars: "h" }));
    keyboard.handle(key({ keyCode: 51, chars: "\u007f" }));
    keyboard.handle(key({ keyCode: 51, chars: "\u007f", flags: FLAG.option }));
    keyboard.handle(key({ keyCode: 36, chars: "\r" }));
    keyboard.handle(key({ keyCode: 53, chars: "\u001b" }));
    keyboard.handle(key({ keyCode: 4, chars: "h", down: false }));
    expect(out).toEqual([
      { type: "edit", edit: { insert: "h" } },
      { type: "edit", edit: { erase: "char" } },
      { type: "edit", edit: { erase: "word" } },
      { type: "edit", edit: { done: "submit" } },
      { type: "edit", edit: { done: "cancel" } },
    ]);
    expect(replayed).toEqual([]);
  });

  test("⌘V inserts the clipboard", async () => {
    const { keyboard, out, state } = setup();
    state.capturing = true;
    keyboard.handle(key({ keyCode: 9, chars: "v", flags: FLAG.command }));
    await Promise.resolve();
    await Promise.resolve();
    expect(out).toEqual([{ type: "edit", edit: { insert: "pasted" } }]);
  });

  test("an empty clipboard inserts nothing", async () => {
    const { keyboard, out, state } = setup();
    state.capturing = true;
    state.clipboard = "";
    keyboard.handle(key({ keyCode: 9, chars: "v", flags: FLAG.command }));
    await Promise.resolve();
    await Promise.resolve();
    expect(out).toEqual([]);
  });
});

describe("the key gate (Quick settings, Picture off) is asked first", () => {
  test("a key it handles goes nowhere else", () => {
    const seen: string[] = [];
    const { keyboard, out, replayed } = setup({
      gate: (input) => {
        seen.push(input.key);
        return true;
      },
    });
    keyboard.handle(key({ keyCode: 126, flags: ARROW }));
    keyboard.handle(A);
    expect(seen).toEqual(["ArrowUp", "a"]);
    expect(out).toEqual([]);
    expect(replayed).toEqual([]);
  });

  test("it sees the key's modifiers and whether it is down or up", () => {
    const seen: unknown[] = [];
    const { keyboard } = setup({
      gate: (input) => {
        seen.push(input);
        return false;
      },
    });
    keyboard.handle(
      key({
        keyCode: 3,
        chars: "f",
        flags: FLAG.command | FLAG.shift,
        down: false,
        id: 0,
      }),
    );
    expect(seen).toEqual([
      { type: "keyUp", key: "f", meta: true, control: false, alt: false, shift: true },
    ]);
  });

  test("a key it lets by follows the ordinary rules", () => {
    const { keyboard, out } = setup({ gate: () => false });
    keyboard.handle(key({ keyCode: 36, chars: "\r" }));
    expect(out).toEqual([{ type: "key", command: "ok" }]);
  });
});

const NAMED_CODE: Record<string, number> = {
  ArrowUp: 126,
  ArrowDown: 125,
  ArrowLeft: 123,
  ArrowRight: 124,
  Enter: 36,
  Escape: 53,
  Backspace: 51,
  " ": 49,
};

describe("the shared keyboard rules, through the WebKit adapter", () => {
  test.each(KEY_CASES)("$name", ({ input, state, events, page }) => {
    const {
      keyboard,
      out,
      answers,
      state: host,
    } = setup({ gate: state.gate ? () => true : undefined });
    host.capturing = state.capturing ?? false;
    host.field = state.fieldFocused ?? false;
    const flags =
      (input.meta ? FLAG.command : 0) |
      (input.control ? FLAG.control : 0) |
      (input.alt ? FLAG.option : 0) |
      (input.shift ? FLAG.shift : 0);
    const k = key({
      keyCode: NAMED_CODE[input.key] ?? 0,
      chars: NAMED_CODE[input.key] === undefined ? input.key : "",
      flags,
      down: input.type === "keyDown",
    });
    keyboard.handle(k);
    expect(out).toEqual(events);
    expect(answers).toEqual([[k.id, page]]);
  });
});
