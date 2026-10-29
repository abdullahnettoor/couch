import { describe, expect, test } from "vite-plus/test";
import { decideKey, type KeyContext } from "./keyboard-policy.ts";

const ctx = (over: Partial<KeyContext> = {}): KeyContext => ({
  gate: undefined,
  capturing: false,
  fieldFocused: false,
  ...over,
});
const decide = (key: string, mods: object, over: Partial<KeyContext> = {}) =>
  decideKey({ type: "keyDown", key, ...mods }, ctx(over), { preventDefault() {} }).kind;

// The native side (input_policy.h) holds back, without asking, only the keys Couch can own: ⌘F and Escape are the only
// Command or field exceptions. These check that the rules in TypeScript agree, key by key.
describe("what the native side may leave alone", () => {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789/.,;'[]-=`\\".split("");

  test("a Command combination is Couch's only for ⌘F; every other one is the page's (or the menu's)", () => {
    for (const c of chars) {
      const kind = decide(c, { meta: true });
      expect(kind, `⌘${c}`).toBe(c === "f" ? "find" : "page");
    }
    for (const q of ["q", "h", "m", "w"]) expect(decide(q, { meta: true })).toBe("page");
  });

  test("with a page field focused, only Escape and ⌘F can be Couch's (the native side holds exactly those back)", () => {
    const named = ["ArrowUp", "ArrowDown", "Enter", "Backspace", "Tab", " ", "Escape", ...chars];
    for (const k of named) {
      const plain = decide(k, {}, { fieldFocused: true });
      expect(plain === "page", k).toBe(k !== "Escape");
      const cmd = decide(k, { meta: true }, { fieldFocused: true });
      if (cmd !== "page") expect(["f", "Escape"], `⌘${k}`).toContain(k);
    }
  });

  test("while Couch captures typed text, nothing is the page's", () => {
    for (const k of ["a", "Enter", "ArrowUp", "Escape"]) {
      expect(decide(k, {}, { capturing: true, fieldFocused: true })).toBe("typed");
      expect(decide(k, { meta: true }, { capturing: true })).toBe("typed");
    }
  });
});
