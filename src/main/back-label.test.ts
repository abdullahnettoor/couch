import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { FileStore } from "./ports/store.ts";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";

const KEY = "eyJhbGciOi.PROJECT.token";
let root: string;
let storeDir: string;
let h: Harness;
let phone: FakePhone;

const touch = (...parts: string[]) => {
  const p = join(root, ...parts);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, "");
};
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "couch-backlabel-"));
  storeDir = mkdtempSync(join(tmpdir(), "couch-backlabelstore-"));
});
afterEach(async () => {
  await h?.stop();
  rmSync(root, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

const screen = () => h.screen.last;
const label = () => screen().back?.label;
const view = () => screen().state.view;

async function focusId(id: string) {
  for (let i = 0; i < 80 && screen().focusedId !== id; i++) {
    const { grid } = screen();
    const cur = grid.find((x) => x.id === screen().focusedId)!;
    const t = grid.find((x) => x.id === id);
    if (!t) throw new Error(`no ${id} in ${grid.map((g) => g.id).join(", ")}`);
    await phone.press(t.r > cur.r ? "down" : t.r < cur.r ? "up" : t.c > cur.c ? "right" : "left");
  }
  expect(screen().focusedId).toBe(id);
}

async function start() {
  const store = new FileStore(storeDir);
  store.write("library", { folders: [root] });
  touch("Arcane", "Arcane S01E01.mkv");
  for (const n of ["A", "B", "C"]) touch(`Eng${n}.2020.mkv`);
  touch("Films", "Sub", "Deep.2020.mkv");
  touch("Films", "Top.2020.mkv");
  h = await startHarness(store, { tmdbProjectKey: KEY });
  h.metadata.catalog.show.arcane = [{ id: 1, name: "Arcane", year: 2021 }];
  ["a", "b", "c"].forEach((n, i) => {
    h.metadata.catalog.film[`eng${n}`] = [{ id: 10 + i, name: `Eng${n}`, year: 2020 }];
    h.metadata.detailsById.set(10 + i, {
      id: 10 + i,
      name: `Eng${n}`,
      genres: ["Drama"],
      language: "en",
      seasons: [],
    });
  });
  await h.app.core.library.settled();
  await h.app.core.details.settled();
  phone = await h.connectPhone();
  await phone.press("home");
  await focusId("library");
  await phone.press("ok");
}

/** The label names what Back does: press it, and the next screen must be what the label said. */
async function back() {
  await phone.press("back");
}

describe("Back label: one resolver for the label and for Back", () => {
  test("Library says Home, and Back goes Home", async () => {
    await start();
    expect(view()).toBe("library");
    expect(label()).toBe("Home");
    await back();
    expect(view()).toBe("home");
  });

  test("Library with an active chip says All; Back clears the chip, staying on the Library", async () => {
    await start();
    const films = screen().library!.chips!.find((c) => c.label === "Films")!;
    await focusId(`chip:${films.key}`);
    await phone.press("ok");
    expect(screen().library!.chips!.find((c) => c.active)!.label).toBe("Films");
    expect(label()).toBe("All");
    await back();
    expect(view()).toBe("library");
    expect(screen().library!.chips!.find((c) => c.active)!.label).toBe("All");
    expect(label()).toBe("Home");
  });

  test("a Library folder says Library; a subfolder says its parent's name", async () => {
    await start();
    await focusId(root);
    await phone.press("ok");
    expect(view()).toBe("folder");
    expect(label()).toBe("Library");
    await focusId(join(root, "Films"));
    await phone.press("ok");
    expect(label()).toBe(basename(root));
    await focusId(join(root, "Films", "Sub"));
    await phone.press("ok");
    expect(screen().library!.heading).toBe("Sub");
    expect(label()).toBe("Films");
    await back();
    expect(screen().library!.heading).toBe("Films");
    expect(label()).toBe(basename(root));
    await back();
    expect(screen().library!.heading).toBe(basename(root));
    expect(label()).toBe("Library");
    await back();
    expect(view()).toBe("library");
  });

  test("a show opened from the Library says Library", async () => {
    await start();
    await focusId("shows:show:arcane");
    await phone.press("ok");
    expect(view()).toBe("show");
    expect(label()).toBe("Library");
    await back();
    expect(view()).toBe("library");
  });

  test("Library search says Library; while typing on the Screen it says Stop typing, and Back only stops typing", async () => {
    await start();
    h.app.screenCommand({ command: "find" });
    expect(view()).toBe("librarySearch");
    expect(screen().state.typingBy).toBe("screen");
    expect(label()).toBe("Stop typing");
    await back();
    expect(view()).toBe("librarySearch");
    expect(screen().state.typingBy).toBeUndefined();
    expect(label()).toBe("Library");
    await back();
    expect(view()).toBe("library");
  });

  test("a show opened from search says Search; Back returns to search", async () => {
    await start();
    h.app.screenCommand({ command: "find" });
    h.app.screenCommand({ command: "typeText", args: { text: "arcane" } });
    h.clock.advance(150);
    h.app.screenCommand({ command: "typeSubmit" });
    const tile = screen().grid.find((g) => g.id.includes("show:arcane"))!;
    await focusId(tile.id);
    await phone.press("ok");
    expect(view()).toBe("show");
    expect(label()).toBe("Search");
    await back();
    expect(view()).toBe("librarySearch");
  });

  test("Fix match opened from a show says the show; from the Library it says Library", async () => {
    await start();
    await focusId("shows:show:arcane");
    await phone.press("ok");
    await focusId("fix");
    await phone.press("ok");
    expect(view()).toBe("fixMatch");
    expect(label()).toBe("Arcane");
    await back();
    expect(view()).toBe("show");
    await back();
    expect(view()).toBe("library");
    await focusId("shows:show:arcane");
    await phone.press("menu");
    expect(view()).toBe("fixMatch");
    expect(label()).toBe("Library");
    await back();
    expect(view()).toBe("library");
  });

  test("Settings pages carry the label of their Back target", async () => {
    await start();
    await phone.press("home");
    await focusId("settings");
    await phone.press("ok");
    expect(label()).toBe("Home");
    await focusId("library");
    await phone.press("ok");
    expect(view()).toBe("settingsLibrary");
    expect(label()).toBe("Settings");
    await back();
    expect(view()).toBe("settings");
  });

  test("pages with no back link have no back field", async () => {
    await start();
    await phone.press("home");
    expect(view()).toBe("home");
    expect(screen().back).toBeUndefined();
  });
});
