import type { BrowserWindow } from "electron";

/** A window that reports itself focused and visible although it sits offscreen, so hosts treat it as on screen. */
export function hiddenWindow(win: BrowserWindow): BrowserWindow {
  return new Proxy(win, {
    get(target, key) {
      if (key === "isFocused" || key === "isVisible") return () => true;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
