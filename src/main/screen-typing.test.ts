import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import type { Command } from "../shared/protocol.ts";
import { FileStore } from "./ports/store.ts";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";

let root: string;
let storeDir: string;
let h: Harness;
let phone: FakePhone;

const SECRET = "eyJsecret-tmdb-token-ZZZZ-1234567890";
const films = ["Kung Fu Panda 4 (2024)", "Panda (2020)", "Pandemic (2019)", "Amélie (2001)"];

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "couch-styping-"));
  storeDir = mkdtempSync(join(tmpdir(), "couch-stypingstore-"));
  mkdirSync(join(root, "Films"), { recursive: true });
  for (const f of films) writeFileSync(join(root, "Films", `${f}.mkv`), "");
  const store = new FileStore(storeDir);
  store.write("library", { folders: [root] });
  h = await startHarness(store);
  await h.app.core.library.settled();
  phone = await h.connectPhone();
  await phone.settle();
});
afterEach(async () => {
  await h.stop();
  rmSync(root, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

const screen = () => h.screen.last;
const key = (command: Command["command"] | Command) =>
  h.app.screenCommand(typeof command === "string" ? { command } : command);
const text = (value: string) => key({ command: "typeText", args: { text: value } });
const films$ = () =>
  screen()
    .search!.rows.find((r) => r.id === "films")
    ?.entries.map((e) => e.title) ?? [];
const calls = (name: string) => h.youtube.calls.filter((c) => c.call === name);

function toLibrary() {
  key("home");
  const grid = () => screen().grid;
  for (let i = 0; i < 20 && screen().focusedId !== "library"; i++) {
    const cur = grid().find((x) => x.id === screen().focusedId)!;
    const t = grid().find((x) => x.id === "library")!;
    key(t.r > cur.r ? "down" : t.r < cur.r ? "up" : t.c > cur.c ? "right" : "left");
  }
  key("ok");
  expect(screen().state.view).toBe("library");
}

async function toDetails() {
  key("home");
  key("up");
  key("ok");
  for (let i = 0; i < 3; i++) key("down");
  key("ok");
  expect(screen().state.view).toBe("details");
}

/** Everything a phone or the Screen could ever be handed, as one string. */
async function everything(): Promise<string> {
  await phone.settle();
  return JSON.stringify([screen(), h.screen.payloads, phone.snapshots, h.app.screen()]);
}

describe("Screen typing: Library search", () => {
  test("a printable key on the Library opens search with that character; results update live", () => {
    toLibrary();
    key({ command: "screenKey", args: { text: "p" } });
    expect(screen().state.view).toBe("librarySearch");
    expect(screen().state.typingBy).toBe("screen");
    expect(screen().screenTyping).toBe("librarySearch");
    expect(screen().search!.query).toBe("p");
    text("pan");
    expect(films$()).toEqual(["Panda", "Pandemic", "Kung Fu Panda 4"]);
    text("panda kung");
    expect(films$()).toEqual(["Kung Fu Panda 4"]);
  });

  test("⌘F opens an empty search with the field focused for typing", () => {
    toLibrary();
    key("find");
    expect(screen().state.view).toBe("librarySearch");
    expect(screen().state.typingBy).toBe("screen");
    expect(screen().search!.query).toBe("");
    expect(screen().focusedId).toBe("field");
  });

  test("a printable key outside the Library's first page does nothing", () => {
    key("home");
    key({ command: "screenKey", args: { text: "p" } });
    expect(screen().state.view).toBe("home");
    expect(screen().state.typingBy).toBeUndefined();
  });

  test("OK on the search icon from the Screen types on the Screen", async () => {
    toLibrary();
    for (let i = 0; i < 20 && screen().focusedId !== "search"; i++) {
      const cur = screen().grid.find((x) => x.id === screen().focusedId)!;
      const t = screen().grid.find((x) => x.id === "search")!;
      key(t.r < cur.r ? "up" : t.c < cur.c ? "left" : "right");
    }
    expect(screen().focusedId).toBe("search");
    key("ok");
    expect(screen().state.view).toBe("librarySearch");
    expect(screen().state.typingBy).toBe("screen");
  });

  test("Enter focuses the first result; Down does too", () => {
    toLibrary();
    key({ command: "screenKey", args: { text: "p" } });
    text("panda");
    key("typeSubmit");
    expect(screen().state.typingBy).toBeUndefined();
    expect(screen().focusedId).toBe(`search:films:${join(root, "Films", "Panda (2020).mkv")}`);
    key("up");
    expect(screen().focusedId).toBe("field");
    expect(screen().state.typingBy).toBe("screen");
    text("pandem");
    key("down");
    expect(screen().state.typingBy).toBeUndefined();
    expect(screen().focusedId).toBe(`search:films:${join(root, "Films", "Pandemic (2019).mkv")}`);
  });

  test("Esc leaves the field, a second Esc leaves the search; Back does the same", () => {
    toLibrary();
    key({ command: "screenKey", args: { text: "p" } });
    text("pand");
    key("back");
    expect(screen().state.view).toBe("librarySearch");
    expect(screen().state.typingBy).toBeUndefined();
    expect(screen().search!.query).toBe("pand");
    key("back");
    expect(screen().state.view).toBe("library");
    key("find");
    key("back");
    expect(screen().state.view).toBe("librarySearch");
    expect(screen().state.typingBy).toBeUndefined();
  });

  test("a phone's Back also leaves the field first", async () => {
    toLibrary();
    key("find");
    await phone.press("back");
    expect(screen().state.view).toBe("librarySearch");
    expect(screen().state.typingBy).toBeUndefined();
  });

  test("with no phone connected the Screen can still search", async () => {
    phone.close();
    await new Promise((r) => setTimeout(r, 20));
    toLibrary();
    key("find");
    text("amelie");
    expect(films$()).toEqual(["Amélie"]);
  });

  test("leaving the view ends the Screen's session and later text goes nowhere", () => {
    toLibrary();
    key("find");
    text("pan");
    key("home");
    expect(screen().state.typingBy).toBeUndefined();
    expect(screen().screenTyping).toBeUndefined();
    text("leaked");
    expect(screen().state.view).toBe("home");
    toLibrary();
    key({ command: "screenKey", args: { text: "a" } });
    expect(screen().search!.query).toBe("a");
  });
});

describe("Screen typing: TMDB key", () => {
  test("typed on the Screen, saved on Enter, and never in a payload, snapshot or toast", async () => {
    await toDetails();
    key("ok");
    expect(screen().state.typingBy).toBe("screen");
    expect(screen().screenTyping).toBe("tmdbKey");
    text(SECRET);
    key("typeSubmit");
    expect(screen().state.typingBy).toBeUndefined();
    expect(h.app.core.details.settings().hasOwnKey).toBe(true);
    expect(h.app.core.details.settings().keyLabel).toBe("Your key •••• 7890");
    expect(await everything()).not.toContain(SECRET);
    expect(JSON.stringify(h.store.read("tmdb", {}))).toContain(SECRET);
  });

  test("while typing, the text is in no payload or snapshot either", async () => {
    await toDetails();
    key("ok");
    text(SECRET);
    expect(await everything()).not.toContain(SECRET);
    expect(await everything()).not.toContain("secret-tmdb");
  });

  test("Esc cancels without saving and forgets the text", async () => {
    await toDetails();
    key("ok");
    text(SECRET);
    key("back");
    expect(screen().state.view).toBe("details");
    expect(screen().state.typingBy).toBeUndefined();
    key("typeSubmit");
    expect(h.app.core.details.settings().hasOwnKey).toBe(false);
    key("ok");
    key("typeSubmit");
    expect(h.app.core.details.settings().hasOwnKey).toBe(false);
  });

  test("leaving the page drops the key being typed", async () => {
    await toDetails();
    key("ok");
    text(SECRET);
    key("home");
    expect(screen().state.typingBy).toBeUndefined();
    key("typeSubmit");
    expect(h.app.core.details.settings().hasOwnKey).toBe(false);
  });
});

describe("Screen typing: YouTube", () => {
  beforeEach(() => {
    key("home");
    key("ok");
    expect(screen().state.view).toBe("youtube");
  });

  test("⌘F or / opens Couch's typing path; typed text reaches setSearchText; Enter submits", () => {
    key("find");
    expect(screen().state.typingBy).toBe("screen");
    expect(calls("openSearch")).toHaveLength(1);
    expect(calls("captureText").at(-1)!.args).toEqual([true]);
    h.youtube.emit({ type: "edit", edit: { insert: "k" } });
    h.youtube.emit({ type: "edit", edit: { insert: "er" } });
    h.youtube.emit({ type: "edit", edit: { erase: "char" } });
    h.youtube.emit({ type: "edit", edit: { insert: "ala" } });
    expect(calls("setSearchText").map((c) => c.args[0])).toEqual(["k", "ker", "ke", "keala"]);
    h.youtube.emit({ type: "edit", edit: { erase: "word" } });
    expect(calls("setSearchText").at(-1)!.args).toEqual([""]);
    h.youtube.emit({ type: "edit", edit: { insert: "cats" } });
    h.youtube.emit({ type: "edit", edit: { done: "submit" } });
    expect(calls("submitSearch")).toHaveLength(1);
    expect(screen().state.typingBy).toBeUndefined();
    expect(calls("captureText").at(-1)!.args).toEqual([false]);
  });

  test("the port's find event opens typing; Esc closes it without submitting", () => {
    h.youtube.emit({ type: "find" });
    expect(screen().state.typingBy).toBe("screen");
    h.youtube.emit({ type: "edit", edit: { insert: "a" } });
    h.youtube.emit({ type: "edit", edit: { done: "cancel" } });
    expect(screen().state.typingBy).toBeUndefined();
    expect(calls("submitSearch")).toHaveLength(0);
    h.youtube.emit({ type: "edit", edit: { insert: "stray" } });
    expect(calls("setSearchText").map((c) => c.args[0])).toEqual(["a"]);
  });

  test("other keys keep driving YouTube while no session is open", () => {
    h.youtube.emit({ type: "key", command: "down" });
    expect(calls("sendKey").map((c) => c.args[0])).toContain("down");
    expect(screen().state.typingBy).toBeUndefined();
  });

  test("leaving YouTube ends the session and stops the capture", () => {
    key("find");
    key("home");
    expect(screen().state.typingBy).toBeUndefined();
    expect(calls("captureText").at(-1)!.args).toEqual([false]);
    h.youtube.emit({ type: "edit", edit: { insert: "x" } });
    expect(calls("setSearchText")).toEqual([]);
  });
});

describe("Screen and phone take over from each other", () => {
  test("the Screen takes over a phone's search; the phone's sheet closes and its text is ignored", async () => {
    await phone.press("home");
    toLibrary();
    await phone.press("typeOpen");
    expect(phone.last!.typing).toBe("you");
    key("find");
    await phone.settle();
    expect(screen().state.typingBy).toBe("screen");
    expect(phone.last!.typing).toBe("other");
    await phone.press({ command: "typeText", args: { text: "intruder" } });
    expect(screen().search!.query).toBe("");
    text("amelie");
    expect(films$()).toEqual(["Amélie"]);
  });

  test("a phone takes over the Screen's session; the Screen's text is then ignored", async () => {
    toLibrary();
    key("find");
    text("pan");
    await phone.press("typeOpen");
    expect(phone.last!.typing).toBe("you");
    expect(screen().state.typingBy).not.toBe("screen");
    expect(screen().screenTyping).toBeUndefined();
    text("hijack");
    expect(screen().search!.query).toBe("pan");
    await phone.press({ command: "typeText", args: { text: "amelie" } });
    expect(films$()).toEqual(["Amélie"]);
  });

  test("the Screen takes over a phone's YouTube typing, and back", async () => {
    key("home");
    await phone.press("ok");
    await phone.press("typeOpen");
    expect(phone.last!.typing).toBe("you");
    h.youtube.emit({ type: "find" });
    await phone.settle();
    expect(phone.last!.typing).toBe("other");
    await phone.press({ command: "typeText", args: { text: "nope" } });
    expect(calls("setSearchText")).toEqual([]);
    h.youtube.emit({ type: "edit", edit: { insert: "yes" } });
    expect(calls("setSearchText").map((c) => c.args[0])).toEqual(["yes"]);
    await phone.press("typeOpen");
    expect(phone.last!.typing).toBe("you");
    expect(calls("captureText").at(-1)!.args).toEqual([false]);
    h.youtube.emit({ type: "edit", edit: { insert: "late" } });
    expect(calls("setSearchText").map((c) => c.args[0])).toEqual(["yes"]);
  });

  test("two phones still cannot take over from each other", async () => {
    toLibrary();
    const b = await h.connectPhone();
    await phone.press("typeOpen");
    await b.press("typeOpen");
    expect(b.last!.typing).toBe("other");
    expect(phone.last!.typing).toBe("you");
  });
});

describe("nothing typed for one purpose reaches another", () => {
  test("the TMDB key never becomes a Library query or YouTube text", async () => {
    await toDetails();
    key("ok");
    text(SECRET);
    h.youtube.emit({ type: "edit", edit: { insert: SECRET } });
    key("typeSubmit");
    toLibrary();
    key("find");
    expect(screen().search!.query).toBe("");
    expect(h.youtube.calls.filter((c) => c.call === "setSearchText")).toEqual([]);
    expect(await everything()).not.toContain(SECRET);
  });

  test("a Library search never becomes a TMDB key or YouTube text", async () => {
    toLibrary();
    key("find");
    text("panda");
    key("typeSubmit");
    expect(h.app.core.details.settings().hasOwnKey).toBe(false);
    expect(calls("setSearchText")).toEqual([]);
    await toDetails();
    key("typeSubmit");
    expect(h.app.core.details.settings().hasOwnKey).toBe(false);
  });

  test("YouTube text never becomes a Library query or TMDB key", async () => {
    key("home");
    key("ok");
    key("find");
    h.youtube.emit({ type: "edit", edit: { insert: "cats" } });
    key("home");
    toLibrary();
    key("find");
    expect(screen().search!.query).toBe("");
    text("");
    expect(h.app.core.details.settings().hasOwnKey).toBe(false);
  });

  test("a Screen session's text is ignored once the session ended, whatever the view", () => {
    toLibrary();
    key("find");
    key("typeSubmit");
    text("late");
    expect(screen().search!.query).toBe("");
    key({ command: "typeOpen" });
    key("home");
    text("later");
    expect(screen().state.view).toBe("home");
  });
});
