import type { Command } from "../shared/protocol.ts";
import { screenKeyCommand, type KeyInput } from "../shared/keyboard.ts";

/**
 * What a Mac key does on the Screen. While Picture off is on, only Space and the media play/pause key
 * act (as play/pause); every other key is swallowed and just turns the picture back on.
 */
export function keyCommand(
  input: KeyInput,
  pictureOff: boolean,
  typing: boolean,
  drawerOpen = false,
): Command | undefined {
  const mapped = screenKeyCommand(input, typing);
  // The Quick settings drawer is above the cover: its keys are its own, and the picture stays off.
  if (!pictureOff || drawerOpen) return mapped;
  if (mapped?.command === "playpause") return mapped;
  return { command: "setPictureOff", args: { on: false } };
}
