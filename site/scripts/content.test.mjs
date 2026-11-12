// Checks of the built page that need no browser (#48): the tab icon is the Couch mark (the sofa and Screen with no
// square) while the places that mean "the app" keep the square icon, the roadmap section and the NAS answer, and that
// their words are recorded in COPY.md.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const tmp = mkdtempSync(join(tmpdir(), "couch-content-"));
const out = join(tmp, "dist");
let html = "";
before(() => {
  execFileSync(join(root, "node_modules/.bin/vite"), ["build", "--outDir", out, "--emptyOutDir", "--logLevel", "error"], { cwd: root, stdio: "inherit" });
  html = readFileSync(join(out, "index.html"), "utf8");
});
after(() => rmSync(tmp, { recursive: true, force: true }));

const text = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const links = (rel) => [...html.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]).filter((l) => new RegExp(`rel="${rel}"`).test(l));
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
/** A PNG's width, height and colour type, from its IHDR chunk. */
const png = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), alpha: buf[25] === 6 || buf[25] === 4 });
/** A PNG's pixel at (x, y) as [r, g, b, a], for 8-bit RGBA, non-interlaced (what the mark files are). */
async function pixel(buf, x, y) {
  const { inflateSync } = await import("node:zlib");
  const { w } = png(buf);
  const idat = [];
  for (let i = 8; i < buf.length;) {
    const len = buf.readUInt32BE(i), type = buf.toString("ascii", i + 4, i + 8);
    if (type === "IDAT") idat.push(buf.subarray(i + 8, i + 8 + len));
    i += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = w * 4, rows = [];
  let prev = Buffer.alloc(stride);
  for (let r = 0; r <= y; r++) {
    const f = raw[r * (stride + 1)], line = Buffer.from(raw.subarray(r * (stride + 1) + 1, (r + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? line[i - 4] : 0, b = prev[i], c = i >= 4 ? prev[i - 4] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      line[i] = (line[i] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]) & 255;
    }
    rows.push(line);
    prev = line;
  }
  return [...rows[y].subarray(x * 4, x * 4 + 4)];
}

describe("the tab icon is the Couch mark", () => {
  test("the icon links are the .ico (16, 32, 48) and a 32 px PNG, both shipped", () => {
    const icons = links("icon");
    assert.equal(icons.length, 2, icons.join("\n"));
    const ico = icons.find((l) => attr(l, "href") === "/favicon.ico");
    assert.ok(ico, "a link to /favicon.ico");
    assert.equal(attr(ico, "sizes"), "16x16 32x32 48x48");
    const p = icons.find((l) => attr(l, "type") === "image/png");
    assert.equal(attr(p, "sizes"), "32x32");
    const buf = readFileSync(join(out, attr(p, "href")));
    assert.deepEqual(png(buf), { w: 32, h: 32, alpha: true });
    const icoBuf = readFileSync(join(out, "favicon.ico"));
    assert.equal(icoBuf.readUInt16LE(2), 1, "an icon file");
    const sizes = Array.from({ length: icoBuf.readUInt16LE(4) }, (_, i) => icoBuf[6 + i * 16] || 256).sort((a, b) => a - b);
    assert.deepEqual(sizes, [16, 32, 48]);
    assert.ok(!existsSync(join(out, "favicon.png")), "the old square favicon is gone");
  });

  test("the 32 px PNG has no square: its corners are transparent and its middle is not", async () => {
    const p = links("icon").find((l) => attr(l, "type") === "image/png");
    const buf = readFileSync(join(out, attr(p, "href")));
    for (const [x, y] of [[0, 0], [31, 0], [0, 31], [31, 31]]) assert.equal((await pixel(buf, x, y))[3], 0, `corner ${x},${y}`);
    assert.ok((await pixel(buf, 16, 16))[3] > 200, "the Screen is opaque");
  });

  test("the app's square icon stays where it means the app: touch icon, step 1 and the Download card", async () => {
    const touch = links("apple-touch-icon");
    assert.equal(touch.length, 1);
    assert.equal(attr(touch[0], "href"), "/apple-touch-icon.png");
    // the square's dark tile, above the sofa (macOS icons keep a transparent margin around it)
    const buf = readFileSync(join(out, "apple-touch-icon.png"));
    assert.equal(png(buf).w, 180);
    assert.ok((await pixel(buf, 90, 30))[3] > 200, "the touch icon keeps its square");
    assert.match(html, /<img class="step-icon" src="\/icon\.png"/);
    assert.match(html, /<img class="dl-icon" src="\/icon\.png"/);
  });
});

/** The roadmap section's HTML. */
const roadmap = () => html.match(/<section\b[^>]*id="roadmap"[\s\S]*?<\/section>/)?.[0] ?? "";

describe("the roadmap", () => {
  test("a section with three groups, in order, with no dates", () => {
    const s = roadmap();
    assert.ok(s, "a section#roadmap");
    assert.match(s, /aria-labelledby="roadmap-h"/);
    const heads = [...s.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => text(m[1]));
    assert.deepEqual(heads, ["Available now (0.2.0)", "Coming next", "Being considered"]);
    assert.doesNotMatch(text(s), /\b(20\d\d|Q[1-4]|January|February|March|April|May|June|July|August|September|October|November|December|soon)\b/);
  });

  test("its items, and no service names under Coming next", () => {
    const groups = [...roadmap().matchAll(/<ul\b[^>]*>([\s\S]*?)<\/ul>/g)].map((m) => [...m[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((l) => text(l[1])));
    assert.equal(groups.length, 3);
    const [now, next, maybe] = groups;
    for (const w of ["Continue watching", "YouTube", "Netflix", "Library", "Remote", "Quick settings"]) assert.ok(now.some((i) => i.includes(w)), `now: ${w}`);
    assert.equal(next.length, 2);
    assert.ok(next[0].startsWith("More Apps"));
    assert.ok(next[1].startsWith("Network folders (NAS)"));
    assert.doesNotMatch(next.join(" "), /YouTube|Netflix|Disney|Prime|Plex|Jellyfin|Hulu|Max\b|Apple TV|Spotify/);
    assert.equal(maybe.length, 3);
    assert.ok(maybe[0].startsWith("Windows"));
    assert.ok(maybe[1].startsWith("Intel Macs"));
    assert.ok(maybe[2].includes("Look"));
  });

  test("its links: only the Windows 👍 issue, and one 'See or suggest on GitHub' link to Issues", () => {
    const s = roadmap();
    const hrefs = [...s.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => [m[1], text(m[2])]);
    const repo = "https://github.com/abdullahnettoor/couch";
    const numbered = hrefs.filter(([h]) => /\/issues\/\d+$/.test(h)).map(([h]) => h);
    assert.deepEqual(numbered, [`${repo}/issues/34`]);
    const issues = hrefs.filter(([h]) => h === `${repo}/issues`);
    assert.equal(issues.length, 1);
    assert.equal(issues[0][1], "See or suggest on GitHub");
  });

  test("it sits after the Download section and before the FAQ", () => {
    const at = (id) => html.indexOf(`id="${id}"`);
    assert.ok(at("download") < at("roadmap") && at("roadmap") < at("faq"));
  });
});

describe("the FAQ", () => {
  test("answers 'Can Couch play from my NAS?' and points at the roadmap", () => {
    const d = [...html.matchAll(/<details>([\s\S]*?)<\/details>/g)].map((m) => m[1]).find((d) => text(d).startsWith("Can Couch play from my NAS?"));
    assert.ok(d, "the NAS question");
    assert.match(text(d), /Yes, if the share is mounted in Finder\. Better support is coming/);
    assert.match(d, /href="#roadmap"/);
  });
});

describe("COPY.md", () => {
  const copy = readFileSync(join(root, "COPY.md"), "utf8").replace(/\*\*/g, "");
  test("records the roadmap's and the NAS answer's words as on the page", () => {
    const s = roadmap();
    const strings = [
      ...[...s.matchAll(/<(h2|h3|li|p)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => text(m[2])),
    ];
    const d = [...html.matchAll(/<details>([\s\S]*?)<\/details>/g)].map((m) => m[1]).find((d) => text(d).startsWith("Can Couch play from my NAS?"));
    strings.push("Can Couch play from my NAS?", text(d.replace(/<summary>[\s\S]*?<\/summary>/, "")));
    for (const str of strings) assert.ok(copy.includes(str), `COPY.md has: ${str}`);
  });
});
