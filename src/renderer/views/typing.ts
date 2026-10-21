import type { ScreenPayload } from "../../shared/protocol.ts";
import { el } from "./dom.ts";

/**
 * The one real text input the Screen uses when its own keyboard types (a Screen typing session). Views
 * draw an empty slot where it belongs; it is moved into the new slot after each redraw, keeping its text,
 * caret and focus. The text goes to the core as typeText; for the TMDB key it is masked and drawn nowhere else.
 */
let input: HTMLInputElement | undefined;
let purpose: ScreenPayload["screenTyping"];
let selection: [number, number] = [0, 0];

const remember = () => {
  if (input) selection = [input.selectionStart ?? 0, input.selectionEnd ?? 0];
};

/** Where a view wants the input, if the Screen is typing. */
export function typingSlot(): HTMLElement {
  return el("span", "typing-slot");
}

export function isTypingTarget(target: EventTarget | null): boolean {
  return target !== null && target === input;
}

/** Called after each draw: put the input in its slot (or remove it) and keep it focused. */
export function syncTyping(payload: ScreenPayload, seed: string): void {
  const next = payload.screenTyping;
  if (!next) {
    input?.remove();
    input = undefined;
    purpose = undefined;
    return;
  }
  const slot = document.querySelector<HTMLElement>(".typing-slot");
  if (!slot) return;
  if (!input || purpose !== next) {
    input?.remove();
    input = el("input", "typing-input") as HTMLInputElement;
    input.type = next === "tmdbKey" ? "password" : "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = next === "tmdbKey" ? "Paste your TMDB key" : "Search your Library";
    input.value = next === "tmdbKey" ? "" : seed;
    selection = [input.value.length, input.value.length];
    input.addEventListener("input", () => {
      remember();
      window.couch.send({ command: "typeText", args: { text: input!.value } });
    });
    for (const type of ["keyup", "click", "select"]) input.addEventListener(type, remember);
    purpose = next;
  }
  slot.append(input);
  input.focus({ preventScroll: true });
  input.setSelectionRange(selection[0], selection[1]);
}
