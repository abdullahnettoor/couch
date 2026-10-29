import { SCREEN_KEYS, textEditFor } from "../../shared/keyboard.ts";
import type { YouTubeEvent } from "../ports/youtube.ts";
import { keyBelongsToField } from "./field-keys.ts";
import type { KeyGate } from "./electron-web-app.ts";
import type { WebKitKey } from "./webkit-bridge.ts";

/** `NSEvent.modifierFlags` bits. */
export const FLAG = {
  shift: 1 << 17,
  control: 1 << 18,
  option: 1 << 19,
  command: 1 << 20,
  numericPad: 1 << 21,
  function: 1 << 23,
} as const;

/** Mac virtual key codes that have a name of their own in `KeyboardEvent.key`. */
const NAMED: Record<number, string> = {
  126: "ArrowUp",
  125: "ArrowDown",
  123: "ArrowLeft",
  124: "ArrowRight",
  36: "Enter",
  76: "Enter",
  53: "Escape",
  51: "Backspace",
  117: "Delete",
  48: "Tab",
  49: " ",
  115: "Home",
  119: "End",
  116: "PageUp",
  121: "PageDown",
  110: "ContextMenu",
};

/** A physical key as `KeyboardEvent.key` (what Electron's `before-input-event` calls `input.key`). */
export function domKey(
  key: Pick<WebKitKey, "keyCode" | "characters" | "charactersIgnoringModifiers" | "flags">,
): string {
  const named = NAMED[key.keyCode];
  if (named) return named;
  const raw =
    key.flags & (FLAG.control | FLAG.command) ? key.charactersIgnoringModifiers : key.characters;
  const first = raw.codePointAt(0) ?? 0;
  return first > 0x1f && first !== 0x7f ? raw : "Unidentified";
}

export interface WebKitKeyboardHooks {
  emit(event: YouTubeEvent): void;
  /** Gives a key to the page, as the same native key it came in as. */
  replay(key: Omit<WebKitKey, "swallowed">): void;
  gate: KeyGate | undefined;
  /** Couch is taking the typed text itself (its own search sheet). */
  capturing(): boolean;
  /** A text field in the page has focus. */
  fieldFocused(): boolean;
  readClipboard(): string | Promise<string>;
}

/**
 * The Mac keyboard rules for a view whose keys the native side hands over (the view is the first responder, so
 * Chromium never sees them): the same as `ElectronWebApp`'s `before-input-event`. The gate (Quick settings, Picture
 * off) goes first; then typed text Couch captures; then a field in the page; then find; then Couch's own keys.
 * Everything else is replayed to the page.
 */
export class WebKitKeyboard {
  #hooks: WebKitKeyboardHooks;

  constructor(hooks: WebKitKeyboardHooks) {
    this.#hooks = hooks;
  }

  handle(key: WebKitKey): void {
    const hooks = this.#hooks;
    const name = domKey(key);
    const meta = (key.flags & FLAG.command) !== 0;
    const control = (key.flags & FLAG.control) !== 0;
    const alt = (key.flags & FLAG.option) !== 0;
    const shift = (key.flags & FLAG.shift) !== 0;
    const input = { type: key.down ? "keyDown" : "keyUp", key: name, meta, control, alt, shift };
    if (hooks.gate?.({ preventDefault() {} }, input)) return;
    if (hooks.capturing()) {
      if (!key.swallowed || !key.down) return;
      const edit = textEditFor({ key: name, meta, ctrl: control, alt });
      if (edit && "paste" in edit) {
        void Promise.resolve(hooks.readClipboard()).then((text) => {
          if (text) hooks.emit({ type: "edit", edit: { insert: text } });
        });
        return;
      }
      if (edit) hooks.emit({ type: "edit", edit });
      return;
    }
    const { swallowed: _swallowed, ...replayable } = key;
    // A key that was swallowed and isn't Couch's is the page's; one that was never held back already reached it.
    const toPage = () => {
      if (key.down) hooks.emit({ type: "input" });
      if (key.swallowed) hooks.replay(replayable);
    };
    if (hooks.fieldFocused() && keyBelongsToField({ key: name, meta })) return toPage();
    if (key.down && !control && !alt) {
      const find = meta ? name.toLowerCase() === "f" : name === "/";
      if (find) {
        hooks.emit({ type: "find" });
        return;
      }
    }
    const command = SCREEN_KEYS[name];
    if (!command || control || meta || alt) return toPage();
    if (key.down) hooks.emit({ type: "key", command });
  }
}
