import { describe, expect, test } from "vite-plus/test";
import { FakeClock, FakeYouTube } from "../ports/fakes.ts";
import type { YouTube } from "../ports/youtube.ts";
import type { TextSize } from "../web/text-size.ts";
import type { App } from "./app.ts";
import { BitChordApp } from "./bitchord/bitchord-app.ts";
import { NetflixApp } from "./netflix/netflix-app.ts";
import { YouTubeApp } from "./youtube/youtube-app.ts";

/** A port that supports Text size, recording what it is given. */
function sizedPort() {
  const sizes: TextSize[] = [];
  const port = Object.assign(new FakeYouTube(), {
    supportsTextSize: true,
    setTextSize: (size: TextSize) => void sizes.push(size),
  }) as YouTube;
  return { port, sizes };
}

describe("Text size at the App boundary", () => {
  test.each([
    ["Netflix", (p: YouTube) => new NetflixApp(p, new FakeClock())],
    ["BitChord", (p: YouTube) => new BitChordApp(p, new FakeClock())],
  ])("%s reports the port's support and passes the size on", (_name, make) => {
    const { port, sizes } = sizedPort();
    const app = make(port);
    expect(app.supportsTextSize).toBe(true);
    app.setTextSize?.("larger");
    expect(sizes).toEqual(["larger"]);
    expect(make(new FakeYouTube()).supportsTextSize).toBe(false);
  });

  test("YouTube's App reports unsupported and ignores a size", () => {
    const { port, sizes } = sizedPort();
    const app: App = new YouTubeApp(port, new FakeClock());
    expect(app.supportsTextSize).toBe(false);
    app.setTextSize?.("larger");
    expect(sizes).toEqual([]);
  });
});
