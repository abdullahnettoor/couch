import { root } from "./dom.ts";

/** The YouTube view is a native view on top of the Screen; this is only what shows while it loads. */
export function render(): void {
  root.replaceChildren();
}
