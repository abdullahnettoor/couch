/** Pixels in one design unit: the Screen is designed at 1920 × 1080 and scaled by whichever side runs out first. Matches `--u` in glass.css. */
export function designUnit(width: number, height: number): number {
  return Math.min(width / 1920, height / 1080);
}
