import type { Command, CommandName } from "./protocol.ts";

/** The Mac keyboard's keys on the Screen, by KeyboardEvent.key. Backspace is left alone for typing. */
export const SCREEN_KEYS: Record<string, CommandName> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Enter: "ok",
  Escape: "back",
  h: "home",
  H: "home",
  " ": "playpause",
  m: "menu",
  M: "menu",
  ContextMenu: "menu",
};

export interface KeyInput {
  key: string;
  meta?: boolean;
  ctrl?: boolean;
  alt?: boolean;
}

const single = (key: string) => [...key].length === 1;

/**
 * What a key press on the Screen means. `typing` is true while a text field owns the keyboard (a Screen
 * typing session): then the field edits its own text and only Enter, Esc and Down leave it.
 */
export function screenKeyCommand(input: KeyInput, typing: boolean): Command | undefined {
  const { key } = input;
  if (typing) {
    if (key === "Enter") return { command: "typeSubmit" };
    if (key === "Escape") return { command: "back" };
    if (key === "ArrowDown") return { command: "down" };
    return undefined;
  }
  if (input.meta && !input.ctrl && !input.alt && (key === "f" || key === "F"))
    return { command: "find" };
  if (input.meta || input.ctrl || input.alt) return undefined;
  const command = SCREEN_KEYS[key];
  if (command) return { command };
  if (single(key)) return { command: "screenKey", args: { text: key } };
  return undefined;
}

/** One edit to text typed with the Mac keyboard where there is no field to do it (YouTube's search). */
export type TextEdit =
  | { insert: string }
  | { erase: "char" | "word" | "all" }
  /** ⌘V: the caller reads the clipboard and sends it as an insert. */
  | { paste: true }
  | { done: "submit" | "cancel" };

export function textEditFor(input: KeyInput): TextEdit | undefined {
  const { key } = input;
  if (key === "Enter") return { done: "submit" };
  if (key === "Escape") return { done: "cancel" };
  if (key === "Backspace") return { erase: input.meta ? "all" : input.alt ? "word" : "char" };
  if (input.meta && !input.ctrl && (key === "v" || key === "V")) return { paste: true };
  if (input.meta || input.ctrl) return undefined;
  return single(key) ? { insert: key } : undefined;
}

export function applyEdit(text: string, edit: TextEdit): string {
  if ("insert" in edit) return text + edit.insert;
  if (!("erase" in edit)) return text;
  if (edit.erase === "all") return "";
  if (edit.erase === "char") return [...text].slice(0, -1).join("");
  return text.replace(/\s+$/, "").replace(/\S+$/, "");
}
