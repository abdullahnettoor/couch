import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  createReadStream,
  type ReadStream,
} from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { WebAppDescription } from "./web-app.ts";

/**
 * A developer-only way to check Couch's screen over a *playing* WebKit page without Netflix: with
 * `COUCH_NETFLIX_ENGINE=webkit COUCH_WEBKIT_EPHEMERAL=1 COUCH_WEBKIT_TEST_PAGE=1`, the Netflix App's host loads a
 * page of Couch's own, on a loopback server, that plays a synthetic clip. Netflix's own description, scripts and
 * playback probe still run on it (the address is a `/watch/` page), so Picture off, Quick settings, the volume
 * display, questions and the search bar can be checked while "something plays", with no account and no network.
 */
/**
 * Electron reports `isPackaged` true for any executable not named "electron", including the renamed dev copy
 * (`Couch.app`) that `scripts/dev-electron.mjs` runs; that one is launched with an app path, so `defaultApp` is set.
 */
export function isPackagedBuild(
  app: { isPackaged: boolean },
  proc: { defaultApp?: boolean },
): boolean {
  return app.isPackaged && !proc.defaultApp;
}

export function testPageEnabled(
  env: Record<string, string | undefined>,
  build: { isPackaged: boolean },
): boolean {
  if (build.isPackaged || env.NODE_ENV === "production") return false;
  return (
    env.COUCH_NETFLIX_ENGINE === "webkit" &&
    env.COUCH_WEBKIT_EPHEMERAL === "1" &&
    env.COUCH_WEBKIT_TEST_PAGE === "1"
  );
}

const CLIP = "/clip.mp4";
const WATCH = "/watch/1";

export function testPageHtml(): string {
  return `<!doctype html><meta charset="utf-8"><title>Couch test page</title>
<style>html,body{margin:0;height:100%;background:#102a43;overflow:hidden}video{position:fixed;inset:0;width:100%;height:100%;object-fit:cover}</style>
<video src="${CLIP}" autoplay muted loop playsinline></video>
<button id="b1" style="position:fixed;left:40px;top:40px;width:200px;height:60px">One</button>
<script>
var root = document.documentElement;
root.dataset.pageSawHost = typeof window.couchHost;
root.dataset.clicks = "0";
try { navigator.mediaSession.metadata = new MediaMetadata({ title: "Test Pattern" }); } catch (e) {}
document.getElementById("b1").addEventListener("click", function () { root.dataset.clicks = String(+root.dataset.clicks + 1); });
// A page handler registered after Couch's own: when told to (through the DOM), it takes Enter for itself, as a site's own key handling would.
addEventListener("DOMContentLoaded", function () {
  addEventListener("keydown", function (e) { if (root.dataset.takeEnter && e.key === "Enter") e.preventDefault(); });
});
</script>`;
}

/** One `bytes=a-b`, `bytes=a-` or `bytes=-n` range, clamped to the file; undefined when it can't be served. */
export function parseRange(
  header: string,
  size: number,
): { start: number; end: number } | undefined {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!m || (m[1] === "" && m[2] === "")) return undefined;
  let start: number;
  let end: number;
  if (m[1] === "") {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return undefined;
  return { start, end };
}

export interface TestPageServer {
  url: string;
  origin: string;
  host: string;
  close: () => Promise<void>;
}

/** Serves the watch page and the clip (with byte ranges, which WebKit's media needs) on 127.0.0.1 only. */
export function serveTestPage(clipPath: string): Promise<TestPageServer> {
  const streams = new Set<ReadStream>();
  const send = (stream: ReadStream, res: ServerResponse) => {
    streams.add(stream);
    stream.once("close", () => streams.delete(stream));
    stream.on("error", () => res.destroy());
    res.once("close", () => stream.destroy());
    stream.pipe(res);
  };
  const server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (path === WATCH) {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(testPageHtml());
      return;
    }
    if (path !== CLIP || !existsSync(clipPath)) {
      res.writeHead(404).end();
      return;
    }
    const size = statSync(clipPath).size;
    const head = { "content-type": "video/mp4", "accept-ranges": "bytes" };
    const asked = req.headers.range;
    if (asked === undefined) {
      res.writeHead(200, { ...head, "content-length": String(size) });
      send(createReadStream(clipPath), res);
      return;
    }
    const range = parseRange(asked, size);
    if (!range) {
      res.writeHead(416, { "content-range": `bytes */${size}` }).end();
      return;
    }
    res.writeHead(206, {
      ...head,
      "content-range": `bytes ${range.start}-${range.end}/${size}`,
      "content-length": String(range.end - range.start + 1),
    });
    send(createReadStream(clipPath, range), res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const origin = `http://127.0.0.1:${port}`;
      resolve({
        url: `${origin}${WATCH}`,
        origin,
        host: "127.0.0.1",
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            for (const stream of streams) stream.destroy();
            server.closeAllConnections();
          }),
      });
    });
  });
}

/** Netflix's description, pointed at the test page and trusting only its origin. */
export function testPageDescription(base: WebAppDescription, origin: string): WebAppDescription {
  return { ...base, url: `${origin}${WATCH}`, isOwnOrigin: (o) => o === origin };
}

/** ffmpeg's arguments for a minute of moving test pattern (h264, no sound), small enough to make in a second or two. */
export function clipArguments(out: string): string[] {
  return [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=1280x720:rate=24",
    "-t",
    "60",
    "-pix_fmt",
    "yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-movflags",
    "+faststart",
    out,
  ];
}

/** Makes the clip in `dir` once (ffmpeg is already one of Couch's tools); resolves its path, or undefined without ffmpeg. */
export function ensureTestClip(
  dir: string,
  ffmpeg: string | undefined,
): Promise<string | undefined> {
  mkdirSync(dir, { recursive: true });
  const out = join(dir, "test-clip.mp4");
  if (existsSync(out) && readFileSync(out).length > 0) return Promise.resolve(out);
  if (!ffmpeg) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    execFile(ffmpeg, clipArguments(out), { timeout: 60_000 }, (error) =>
      resolve(error ? undefined : out),
    );
  });
}
