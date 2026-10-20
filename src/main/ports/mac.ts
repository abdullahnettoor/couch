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
  /** Resolves to the chosen folder, or undefined when cancelled. */
  pickFolder(): Promise<string | undefined>;
  quit(): void;
}
