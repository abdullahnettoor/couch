export interface DisplayInfo {
  id: number;
  label: string;
  internal: boolean;
}

/** The Mac port: system services. */
export interface Mac {
  getVolume(): Promise<number>;
  setVolume(percent: number): Promise<void>;
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
  quit(): void;
}
