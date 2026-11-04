import { describe, expect, test } from "vite-plus/test";
import { loadFixtures } from "./look-fixture-data.ts";

describe("the committed screenshot fixtures", () => {
  const fixtures = loadFixtures();

  test("cover every Screen Page and overlay the harness names", () => {
    expect(Object.keys(fixtures.screen).sort()).toEqual(
      [
        "app-error",
        "folder",
        "folder-root",
        "fix-match",
        "home",
        "home-ambient",
        "home-hero",
        "library",
        "library-search",
        "overlay-confirm",
        "overlay-picture-off",
        "overlay-quick-settings",
        "overlay-setup",
        "overlay-toast",
        "overlay-volume",
        "player",
        "player-next",
        "player-up-next",
        "settings",
        "settings-addons",
        "settings-about",
        "settings-add-phone",
        "settings-apps",
        "settings-credits",
        "settings-details",
        "settings-home",
        "settings-library",
        "settings-library-folders",
        "settings-remotes",
        "settings-sound",
        "show",
      ].sort(),
    );
  });

  test("cover the phone's Home, Now Playing, Setup and a question", () => {
    expect(Object.keys(fixtures.phone).sort()).toEqual([
      "home",
      "overlay-confirm",
      "player",
      "setup",
    ]);
  });

  test("hold what each name promises", () => {
    const view = (n: string) => fixtures.screen[n].state.view;
    expect(view("home")).toBe("home");
    expect(fixtures.screen["home-hero"].hero).toBeDefined();
    expect(fixtures.screen["home-ambient"].ambient).toBe(true);
    expect(fixtures.screen["home"].continueCard).toBeDefined();
    expect(view("fix-match")).toBe("fixMatch");
    expect(view("show")).toBe("show");
    expect(view("app-error")).toBe("appError");
    expect(view("player")).toBe("player");
    expect(fixtures.screen["player"].overlay?.controls).toBe("dock");
    expect(fixtures.screen["player-up-next"].overlay?.controls).toBe("upnext");
    expect(fixtures.screen["player-up-next"].overlay?.upNext?.tiles.length).toBeGreaterThan(1);
    expect(fixtures.screen["player-next"].overlay?.controls).toBe("next");
    expect(fixtures.screen["player-next"].overlay?.next).toBeDefined();
    expect(view("settings-addons")).toBe("addons");
    expect(fixtures.screen["settings-addons"].addons?.length).toBeGreaterThan(0);
    expect(view("settings-credits")).toBe("credits");
    expect(fixtures.screen["overlay-quick-settings"].quick).toBeDefined();
    expect(fixtures.screen["overlay-setup"].setup).toBeDefined();
    expect(fixtures.screen["overlay-confirm"].state.confirm).toBeDefined();
    expect(fixtures.screen["overlay-picture-off"].state.pictureOff).toBe(true);
    expect(fixtures.screen["overlay-toast"].state.toast).toBeDefined();
    expect(fixtures.screen["overlay-volume"].state.volumeShown).toBe(true);
  });

  test("hold nothing that depends on the machine or the run", () => {
    const text = JSON.stringify(fixtures);
    expect(text).not.toMatch(/\/Users\/|\/private\/var|\/var\/folders|127\.0\.0\.1|localhost/);
  });
});
