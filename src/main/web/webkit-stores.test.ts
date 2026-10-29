import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import {
  WEBKIT_STORES_FILE,
  removeWebKitStore,
  resolveWebKitStore,
  webkitEphemeral,
} from "./webkit-stores.ts";

const root = () => mkdtempSync(join(tmpdir(), "couch-webkit-stores-"));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("which WebKit data store an App uses", () => {
  test("two userData roots get different stores for the same App", () => {
    const a = resolveWebKitStore("netflix", { userDataDir: root(), env: {} });
    const b = resolveWebKitStore("netflix", { userDataDir: root(), env: {} });
    expect(a).toMatchObject({ ephemeral: false, id: expect.stringMatching(UUID) });
    expect(b).toMatchObject({ ephemeral: false, id: expect.stringMatching(UUID) });
    expect(a).not.toEqual(b);
  });

  test("one userData root keeps the same store across launches", () => {
    const dir = root();
    const first = resolveWebKitStore("netflix", { userDataDir: dir, env: {} });
    expect(resolveWebKitStore("netflix", { userDataDir: dir, env: {} })).toEqual(first);
  });

  test("Apps in one userData root have stores apart from each other", () => {
    const dir = root();
    expect(resolveWebKitStore("netflix", { userDataDir: dir, env: {} })).not.toEqual(
      resolveWebKitStore("other", { userDataDir: dir, env: {} }),
    );
  });

  test("the namespace is created once and kept in userData", () => {
    const dir = root();
    resolveWebKitStore("netflix", { userDataDir: dir, env: {} });
    const saved = JSON.parse(readFileSync(join(dir, WEBKIT_STORES_FILE), "utf8"));
    expect(saved.namespace).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("a damaged file is replaced with a new namespace", () => {
    const dir = root();
    writeFileSync(join(dir, WEBKIT_STORES_FILE), "{not json");
    expect(resolveWebKitStore("netflix", { userDataDir: dir, env: {} })).toMatchObject({
      ephemeral: false,
    });
  });

  test("COUCH_WEBKIT_EPHEMERAL=1 selects the non-persistent store and writes nothing", () => {
    const dir = root();
    expect(
      resolveWebKitStore("netflix", { userDataDir: dir, env: { COUCH_WEBKIT_EPHEMERAL: "1" } }),
    ).toEqual({ ephemeral: true });
    expect(() => readFileSync(join(dir, WEBKIT_STORES_FILE))).toThrow();
  });

  test("only the exact value 1 turns the flag on", () => {
    expect(webkitEphemeral({ COUCH_WEBKIT_EPHEMERAL: "1" })).toBe(true);
    expect(webkitEphemeral({ COUCH_WEBKIT_EPHEMERAL: "0" })).toBe(false);
    expect(webkitEphemeral({ COUCH_WEBKIT_EPHEMERAL: "true" })).toBe(false);
    expect(webkitEphemeral({})).toBe(false);
  });
});

describe("removing an App's WebKit store (sign out)", () => {
  test("asks the bridge to remove exactly this userData's store", async () => {
    const dir = root();
    const store = resolveWebKitStore("netflix", { userDataDir: dir, env: {} });
    const removed: string[] = [];
    await removeWebKitStore("netflix", {
      userDataDir: dir,
      env: {},
      bridge: { removeStore: async (id) => void removed.push(id) },
    });
    expect(removed).toEqual([(store as { id: string }).id]);
  });

  test("an ephemeral store has nothing to remove", async () => {
    const removed: string[] = [];
    await removeWebKitStore("netflix", {
      userDataDir: root(),
      env: { COUCH_WEBKIT_EPHEMERAL: "1" },
      bridge: { removeStore: async (id) => void removed.push(id) },
    });
    expect(removed).toEqual([]);
  });
});
