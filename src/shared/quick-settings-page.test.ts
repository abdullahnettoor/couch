import { runInNewContext } from "node:vm";
import { describe, expect, test } from "vite-plus/test";
import type { QuickPayload } from "./protocol.ts";
import { quickSettingsPage } from "./quick-settings-page.ts";

function load() {
  const script = /<script>([\s\S]*)<\/script>/.exec(quickSettingsPage())![1]!;
  const drawer = { innerHTML: "", className: "", contains: (t: unknown) => t === drawer };
  const sent: unknown[] = [];
  const listeners: Record<string, (e: unknown) => void> = {};
  let onQuick!: (q: QuickPayload | undefined) => void;
  runInNewContext(script, {
    document: {
      getElementById: () => drawer,
      addEventListener: (n: string, f: (e: unknown) => void) => (listeners[n] = f),
    },
    window: {
      couch: {
        onQuick: (f: typeof onQuick) => (onQuick = f),
        send: (c: unknown) => sent.push(c),
      },
    },
    requestAnimationFrame: (f: () => void) => f(),
  });
  return { drawer, sent, listeners, onQuick };
}

const payload: QuickPayload = {
  items: [
    { id: "out:default", r: 0, c: 0, label: "System default", checked: true },
    { id: "out:x", r: 1, c: 0, label: "L27h-4A" },
    { id: "vol:down", r: 2, c: 0, label: "Volume down" },
    { id: "vol:up", r: 2, c: 1, label: "Volume up" },
    { id: "vol:mute", r: 2, c: 2, label: "Mute" },
    { id: "picture", r: 3, c: 0, label: "Picture off" },
    { id: "settings", r: 4, c: 0, label: "All settings" },
  ],
  focusedId: "out:x",
  volume: 60,
  muted: false,
};

describe("the Quick settings page", () => {
  test("draws the outputs, volume, Picture off and All settings, with the highlight", () => {
    const { drawer, onQuick } = load();
    onQuick(payload);
    expect(drawer.className).toBe("in");
    expect(drawer.innerHTML).toContain("System default");
    expect(drawer.innerHTML).toContain('class="row focus" data-id="out:x"');
    expect(drawer.innerHTML).toContain(">60<");
    expect(drawer.innerHTML).toContain("Picture off");
    expect(drawer.innerHTML).toContain("All settings");
  });

  test("leaves Picture off out when the core didn't offer it, and slides out on nothing", () => {
    const { drawer, onQuick } = load();
    onQuick({ ...payload, items: payload.items.filter((i) => i.id !== "picture") });
    expect(drawer.innerHTML).not.toContain("Picture off");
    onQuick(undefined);
    expect(drawer.className).toBe("");
  });

  test("a click on a row picks it; a click outside the drawer closes it", () => {
    const { listeners, sent, drawer, onQuick } = load();
    onQuick(payload);
    listeners.click!({
      target: { closest: () => ({ getAttribute: () => "out:x" }), id: "row" },
    });
    listeners.click!({ target: { closest: () => null } });
    listeners.click!({ target: drawer });
    expect(sent).toEqual([
      { command: "quickPick", args: { item: "out:x" } },
      { command: "quickClose" },
    ]);
  });
});
