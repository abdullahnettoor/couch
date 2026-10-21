import { describe, expect, test } from "vite-plus/test";
import { COMPAT_SCRIPT, compatEnabled } from "./youtube-compat.ts";

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
