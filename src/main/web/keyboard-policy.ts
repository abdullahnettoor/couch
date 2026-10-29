import { SCREEN_KEYS, textEditFor, type TextEdit } from "../../shared/keyboard.ts";
import type { CommandName } from "../../shared/protocol.ts";
import { keyBelongsToField } from "./field-keys.ts";

/** One physical key on the Mac keyboard, in the terms of Electron's `before-input-event` (`WebKitKeyboard` converts a native key to this). */
export interface KeyInput {
  /** `keyDown` or `keyUp`. */
  type: string;
  key: string;
  meta?: boolean;
  control?: boolean;
  alt?: boolean;
  shift?: boolean;
}

/** Asked first about every physical key on the page (Quick settings and Picture off take keys here); true means it was handled. */
export type KeyGate = (event: { preventDefault(): void }, input: KeyInput) => boolean;

/** What the host knows when a physical key arrives. */
export interface KeyContext {
  gate: KeyGate | undefined;
  /** Couch takes the typed text itself (its own search sheet). */
  capturing: boolean;
  /** A text field in the page has focus. */
  fieldFocused: boolean;
}

/**
 * What a physical key means. Both hosts decide with this and only apply the outcome (Electron's
 * `before-input-event`, `WebKitKeyboard` for native keys), so the rules cannot drift apart.
 * - `gate`: the gate took it (it has already blocked the page).
 * - `typed`: Couch is capturing text: the page never gets it. `edit` is what it types (none on a key release or an unknown key).
 * - `find`: Couch opens its search bar; the page doesn't get it.
 * - `command`: Couch's own key (a Screen command); the page doesn't get it. Only a key press runs it.
 * - `page`: the page's (a key press says physical input happened).
 */
export type KeyDecision =
  | { kind: "gate" }
  | { kind: "typed"; edit: TextEdit | undefined }
  | { kind: "find" }
  | { kind: "command"; command: CommandName }
  | { kind: "page" };

export function decideKey(
  input: KeyInput,
  context: KeyContext,
  event: { preventDefault(): void },
): KeyDecision {
  if (context.gate?.(event, input)) return { kind: "gate" };
  const meta = input.meta ?? false;
  const control = input.control ?? false;
  const alt = input.alt ?? false;
  if (context.capturing) {
    if (input.type !== "keyDown") return { kind: "typed", edit: undefined };
    return {
      kind: "typed",
      edit: textEditFor({ key: input.key, meta, ctrl: control, alt }),
    };
  }
  if (context.fieldFocused && keyBelongsToField({ key: input.key, meta })) return { kind: "page" };
  if (input.type === "keyDown" && !control && !alt) {
    const find = meta ? input.key.toLowerCase() === "f" : input.key === "/";
    if (find) return { kind: "find" };
  }
  const command = SCREEN_KEYS[input.key];
  if (!command || control || meta || alt) return { kind: "page" };
  return { kind: "command", command };
}
