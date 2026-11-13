import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { startHarness, type Harness } from "./testing/harness.ts";

let h: Harness;
beforeEach(async () => {
  h = await startHarness();
});
afterEach(async () => {
  await h.stop();
});

const focused = (hh: Harness) => hh.screen.last.focusedLabel;

describe("Remote on Home", () => {
  test("a phone connects and gets a snapshot of Home", async () => {
    const phone = await h.connectPhone();
    expect(phone.last).toMatchObject({
      type: "snapshot",
      where: "Home",
      remotes: 1,
      typeAvailable: false,
    });
  });

  test("the Remote page is served", async () => {
    const res = await fetch(`http://127.0.0.1:${h.app.remote.port}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Couch Remote");
  });

  test("the Remote page's tab and home-screen icons are served", async () => {
    for (const path of ["/mark.png", "/mark-32.png", "/icon.png", "/touch-icon.png"]) {
      const res = await fetch(`http://127.0.0.1:${h.app.remote.port}${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
    }
  });

  test("the browser tab shows the Couch mark; Add to Home screen keeps the square icon", async () => {
    const page = await (await fetch(`http://127.0.0.1:${h.app.remote.port}/`)).text();
    const icons = [...page.matchAll(/<link rel="icon"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    expect(icons).toEqual(["/mark-32.png", "/mark.png"]);
    expect(page).toContain('<link rel="apple-touch-icon" href="/touch-icon.png">');
  });

  test("“Couch is off” shows the Couch mark, not the square icon", async () => {
    const page = await (await fetch(`http://127.0.0.1:${h.app.remote.port}/`)).text();
    const off = page.slice(page.indexOf('<div class="pw"'), page.indexOf('id="pw-title"'));
    expect(off).toContain('src="/mark.png"');
    expect(off).not.toContain("touch-icon");
  });

  test("the manifest is served as application/manifest+json and never carries the pairing key", async () => {
    const base = `http://127.0.0.1:${h.app.remote.port}`;
    const res = await fetch(`${base}/manifest.webmanifest?key=${h.pairingKey()}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/manifest\+json/);
    const text = await res.text();
    expect(text).not.toContain(h.pairingKey());
    expect(JSON.parse(text)).toMatchObject({
      name: "Couch",
      short_name: "Couch",
      display: "standalone",
      start_url: "/",
      theme_color: "#161412",
      background_color: "#000000",
    });
    expect(JSON.parse(text).icons).toEqual([
      { src: "/icon.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ]);
    expect((await fetch(`${base}/icon-512.png`)).status).toBe(200);
  });

  test("the page links the manifest and has the iPhone home-screen tags", async () => {
    const page = await (await fetch(`http://127.0.0.1:${h.app.remote.port}/`)).text();
    expect(page).toContain('<link rel="manifest" id="manifest" href="/manifest.webmanifest">');
    expect(page).not.toContain("manifest.webmanifest?key");
    expect(page).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(page).toContain('name="apple-mobile-web-app-title" content="Couch"');
    expect(page).toContain('name="apple-mobile-web-app-status-bar-style"');
  });

  test("every connected phone gets a snapshot after each change", async () => {
    const a = await h.connectPhone();
    const b = await h.connectPhone();
    await a.settle();
    expect(a.last?.remotes).toBe(2);
    const before = b.snapshots.length;
    await a.press("right");
    await b.waitFor(() => b.snapshots.length > before);
    expect(b.last?.remotes).toBe(2);
  });

  test("arrows move focus between the Apps and up reaches the settings gear", async () => {
    const phone = await h.connectPhone();
    expect(focused(h)).toBe("YouTube");
    await phone.press("right");
    expect(focused(h)).toBe("Netflix");
    await phone.press("right");
    expect(focused(h)).toBe("Library");
    await phone.press("right");
    expect(focused(h)).toBe("Library");
    await phone.press("up");
    expect(focused(h)).toBe("Settings");
    await phone.press("down");
    expect(focused(h)).toBe("YouTube");
    await phone.press("left");
    expect(focused(h)).toBe("YouTube");
  });

  test("a toast shows on the Screen and clears itself", async () => {
    await h.connectPhone();
    expect(h.screen.last.state.toast).toBe("Phone connected");
    h.clock.advance(3500);
    expect(h.screen.last.state.toast).toBeUndefined();
  });

  test("Home goes to Home", async () => {
    const phone = await h.connectPhone();
    const snap = await phone.press("home");
    expect(snap.where).toBe("Home");
    expect(h.screen.last.state.view).toBe("home");
  });

  test("the Screen's keyboard and a phone produce identical results", async () => {
    const phone = await h.connectPhone();
    h.clock.advance(3500);
    const sequence = ["right", "up", "down", "left", "ok", "home"] as const;
    const viaPhone: unknown[] = [];
    for (const command of sequence) {
      await phone.press(command);
      viaPhone.push({
        focus: focused(h),
        toast: h.screen.last.state.toast,
        view: h.screen.last.state.view,
      });
    }
    const keyboard = await startHarness();
    const viaKeys: unknown[] = [];
    for (const command of sequence) {
      keyboard.app.screenCommand({ command });
      viaKeys.push({
        focus: keyboard.screen.last.focusedLabel,
        toast: keyboard.screen.last.state.toast,
        view: keyboard.screen.last.state.view,
      });
    }
    await keyboard.stop();
    expect(viaKeys).toEqual(viaPhone);
  });

  test("the Home clock updates every minute, driven by the Clock port", async () => {
    const first = h.screen.payloads.length;
    const start = h.screen.last?.now ?? h.clock.now();
    h.clock.advance(60_000);
    expect(h.screen.payloads.length).toBeGreaterThan(first);
    expect(h.screen.last.now).toBe(start + 60_000);
    const count = h.screen.payloads.length;
    h.clock.advance(30_000);
    expect(h.screen.payloads.length).toBe(count);
  });

  test("garbage and unknown commands are ignored", async () => {
    const phone = await h.connectPhone();
    const before = phone.snapshots.length;
    // @ts-expect-error not a command
    phone.send({ command: "rm -rf" });
    await new Promise((r) => setTimeout(r, 100));
    expect(phone.snapshots.length).toBe(before);
  });

  test("a phone leaving drops the connected count", async () => {
    const a = await h.connectPhone();
    const b = await h.connectPhone();
    await a.settle();
    b.close();
    await a.waitFor(() => a.last?.remotes === 1);
    expect(h.screen.last.state.remotes).toBe(1);
  });
});
