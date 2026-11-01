import type { Command, ScreenPayload } from "../shared/protocol.ts";

const PIXELS_PER_STEP = 60;
const COOLDOWN_MS = 90;
const IDLE_MS = 250;
const LINE_PIXELS = 100;
const PAGE_PIXELS = 400;

const WHEEL_VIEWS = new Set(["library", "folder", "show", "librarySearch"]);

/** The Library and its pages take the wheel, unless something is up over them (the player's wheel is volume). */
export function wheelScrolls(payload: ScreenPayload): boolean {
  if (!WHEEL_VIEWS.has(payload.state.view)) return false;
  return !payload.quick && !payload.state.confirm && !payload.state.pictureOff;
}

export interface WheelInput {
  deltaX: number;
  deltaY: number;
  /** DOM_DELTA_PIXEL 0, DOM_DELTA_LINE 1, DOM_DELTA_PAGE 2 */
  deltaMode: number;
}

/**
 * Turns the wheel and trackpad into arrow presses: one mouse notch is one step, a trackpad swipe steps
 * once per distance travelled, and a step starts a short cooldown so a flick (and its momentum tail)
 * moves a few rows rather than the whole page.
 */
export function wheelSteps(): (input: WheelInput, now: number) => Command | undefined {
  let sumX = 0;
  let sumY = 0;
  let last = -Infinity;
  let blockedUntil = -Infinity;
  return (input, now) => {
    if (now - last > IDLE_MS) sumX = sumY = 0;
    last = now;
    if (now < blockedUntil) return undefined;
    const scale = input.deltaMode === 1 ? LINE_PIXELS : input.deltaMode === 2 ? PAGE_PIXELS : 1;
    const dx = input.deltaX * scale;
    const dy = input.deltaY * scale;
    // A swipe is mostly one axis; the other one's drift must not step.
    if (Math.abs(dy) >= Math.abs(dx)) {
      sumY = Math.sign(sumY) === Math.sign(dy) ? sumY + dy : dy;
      sumX = 0;
    } else {
      sumX = Math.sign(sumX) === Math.sign(dx) ? sumX + dx : dx;
      sumY = 0;
    }
    const vertical = Math.abs(sumY) >= PIXELS_PER_STEP;
    const horizontal = Math.abs(sumX) >= PIXELS_PER_STEP;
    if (!vertical && !horizontal) return undefined;
    const sum = vertical ? sumY : sumX;
    sumX = sumY = 0;
    blockedUntil = now + COOLDOWN_MS;
    if (vertical) return { command: sum > 0 ? "down" : "up" };
    return { command: sum > 0 ? "right" : "left" };
  };
}
