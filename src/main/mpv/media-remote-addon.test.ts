import { describe, expect, test } from "vite-plus/test";
import { createRemoteCommands, type MediaRemoteAddon } from "./embed-addon.ts";

function fakeAddon() {
  const calls: unknown[][] = [];
  let press: (command: string) => void = () => {};
  const addon: MediaRemoteAddon = {
    mediaRemoteStart: (cb) => {
      calls.push(["start"]);
      press = cb;
    },
    mediaRemoteSetInfo: (...args) => calls.push(["info", ...args]),
    mediaRemoteStop: () => calls.push(["stop"]),
    mediaRemoteSelfTest: () => "{}",
  };
  return { addon, calls, press: (c: string) => press(c) };
}

describe("the remote commands over the native add-on", () => {
  test("is unavailable when the add-on isn't built or lacks the functions", () => {
    expect(
      createRemoteCommands(() => {
        throw new Error("no addon");
      }),
    ).toBeUndefined();
    expect(createRemoteCommands(() => ({}) as MediaRemoteAddon)).toBeUndefined();
  });

  test("loading it registers nothing", () => {
    const f = fakeAddon();
    createRemoteCommands(() => f.addon);
    expect(f.calls).toEqual([]);
  });

  test("passes info and stop through, and only known commands reach Couch", () => {
    const f = fakeAddon();
    const center = createRemoteCommands(() => f.addon)!;
    const got: string[] = [];
    center.start((c) => got.push(c));
    center.setInfo({ title: "T", app: "A", position: 1, duration: 2, paused: true });
    f.press("toggle");
    f.press("bogus");
    f.press("next");
    center.stop();
    expect(got).toEqual(["toggle", "next"]);
    expect(f.calls).toEqual([["start"], ["info", "T", "A", 1, 2, true], ["stop"]]);
  });
});
