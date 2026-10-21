import type { ListenerLoginItem } from "./login-item.ts";

export interface DisplayInfo {
  id: number;
  label: string;
  internal: boolean;
}

/** A sound output the Mac can play to; `uid` is its CoreAudio UID. */
export interface OutputDevice {
  uid: string;
  name: string;
}

/** The Mac port: system services. */
export interface Mac {
  /** The sound outputs now connected (read-only; never changes the Mac's own output). */
  listOutputDevices(): Promise<OutputDevice[]>;
  /** Calls back when an output appears or disappears. */
  onOutputDevicesChanged(listener: () => void): () => void;
  keepAwake(keep: boolean): void;
  keepDisplayAwake(keep: boolean): void;
  wakeDisplay(): void;
  listDisplays(): DisplayInfo[];
  /** Calls back when a display is plugged in, unplugged or rearranged. */
  onDisplaysChanged(listener: () => void): () => void;
  /** Move the Screen window to the display with this id. */
  moveScreenTo(displayId: number): void;
  /** Resolves to the chosen folder, or undefined when cancelled. */
  pickFolder(): Promise<string | undefined>;
  /** The Mac's Bonjour name, e.g. "Living-Room-Mac.local". */
  localName(): string;
  /** How the Mac shows times of day: "12" (9:41 PM) or "24" (21:41). */
  timeFormat(): "12" | "24";
  /** Calls back when the Mac's 12/24-hour setting may have changed. */
  onTimeFormatChanged(listener: () => void): () => void;
  /** Whether the listener starts at login (a LaunchAgent); unavailable outside the installed Couch.app. */
  listenerLoginItem(): Promise<ListenerLoginItem>;
  setListenerLoginItem(on: boolean): Promise<void>;
  quit(): void;
}
