import type { GridItem, ScreenPayload } from "../../../shared/protocol.ts";
import type { InterfaceSounds } from "../interface-sounds.ts";
import type { SoundOutput } from "../sound-output.ts";
import { backTo, type Page, type PageBack, type PageContext } from "./page.ts";

export interface SoundOutputPageHost {
  sound: Pick<SoundOutput, "grid" | "payload" | "action">;
  uiSounds: Pick<InterfaceSounds, "row" | "on" | "action">;
}

/** Settings → Sound output: one row per device, then the Interface sounds On/Off row. */
export class SoundOutputPage implements Page {
  #ctx: PageContext;
  #h: SoundOutputPageHost;

  constructor(ctx: PageContext, host: SoundOutputPageHost) {
    this.#ctx = ctx;
    this.#h = host;
  }

  grid(): GridItem[] {
    const devices = this.#h.sound.grid();
    return [...devices, this.#h.uiSounds.row(devices.length)];
  }

  payload(): Partial<ScreenPayload> {
    return { sound: this.#h.sound.payload(), interfaceSounds: this.#h.uiSounds.on };
  }

  action(action: string): boolean {
    return this.#h.sound.action(action) || this.#h.uiSounds.action(action);
  }

  back(): PageBack {
    return backTo(this.#ctx, "settings");
  }
}
