import { root } from "./dom.ts";

/** A web App is a native view on top of the Screen; this is only what shows while it loads. */
export function render(): void {
  root.replaceChildren();
}
