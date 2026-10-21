import type { YouTubeKey } from "../../ports/youtube.ts";

/** YouTube TV scrubs 10 s per Left/Right once its controls are up; OK then commits the jump. */
export const SKIP_STEP_SECONDS = 10;
/** Controls hide a few seconds after the last key; a press then only wakes them. */
export const CONTROLS_HIDE_MS = 4000;
export const SKIP_COMMIT_MS = 1200;

/** The arrow presses for a skip: one extra wake-up press when the controls are probably hidden. */
export function skipKeys(seconds: number, controlsUp: boolean): YouTubeKey[] {
  const key: YouTubeKey = seconds < 0 ? "left" : "right";
  const steps = Math.max(1, Math.round(Math.abs(seconds) / SKIP_STEP_SECONDS));
  return [...(controlsUp ? [] : [key]), ...Array<YouTubeKey>(steps).fill(key)];
}
