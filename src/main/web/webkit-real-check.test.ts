import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { resolveWebKitStore } from "./webkit-stores.ts";
import {
  CHECK_PORTS,
  HOUSEHOLD_PORTS,
  assertSafeWebkitRealCheck,
  webkitRealCheckEnv,
  webkitRealCheckLaunch,
} from "./webkit-real-check.ts";

const temp = () => mkdtempSync(join(tmpdir(), "couch-real-check-"));

describe("the agent's WebKit real check", () => {
  test("uses explicit Remote and Listener ports that are not the household's", () => {
    const env = webkitRealCheckEnv();
    expect(Number(env.COUCH_PORT)).toBe(CHECK_PORTS.remote);
    expect(Number(env.COUCH_APP_PORT)).toBe(CHECK_PORTS.app);
    for (const port of HOUSEHOLD_PORTS) {
      expect(Number(env.COUCH_PORT)).not.toBe(port);
      expect(Number(env.COUCH_APP_PORT)).not.toBe(port);
    }
    expect(HOUSEHOLD_PORTS).toEqual([4747, 4748]);
  });

  test("asks for WebKit and the non-persistent store, and the store it gets is non-persistent", () => {
    const env = webkitRealCheckEnv();
    expect(env.COUCH_NETFLIX_ENGINE).toBe("webkit");
    expect(env.COUCH_WEBKIT_EPHEMERAL).toBe("1");
    expect(resolveWebKitStore("netflix", { userDataDir: temp(), env })).toEqual({
      ephemeral: true,
    });
  });

  test("overrides whatever ports and flags the shell already had", () => {
    const env = webkitRealCheckEnv({
      COUCH_PORT: "4747",
      COUCH_APP_PORT: "4748",
      COUCH_WEBKIT_EPHEMERAL: "0",
    });
    expect(() => assertSafeWebkitRealCheck(env, temp())).not.toThrow();
  });

  test("the launch is a temp userData and the safe env", () => {
    const dir = temp();
    const launch = webkitRealCheckLaunch(dir, {});
    expect(launch.args).toEqual(["scripts/dev-electron.mjs", `--user-data-dir=${dir}`]);
    expect(launch.env.COUCH_PORT).toBe(String(CHECK_PORTS.remote));
  });

  describe("refuses anything that could touch the household's Couch", () => {
    const safe = () => webkitRealCheckEnv();
    test.each([
      ["no Remote port", { COUCH_PORT: undefined }],
      ["no Listener port", { COUCH_APP_PORT: undefined }],
      ["the Remote's default port", { COUCH_PORT: "4747" }],
      ["the Listener's default app port", { COUCH_APP_PORT: "4748" }],
      ["the default Listener port as the app port", { COUCH_APP_PORT: "4747" }],
      ["a port that is not a number", { COUCH_PORT: "http" }],
      ["the same port twice", { COUCH_APP_PORT: String(CHECK_PORTS.remote) }],
      ["a persistent store", { COUCH_WEBKIT_EPHEMERAL: undefined }],
      ["a flag that is not exactly 1", { COUCH_WEBKIT_EPHEMERAL: "true" }],
      ["the Chromium engine", { COUCH_NETFLIX_ENGINE: undefined }],
    ])("%s", (_name, change) => {
      expect(() => assertSafeWebkitRealCheck({ ...safe(), ...change }, temp())).toThrow();
    });

    test.each([
      ["the household's userData", join(homedir(), "Library/Application Support/couch")],
      ["a folder under Application Support", join(homedir(), "Library/Application Support/x")],
      ["the temp directory itself", tmpdir()],
      ["a folder outside the temp directory", join(homedir(), "couch-check")],
      ["a path that climbs out of the temp directory", join(tmpdir(), "..", "couch-check")],
    ])("%s", (_name, dir) => {
      expect(() => assertSafeWebkitRealCheck(safe(), dir)).toThrow(/userData/);
    });
  });
});
