import type { PointerInput } from "../shared/pointer.ts";

/** What Couch needs of a `webContents` to hand it a pointer event as real input (Electron's `sendInputEvent`). */
export interface InputTarget {
  sendInputEvent(event: {
    type: "mouseMove" | "mouseDown" | "mouseUp" | "mouseWheel";
    x: number;
    y: number;
    button?: "left" | "right";
    clickCount?: number;
    deltaX?: number;
    deltaY?: number;
  }): void;
}

/** The webContents behind each of Couch's own layers; undefined while that layer isn't there. */
export interface PointerTargets {
  page(): InputTarget | undefined;
  quick(): InputTarget | undefined;
}

/**
 * Hands a pointer event to the layer in front as the mouse events it would have made: they reach the page's own
 * handlers (hover, click, right-click, wheel) and never the Mac's real mouse. The App layer is not here: core calls the App directly.
 */
export function deliverPointerInput(input: PointerInput, targets: PointerTargets): void {
  const target =
    input.layer === "page" ? targets.page() : input.layer === "quick" ? targets.quick() : undefined;
  if (!target) return;
  const x = Math.round(input.x);
  const y = Math.round(input.y);
  switch (input.type) {
    case "move":
      target.sendInputEvent({ type: "mouseMove", x, y });
      break;
    case "click":
      target.sendInputEvent({ type: "mouseMove", x, y });
      target.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
      target.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
      break;
    case "rightClick":
      target.sendInputEvent({ type: "mouseMove", x, y });
      target.sendInputEvent({ type: "mouseDown", x, y, button: "right", clickCount: 1 });
      target.sendInputEvent({ type: "mouseUp", x, y, button: "right", clickCount: 1 });
      break;
    case "scroll":
      target.sendInputEvent({ type: "mouseWheel", x, y, deltaX: input.dx, deltaY: input.dy });
      break;
  }
}
