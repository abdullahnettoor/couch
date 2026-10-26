import { describe, expect, test } from "vite-plus/test";
import type { Command } from "../shared/protocol.ts";
import { Channel } from "../shared/ipc.ts";
import { readFileSync } from "node:fs";
import { quickCommandFrom, wireQuickIpc } from "./quick-ipc.ts";

const ids = ["out:default", "out:Built-in", "vol", "picture", "settings"];

describe("what the drawer's page may ask for", () => {
  test("a pick of a row on the drawer, a volume button, or a close", () => {
    expect(quickCommandFrom({ command: "quickPick", args: { item: "out:Built-in" } }, ids)).toEqual(
      {
        command: "quickPick",
        args: { item: "out:Built-in" },
      },
    );
    expect(quickCommandFrom({ command: "quickPick", args: { item: "vol:up" } }, ids)).toEqual({
      command: "quickPick",
      args: { item: "vol:up" },
    });
    expect(quickCommandFrom({ command: "quickClose" }, ids)).toEqual({ command: "quickClose" });
  });

  test.each([
    ["an unrelated command", { command: "openSettings" }],
    ["a power command", { command: "power" }],
    ["a Screen command it may not send", { command: "quickEdge" }],
    ["a pick of a row that isn't there", { command: "quickPick", args: { item: "out:nope" } }],
    ["a pick with no args", { command: "quickPick" }],
    ["a pick with a non-string item", { command: "quickPick", args: { item: 5 } }],
    ["a pick with an object item", { command: "quickPick", args: { item: { toString: 1 } } }],
    ["a pick naming a prototype key", { command: "quickPick", args: { item: "constructor" } }],
    ["a pick with extra args", { command: "quickPick", args: { item: "vol", text: "x" } }],
    ["a close with args", { command: "quickClose", args: { item: "vol" } }],
    ["a bare string", "quickClose"],
    ["null", null],
    ["a number", 7],
    ["an array", ["quickClose"]],
    ["a non-string command", { command: 1 }],
  ])("rejects %s", (_name, raw) => {
    expect(quickCommandFrom(raw, ids)).toBeUndefined();
  });
});

describe("the drawer's IPC channel", () => {
  function setup(known = ids) {
    const handlers: Array<(event: { sender: unknown }, raw: unknown) => void> = [];
    const slideHandlers: typeof handlers = [];
    const slides: string[] = [];
    const sent: Command[] = [];
    const drawerPage = { id: "drawer" };
    wireQuickIpc({
      on: (channel, handler) =>
        (channel === Channel.quickSlide ? slideHandlers : handlers).push(handler),
      slide: (phase) => slides.push(phase),
      isDrawer: (sender) => sender === drawerPage,
      ids: () => known,
      send: (command) => sent.push(command),
    });
    return { handlers, slideHandlers, slides, sent, drawerPage };
  }

  test("a valid command from the drawer's page reaches the core", () => {
    const { handlers, sent, drawerPage } = setup();
    handlers[0]!({ sender: drawerPage }, { command: "quickPick", args: { item: "settings" } });
    expect(sent).toEqual([{ command: "quickPick", args: { item: "settings" } }]);
  });

  test("the same command from any other page, such as a web App's, is dropped", () => {
    const { handlers, sent } = setup();
    handlers[0]!({ sender: { id: "youtube" } }, { command: "quickClose" });
    expect(sent).toEqual([]);
  });

  test("malformed or unrelated commands from the drawer's page are dropped", () => {
    const { handlers, sent, drawerPage } = setup();
    handlers[0]!({ sender: drawerPage }, { command: "openSettings" });
    handlers[0]!({ sender: drawerPage }, { command: "quickPick", args: { item: 1 } });
    handlers[0]!({ sender: drawerPage }, { command: "quickPick", args: { item: "out:gone" } });
    expect(sent).toEqual([]);
  });

  test("nothing can be picked while the drawer isn't showing anything", () => {
    const { handlers, sent, drawerPage } = setup([]);
    handlers[0]!({ sender: drawerPage }, { command: "quickPick", args: { item: "settings" } });
    handlers[0]!({ sender: drawerPage }, { command: "quickPick", args: { item: "vol:mute" } });
    expect(sent).toEqual([]);
  });
});

describe("the drawer's slide-start message", () => {
  function setup() {
    const slideHandlers: Array<(event: { sender: unknown }, raw: unknown) => void> = [];
    const slides: string[] = [];
    const drawerPage = { id: "drawer" };
    wireQuickIpc({
      on: (channel, handler) => {
        if (channel === Channel.quickSlide) slideHandlers.push(handler);
      },
      isDrawer: (sender) => sender === drawerPage,
      ids: () => [],
      send: () => {},
      slide: (phase) => slides.push(phase),
    });
    return { handler: slideHandlers[0]!, slides, drawerPage };
  }

  test("in and out from the drawer's page reach the drawer", () => {
    const { handler, slides, drawerPage } = setup();
    handler({ sender: drawerPage }, "in");
    handler({ sender: drawerPage }, "out");
    expect(slides).toEqual(["in", "out"]);
  });

  test("from any other page, or with anything else, it is dropped", () => {
    const { handler, slides, drawerPage } = setup();
    handler({ sender: { id: "youtube" } }, "in");
    for (const raw of ["sideways", 1, null, undefined, { phase: "in" }, ["in"], "IN"])
      handler({ sender: drawerPage }, raw);
    expect(slides).toEqual([]);
  });
});

test("the drawer's preload uses the channel names main listens on", () => {
  const source = readFileSync(new URL("../preload/quick.ts", import.meta.url), "utf8");
  expect(source).toContain(`quick: "${Channel.quick}"`);
  expect(source).toContain(`quickCommand: "${Channel.quickCommand}"`);
  expect(source).toContain(`quickSlide: "${Channel.quickSlide}"`);
  expect(source).not.toMatch(/import (?!type)[^;]*shared/);
});
