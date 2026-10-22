import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { netflixDescription } from "./apps/netflix/netflix-web.ts";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";

let h: Harness;
let routes: ReturnType<ReturnType<typeof netflixDescription>["route"]["tracker"]>;
/** The page moves to this address, announced the way the real host does it (the description's own route rules). */
const navigate = (url: string, page: unknown = null) => {
  const route = routes.update(url, page);
  if (route) h.netflix.emit({ type: "route", ...route });
};
let phone: FakePhone;
beforeEach(async () => {
  routes = netflixDescription("130.0.0.0").route.tracker();
  h = await startHarness();
  phone = await h.connectPhone();
});
afterEach(() => h.stop());

const calls = (name: string) => h.netflix.calls.filter((c) => c.call === name);
const keys = () => calls("sendKey").map((c) => c.args[0]);

async function openNetflix() {
  expect(h.screen.last.grid.map((i) => i.id)).toContain("netflix");
  await phone.press("right");
  return phone.press("ok");
}

describe("Netflix App", () => {
  test("Netflix is on Home after YouTube and OK opens it, not YouTube", async () => {
    const s = await openNetflix();
    expect(s.view).toBe("app");
    expect(s.where).toBe("Netflix");
    expect(calls("show")).toHaveLength(1);
    expect(h.youtube.calls.filter((c) => c.call === "show")).toHaveLength(0);
  });

  test("D-pad and OK reach Netflix; play/pause and skip too", async () => {
    await openNetflix();
    for (const c of ["up", "down", "left", "right", "ok"] as const) await phone.press(c);
    await phone.press("playpause");
    await phone.press({ command: "seekBy", args: { seconds: -10 } });
    expect(keys()).toEqual(["up", "down", "left", "right", "ok"]);
    expect(calls("playPause")).toHaveLength(1);
    expect(calls("seekBy").map((c) => c.args)).toEqual([[-10]]);
    expect(h.youtube.calls.filter((c) => c.call === "sendKey")).toEqual([]);
  });

  test("Back inside Netflix goes back in it (closing a modal or the player)", async () => {
    await openNetflix();
    navigate("https://www.netflix.com/watch/80100172");
    const s = await phone.press("back");
    expect(s.view).toBe("app");
    expect(s.confirm).toBeUndefined();
    expect(keys()).toEqual(["back"]);
  });

  test("Back at Netflix's home asks Leave Netflix?; Yes goes Home", async () => {
    await openNetflix();
    navigate("https://www.netflix.com/browse?jbv=1");
    navigate("https://www.netflix.com/browse");
    let s = await phone.press("back");
    expect(s.confirm?.title).toBe("Leave Netflix?");
    expect(keys()).toEqual([]);
    s = await phone.press("right");
    s = await phone.press("ok");
    expect(s.view).toBe("home");
    expect(calls("hide")).toHaveLength(1);
  });

  test("Back where Netflix can't go back any further leaves instead of hanging", async () => {
    await openNetflix();
    navigate("https://www.netflix.com/title/80100172");
    await phone.press("back");
    h.clock.advance(1000);
    const s = await phone.press("back");
    expect(s.confirm?.title).toBe("Leave Netflix?");
  });

  test("Back that closed a player menu or bar changed no route and is not a stuck Back", async () => {
    await openNetflix();
    navigate("https://www.netflix.com/watch/80100172");
    await phone.press("back");
    h.netflix.emit({ type: "backHandled" });
    h.clock.advance(1000);
    const s = await phone.press("back");
    expect(s.confirm).toBeUndefined();
    expect(keys()).toEqual(["back", "back"]);
  });

  test("Back where Netflix keeps announcing the same route still leaves", async () => {
    await openNetflix();
    navigate("https://www.netflix.com/title/80100172");
    await phone.press("back");
    for (let i = 0; i < 3; i++) {
      h.clock.advance(400);
      h.netflix.emit({
        type: "route",
        home: false,
        scrolled: false,
        url: "https://www.netflix.com/title/80100172",
      });
    }
    const s = await phone.press("back");
    expect(s.confirm?.title).toBe("Leave Netflix?");
  });

  test("Back on browse scrolled down scrolls to the top; at the top it asks Leave Netflix?", async () => {
    await openNetflix();
    navigate("https://www.netflix.com/browse", { y: 1800, modal: false });
    let s = await phone.press("back");
    expect(s.confirm).toBeUndefined();
    expect(keys()).toEqual([]);
    expect(calls("scrollToTop")).toHaveLength(1);
    navigate("https://www.netflix.com/browse", { y: 0, modal: false });
    s = await phone.press("back");
    expect(s.confirm?.title).toBe("Leave Netflix?");
    expect(calls("scrollToTop")).toHaveLength(1);
  });

  test("Back with a modal open over browse goes back in the page", async () => {
    await openNetflix();
    navigate("https://www.netflix.com/browse", { y: 0, modal: true });
    const s = await phone.press("back");
    expect(s.confirm).toBeUndefined();
    expect(keys()).toEqual(["back"]);
  });

  test("the Remote follows Netflix: volume, skip and Search Netflix", async () => {
    const s = await openNetflix();
    expect(s.layout).toBe("app");
    expect(s.showVolume).toBe(true);
    expect(s.showSkip).toBe(true);
    expect(s.typeAvailable).toBe(true);
    expect(s.typeLabel).toBe("Search Netflix");
    await phone.press({ command: "typeOpen" });
    await phone.press({ command: "typeText", args: { text: "dark" } });
    await phone.press("typeSubmit");
    expect(calls("submitSearch").map((c) => c.args)).toEqual([["dark"]]);
    expect(h.youtube.calls.filter((c) => c.call === "submitSearch")).toEqual([]);
  });

  test("Couch's volume and Sound output reach Netflix", async () => {
    await phone.press({ command: "volSet", args: { percent: 40 } });
    expect(h.netflix.volume).toBe(40);
    await phone.press("up");
    await phone.press("ok");
    for (let i = 0; i < 2; i++) await phone.press("down");
    await phone.press("ok");
    expect(h.screen.last.state.view).toBe("soundOutput");
    await phone.press("down");
    await phone.press("down");
    await phone.press("ok");
    expect(h.netflix.outputName).toBe("L27h-4A");
  });

  test("Settings → Apps → Netflix has Restart Netflix and no Add-ons", async () => {
    await phone.press("up");
    await phone.press("ok");
    for (let i = 0; i < 3; i++) await phone.press("down");
    await phone.press("ok");
    expect(h.screen.last.state.view).toBe("settingsApps");
    await phone.press("down");
    await phone.press("ok");
    expect(h.screen.last.state.view).toBe("settingsApp");
    expect(h.screen.last.grid.map((g) => g.label)).toEqual(["Restart Netflix"]);
    await phone.press("ok");
    expect(calls("restart")).toHaveLength(1);
    expect(h.screen.last.state.toast).toBe("Restarting Netflix");
  });

  test("a load failure shows the error screen for Netflix", async () => {
    await openNetflix();
    h.netflix.emit({ type: "failed" });
    await phone.waitFor(() => phone.last?.view === "appError");
    expect(phone.last?.where).toBe("Netflix");
    await phone.press("ok");
    expect(calls("restart")).toHaveLength(1);
  });

  test("when Widevine can't load, the error screen says so", async () => {
    await openNetflix();
    h.netflix.emit({
      type: "failed",
      note: "Widevine isn't available on this Mac, so this App can't play video.",
    });
    await phone.waitFor(() => phone.last?.view === "appError");
    expect(h.screen.last.state.appNote).toContain("Widevine");
    h.netflix.emit({ type: "loaded" });
    await phone.press("back");
    expect(h.screen.last.state.appNote).toBeUndefined();
  });

  test("an idle Netflix unloads; opening it again reloads it and starts at its home", async () => {
    await openNetflix();
    navigate("https://www.netflix.com/title/80100172");
    // Leave Netflix, then use YouTube, so Netflix is no longer the most recent App.
    navigate("https://www.netflix.com/browse");
    await phone.press("back");
    let s = await phone.press("right");
    s = await phone.press("ok");
    expect(s.view).toBe("home");
    await phone.press("left");
    s = await phone.press("ok");
    expect(s.where).toBe("YouTube");
    await phone.press("back");
    await phone.press("right");
    s = await phone.press("ok");
    expect(s.view).toBe("home");
    h.clock.advance(10 * 60_000);
    expect(calls("unload")).toHaveLength(1);

    await phone.press("right");
    s = await phone.press("right");
    s = await phone.press("ok");
    expect(s.where).toBe("Netflix");
    expect(calls("show")).toHaveLength(2);
    expect(calls("unload")).toHaveLength(1);
    s = await phone.press("back");
    expect(s.confirm?.title).toBe("Leave Netflix?");
  });
});
