import type { Command } from "../../shared/protocol.ts";

/** A phone's pointer movement and scrolling reach the core at most once each per this long. */
export const POINTER_COALESCE_MS = 16;

/**
 * Stands between one phone's socket and the core: pointerMove and pointerScroll messages are summed and delivered at most
 * once each per `POINTER_COALESCE_MS`, so a flood from one phone can't lag the Screen. Any other command first delivers the
 * movement owed before it, so the order the phone sent them in is kept.
 */
export class PointerCoalescer {
  #deliver: (command: Command) => void;
  #move: { dx: number; dy: number } | undefined;
  #scroll: { dx: number; dy: number } | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(deliver: (command: Command) => void) {
    this.#deliver = deliver;
  }

  push(command: Command): void {
    const key = command.command === "pointerMove" ? "#move" : "#scroll";
    if (command.command !== "pointerMove" && command.command !== "pointerScroll") {
      this.flush();
      this.#deliver(command);
      return;
    }
    const dx = command.args?.dx ?? 0;
    const dy = command.args?.dy ?? 0;
    const owed = key === "#move" ? this.#move : this.#scroll;
    const sum = { dx: (owed?.dx ?? 0) + dx, dy: (owed?.dy ?? 0) + dy };
    if (key === "#move") this.#move = sum;
    else this.#scroll = sum;
    this.#timer ??= setTimeout(() => this.flush(), POINTER_COALESCE_MS);
  }

  /** Delivers what is owed now. */
  flush(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    const move = this.#move;
    const scroll = this.#scroll;
    this.#move = this.#scroll = undefined;
    if (move) this.#deliver({ command: "pointerMove", args: move });
    if (scroll) this.#deliver({ command: "pointerScroll", args: scroll });
  }

  /** The phone is gone: what it still owed is dropped. */
  dispose(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#move = this.#scroll = undefined;
  }
}
