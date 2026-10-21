import { describe, expect, test } from "vite-plus/test";
import { MemoryStore } from "../ports/store.ts";
import { enabledAddons, readChoices, writeChoice, type Addon } from "./addon.ts";

const add = (id: string, defaultOn: boolean): Addon => ({
  id,
  label: id,
  description: "",
  app: "youtube",
  defaultOn,
});
const list = [add("a", true), add("b", false)];

describe("add-on choices", () => {
  test("defaults apply until the household chooses", () => {
    expect(enabledAddons(list, {}).map((a) => a.id)).toEqual(["a"]);
    expect(enabledAddons(list, { a: false, b: true }).map((a) => a.id)).toEqual(["b"]);
  });

  test("the Store holds only choices that differ from the default", () => {
    const store = new MemoryStore();
    writeChoice(store, list, "youtube", "b", true);
    writeChoice(store, list, "youtube", "a", false);
    expect(store.read("addons", {})).toEqual({ youtube: { b: true, a: false } });
    writeChoice(store, list, "youtube", "b", false);
    writeChoice(store, list, "youtube", "a", true);
    expect(store.read("addons", {})).toEqual({ youtube: {} });
    expect(readChoices(store, "youtube")).toEqual({});
  });

  test("an unreadable document means defaults", () => {
    const store = new MemoryStore();
    store.write("addons", { youtube: "nope" });
    expect(readChoices(store, "youtube")).toEqual({});
  });
});
