import { GLASS } from "./look.ts";

/** Pixels in one design unit: the Screen is designed at `GLASS.metrics.base` and scaled by whichever side runs out first. `--u` is written from the same numbers. */
export function designUnit(width: number, height: number): number {
  const { base } = GLASS.metrics;
  return Math.min(width / base.width, height / base.height);
}
