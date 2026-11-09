// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import type { Command, ScreenPayload } from "../shared/protocol.ts";

const payload = (open: boolean) =>
  ({
    state: { view: "about", remotes: 0 },
    focusedId: open ? "support-close" : "support",
    grid: open
      ? [{ id: "support-close", label: "Close", r: 0, c: 0 }]
      : [{ id: "support", label: "Support Couch", r: 0, c: 0 }],
    about: {
      version: "0.2.0",
      beta: false,
      support: {
        line: "Couch is free and open source.",
        url: "https://buymeacoffee.com/abdullahnettoor",
        short: "buymeacoffee.com/abdullahnettoor",
        open,
      },
    },
  }) as unknown as ScreenPayload;

test("clicking Close, as a mouse would, closes the panel and About's rows come back", async () => {
  const html = readFileSync(join(import.meta.dirname, "index.html"), "utf8");
  document.body.innerHTML = /<body[^>]*>([^]*)<\/body>/
    .exec(html)![1]!
    .replace(/<script[^]*?<\/script>/g, "");
  const sent: Command[] = [];
  let deliver: (p: ScreenPayload) => void = () => {};
  (window as unknown as { couch: unknown }).couch = {
    send: (c: Command) => sent.push(c),
    reportGrid() {},
    reportGlass() {},
    onScreen: (f: (p: ScreenPayload) => void) => (deliver = f),
    onTint() {},
    onSound() {},
    onMpv() {},
  };
  await import("./main.ts");
  const screen = document.getElementById("screen")!;

  deliver(payload(true));
  const close = screen.querySelector<HTMLElement>('[data-id="support-close"]')!;
  expect(close.textContent).toBe("Close");
  expect(close.querySelector("svg")).toBeNull();
  close.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(sent.map((c) => c.command)).toEqual(["focusAt", "ok"]);

  deliver(payload(false));
  expect(screen.querySelector(".support-panel")).toBeNull();
  expect(screen.querySelector('[data-id="support"]')).not.toBeNull();
  expect(screen.querySelector(".support-line")).not.toBeNull();
});
