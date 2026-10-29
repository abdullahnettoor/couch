import { afterEach, describe, expect, test } from "vite-plus/test";
import type { AppEntry } from "./apps/index.ts";
import { PlaybackUnavailable, type AppPlayback, type AppSignIn } from "./apps/app.ts";
import { FakeWebApp } from "./ports/fakes.ts";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";

let h: Harness;
afterEach(async () => {
  await h?.stop();
});

const entry: AppEntry = {
  id: "cinema",
  label: "Cinema",
  icon: "<svg/>",
  action: "app:open:cinema",
  web: true,
};

const WEBKIT = { id: "webkit", label: "WebKit (FairPlay)" };
const CHROMIUM = { id: "chromium", label: "Chromium (Widevine)" };

/** An App whose engine can switch: WebKit has sign-in rows and follows the Mac's output, Chromium doesn't. */
class SwitchingFake extends FakeWebApp {
  engine = "webkit";
  selects: string[] = [];
  failWith: string | undefined;
  unavailableError = false;
  readonly playback: AppPlayback;
  readonly #signIn: AppSignIn = {
    importSignIn: async () => ({ ok: true, count: 1 }),
    signOut: async () => {},
  };
  constructor(unavailable?: string) {
    super("cinema", "Cinema", { showVolume: true });
    this.playback = {
      options: [WEBKIT, CHROMIUM],
      current: () => (this.engine === "webkit" ? WEBKIT : CHROMIUM),
      unavailable,
      select: async (id) => {
        this.selects.push(id);
        if (this.failWith)
          throw this.unavailableError
            ? new PlaybackUnavailable(this.failWith)
            : new Error(this.failWith);
        this.engine = id;
      },
    };
  }
  override get followsMacOutput() {
    return this.engine === "webkit";
  }
  get signInRows() {
    return this.engine === "webkit" ? this.#signIn : undefined;
  }
}
// FakeWebApp.signIn is a plain property; make it follow the engine.
function app(unavailable?: string): SwitchingFake {
  const a = new SwitchingFake(unavailable);
  Object.defineProperty(a, "signIn", { get: () => a.signInRows });
  return a;
}

async function focus(phone: FakePhone, label: string) {
  const target = h.screen.last.grid.findIndex((i) => i.label === label);
  for (let i = 0; i < 12 && h.screen.last.focusedLabel !== label; i++) {
    const at = h.screen.last.grid.findIndex((g) => g.id === h.screen.last.focusedId);
    await phone.press(target > at ? "down" : "up");
  }
  expect(h.screen.last.focusedLabel).toBe(label);
}
async function openMenu(phone: FakePhone) {
  await phone.press("up");
  await phone.press("ok");
  await focus(phone, "Apps");
  await phone.press("ok");
  await focus(phone, "Cinema");
  await phone.press("ok");
  expect(h.screen.last.appMenu?.label).toBe("Cinema");
}
async function pick(phone: FakePhone, label: string) {
  await focus(phone, label);
  await phone.press("ok");
  await h.settle();
  await phone.settle();
}
const labels = () => h.screen.last.grid.map((i) => i.label);

async function start(a: SwitchingFake) {
  h = await startHarness(undefined, { apps: [{ entry, app: a }] });
  const phone = await h.connectPhone();
  await openMenu(phone);
  return phone;
}

describe("Settings → Apps → Playback", () => {
  test("an App with an engine choice has a Playback row naming the current engine", async () => {
    await start(app());
    expect(labels()).toContain("Playback: WebKit (FairPlay)");
  });

  test("an App without one has no Playback row", async () => {
    h = await startHarness(undefined, {
      apps: [{ entry, app: new FakeWebApp("cinema", "Cinema") }],
    });
    const phone = await h.connectPhone();
    await openMenu(phone);
    expect(labels().some((l) => l.startsWith("Playback"))).toBe(false);
  });

  test("choosing it switches to the other engine, says so, and the row follows", async () => {
    const a = app();
    const phone = await start(a);
    await pick(phone, "Playback: WebKit (FairPlay)");
    expect(a.selects).toEqual(["chromium"]);
    expect(h.screen.last.state.toast).toBe("Cinema now plays with Chromium (Widevine)");
    expect(labels()).toContain("Playback: Chromium (Widevine)");
    await pick(phone, "Playback: Chromium (Widevine)");
    expect(a.selects).toEqual(["chromium", "webkit"]);
    expect(labels()).toContain("Playback: WebKit (FairPlay)");
  });

  test("the sign-in rows are there for WebKit only, and follow a switch", async () => {
    const phone = await start(app());
    expect(labels()).toContain("Import Safari sign-in");
    expect(labels()).toContain("Sign out");
    await pick(phone, "Playback: WebKit (FairPlay)");
    expect(labels()).not.toContain("Import Safari sign-in");
    expect(labels()).not.toContain("Sign out");
    await pick(phone, "Playback: Chromium (Widevine)");
    expect(labels()).toContain("Import Safari sign-in");
  });

  test("the sound note shows for WebKit only, and a switch updates it", async () => {
    const a = app();
    const phone = await start(a);
    const soundNotes = async () => {
      await phone.press("back"); // menu → Apps
      await phone.press("back"); // Apps → Settings
      await focus(phone, "Sound output");
      await phone.press("ok");
      const notes = h.screen.last.sound?.notes;
      await phone.press("back");
      await focus(phone, "Apps");
      await phone.press("ok");
      await focus(phone, "Cinema");
      await phone.press("ok");
      return notes;
    };
    expect(await soundNotes()).toEqual(["Cinema · Follows the Mac's output"]);
    await pick(phone, "Playback: WebKit (FairPlay)");
    expect(await soundNotes()).toBeUndefined();
    await pick(phone, "Playback: Chromium (Widevine)");
    expect(await soundNotes()).toEqual(["Cinema · Follows the Mac's output"]);
  });

  test("a switch that fails says so and leaves the engine alone", async () => {
    const a = app();
    a.failWith = "no add-on";
    const phone = await start(a);
    await pick(phone, "Playback: WebKit (FairPlay)");
    expect(h.screen.last.state.toast).toBe("Couldn't switch Cinema's playback");
    expect(labels()).toContain("Playback: WebKit (FairPlay)");
  });

  test("when WebKit isn't available the Playback row itself says why, on the Screen and on the Remote", async () => {
    const a = app("WebKit unavailable: FairPlay isn't available on this Mac");
    a.engine = "chromium";
    const phone = await start(a);
    expect(labels()).toContain(
      "Playback: Chromium (Widevine) · WebKit unavailable: FairPlay isn't available on this Mac",
    );
    expect(h.screen.last.appMenu?.note).toBeUndefined();
    expect(phone.last?.signInNote).toEqual({
      title: "Playback",
      steps: ["WebKit unavailable: FairPlay isn't available on this Mac"],
    });
  });

  test("toggling when WebKit isn't available toasts the reason, on the Screen and on the phone, and changes nothing", async () => {
    const a = app("WebKit unavailable: FairPlay isn't available on this Mac");
    a.engine = "chromium";
    a.failWith = "WebKit unavailable: FairPlay isn't available on this Mac";
    a.unavailableError = true;
    const phone = await start(a);
    await pick(
      phone,
      "Playback: Chromium (Widevine) · WebKit unavailable: FairPlay isn't available on this Mac",
    );
    expect(h.screen.last.state.toast).toBe(
      "WebKit unavailable: FairPlay isn't available on this Mac",
    );
    expect(phone.last?.toast?.text).toBe(
      "WebKit unavailable: FairPlay isn't available on this Mac",
    );
    expect(a.engine).toBe("chromium");
  });

  test("with both engines available there is no reason shown", async () => {
    await start(app());
    expect(h.screen.last.appMenu?.note).toBeUndefined();
  });
});

describe("NetflixApp over a switchable host", () => {
  test("its sign-in and playback follow what it is given, asked each time", async () => {
    const { NetflixApp } = await import("./apps/netflix/netflix-app.ts");
    const { FakeYouTube, FakeClock } = await import("./ports/fakes.ts");
    let signIn: AppSignIn | undefined = {
      importSignIn: async () => ({ ok: true, count: 1 }),
      signOut: async () => {},
    };
    const playback: AppPlayback = {
      options: [WEBKIT, CHROMIUM],
      current: () => WEBKIT,
      select: async () => {},
    };
    const netflix = new NetflixApp(new FakeYouTube(), new FakeClock(), () => signIn, playback);
    expect(netflix.signIn).toBeDefined();
    expect(netflix.playback).toBe(playback);
    signIn = undefined;
    expect(netflix.signIn).toBeUndefined();
  });
});
