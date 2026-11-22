/** The household's Text size for a web App. */
export type TextSize = "smaller" | "default" | "larger";

export const TEXT_SIZE_MULTIPLIER: Record<TextSize, number> = {
  smaller: 0.85,
  default: 1,
  larger: 1.2,
};

/** Chromium's page zoom factor range. */
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;

/**
 * The page zoom for a window `windowWidth` points wide (never the display's pixels) and an App whose site
 * lays out best at `targetWidth` CSS px: fill the window, never below 1 before the size, times the size.
 */
export function textZoom(windowWidth: number, targetWidth: number, size: TextSize): number {
  const fit = Math.max(1, windowWidth / targetWidth);
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fit * TEXT_SIZE_MULTIPLIER[size]));
}
