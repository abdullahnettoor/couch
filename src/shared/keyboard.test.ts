import { describe, expect, test } from "vite-plus/test";
import { applyEdit, screenKeyCommand, textEditFor } from "./keyboard.ts";

describe("Screen keys", () => {
  test("H is Home outside a field and a letter inside one", () => {
    expect(screenKeyCommand({ key: "h" }, false)).toEqual({ command: "home" });
    expect(screenKeyCommand({ key: "H" }, false)).toEqual({ command: "home" });
    expect(screenKeyCommand({ key: "h" }, true)).toBeUndefined();
    expect(screenKeyCommand({ key: " " }, true)).toBeUndefined();
  });

  test("⌘F finds; other printable keys are offered to the Library; modifiers never are", () => {
    expect(screenKeyCommand({ key: "f", meta: true }, false)).toEqual({ command: "find" });
    expect(screenKeyCommand({ key: "p" }, false)).toEqual({
      command: "screenKey",
      args: { text: "p" },
    });
    expect(screenKeyCommand({ key: "7" }, false)).toEqual({
      command: "screenKey",
      args: { text: "7" },
    });
    expect(screenKeyCommand({ key: "v", meta: true }, false)).toBeUndefined();
    expect(screenKeyCommand({ key: "Tab" }, false)).toBeUndefined();
    expect(screenKeyCommand({ key: "ArrowDown" }, false)).toEqual({ command: "down" });
  });

  test("in a field, Enter submits, Esc goes Back, Down goes to the results; the rest is the field's", () => {
    expect(screenKeyCommand({ key: "Enter" }, true)).toEqual({ command: "typeSubmit" });
    expect(screenKeyCommand({ key: "Escape" }, true)).toEqual({ command: "back" });
    expect(screenKeyCommand({ key: "ArrowDown" }, true)).toEqual({ command: "down" });
    expect(screenKeyCommand({ key: "ArrowLeft" }, true)).toBeUndefined();
    expect(screenKeyCommand({ key: "Backspace", alt: true }, true)).toBeUndefined();
    expect(screenKeyCommand({ key: "v", meta: true }, true)).toBeUndefined();
  });
});

describe("Text edits (YouTube key capture)", () => {
  test("maps keys", () => {
    expect(textEditFor({ key: "a" })).toEqual({ insert: "a" });
    expect(textEditFor({ key: " " })).toEqual({ insert: " " });
    expect(textEditFor({ key: "Backspace" })).toEqual({ erase: "char" });
    expect(textEditFor({ key: "Backspace", alt: true })).toEqual({ erase: "word" });
    expect(textEditFor({ key: "Backspace", meta: true })).toEqual({ erase: "all" });
    expect(textEditFor({ key: "v", meta: true })).toEqual({ paste: true });
    expect(textEditFor({ key: "Enter" })).toEqual({ done: "submit" });
    expect(textEditFor({ key: "Escape" })).toEqual({ done: "cancel" });
    expect(textEditFor({ key: "Shift" })).toBeUndefined();
    expect(textEditFor({ key: "ArrowUp" })).toBeUndefined();
    expect(textEditFor({ key: "a", meta: true })).toBeUndefined();
  });

  test("applies edits", () => {
    expect(applyEdit("kerala", { insert: "!" })).toBe("kerala!");
    expect(applyEdit("kerala", { erase: "char" })).toBe("keral");
    expect(applyEdit("kerala fish ", { erase: "word" })).toBe("kerala ");
    expect(applyEdit("kerala", { erase: "word" })).toBe("");
    expect(applyEdit("kerala", { erase: "all" })).toBe("");
    expect(applyEdit("a😀", { erase: "char" })).toBe("a");
    expect(applyEdit("x", { done: "submit" })).toBe("x");
  });
});
