import { describe, expect, test } from "vite-plus/test";
import type { ScreenState, View } from "../../../shared/protocol.ts";
import { devUpdates } from "../../ports/updates.ts";
import { MemoryStore } from "../../ports/store.ts";
import { AboutPage } from "./about-page.ts";
import { AddonsPage } from "./addons-page.ts";
import type { PageContext } from "./page.ts";
import { HomeApps } from "../home-apps.ts";
import { APPS_MENU_KEY } from "../home-apps.ts";
import {
  AddPhonePage,
  CreditsPage,
  LibraryFoldersPage,
  LibrarySettingsPage,
  RemotesPage,
  SettingsPage,
} from "./settings-pages.ts";
import { SoundOutputPage } from "./sound-output-page.ts";
import { SettingsHomePage } from "./settings-home-page.ts";
import { SettingsAppsPage } from "./settings-apps-page.ts";
import { DetailsPage } from "./details-page.ts";

function fakeContext(): PageContext & {
  went: View[];
  focus: Map<string, { r: number; c: number } | undefined>;
} {
  const went: View[] = [];
  const focus = new Map<string, { r: number; c: number } | undefined>();
  return {
    went,
    focus,
    state: {} as ScreenState,
    go: (view) => void went.push(view),
    focusOf: () => undefined,
    viewKey: () => "",
    startTyping: () => {},
    stopTyping: () => {},
    toast: () => {},
    ask: () => {},
    cue: () => {},
    emit: () => {},
    setFocus: (key, at) => void focus.set(key, at),
  };
}

describe("Page Back", () => {
  test("About goes back to Settings", () => {
    const ctx = fakeContext();
    const page = new AboutPage(ctx, {
      updates: devUpdates({ store: new MemoryStore(), version: "1.0.0" }),
      restart: () => {},
      runSetup: () => {},
    });
    const back = page.back();
    expect(back?.label).toBe("Settings");
    back?.act();
    expect(ctx.went).toEqual(["settings"]);
  });

  test("Add-ons is labelled YouTube and goes back to Settings → Apps", () => {
    const ctx = fakeContext();
    const page = new AddonsPage(ctx, {
      store: new MemoryStore(),
      apply: () => {},
      isFront: () => false,
      forgetMenu: () => {},
    });
    const back = page.back();
    expect(back?.label).toBe("YouTube");
    back?.act();
    expect(ctx.went).toEqual(["settingsApps"]);
  });
});

const settingsHost = {
  details: { settings: () => ({}) as never },
  sound: { payload: () => ({}) as never },
};

describe("Settings Pages Back", () => {
  const cases: Array<
    [
      string,
      (ctx: PageContext) => { back(): { label?: string; act(): void } | undefined },
      string,
      View,
    ]
  > = [
    ["Settings", (c) => new SettingsPage(c, settingsHost), "Home", "home"],
    [
      "Remotes and Devices",
      (c) =>
        new RemotesPage(c, {
          listener: () => ({ available: false, on: false, running: false }),
          refresh: () => {},
        }),
      "Settings",
      "settings",
    ],
    ["Settings → Library", (c) => new LibrarySettingsPage(c, settingsHost), "Settings", "settings"],
    ["Add phone", (c) => new AddPhonePage(c), "Remotes and Devices", "settingsRemotes"],
    [
      "Library folders",
      (c) => new LibraryFoldersPage(c, { folders: () => [], add: () => {}, remove: () => {} }),
      "Library",
      "settingsLibrary",
    ],
    ["Credits", (c) => new CreditsPage(c, settingsHost), "Show and film details", "details"],
    [
      "Sound output",
      (c) =>
        new SoundOutputPage(c, {
          sound: { grid: () => [], payload: () => ({}) as never, action: () => false },
          uiSounds: { row: () => ({}) as never, on: true, action: () => false },
        }),
      "Settings",
      "settings",
    ],
    [
      "Settings → Home",
      (c) =>
        new SettingsHomePage(c, {
          grid: () => [],
          payload: () => ({}) as never,
          action: () => false,
          watch: () => {},
          refresh: () => {},
        }),
      "Settings",
      "settings",
    ],
    [
      "Details",
      (c) =>
        new DetailsPage(c, {
          details: { settings: () => ({}) as never } as never,
          connectedPhone: () => undefined,
        }),
      "Library",
      "settingsLibrary",
    ],
  ];
  for (const [name, make, label, target] of cases) {
    test(`${name} is labelled ${label} and goes to ${target}`, () => {
      const ctx = fakeContext();
      const back = make(ctx).back();
      expect(back?.label).toBe(label);
      back?.act();
      expect(ctx.went).toEqual([target]);
    });
  }

  function apps(ctx: ReturnType<typeof fakeContext>) {
    const homeApps = new HomeApps({
      store: new MemoryStore(),
      known: () => [{ id: "youtube", label: "YouTube" } as never],
      toast: () => {},
      hidden: () => {},
      changed: () => {},
      playback: () => undefined,
      hasSignIn: () => false,
      hasCouchCopy: () => false,
    });
    return {
      homeApps,
      page: new SettingsAppsPage(ctx, {
        homeApps,
        apps: new Map(),
        clearFailure: () => {},
        catalog: () => [],
        addons: () => [],
      }),
    };
  }

  test("Settings → Apps goes back to Settings", () => {
    const ctx = fakeContext();
    const back = apps(ctx).page.back();
    expect(back?.label).toBe("Settings");
    back?.act();
    expect(ctx.went).toEqual(["settings"]);
  });

  test("Settings → Apps' menu goes back to ‹ Apps and closes the menu", () => {
    const ctx = fakeContext();
    const { homeApps, page } = apps(ctx);
    homeApps.openMenu("youtube");
    const back = page.back();
    expect(back?.label).toBe("Apps");
    back?.act();
    expect(homeApps.menuId).toBeUndefined();
    expect(ctx.went).toEqual([]);
    expect(ctx.focus.get(APPS_MENU_KEY)).toBeUndefined();
  });

  test("Settings → Apps forgets its menu on leaving, except into Add-ons", () => {
    const ctx = fakeContext();
    const { homeApps, page } = apps(ctx);
    homeApps.openMenu("youtube");
    page.leave("addons");
    expect(homeApps.menuId).toBe("youtube");
    page.leave("home");
    expect(homeApps.menuId).toBeUndefined();
  });
});
