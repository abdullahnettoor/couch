// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import type { Command, ScreenPayload, SetupPayload } from "../shared/protocol.ts";

const sent: Command[] = [];
let renderSetup: (p: ScreenPayload) => void;
let panel: HTMLElement;

beforeAll(async () => {
  document.body.innerHTML = '<div id="setup" class="setup"></div>';
  (window as unknown as { couch: unknown }).couch = { send: (c: Command) => sent.push(c) };
  renderSetup = (await import("./setup.ts")).renderSetup;
  panel = document.getElementById("setup")!;
});
beforeEach(() => (sent.length = 0));

const welcome: SetupPayload = {
  id: "welcome",
  title: "Welcome to Couch",
  body: "Your Mac, made into a TV.",
  step: 0,
  steps: 2,
  buttons: ["Use the Mac's keyboard or mouse for now", "Skip", "Set up later"],
  focus: 0,
};
const draw = (setup?: SetupPayload) => renderSetup({ setup } as unknown as ScreenPayload);

describe("the Setup panel", () => {
  test("draws the step dots, the words and every button, with the focused one marked", () => {
    draw({ ...welcome, focus: 1 });
    expect(panel.classList.contains("show")).toBe(true);
    expect(panel.querySelector("b")?.textContent).toBe("Welcome to Couch");
    expect(panel.querySelector("p")?.textContent).toBe("Your Mac, made into a TV.");
    const dots = Array.from(panel.querySelectorAll(".dots i"));
    expect(dots.map((d) => d.className)).toEqual(["on", ""]);
    const buttons = Array.from(panel.querySelectorAll<HTMLElement>(".buttons span"));
    expect(buttons.map((b) => b.textContent)).toEqual(welcome.buttons);
    expect(buttons.map((b) => b.style.getPropertyValue("background"))).toEqual([
      "rgba(255, 255, 255, 0.16)",
      "#fff",
      "rgba(255, 255, 255, 0.16)",
    ]);
  });

  test("draws the tips as a list", () => {
    draw({ ...welcome, id: "done", tips: ["OK opens", "Back steps out"], step: 1 });
    expect(Array.from(panel.querySelectorAll("li")).map((l) => l.textContent)).toEqual([
      "OK opens",
      "Back steps out",
    ]);
    expect(panel.querySelectorAll(".dots i")[1]!.className).toBe("on");
  });

  test("a hover focuses a button and a click answers it, as the keys do", () => {
    draw(welcome);
    const buttons = panel.querySelectorAll(".buttons span");
    buttons[2]!.dispatchEvent(new Event("mouseenter"));
    buttons[2]!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(sent).toEqual([
      { command: "focusAt", args: { r: 0, c: 2 } },
      { command: "confirmAt", args: { index: 2 } },
    ]);
  });

  test("draws an update's new step titled with the version, with a single dot", () => {
    draw({
      id: "remote-style",
      title: "New in Couch 0.3.0",
      body: "Remote style",
      step: 0,
      steps: 1,
      buttons: ["Pick one", "Skip", "Set up later"],
      focus: 0,
    });
    expect(panel.querySelector("b")?.textContent).toBe("New in Couch 0.3.0");
    expect(panel.querySelector("p")?.textContent).toBe("Remote style");
    expect(panel.querySelectorAll(".dots i").length).toBe(1);
  });

  test("leaves nothing showing when Setup is closed", () => {
    draw(welcome);
    draw(undefined);
    expect(panel.classList.contains("show")).toBe(false);
    expect(panel.children.length).toBe(0);
  });
});

describe("the pairing step", () => {
  const pair: SetupPayload = {
    id: "pair",
    title: "Pair your phone",
    body: "Scan this with your phone's camera. Your phone must be on the same Wi-Fi as this Mac.",
    qr: true,
    step: 1,
    steps: 3,
    buttons: ["Skip for now", "Set up later"],
    focus: 0,
  };
  const drawPair = (setup: SetupPayload) =>
    renderSetup({ setup, pairingUrl: "http://mac.local:4747/?key=k" } as unknown as ScreenPayload);

  test("draws the QR code and the same-Wi-Fi note", () => {
    drawPair(pair);
    expect(panel.querySelector(".qr svg")).not.toBeNull();
    expect(panel.querySelector("p")?.textContent).toContain("same Wi-Fi");
  });

  test("draws the connected state without a QR code", () => {
    drawPair({ ...pair, title: "Phone connected", body: undefined, qr: undefined });
    expect(panel.querySelector("b")?.textContent).toBe("Phone connected");
    expect(panel.querySelector(".qr")).toBeNull();
  });
});

describe("the Apps step's switches", () => {
  const apps: SetupPayload = {
    id: "apps",
    title: "Which Apps show on Home?",
    step: 1,
    steps: 3,
    switches: [
      { label: "YouTube", on: true },
      { label: "Netflix", on: false },
    ],
    buttons: ["Continue", "Skip", "Set up later"],
    focus: 1,
  };

  test("draws a switch row for each App, on or off, with the focused one marked", () => {
    draw(apps);
    const rows = Array.from(panel.querySelectorAll<HTMLElement>(".switches .row"));
    expect(rows.map((r) => r.querySelector("span")?.textContent)).toEqual(["YouTube", "Netflix"]);
    expect(rows.map((r) => r.querySelector(".g-switch")?.classList.contains("on"))).toEqual([
      true,
      false,
    ]);
    expect(rows.map((r) => r.classList.contains("focused"))).toEqual([false, true]);
    expect(Array.from(panel.querySelectorAll(".buttons span")).map((b) => b.textContent)).toEqual(
      apps.buttons,
    );
  });

  test("a click on a switch answers it, and a button's click counts after the switches", () => {
    draw(apps);
    const rows = panel.querySelectorAll(".switches .row");
    rows[0]!.dispatchEvent(new Event("mouseenter"));
    rows[0]!.dispatchEvent(new Event("click", { bubbles: true }));
    const buttons = panel.querySelectorAll(".buttons span");
    buttons[0]!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(sent).toEqual([
      { command: "focusAt", args: { r: 0, c: 0 } },
      { command: "confirmAt", args: { index: 0 } },
      { command: "confirmAt", args: { index: 2 } },
    ]);
  });
});
