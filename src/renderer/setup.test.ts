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

  test("draws the folders already added and both skip labels", () => {
    const videos: SetupPayload = {
      ...welcome,
      id: "videos",
      title: "Add your videos",
      list: ["/Movies", "/Shows"],
      step: 1,
      buttons: ["Add more", "Continue", "Skip, I only use the Apps", "Set up later"],
    };
    draw(videos);
    expect(Array.from(panel.querySelectorAll(".list li")).map((l) => l.textContent)).toEqual([
      "/Movies",
      "/Shows",
    ]);
    const labels = () =>
      Array.from(panel.querySelectorAll(".buttons span")).map((b) => b.textContent);
    expect(labels()).toContain("Skip, I only use the Apps");
    draw({ ...videos, list: undefined, buttons: ["Add a folder", "Skip for now", "Set up later"] });
    expect(panel.querySelector(".list")).toBeNull();
    expect(labels()).toEqual(["Add a folder", "Skip for now", "Set up later"]);
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
