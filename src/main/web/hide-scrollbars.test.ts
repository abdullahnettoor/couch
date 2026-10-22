import { expect, test } from "vite-plus/test";
import vm from "node:vm";
import { HIDE_SCROLLBARS_CSS, HIDE_SCROLLBARS_PRELOAD } from "./hide-scrollbars.ts";

function run(document: Record<string, unknown>) {
  vm.runInContext(`(${HIDE_SCROLLBARS_PRELOAD.func})()`, vm.createContext({ document }));
}

test("the preload adds a style that hides every scrollbar, before the page has a head", () => {
  const added: { textContent?: string }[] = [];
  run({
    head: null,
    documentElement: { appendChild: (el: { textContent?: string }) => added.push(el) },
    createElement: () => ({}),
  });
  expect(added).toEqual([{ textContent: HIDE_SCROLLBARS_CSS }]);
  expect(HIDE_SCROLLBARS_CSS).toContain("scrollbar-width:none");
});

test("the preload never throws into the page", () => {
  expect(() =>
    run({
      createElement: () => {
        throw new Error("no DOM yet");
      },
    }),
  ).not.toThrow();
});
