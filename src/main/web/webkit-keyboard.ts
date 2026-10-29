import type { YouTubeEvent } from "../ports/youtube.ts";
import { decideKey, type KeyGate, type KeyInput } from "./keyboard-policy.ts";
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
  /** Answers a held key: give it to the page (`true`), or Couch has taken it (`false`). Called once for every held key. */
  answer(id: number, replay: boolean): void;
  gate: KeyGate | undefined;
  /** Couch is taking the typed text itself (its own search sheet). */
  capturing(): boolean;
  /** A text field in the page has focus. */
  fieldFocused(): boolean;
  readClipboard(): string | Promise<string>;
}

/**
 * The adapter from native keys to the shared keyboard rules (`decideKey`, also what `ElectronWebApp` applies). A key
 * with an `id` is held back by the native side until this answers it; one without has already reached the page.
 */
export class WebKitKeyboard {
  #hooks: WebKitKeyboardHooks;

  constructor(hooks: WebKitKeyboardHooks) {
    this.#hooks = hooks;
  }

  handle(key: WebKitKey): void {
    const hooks = this.#hooks;
    const input: KeyInput = {
      type: key.down ? "keyDown" : "keyUp",
      key: domKey(key),
      meta: (key.flags & FLAG.command) !== 0,
      control: (key.flags & FLAG.control) !== 0,
      alt: (key.flags & FLAG.option) !== 0,
      shift: (key.flags & FLAG.shift) !== 0,
    };
    const decision = decideKey(
      input,
      { gate: hooks.gate, capturing: hooks.capturing(), fieldFocused: hooks.fieldFocused() },
      { preventDefault() {} },
    );
    let toPage = false;
    switch (decision.kind) {
      case "gate":
        break;
      case "typed": {
        const edit = decision.edit;
        if (edit && "paste" in edit) {
          void Promise.resolve(hooks.readClipboard()).then((text) => {
            if (text) hooks.emit({ type: "edit", edit: { insert: text } });
          });
        } else if (edit) hooks.emit({ type: "edit", edit });
        break;
      }
      case "find":
        hooks.emit({ type: "find" });
        break;
      case "command":
        if (key.down) hooks.emit({ type: "key", command: decision.command });
        break;
      case "page":
        toPage = true;
        if (key.down) hooks.emit({ type: "input" });
        break;
    }
    if (key.id > 0) hooks.answer(key.id, toPage);
  }
}
