import vm from "node:vm";
import { describe, expect, test } from "vite-plus/test";
import {
  SELF_TEST_EXPECTED_EVENTS,
  SELF_TEST_EXPECTED_MOVE,
  SELF_TEST_KEYS,
  SELF_TEST_SCRIPT,
  summarizeSelfTest,
} from "./webkit-selftest.ts";

describe("summarizing the WebKit self-test", () => {
  const raw = {
    ua: "Mozilla/5.0 Safari",
    keySystems: {
      "com.apple.fps": "granted",
      "com.apple.fps.3_0": "granted",
      "com.widevine.alpha": "denied: NotSupportedError",
    },
    setSinkId: "function",
    audioContextSetSinkId: "undefined",
    mediaDevices: true,
    devices: [{ kind: "audioinput" }, { kind: "videoinput" }],
    keys: ["keydown:ArrowUp", "keyup:ArrowUp"],
  };

  test("FairPlay is available when com.apple.fps.3_0 is granted", () => {
    expect(summarizeSelfTest(raw).fairPlay).toBe(true);
    expect(
      summarizeSelfTest({
        ...raw,
        keySystems: { "com.apple.fps.3_0": "denied: NotSupportedError" },
      }).fairPlay,
    ).toBe(false);
  });

  test("reports setSinkId on media elements and whether audiooutput devices are listed", () => {
    expect(summarizeSelfTest(raw)).toMatchObject({ setSinkId: true, audioOutputListed: false });
    expect(
      summarizeSelfTest({
        ...raw,
        setSinkId: "undefined",
        devices: [{ kind: "audiooutput" }],
      }),
    ).toMatchObject({ setSinkId: false, audioOutputListed: true });
  });

  test("lists the keys the page saw, and survives an empty answer", () => {
    expect(summarizeSelfTest(raw).keys).toEqual(["keydown:ArrowUp", "keyup:ArrowUp"]);
    expect(summarizeSelfTest(undefined)).toMatchObject({
      fairPlay: false,
      setSinkId: false,
      audioOutputListed: false,
      keys: [],
      moves: [],
    });
  });

  test("lists where the page saw each mousemove (client coordinates), which the selftest checks", () => {
    expect(summarizeSelfTest({ ...raw, moves: [[200, 520]] }).moves).toEqual([[200, 520]]);
    expect(SELF_TEST_EXPECTED_EVENTS).toContain("mousemove:trusted");
    expect(SELF_TEST_EXPECTED_MOVE).toEqual([200, 520]);
  });
});

describe("the self-test script", () => {
  test("asks for the FairPlay and Widevine key systems and reads the sink API and devices", async () => {
    const asked: string[] = [];
    const sandbox: any = {
      navigator: {
        userAgent: "UA",
        requestMediaKeySystemAccess: async (ks: string) => {
          asked.push(ks);
          if (ks.startsWith("com.apple")) return {};
          throw Object.assign(new Error("no"), { name: "NotSupportedError" });
        },
        mediaDevices: { enumerateDevices: async () => [{ kind: "audiooutput" }] },
      },
      HTMLMediaElement: { prototype: { setSinkId() {} } },
      window: { __keys: ["keydown:ArrowUp"] },
    };
    vm.createContext(sandbox);
    const result = await vm.runInContext(SELF_TEST_SCRIPT, sandbox);
    expect(asked).toEqual(["com.apple.fps", "com.apple.fps.3_0", "com.widevine.alpha"]);
    expect(summarizeSelfTest(result)).toMatchObject({
      fairPlay: true,
      setSinkId: true,
      audioOutputListed: true,
      keys: ["keydown:ArrowUp"],
    });
  });

  test("sends the arrows, OK and Back", () => {
    expect(SELF_TEST_KEYS.slice(0, 6)).toEqual(["Up", "Down", "Left", "Right", "Return", "Escape"]);
  });

  test("also replays Mac keys and a pointer click and wheel tick through the input paths", () => {
    expect(SELF_TEST_KEYS.slice(6)).toEqual([
      "replay:6:z:0",
      "replay:0:A:131072",
      "pointer:200:200",
    ]);
  });
});
