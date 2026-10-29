import { afterEach, describe, expect, test } from "vite-plus/test";
import type { AppEntry } from "./apps/index.ts";
import type { AppSignIn } from "./apps/app.ts";
import { FakeWebApp } from "./ports/fakes.ts";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";

let h: Harness;
afterEach(async () => {
  await h?.stop();
});

const entry: AppEntry = {
  id: "weather",
  label: "Cinema",
  icon: "<svg/>",
  action: "app:open:weather",
  web: true,
};

function setup() {
  const calls: string[] = [];
  const signIn: AppSignIn = {
    signOut: async () => void calls.push("signOut"),
  };
  return { calls, app: new FakeWebApp("weather", "Cinema", { signIn }) };
}

async function openMenu(phone: FakePhone, label: string) {
  await phone.press("up");
  await phone.press("ok");
  await focus(phone, "Apps");
  await phone.press("ok");
  await focus(phone, label);
  await phone.press("ok");
  expect(h.screen.last.appMenu?.label).toBe(label);
}
async function focus(phone: FakePhone, label: string) {
  const target = h.screen.last.grid.findIndex((i) => i.label === label);
  for (let i = 0; i < 12 && h.screen.last.focusedLabel !== label; i++) {
    const at = h.screen.last.grid.findIndex((g) => g.id === h.screen.last.focusedId);
    await phone.press(target > at ? "down" : "up");
  }
  expect(h.screen.last.focusedLabel).toBe(label);
}
async function pick(phone: FakePhone, label: string) {
  await focus(phone, label);
  await phone.press("ok");
  await h.settle();
  await phone.settle();
}
const labels = () => h.screen.last.grid.map((i) => i.label);

describe("Settings → Apps → sign-in rows", () => {
  test("Sign out is shown for an App that offers sign-in, and nothing reads Safari or asks for permissions", async () => {
    const { app } = setup();
    h = await startHarness(undefined, { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    expect(labels()).toEqual([
      "Hide from Home",
      "Move up",
      "Move down",
      "Restart Cinema",
      "Sign out",
    ]);
  });

  test("the built-in Apps have none by default", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    await openMenu(phone, "Netflix");
    expect(labels()).not.toContain("Sign out");
  });

  test("sign out asks the App and toasts", async () => {
    const { app, calls } = setup();
    h = await startHarness(undefined, { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    await pick(phone, "Sign out");
    expect(calls).toEqual(["signOut"]);
    expect(h.screen.last.state.toast).toBe("Signed out of Cinema");
    expect(phone.last?.toast?.text).toBe("Signed out of Cinema");
  });

  test("an App that throws on sign out gets a calm toast", async () => {
    const app = new FakeWebApp("weather", "Cinema", {
      signIn: {
        signOut: async () => {
          throw new Error("busy");
        },
      },
    });
    h = await startHarness(undefined, { apps: [{ entry, app }] });
    const phone = await h.connectPhone();
    await openMenu(phone, "Cinema");
    await pick(phone, "Sign out");
    expect(h.screen.last.state.toast).toBe("Couldn't sign out of Cinema");
  });
});
