import { describe, expect, test } from "vite-plus/test";
import { FakeClock, FakeYouTube } from "../../ports/fakes.ts";
import type { YouTubeEvent, YouTubeKey } from "../../ports/youtube.ts";
import { BACK_QUERY } from "../../web/page-focus.ts";
import { WebHostCore, type HostEngine } from "../../web/web-host-core.ts";
import { BitChordApp } from "./bitchord-app.ts";
import { bitchordDescription } from "./bitchord-web.ts";

const description = bitchordDescription("130.0.0.0", {
  request: () => Promise.reject(new Error("no network")),
  manifest: () => Promise.resolve("{}"),
});

/** BitChord's page as far as Back is concerned: a ⋯ menu over the full view over a panel, and history behind the home. */
class Page implements HostEngine {
  open = { menu: true, full: true, panel: true };
  history = true;
  pressed: string[] = [];
  wentBack = 0;
  loads: string[] = [];
  async run(script: string) {
    if (script !== BACK_QUERY) return undefined;
    if (this.open.menu || this.open.full) return "escape";
    if (this.open.panel) {
      this.open.panel = false;
      return "handled";
    }
    return "";
  }
  press(code: string) {
    this.pressed.push(code);
    if (this.open.menu) this.open.menu = false;
    else this.open.full = false;
  }
  goBack() {
    this.wentBack++;
  }
  canGoBack = async () => this.history;
  url = () => description.url;
  load(url: string) {
    this.loads.push(url);
  }
  focus() {}
  visible = () => true;
}

/** The port over the shared host logic, with the engine's page behind it. */
class HostedPort extends FakeYouTube {
  core: WebHostCore;
  constructor(readonly page: Page) {
    super();
    this.core = new WebHostCore(description, page, (e: YouTubeEvent) => this.emit(e), {
      pollsRoute: false,
    });
  }
  override sendKey(key: YouTubeKey) {
    this.core.sendKey(key);
  }
  override closeOverlay() {
    return this.core.closeOverlay();
  }
}

describe("BitChord's Back", () => {
  test("on its home it closes what is open, a menu, the full view, a panel, before it asks to leave", async () => {
    const page = new Page();
    const port = new HostedPort(page);
    const app = new BitChordApp(port, new FakeClock());
    port.emit({ type: "route", home: true, url: description.url });
    expect(await app.back()).toBe("handled");
    expect(page.open).toEqual({ menu: false, full: true, panel: true });
    expect(await app.back()).toBe("handled");
    expect(page.open).toEqual({ menu: false, full: false, panel: true });
    expect(await app.back()).toBe("handled");
    expect(page.open).toEqual({ menu: false, full: false, panel: false });
    expect(await app.back()).toBe("leave");
    expect(page.pressed).toEqual(["Escape", "Escape"]);
    expect(page.wentBack).toBe(0);
    expect(page.loads).toEqual([]);
  });

  test("off its home it goes back a page, and a Back that changes nothing leaves in the end", async () => {
    const page = new Page();
    page.open = { menu: false, full: false, panel: false };
    const clock = new FakeClock();
    const port = new HostedPort(page);
    const app = new BitChordApp(port, clock);
    port.emit({ type: "route", home: false, url: "https://bitchord.example/album/x" });
    expect(await app.back()).toBe("handled");
    await new Promise((r) => setTimeout(r, 0));
    expect(page.wentBack).toBe(1);
    clock.advance(1000);
    expect(await app.back()).toBe("leave");
  });
});

describe("BitChord's typing", () => {
  test("it offers Search BitChord, and a search, its bar and text capture reach the host", () => {
    const port = new FakeYouTube();
    const app = new BitChordApp(port, new FakeClock());
    expect(app.typing?.label).toBe("Search BitChord");
    app.typing!.submitSearch("coldplay");
    app.typing!.showSearchBar("cold");
    app.typing!.captureText(true);
    expect(port.calls.map((c) => [c.call, ...c.args])).toEqual([
      ["submitSearch", "coldplay"],
      ["showSearchBar", "cold"],
      ["captureText", true],
    ]);
  });
});
