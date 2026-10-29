import { afterEach, describe, expect, test } from "vite-plus/test";
import type { AppEntry } from "./apps/index.ts";
import type { AppWelcome, WelcomeQuestion } from "./apps/app.ts";
import { FakeWebApp } from "./ports/fakes.ts";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";

let h: Harness;
afterEach(() => h?.stop());

const entry: AppEntry = {
  id: "cinema",
  label: "Cinema",
  icon: "<svg/>",
  action: "app:open:cinema",
  web: true,
};
const QUESTION: WelcomeQuestion = {
  title: "Cinema now plays in sharper quality",
  body: "It needs its own sign-in.",
  choices: [
    { id: "copy", label: "Copy sign-in from Couch" },
    { id: "signin", label: "Sign in on Cinema" },
    { id: "chromium", label: "Keep using Chromium" },
  ],
  back: "signin",
};

function setup(o: { question?: WelcomeQuestion | undefined; toast?: string; fail?: boolean } = {}) {
  const asked: string[] = [];
  const answers: string[] = [];
  const state = { question: "question" in o ? o.question : QUESTION };
  const welcome: AppWelcome = {
    question: async () => (asked.push("q"), state.question),
    answer: async (id) => {
      answers.push(id);
      // Once answered it is never asked again.
      state.question = undefined;
      if (o.fail) throw new Error("boom");
      return o.toast;
    },
  };
  const app = new FakeWebApp("cinema", "Cinema", { welcome });
  return { asked, answers, app };
}

async function focusTile(phone: FakePhone) {
  for (let i = 0; i < 20 && h.screen.last.focusedId !== "cinema"; i++) {
    const { grid, focusedId } = h.screen.last;
    const cur = grid.find((x) => x.id === focusedId)!;
    const t = grid.find((x) => x.id === "cinema")!;
    await phone.press(t.r > cur.r ? "down" : t.r < cur.r ? "up" : t.c > cur.c ? "right" : "left");
  }
}
async function start(app: FakeWebApp): Promise<FakePhone> {
  h = await startHarness(undefined, { apps: [{ entry, app }] });
  app.calls.length = 0;
  const phone = await h.connectPhone();
  await focusTile(phone);
  return phone;
}
const shows = (app: FakeWebApp) => app.calls.filter((c) => c.call === "show").length;
const settle = async (phone: FakePhone) => {
  await h.settle();
  await phone.settle();
};
const open = async (phone: FakePhone) => {
  await phone.press("ok");
  await settle(phone);
};

describe("the welcome question before an App first loads", () => {
  test("asks before the page loads: title, body and the answers, on the Screen and the phone", async () => {
    const { app } = setup();
    const phone = await start(app);
    await open(phone);
    const expected = {
      title: QUESTION.title,
      body: QUESTION.body,
      buttons: ["Copy sign-in from Couch", "Sign in on Cinema", "Keep using Chromium"],
      focus: 0,
      phone: true,
    };
    expect(h.screen.last.state.confirm).toEqual(expected);
    expect(phone.last?.confirm).toEqual(expected);
    expect(shows(app)).toBe(0);
    expect(h.screen.last.state.view).not.toBe("app");
  });

  test("the first answer opens the App after answering", async () => {
    const { app, answers } = setup({ toast: "Copied 3 Cinema cookies" });
    const phone = await start(app);
    await open(phone);
    await phone.press("ok");
    await settle(phone);
    expect(answers).toEqual(["copy"]);
    expect(shows(app)).toBe(1);
    expect(h.screen.last.state.view).toBe("app");
    expect(h.screen.last.state.confirm).toBeUndefined();
    expect(h.screen.last.state.toast).toBe("Copied 3 Cinema cookies");
  });

  test("the D-pad moves between the three answers, and OK answers the focused one", async () => {
    const { app, answers } = setup();
    const phone = await start(app);
    await open(phone);
    await phone.press("right");
    expect(h.screen.last.state.confirm?.focus).toBe(1);
    await phone.press("right");
    await phone.press("right");
    expect(h.screen.last.state.confirm?.focus).toBe(2);
    await phone.press("left");
    expect(h.screen.last.state.confirm?.focus).toBe(1);
    await phone.press("ok");
    await settle(phone);
    expect(answers).toEqual(["signin"]);
    expect(shows(app)).toBe(1);
  });

  test("Keep using Chromium is the third answer", async () => {
    const { app, answers } = setup();
    const phone = await start(app);
    await open(phone);
    await phone.press("down");
    await phone.press("down");
    await phone.press("ok");
    await settle(phone);
    expect(answers).toEqual(["chromium"]);
    expect(shows(app)).toBe(1);
  });

  test("Back counts as the answer it names", async () => {
    const { app, answers } = setup();
    const phone = await start(app);
    await open(phone);
    await phone.press("back");
    await settle(phone);
    expect(answers).toEqual(["signin"]);
    expect(shows(app)).toBe(1);
    expect(h.screen.last.state.confirm).toBeUndefined();
  });

  test("a click on the Screen answers by index", async () => {
    const { app, answers } = setup();
    const phone = await start(app);
    await open(phone);
    h.app.screenCommand({ command: "focusAt", args: { r: 0, c: 2 } });
    expect(h.screen.last.state.confirm?.focus).toBe(2);
    h.app.screenCommand({ command: "confirmAt", args: { index: 2 } });
    await settle(phone);
    expect(answers).toEqual(["chromium"]);
    expect(shows(app)).toBe(1);
  });

  test("the phone's buttons answer by index for this question", async () => {
    const { app, answers } = setup();
    const phone = await start(app);
    await open(phone);
    phone.send({ command: "confirmAnswer", args: { index: 1, text: QUESTION.title } } as never);
    await settle(phone);
    expect(answers).toEqual(["signin"]);
    expect(shows(app)).toBe(1);
  });

  test("a phone answer for another question, or out of range, does nothing", async () => {
    const { app, answers } = setup();
    const phone = await start(app);
    await open(phone);
    phone.send({ command: "confirmAnswer", args: { index: 0, text: "Quit Couch?" } } as never);
    phone.send({ command: "confirmAnswer", args: { index: 3, text: QUESTION.title } } as never);
    await settle(phone);
    expect(answers).toEqual([]);
    expect(h.screen.last.state.confirm?.title).toBe(QUESTION.title);
  });

  test("a phone cannot answer Quit Couch? through confirmAnswer", async () => {
    const { app, answers } = setup({ question: undefined });
    const phone = await start(app);
    h.app.askQuit();
    phone.send({ command: "confirmAnswer", args: { index: 1, text: "Quit Couch?" } } as never);
    await settle(phone);
    expect(answers).toEqual([]);
    expect(h.mac.calls.filter((c) => c.call === "quit")).toHaveLength(0);
    expect(h.screen.last.state.confirm?.title).toBe("Quit Couch?");
  });

  test("Home leaves the question unanswered; the next open asks again", async () => {
    const { app, answers, asked } = setup();
    const phone = await start(app);
    await open(phone);
    await phone.press("home");
    await settle(phone);
    expect(answers).toEqual([]);
    expect(shows(app)).toBe(0);
    expect(h.screen.last.state.confirm).toBeUndefined();
    await focusTile(phone);
    await open(phone);
    expect(asked).toHaveLength(2);
    expect(h.screen.last.state.confirm?.title).toBe(QUESTION.title);
  });

  test("with nothing to ask, the App opens at once", async () => {
    const { app } = setup({ question: undefined });
    const phone = await start(app);
    await open(phone);
    expect(shows(app)).toBe(1);
    expect(h.screen.last.state.view).toBe("app");
  });

  test("once answered it is not asked again", async () => {
    const { app, answers, asked } = setup();
    const phone = await start(app);
    await open(phone);
    await phone.press("back");
    await settle(phone);
    await phone.press("home");
    await focusTile(phone);
    await open(phone);
    expect(answers).toEqual(["signin"]);
    expect(asked).toHaveLength(2);
    expect(h.screen.last.state.confirm).toBeUndefined();
    expect(shows(app)).toBe(2);
  });

  test("a failing answer still opens the App, with a toast", async () => {
    const { app } = setup({ fail: true });
    const phone = await start(app);
    await open(phone);
    await phone.press("ok");
    await settle(phone);
    expect(shows(app)).toBe(1);
    expect(h.screen.last.state.toast).toBe("Couldn't finish that. Cinema is opening.");
  });

  test("pressing OK twice on the tile asks once", async () => {
    const { app, asked } = setup();
    const phone = await start(app);
    await phone.press("ok");
    await phone.press("ok");
    await settle(phone);
    expect(asked).toHaveLength(1);
  });
});
