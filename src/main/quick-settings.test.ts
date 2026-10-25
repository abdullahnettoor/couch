import { afterEach, describe, expect, test } from "vite-plus/test";
import { FakeWebApp } from "./ports/fakes.ts";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";

let h: Harness;
afterEach(() => h.stop());

const entry = (id: string, label: string) => ({
  id,
  label,
  icon: "<svg></svg>",
  action: `app:open:${id}`,
  web: true,
});
const SPEAKERS = "out:BuiltInSpeakerDevice";
const MONITOR = "out:30AEC067-0000-0000-1A24-0104B53C2278";

const settle = () => new Promise((r) => setTimeout(r, 30));
const quick = () => h.screen.last.quick;
const focused = () => quick()?.focusedId;
const open = async (phone: FakePhone) => {
  await phone.press("quickSettings");
  await settle();
};

async function start() {
  const tube = new FakeWebApp("tube", "Tube", { showVolume: true, adapter: true });
  h = await startHarness(undefined, { apps: [{ entry: entry("tube", "Tube"), app: tube }] });
  const phone = await h.connectPhone();
  await settle();
  return { tube, phone };
}

async function playing() {
  const { tube, phone } = await start();
  for (let i = 0; i < 20 && h.screen.last.focusedId !== "tube"; i++) await phone.press("right");
  await phone.press("ok");
  expect(h.screen.last.state.view).toBe("app");
  tube.emit({
    type: "playback",
    playback: { position: 30, duration: 600, paused: false, title: "Cat video" },
  });
  await phone.waitFor(() => phone.last?.nowPlaying !== undefined);
  tube.calls.length = 0;
  return { tube, phone };
}

describe("Quick settings", () => {
  test("the phone button opens the drawer and the same button closes it", async () => {
    const { phone } = await start();
    expect(quick()).toBeUndefined();
    await open(phone);
    expect(quick()).toBeDefined();
    expect(phone.last?.quickSettings).toBe(true);
    await open(phone);
    expect(quick()).toBeUndefined();
    expect(phone.last?.quickSettings).toBe(false);
  });

  test("lists the Sound output devices, the current one ticked, then volume and All settings", async () => {
    const { phone } = await start();
    await open(phone);
    const q = quick()!;
    expect(q.items.map((i) => i.id)).toEqual(["out:default", SPEAKERS, MONITOR, "vol", "settings"]);
    expect(q.items.filter((i) => i.checked).map((i) => i.id)).toEqual(["out:default"]);
    expect(q.focusedId).toBe("out:default");
    expect(q.volume).toBe(60);
  });

  test("the arrows move the highlight, OK picks, and Left from the first column closes", async () => {
    const { phone } = await start();
    await open(phone);
    await phone.press("down");
    expect(focused()).toBe(SPEAKERS);
    await phone.press("up");
    expect(focused()).toBe("out:default");
    await phone.press("up");
    expect(focused()).toBe("out:default");
    for (let i = 0; i < 3; i++) await phone.press("down");
    expect(focused()).toBe("vol");
    await phone.press("down");
    expect(focused()).toBe("settings");
    await phone.press("left");
    expect(quick()).toBeUndefined();
  });

  test("Left closes the drawer on every row but Volume, and Right does nothing there", async () => {
    const { phone } = await start();
    await open(phone);
    await phone.press("right");
    expect(focused()).toBe("out:default");
    await phone.press("down");
    await phone.press("left");
    expect(quick()).toBeUndefined();
  });

  test("picking an output switches it at once, keeps the drawer open and the App playing", async () => {
    const { phone, tube } = await playing();
    await open(phone);
    await phone.press("down");
    await phone.press("down");
    expect(focused()).toBe(MONITOR);
    await phone.press("ok");
    await settle();
    expect(h.player.calls.some((c) => c.call === "setAudioDevice")).toBe(true);
    expect(quick()!.items.find((i) => i.checked && i.id.startsWith("out:"))?.id).toBe(MONITOR);
    expect(quick()).toBeDefined();
    expect(tube.calls.filter((c) => ["hide", "show", "playPause"].includes(c.call))).toEqual([]);
  });

  test("Volume is a slider: Left steps down, Right steps up, OK toggles mute, and the level is shown", async () => {
    const { phone } = await start();
    await open(phone);
    for (let i = 0; i < 3; i++) await phone.press("down");
    expect(focused()).toBe("vol");
    await phone.press("left");
    expect(quick()).toBeDefined();
    expect(h.player.volume).toBe(55);
    expect(quick()!.volume).toBe(55);
    await phone.press("right");
    await phone.press("right");
    expect(h.player.volume).toBe(65);
    expect(quick()!.volume).toBe(65);
    await phone.press("ok");
    expect(phone.last?.muted).toBe(true);
    expect(quick()!.muted).toBe(true);
    expect(quick()!.items.find((i) => i.id === "vol")?.label).toBe("Volume");
  });

  test("Picture off is shown only while something plays, and turns the picture off", async () => {
    const idle = await start();
    await open(idle.phone);
    expect(quick()!.items.some((i) => i.id === "picture")).toBe(false);
    await h.stop();

    const { phone } = await playing();
    await open(phone);
    expect(quick()!.items.map((i) => i.id)).toContain("picture");
    while (focused() !== "picture") await phone.press("down");
    await phone.press("ok");
    expect(h.screen.last.state.pictureOff).toBe(true);
    expect(quick()).toBeUndefined();
  });

  test("opening the drawer does not end Picture off; the row then reads Picture on and brings the picture back", async () => {
    const { phone } = await playing();
    await open(phone);
    expect(quick()!.items.find((i) => i.id === "picture")?.label).toBe("Picture off");
    while (focused() !== "picture") await phone.press("down");
    await phone.press("ok");
    expect(h.screen.last.state.pictureOff).toBe(true);

    await open(phone);
    expect(quick()).toBeDefined();
    expect(h.screen.last.state.pictureOff).toBe(true);
    expect(quick()!.items.find((i) => i.id === "picture")?.label).toBe("Picture on");
    await phone.press("up");
    await phone.press("down");
    expect(h.screen.last.state.pictureOff).toBe(true);
    while (focused() !== "picture") await phone.press("down");
    await phone.press("ok");
    expect(h.screen.last.state.pictureOff).toBe(false);
    expect(quick()).toBeUndefined();
  });

  test("Back closes the drawer and leaves Picture off on", async () => {
    const { phone } = await playing();
    await phone.press({ command: "setPictureOff", args: { on: true } });
    await open(phone);
    await phone.press("back");
    expect(quick()).toBeUndefined();
    expect(h.screen.last.state.pictureOff).toBe(true);
  });

  test("play/pause, volume and mute keep acting on playback through the core while it is open", async () => {
    const { phone, tube } = await playing();
    await open(phone);
    await phone.press("playpause");
    expect(tube.calls.some((c) => c.call === "playPause")).toBe(true);
    expect(quick()).toBeDefined();
    await phone.press("volUp");
    expect(h.player.volume).toBe(65);
    await phone.press("mute");
    expect(phone.last?.muted).toBe(true);
    expect(quick()).toBeDefined();
    expect(tube.calls.filter((c) => c.call === "sendKey")).toEqual([]);
  });

  test("All settings closes the drawer and opens Settings", async () => {
    const { phone } = await start();
    await open(phone);
    while (focused() !== "settings") await phone.press("down");
    await phone.press("ok");
    expect(h.screen.last.state.view).toBe("settings");
    expect(quick()).toBeUndefined();
  });

  test("Back closes it, and so does 10 s without input", async () => {
    const { phone } = await start();
    await open(phone);
    await phone.press("back");
    expect(quick()).toBeUndefined();
    expect(h.screen.last.state.view).toBe("home");

    await open(phone);
    h.clock.advance(9_000);
    await phone.press("down");
    h.clock.advance(9_000);
    expect(quick()).toBeDefined();
    h.clock.advance(1_500);
    expect(quick()).toBeUndefined();
  });

  test("keys never reach the App underneath while it is open", async () => {
    const { phone, tube } = await playing();
    await open(phone);
    for (const k of ["up", "down", "right", "ok"] as const) await phone.press(k);
    h.app.screenCommand({ command: "left" });
    expect(tube.calls.filter((c) => c.call === "sendKey")).toEqual([]);
    expect(h.screen.last.state.view).toBe("app");
  });

  test("the Screen's edge gesture opens it; a click outside closes it; a click on a row picks it", async () => {
    const { phone } = await start();
    h.app.screenCommand({ command: "quickEdge" });
    await settle();
    expect(quick()).toBeDefined();
    h.app.screenCommand({ command: "quickPick", args: { item: MONITOR } });
    await settle();
    expect(quick()!.items.find((i) => i.id === MONITOR)?.checked).toBe(true);
    h.app.screenCommand({ command: "quickClose" });
    await settle();
    expect(quick()).toBeUndefined();
    phone.send("quickEdge");
    await settle();
    expect(quick()).toBeUndefined();
  });
});
