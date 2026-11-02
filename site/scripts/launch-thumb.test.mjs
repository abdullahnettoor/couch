// Unit tests of scripts/launch-thumb.mjs (ticket 145 review): fetch and the converter are mocks, so nothing goes to
// YouTube and cwebp is not needed. Placeholder mode, a local picture and a saved thumbnail fetch nothing; the sources
// are tried maxres → sd → hq (a missing one or YouTube's 120 × 90 stand-in is skipped, 4:3 is cropped to 16:9); both
// files are written; --refresh fetches again.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { jpegSize, saveThumb } from "./launch-thumb.mjs";

const ID = "TESTvideo01";
/** The smallest JPEG jpegSize reads: SOI, then a start-of-frame marker with its height and width. */
const jpeg = (w, h) => { const b = Buffer.alloc(24); b.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]); b.writeUInt16BE(h, 7); b.writeUInt16BE(w, 9); return b; };
/** A fetch that answers from `pictures` (source name → JPEG), 404 for the rest, and records every URL. */
function mockFetch(pictures) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    const name = url.match(/\/([a-z]+)\.jpg$/)[1];
    return pictures[name] ? new Response(pictures[name]) : new Response("", { status: 404 });
  };
  return { fetch, calls };
}
/** A converter that writes what it was asked to do into the output file. */
function mockConvert() {
  const runs = [];
  const convert = (src, out, opts) => { runs.push({ src, out, ...opts }); writeFileSync(out, JSON.stringify(opts)); };
  return { convert, runs };
}
const quiet = () => {};
const url = (name) => `https://i.ytimg.com/vi/${ID}/${name}.jpg`;

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "couch-thumb-test-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("jpegSize reads the start-of-frame marker", () => {
  assert.deepEqual(jpegSize(jpeg(1280, 720)), { w: 1280, h: 720 });
});

test("placeholder mode fetches nothing and converts nothing", async () => {
  const f = mockFetch({ maxresdefault: jpeg(1280, 720) }), c = mockConvert();
  assert.deepEqual(await saveThumb({ id: "", dir, fetch: f.fetch, convert: c.convert, log: quiet }), { status: "placeholder" });
  assert.deepEqual(f.calls, []);
  assert.deepEqual(c.runs, []);
});

test("a local picture (COUCH_LAUNCH_THUMB) fetches nothing", async () => {
  const f = mockFetch({}), c = mockConvert();
  assert.equal((await saveThumb({ id: ID, local: "x.webp", dir, fetch: f.fetch, convert: c.convert, log: quiet })).status, "local");
  assert.deepEqual(f.calls, []);
});

test("maxres: one fetch, both files written at 1280 and 640, no crop", async () => {
  const f = mockFetch({ maxresdefault: jpeg(1280, 720), sddefault: jpeg(640, 480) }), c = mockConvert();
  assert.deepEqual(await saveThumb({ id: ID, dir, fetch: f.fetch, convert: c.convert, log: quiet }), { status: "saved", from: "maxresdefault" });
  assert.deepEqual(f.calls, [url("maxresdefault")]);
  assert.deepEqual(c.runs.map((r) => [r.out, r.width, r.crop]), [
    [join(dir, `${ID}.webp`), 1280, [0, 0, 1280, 720]],
    [join(dir, `${ID}-640.webp`), 640, [0, 0, 1280, 720]],
  ]);
  assert.ok(existsSync(join(dir, `${ID}.webp`)) && existsSync(join(dir, `${ID}-640.webp`)));
});

test("no maxres: falls back to sd, its 4:3 letterbox cropped to 16:9", async () => {
  const f = mockFetch({ sddefault: jpeg(640, 480), hqdefault: jpeg(480, 360) }), c = mockConvert();
  assert.equal((await saveThumb({ id: ID, dir, fetch: f.fetch, convert: c.convert, log: quiet })).from, "sddefault");
  assert.deepEqual(f.calls, [url("maxresdefault"), url("sddefault")]);
  assert.deepEqual(c.runs.map((r) => [r.width, r.crop]), [[640, [0, 60, 640, 360]], [640, [0, 60, 640, 360]]]);
});

test("maxres is YouTube's 120 × 90 stand-in and no sd: falls back to hq", async () => {
  const f = mockFetch({ maxresdefault: jpeg(120, 90), hqdefault: jpeg(480, 360) }), c = mockConvert();
  assert.equal((await saveThumb({ id: ID, dir, fetch: f.fetch, convert: c.convert, log: quiet })).from, "hqdefault");
  assert.deepEqual(f.calls, [url("maxresdefault"), url("sddefault"), url("hqdefault")]);
  assert.deepEqual(c.runs.map((r) => [r.width, r.crop]), [[480, [0, 45, 480, 270]], [480, [0, 45, 480, 270]]]);
});

test("no thumbnail at all: an error, no files", async () => {
  const f = mockFetch({}), c = mockConvert();
  await assert.rejects(saveThumb({ id: ID, dir, fetch: f.fetch, convert: c.convert, log: quiet }), /no thumbnail/);
  assert.equal(f.calls.length, 3);
  assert.deepEqual(c.runs, []);
});

test("not an id: an error before any fetch", async () => {
  const f = mockFetch({});
  await assert.rejects(saveThumb({ id: "../etc", dir, fetch: f.fetch, log: quiet }), /not a YouTube video id/);
  assert.deepEqual(f.calls, []);
});

test("saved already: no fetch; --refresh fetches and writes again", async () => {
  const f = mockFetch({ maxresdefault: jpeg(1280, 720) }), c = mockConvert();
  writeFileSync(join(dir, `${ID}.webp`), "old");
  writeFileSync(join(dir, `${ID}-640.webp`), "old");
  assert.equal((await saveThumb({ id: ID, dir, fetch: f.fetch, convert: c.convert, log: quiet })).status, "cached");
  assert.deepEqual(f.calls, []);
  assert.deepEqual(c.runs, []);
  assert.equal(readFileSync(join(dir, `${ID}.webp`), "utf8"), "old");

  assert.equal((await saveThumb({ id: ID, dir, refresh: true, fetch: f.fetch, convert: c.convert, log: quiet })).status, "saved");
  assert.deepEqual(f.calls, [url("maxresdefault")]);
  assert.equal(c.runs.length, 2);
  assert.notEqual(readFileSync(join(dir, `${ID}.webp`), "utf8"), "old");
  assert.notEqual(readFileSync(join(dir, `${ID}-640.webp`), "utf8"), "old");
});

test("only one of the two files saved: fetched again, so both are there", async () => {
  const f = mockFetch({ maxresdefault: jpeg(1280, 720) }), c = mockConvert();
  writeFileSync(join(dir, `${ID}.webp`), "old");
  assert.equal((await saveThumb({ id: ID, dir, fetch: f.fetch, convert: c.convert, log: quiet })).status, "saved");
  assert.equal(f.calls.length, 1);
  assert.ok(existsSync(join(dir, `${ID}-640.webp`)));
});
