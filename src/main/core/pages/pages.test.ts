import { describe, expect, test } from "vite-plus/test";
import type { ScreenState, View } from "../../../shared/protocol.ts";
import { devUpdates } from "../../ports/updates.ts";
import { MemoryStore } from "../../ports/store.ts";
import { AboutPage } from "./about-page.ts";
import { AddonsPage } from "./addons-page.ts";
import type { PageContext } from "./page.ts";

function fakeContext(): PageContext & { went: View[] } {
  const went: View[] = [];
  return {
    went,
    state: {} as ScreenState,
    go: (view) => void went.push(view),
    focus: { get: () => undefined, set: () => {}, clear: () => {} },
    viewKey: () => "",
    set: () => {},
    startTyping: () => {},
    stopTyping: () => {},
    toast: () => {},
    ask: () => {},
    cue: () => {},
    emit: () => {},
  };
}

describe("Page Back", () => {
  test("About goes back to Settings", () => {
    const ctx = fakeContext();
    const page = new AboutPage(ctx, {
      updates: devUpdates({ store: new MemoryStore(), version: "1.0.0" }),
      restart: () => {},
      runSetup: () => {},
    });
    const back = page.back();
    expect(back?.label).toBe("Settings");
    back?.act();
    expect(ctx.went).toEqual(["settings"]);
  });

  test("Add-ons is labelled YouTube and goes back to Settings → Apps", () => {
    const ctx = fakeContext();
    const page = new AddonsPage(ctx, {
      store: new MemoryStore(),
      apply: () => {},
      isFront: () => false,
    });
    const back = page.back();
    expect(back?.label).toBe("YouTube");
    back?.act();
    expect(ctx.went).toEqual(["settingsApps"]);
  });
});
