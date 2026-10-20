import { describe, expect, test } from "vite-plus/test";
import { applyCompatPatch, COMPAT_SCRIPT, compatEnabled } from "./youtube-compat.ts";

function fakeContents(fail?: "attach" | "send") {
  const sent: [string, unknown][] = [];
  return {
    sent,
    wc: {
      debugger: {
        isAttached: () => false,
        attach: () => {
          if (fail === "attach") throw new Error("attach boom");
        },
        sendCommand: async (m: string, p?: unknown) => {
          if (fail === "send") throw new Error("send boom");
          sent.push([m, p]);
        },
      },
    },
  };
}

function runScript() {
  const real = (t: string) => t.includes("avc1");
  const win: any = {
    matchMedia: () => ({ matches: false }),
    MediaSource: { isTypeSupported: real },
  };
  new Function("window", "MediaSource", COMPAT_SCRIPT)(win, win.MediaSource);
  return win;
}

describe("YouTube compat patch", () => {
  test("registers the script for every new document", async () => {
    const f = fakeContents();
    const logs: string[] = [];
    expect(await applyCompatPatch(f.wc, { log: (m) => logs.push(m) })).toBe(true);
    expect(f.sent[0][0]).toBe("Page.addScriptToEvaluateOnNewDocument");
    expect((f.sent[0][1] as { source: string }).source).toBe(COMPAT_SCRIPT);
    expect(logs).toEqual([]);
  });

  test("disabled: does nothing", async () => {
    const f = fakeContents();
    expect(await applyCompatPatch(f.wc, { enabled: false, log: () => {} })).toBe(false);
    expect(f.sent).toEqual([]);
  });

  test.each(["attach", "send"] as const)("%s failure is logged, not thrown", async (mode) => {
    const logs: string[] = [];
    const f = fakeContents(mode);
    expect(await applyCompatPatch(f.wc, { log: (m) => logs.push(m) })).toBe(false);
    expect(logs[0]).toContain("boom");
  });

  test("env switch", () => {
    expect(compatEnabled({ COUCH_YOUTUBE_PATCH: "off" })).toBe(false);
    expect(compatEnabled({})).toBe(true);
  });

  test("script mimics Cobalt's isTypeSupported and unlocks the container size", () => {
    const w = runScript();
    const t = (s: string) => w.MediaSource.isTypeSupported(s);
    expect(t('video/mp4; codecs="avc1.640028"; width=3840; height=2160; framerate=60')).toBe(true);
    expect(t('video/mp4; codecs="avc1.640028"; framerate=9999')).toBe(false);
    expect(t('video/mp4; codecs="avc1.640028"; width=99999')).toBe(false);
    expect(t('video/mp4; codecs="avc1.640028"; eotf=smpte2084')).toBe(false);
    expect(t('video/mp4; codecs="vp09.02.10.10.01.09.16.09.00"')).toBe(false);
    expect(w.h5vcc.system.getVideoContainerSizeOverride()).toBe("7680x4320");
  });

  test("script never throws if MediaSource is missing", () => {
    expect(() => new Function("window", "MediaSource", COMPAT_SCRIPT)({}, undefined)).not.toThrow();
  });
});
