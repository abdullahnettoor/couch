import type { GridItem, UiSound } from "../../shared/protocol.ts";
import type { Store } from "../ports/store.ts";
import { INTERFACE_SOUNDS_ID } from "../../shared/settings-grid.ts";

const KEY = "interface-sounds";
const TOGGLE = "sound:interface";

/**
 * Interface sounds: the soft clicks the Screen plays as focus moves in Couch's own views, On unless the
 * household turned them off (Settings → Sound output). Holds the one sound the command being handled asks for.
 */
export class InterfaceSounds {
  #store: Store;
  #on: boolean;
  #cue: UiSound | undefined;

  constructor(store: Store) {
    this.#store = store;
    this.#on = store.read<{ on?: unknown }>(KEY, {}).on !== false;
  }

  get on(): boolean {
    return this.#on;
  }

  /** The On/Off row, after Sound output's devices. */
  row(r: number): GridItem {
    return { id: INTERFACE_SOUNDS_ID, r, c: 0, label: "Interface sounds", action: TOGGLE };
  }

  action(action: string): boolean {
    if (action !== TOGGLE) return false;
    this.#on = !this.#on;
    this.#store.write(KEY, { on: this.#on });
    return true;
  }

  /** The command asks for this sound; a later cue in the same command wins (OK on a Back button sounds as Back). */
  cue(sound: UiSound): void {
    this.#cue = sound;
  }

  /** The sound asked for since the last take, if any. */
  take(): UiSound | undefined {
    const cue = this.#cue;
    this.#cue = undefined;
    return cue;
  }
}
