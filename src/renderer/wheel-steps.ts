import type { Command, ScreenPayload } from "../shared/protocol.ts";

const PIXELS_PER_STEP = 60;
const COOLDOWN_MS = 90;
const IDLE_MS = 250;
const NOTCH_PIXELS = 50;
const NOTCH_UNIT_PIXELS = 100;
const NOTCH_PIXELS_QUIET_MS = 100;
const MAX_NOTCH_STEPS = 3;
const TAIL_FRACTION = 0.5;
const TAIL_RISE = 1.5;

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
 * Turns the wheel and trackpad into arrow presses.
 *
 * Notch rule (the one place): input is a mouse-wheel notch when deltaMode is lines or pages, or when a
 * pixel delta on its axis is at least NOTCH_PIXELS and no small trackpad-sized delta came just before.
 * A notch is never dropped: it steps once per notch (a line, a page, or 100px), no cooldown, and an
 * accelerated or coalesced event steps up to MAX_NOTCH_STEPS times.
 *
 * Everything else is trackpad: distance accumulates and steps once per PIXELS_PER_STEP, with a short
 * cooldown. After a step, the same-direction momentum tail (deltas decaying well below the gesture's
 * peak) is ignored until the input pauses, reverses or rises again.
 */
export function wheelSteps(): (input: WheelInput, now: number) => Command[] {
  let sumX = 0;
  let sumY = 0;
  let last = -Infinity;
  let lastSmall = -Infinity;
  let blockedUntil = -Infinity;
  let peak = 0;
  let prevAbs = 0;
  let tail: { vertical: boolean; sign: number } | undefined;
  const reset = () => {
    sumX = sumY = peak = prevAbs = 0;
    tail = undefined;
  };
  return (input, now) => {
    if (now - last > IDLE_MS) reset();
    last = now;
    const vertical = Math.abs(input.deltaY) >= Math.abs(input.deltaX);
    const delta = vertical ? input.deltaY : input.deltaX;
    if (delta === 0) return [];
    const sign = Math.sign(delta);
    const names = vertical ? (["up", "down"] as const) : (["left", "right"] as const);
    const command: Command = { command: names[sign > 0 ? 1 : 0] };

    const discrete = input.deltaMode !== 0;
    if (discrete || (Math.abs(delta) >= NOTCH_PIXELS && now - lastSmall > NOTCH_PIXELS_QUIET_MS)) {
      reset();
      const notches = discrete ? Math.abs(delta) : Math.abs(delta) / NOTCH_UNIT_PIXELS;
      const steps = Math.min(MAX_NOTCH_STEPS, Math.max(1, Math.round(notches)));
      return Array.from({ length: steps }, () => command);
    }

    lastSmall = now;
    const abs = Math.abs(delta);
    const axisSum = vertical ? sumY : sumX;
    const reversed =
      (tail && (tail.vertical !== vertical || tail.sign !== sign)) ||
      (axisSum !== 0 && Math.sign(axisSum) !== sign);
    if (reversed || (!vertical && sumY !== 0) || (vertical && sumX !== 0)) {
      sumX = sumY = peak = 0;
      tail = undefined;
    }
    if (tail) {
      if (abs < peak * TAIL_FRACTION && abs <= prevAbs * TAIL_RISE) {
        prevAbs = abs;
        return [];
      }
      tail = undefined;
      peak = 0;
    }
    prevAbs = abs;
    peak = Math.max(peak, abs);
    if (now < blockedUntil) return [];
    if (vertical) sumY += delta;
    else sumX += delta;
    if (Math.abs(vertical ? sumY : sumX) < PIXELS_PER_STEP) return [];
    sumX = sumY = 0;
    blockedUntil = now + COOLDOWN_MS;
    tail = { vertical, sign };
    return [command];
  };
}
