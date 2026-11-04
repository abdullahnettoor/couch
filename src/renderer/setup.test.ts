// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import type { Command, ScreenPayload, SetupPayload } from "../shared/protocol.ts";

const sent: Command[] = [];
let renderSetup: (p: ScreenPayload) => void;
let setupTakesKey: () => boolean;
let panel: HTMLElement;

beforeAll(async () => {
  // No Web Animations here: the intro and the step changes resolve at once, as they do with reduce motion.
  Object.defineProperty(Element.prototype, "animate", { value: undefined, configurable: true });
  document.body.innerHTML = '<div id="setup" class="setup"></div>';
  (window as unknown as { couch: unknown }).couch = { send: (c: Command) => sent.push(c) };
  ({ renderSetup, setupTakesKey } = await import("./setup.ts"));
  panel = document.getElementById("setup")!;
});
beforeEach(() => {
  sent.length = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  draw(undefined);
  vi.runAllTimers();
  vi.useRealTimers();
});

const welcome: SetupPayload = {
  id: "pair",
  title: "Welcome to Couch",
  body: "Scan with your phone's camera. Your phone becomes the Remote, with no app to install.",
  note: "Your phone needs to be on the same Wi-Fi as this Mac.",
  hint: "No phone nearby? Use the arrow keys and Return.",
  footnote: "You can change all of this later in Settings.",
  qr: true,
  step: 0,
  steps: 5,
  buttons: ["Not now"],
  focus: 0,
};
const draw = (setup?: SetupPayload) =>
  renderSetup({ setup, pairingUrl: "http://mac.local:4747/?key=k" } as unknown as ScreenPayload);
const text = (selector: string) => panel.querySelector(selector)?.textContent;
const buttons = () => Array.from(panel.querySelectorAll<HTMLElement>(".buttons button"));

describe("the Setup panel", () => {
  test("draws the sofa mark, the amber step dots, the words, the QR code and the one button, focused", () => {
    draw(welcome);
    expect(panel.classList.contains("show")).toBe(true);
    expect(panel.querySelector(".s-mark img")?.getAttribute("src")).toBeTruthy();
    expect(text(".s-title")).toBe("Welcome to Couch");
    expect(text(".s-body")).toBe(welcome.body);
    expect(panel.querySelector(".qr svg")).not.toBeNull();
    expect(text(".s-note")).toBe("Your phone needs to be on the same Wi-Fi as this Mac.");
    const dots = Array.from(panel.querySelectorAll(".dots i"));
    expect(dots.map((d) => d.className)).toEqual(["on", "", "", "", ""]);
    expect(buttons().map((b) => b.textContent)).toEqual(["Not now"]);
    expect(buttons()[0]!.classList.contains("focused")).toBe(true);
  });

  test("the hint is words, not a button", () => {
    draw(welcome);
    const hint = panel.querySelector(".s-hint")!;
    expect(hint.textContent).toBe("No phone nearby? Use the arrow keys and Return.");
    expect(hint.tagName).toBe("P");
    expect(hint.closest("button, .buttons")).toBeNull();
    expect(hint.querySelector("[data-i]")).toBeNull();
    expect(buttons().some((b) => b.textContent?.includes("phone nearby"))).toBe(false);
  });

  test("the first and last steps end with the Settings line", () => {
    draw(welcome);
    expect(text(".s-foot")).toBe("You can change all of this later in Settings.");
    const foot = panel.querySelector(".s-foot")!;
    expect(foot.previousElementSibling?.classList.contains("buttons")).toBe(true);
    draw({
      id: "done",
      title: "You're set",
      tips: [
        { key: "OK", text: "opens" },
        { key: "Back", text: "steps out" },
        { key: "Home", text: "always goes Home" },
      ],
      footnote: "Change any of this later in Settings.",
      step: 4,
      steps: 5,
      buttons: ["Go to Home"],
      focus: 0,
      final: true,
    });
    expect(text(".s-foot")).toBe("Change any of this later in Settings.");
    expect(panel.querySelector(".box")?.classList.contains("final")).toBe(true);
    expect(
      Array.from(panel.querySelectorAll(".s-tips li")).map((li) => [
        li.querySelector("kbd")?.textContent,
        li.querySelector("span")?.textContent,
      ]),
    ).toEqual([
      ["OK", "opens"],
      ["Back", "steps out"],
      ["Home", "always goes Home"],
    ]);
    expect(panel.querySelectorAll(".dots i")[4]!.className).toBe("on");
  });

  test("the panel stays and only the focus moves when the focus changes", () => {
    const two = {
      ...welcome,
      title: "1 phone connected",
      buttons: ["Continue", "Add another phone"],
    };
    draw(two);
    const first = buttons()[0]!;
    draw({ ...two, focus: 1 });
    expect(buttons()[0]).toBe(first);
    expect(buttons().map((b) => b.classList.contains("focused"))).toEqual([false, true]);
  });

  test("a hover focuses a button and a click answers it, as the keys do", () => {
    draw({ ...welcome, buttons: ["Continue", "Add another phone"] });
    buttons()[1]!.dispatchEvent(new Event("mouseenter"));
    buttons()[1]!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(sent).toEqual([
      { command: "focusAt", args: { r: 0, c: 1 } },
      { command: "confirmAt", args: { index: 1 } },
    ]);
  });

  test("a phone just connected: a ✓ instead of the QR code", () => {
    draw({ ...welcome, title: "Phone connected", qr: undefined, connected: true });
    expect(panel.querySelector(".s-check svg")).not.toBeNull();
    expect(panel.querySelector(".qr")).toBeNull();
  });

  test("draws the folders already added", () => {
    draw({
      id: "videos",
      title: "Add your videos",
      list: ["/Movies", "/Shows"],
      step: 3,
      steps: 5,
      buttons: ["Continue", "Add more"],
      focus: 0,
    });
    expect(Array.from(panel.querySelectorAll(".list li")).map((l) => l.textContent)).toEqual([
      "/Movies",
      "/Shows",
    ]);
  });

  test("an update's new step is titled with the version, with no dots for a single step", () => {
    draw({
      id: "remote-style",
      title: "New in Couch 0.3.0",
      body: "Remote style",
      step: 0,
      steps: 1,
      buttons: ["Pick one"],
      focus: 0,
    });
    expect(text(".s-title")).toBe("New in Couch 0.3.0");
    expect(panel.querySelector<HTMLElement>(".dots")!.hidden).toBe(true);
  });

  test("closing fades the panel out, then leaves nothing", () => {
    draw(welcome);
    draw(undefined);
    expect(panel.classList.contains("show")).toBe(false);
    vi.runAllTimers();
    expect(panel.children.length).toBe(0);
  });
});

describe("the Apps step", () => {
  const apps: SetupPayload = {
    id: "apps",
    title: "Pick your Apps",
    step: 2,
    steps: 5,
    tiles: [
      { id: "youtube", label: "YouTube", icon: '<svg data-n="yt"></svg>', on: true },
      { id: "netflix", label: "Netflix", icon: '<svg data-n="nf"></svg>', on: false },
      { id: "library", label: "Library", icon: '<svg data-n="lib"></svg>', on: true },
    ],
    columns: 3,
    buttons: ["Continue"],
    focus: 1,
  };
  const tiles = () => Array.from(panel.querySelectorAll<HTMLElement>(".s-tile"));

  test("Home-style tiles with each App's logo: on with a ✓, off dimmed; the focused one marked", () => {
    draw(apps);
    expect(tiles().map((t) => t.querySelector(".g-cap")?.textContent)).toEqual([
      "YouTube",
      "Netflix",
      "Library",
    ]);
    expect(tiles().map((t) => t.querySelector(".g-tile")?.className)).toEqual([
      "g-tile youtube-face",
      "g-tile netflix-face",
      "g-tile library-face",
    ]);
    expect(tiles()[0]!.querySelector('[data-n="yt"]')).not.toBeNull();
    expect(tiles().map((t) => t.className)).toEqual([
      "s-tile on",
      "s-tile focused off",
      "s-tile on",
    ]);
    for (const t of tiles()) expect(t.querySelector(".s-tick svg")).not.toBeNull();
    expect(panel.querySelector<HTMLElement>(".s-tiles")!.style.getPropertyValue("--cols")).toBe(
      "3",
    );
    const css = readFileSync(join(import.meta.dirname, "glass.css"), "utf8");
    expect(css).toMatch(/\.s-tile\.off > \.g-tile \{[^}]*filter/);
    expect(css).toMatch(/\.s-tile\.off \.s-tick \{[^}]*opacity: 0/);
  });

  test("a switch flips in place; a click answers a tile, and a button counts after the tiles", () => {
    draw(apps);
    const netflix = tiles()[1]!;
    draw({ ...apps, tiles: apps.tiles!.map((t) => ({ ...t, on: true })) });
    expect(tiles()[1]).toBe(netflix);
    expect(netflix.className).toBe("s-tile focused on");
    tiles()[0]!.dispatchEvent(new Event("mouseenter"));
    tiles()[0]!.dispatchEvent(new Event("click", { bubbles: true }));
    buttons()[0]!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(sent).toEqual([
      { command: "focusAt", args: { r: 0, c: 0 } },
      { command: "confirmAt", args: { index: 0 } },
      { command: "confirmAt", args: { index: 3 } },
    ]);
  });
});

describe("the intro", () => {
  const intro = () => panel.querySelector(".s-intro");

  test("plays on a fresh Setup with the sofa, the name and the tagline; any key skips it and is not sent", () => {
    draw({ ...welcome, intro: true });
    expect(panel.classList.contains("intro")).toBe(true);
    expect(intro()?.querySelector(".s-sofa")).not.toBeNull();
    expect(intro()?.querySelector(".s-name")?.textContent).toBe("Couch");
    expect(intro()?.querySelector(".s-tag")?.textContent).toBe("Turn your Mac into a smart TV.");
    expect(setupTakesKey()).toBe(true);
    expect(intro()).toBeNull();
    expect(panel.classList.contains("intro")).toBe(false);
    expect(setupTakesKey()).toBe(false);
    expect(sent).toEqual([]);
  });

  test("plays once: the next steps, and a Setup with no intro (Run setup again, New in Couch), never show it", () => {
    draw({ ...welcome, intro: true });
    setupTakesKey();
    draw({
      ...welcome,
      id: "listener",
      title: "Start Couch from your phone",
      step: 1,
      intro: true,
    });
    expect(intro()).toBeNull();
    draw(undefined);
    vi.runAllTimers();
    draw(welcome);
    expect(intro()).toBeNull();
    expect(setupTakesKey()).toBe(false);
  });

  test("the Mac's keys go to Setup first", () => {
    const main = readFileSync(join(import.meta.dirname, "main.ts"), "utf8");
    expect(main).toMatch(/keydown[^]*?setupTakesKey\(\)[^]*?keyCommand\(/);
  });
});

describe("Home under Setup", () => {
  const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
  const css = read("./glass.css");

  test("only the panel is hidden when it is closed; Home takes its own modifier, so its wallpaper stays", () => {
    const home = read("./views/home.ts");
    expect(home).toContain('toggle("in-setup"');
    expect(home).not.toContain('toggle("setup"');
    expect(css).not.toMatch(/\.home\.setup/);
    const hides = /\.home\.in-setup[^{]*\{[^}]*display: none/.exec(css)?.[0] ?? "";
    expect(hides).not.toContain(".h-photo");
    expect(css).not.toMatch(/\n\.setup \{[^}]*opacity: 0/);
  });
});
