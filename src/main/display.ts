export interface DisplayInfo {
  id: number;
  label: string;
  internal: boolean;
}

/** The external monitor if one is connected, otherwise the built-in screen. */
export function pickTargetDisplay<T extends DisplayInfo>(displays: T[]): T | undefined {
  return displays.find((d) => !d.internal) ?? displays[0];
}
