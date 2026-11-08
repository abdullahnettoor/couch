// Real-Electron check of Home wallpapers (tickets 107 and 108). Headless: no window is ever shown, nothing
// takes focus, nothing is captured. userData is a FRESH temp folder, never the household's.
// Run: env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/real-photos-check.mts
import { app, BrowserWindow, nativeImage, session } from "electron";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const userData = mkdtempSync(join(tmpdir(), "couch-real-photos-"));
app.setPath("userData", userData);
app.dock?.hide();
app.on("window-all-closed", () => {});

const results: string[] = [];
let failed = false;
const check = (name: string, ok: boolean, extra = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` (${extra})` : ""}`);
  if (!ok) failed = true;
};

const flat = (rgb: number, size = 256) => {
  const bitmap = Buffer.alloc(size * size * 4, rgb);
  for (let i = 3; i < bitmap.length; i += 4) bitmap[i] = 255;
  return nativeImage.createFromBitmap(bitmap, { width: size, height: size });
};

/** Segment markers of a JPEG up to its scan. */
function markers(jpeg: Buffer): number[] {
  const out: number[] = [];
  for (let at = 2; at + 4 <= jpeg.length;) {
    const marker = jpeg[at + 1]!;
    out.push(marker);
    if (marker === 0xda) break;
    at += 2 + jpeg.readUInt16BE(at + 2);
  }
  return out;
}

/** A hand-built EXIF APP1 block with a GPS IFD (latitude 51.5074 N, 0.1278 W). */
function exifWithGps(): Buffer {
  const rational = (n: number, d: number) => [n, d];
  const be32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const entry = (tag: number, type: number, count: number, value: number[]) => [
    tag >> 8,
    tag & 255,
    0,
    type,
    ...be32(count),
    ...[...value, 0, 0, 0, 0].slice(0, 4),
  ];
  // TIFF: header(8) + IFD0(2+12+4=18) -> GPS IFD at 26; GPS IFD: 2 + 4*12 + 4 = 54 -> data at 80.
  const dataAt = 80;
  const lat = [51, 1, 30, 1, 4464, 100].flatMap((v) => be32(v));
  const lon = [0, 1, 7, 1, 4080, 100].flatMap((v) => be32(v));
  void rational;
  const tiff = [
    0x4d,
    0x4d,
    0,
    42,
    ...be32(8),
    0,
    1,
    ...entry(0x8825, 4, 1, be32(26)),
    ...be32(0),
    0,
    4,
    ...entry(1, 2, 2, [0x4e, 0]),
    ...entry(2, 5, 3, be32(dataAt)),
    ...entry(3, 2, 2, [0x57, 0]),
    ...entry(4, 5, 3, be32(dataAt + 24)),
    ...be32(0),
    ...lat,
    ...lon,
  ];
  const body = Buffer.from([0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]);
  const head = Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255]);
  return Buffer.concat([head, body]);
}
const LAT_BYTES = Buffer.from([0, 0, 0x11, 0x70]); // 4464 as a big-endian long: the latitude's fraction

void app.whenReady().then(async () => {
  try {
    const { ElectronConverter } = await import(resolve("src/main/ports/electron-pictures.ts"));
    const { WallpaperFilesOnDisk } = await import(resolve("src/main/ports/pictures.ts"));
    const { RealMacWallpapers } = await import(resolve("src/main/ports/mac-wallpapers.ts"));
    const { dimFor } = await import(resolve("src/shared/wallpapers.ts"));
    const converter = new ElectronConverter(join(userData, "wallpapers"));
    const files = new WallpaperFilesOnDisk(join(userData, "wallpapers"));
    let inputs = 0;
    /** The converter reads files: put the bytes in a file of our own and convert that. */
    const encode = async (bytes: Buffer) => {
      const path = join(userData, `in-${(inputs += 1)}.bin`);
      writeFileSync(path, bytes);
      return converter.convert(path) as Promise<
        { jpeg: Buffer; thumb: Buffer; brightness: number } | undefined
      >;
    };

    const dark = { jpeg: flat(20).toJPEG(92), png: flat(20).toPNG() };
    const bright = { jpeg: flat(235).toJPEG(92), png: flat(235).toPNG() };
    const encoded = {
      darkJpeg: await encode(dark.jpeg),
      brightJpeg: await encode(bright.jpeg),
      darkPng: await encode(dark.png),
      brightPng: await encode(bright.png),
    };
    for (const [name, e] of Object.entries(encoded)) check(`${name} encodes`, e !== undefined);
    const b = (k: keyof typeof encoded) => encoded[k]?.brightness ?? NaN;
    check(
      "JPEG: dark < bright",
      b("darkJpeg") < b("brightJpeg"),
      `${b("darkJpeg")} < ${b("brightJpeg")}`,
    );
    check(
      "PNG: dark < bright",
      b("darkPng") < b("brightPng"),
      `${b("darkPng")} < ${b("brightPng")}`,
    );
    check("a bright photo is dimmed more", dimFor(b("brightJpeg")) > dimFor(b("darkJpeg")));
    check(
      "dim stays within 0.35..0.65",
      dimFor(b("darkPng")) >= 0.35 && dimFor(b("brightPng")) <= 0.65,
    );

    // Save and read back: the saved file is a JPEG that decodes, with the same brightness ordering.
    files.save("aaaaaaaaaaaa", encoded.darkJpeg!.jpeg, encoded.darkJpeg!.thumb);
    files.save("bbbbbbbbbbbb", encoded.brightPng!.jpeg, encoded.brightPng!.thumb);
    const savedDark = readFileSync(join(userData, "wallpapers", "aaaaaaaaaaaa.jpg"));
    const savedBright = readFileSync(join(userData, "wallpapers", "bbbbbbbbbbbb.jpg"));
    check(
      "saved files are JPEGs",
      savedDark[0] === 0xff && savedDark[1] === 0xd8 && savedBright[1] === 0xd8,
    );
    const reread = async (buf: Buffer) => (await encode(buf))?.brightness ?? NaN;
    check(
      "saved brightness ordering holds",
      (await reread(savedDark)) < (await reread(savedBright)),
    );

    // GPS: a JPEG carrying EXIF with a GPS IFD comes out with no APP1 and no trace of it.
    const base = flat(120).toJPEG(90);
    const tagged = Buffer.concat([base.subarray(0, 2), exifWithGps(), base.subarray(2)]);
    check(
      "fixture really has EXIF and GPS",
      markers(tagged).includes(0xe1) && tagged.includes(LAT_BYTES),
    );
    const clean = await encode(tagged);
    check("GPS-tagged JPEG encodes", clean !== undefined);
    if (clean) {
      check("output has no APP1 segment", !markers(clean.jpeg).includes(0xe1));
      check(
        "output has no Exif or GPS bytes",
        !clean.jpeg.includes("Exif") && !clean.jpeg.includes(LAT_BYTES),
      );
    }

    // Decoding bombs: tiny files that declare huge pictures are refused before decoding.
    const bomb = Buffer.from([
      0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0xff, 0xff, 0xff, 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11,
      1, 0xff, 0xd9,
    ]);
    const t0 = Date.now();
    check(
      "65535 x 65535 JPEG header is refused fast",
      (await encode(bomb)) === undefined && Date.now() - t0 < 200,
    );

    // 108: pictures that already sit on the Mac. Everything below only READS ~/Pictures/Wallpapers,
    // /System/Library/Desktop Pictures and the desktop picture; the sources are fingerprinted before and after.
    {
      const mac = new RealMacWallpapers(homedir(), async () => undefined);
      const fingerprint = (path: string) => {
        const st = statSync(path);
        return `${st.size}:${st.mtimeMs}:${createHash("sha1").update(readFileSync(path)).digest("hex")}`;
      };
      const listing = (dir: string) =>
        readdirSync(dir)
          .map((n) => `${n}:${statSync(join(dir, n)).mtimeMs}`)
          .join("|");
      const folder = mac.defaultFolder();
      const apple = "/System/Library/Desktop Pictures";
      const folderBefore = existsSync(folder) ? listing(folder) : "";
      const appleBefore = listing(apple);

      const entries = mac.listFolder(folder);
      check("the wallpaper folder lists", !!entries && entries.length > 0, folder);
      const jpeg = entries?.find(
        (e: { kind: string; name: string }) => e.kind === "file" && /\.jpe?g$/i.test(e.name),
      );
      check("the folder has a real JPEG", !!jpeg, jpeg?.name ?? "none");
      const heicEntry = mac
        .appleWallpapers()
        .find((e: { kind: string; name: string }) => e.kind === "file" && /\.heic$/i.test(e.name));
      check("Apple's folder has a real HEIC", !!heicEntry, heicEntry?.name ?? "none");
      check(
        "listing reports kinds (a subfolder or symlink is never a file)",
        (entries ?? []).every((e: { kind: string }) =>
          ["file", "dir", "symlink", "other"].includes(e.kind),
        ),
      );

      const desktop = await mac.desktopPicture();
      check(
        "the real desktop picture path is read",
        !!desktop && existsSync(desktop.path) && /\.(jpe?g|png|heic)$/i.test(desktop.name),
        desktop?.path ?? "none",
      );

      const inspect = async (label: string, path: string | undefined) => {
        if (!path) return check(`${label} converts`, false, "no path");
        const before = fingerprint(path);
        const t = Date.now();
        const out = await converter.convert(path);
        const ms = Date.now() - t;
        check(`${label} converts`, !!out, `${ms} ms`);
        if (!out) return;
        const full = nativeImage.createFromBuffer(out.jpeg);
        const { width, height } = full.getSize();
        check(
          `${label}: TV-size JPEG, at most 3840 x 2160`,
          out.jpeg[0] === 0xff &&
            out.jpeg[1] === 0xd8 &&
            width <= 3840 &&
            height <= 2160 &&
            width > 0,
          `${width}x${height}, ${Math.round(out.jpeg.length / 1024)} KiB`,
        );
        const thumb = nativeImage.createFromBuffer(out.thumb).getSize();
        check(
          `${label}: thumbnail is a small JPEG`,
          out.thumb[0] === 0xff && thumb.width <= 320 && thumb.height <= 320 && thumb.width > 0,
          `${thumb.width}x${thumb.height}`,
        );
        check(
          `${label}: brightness in 0..1 and dim in 0.35..0.65`,
          out.brightness >= 0 &&
            out.brightness <= 1 &&
            dimFor(out.brightness) >= 0.35 &&
            dimFor(out.brightness) <= 0.65,
          `${out.brightness.toFixed(3)}`,
        );
        check(`${label}: no EXIF in the copy`, !markers(out.jpeg).includes(0xe1));
        check(`${label}: the source is untouched`, fingerprint(path) === before);
      };
      await inspect("a real JPEG from the wallpaper folder", jpeg?.path);
      await inspect("a real HEIC from Apple's wallpapers", heicEntry?.path);
      await inspect("the real desktop picture", desktop?.path);

      check(
        "no temporary files are left in our wallpapers folder",
        !readdirSync(join(userData, "wallpapers")).some((n) => n.startsWith(".convert-")),
      );
      check(
        "the source folders are unchanged",
        (existsSync(folder) ? listing(folder) : "") === folderBefore &&
          listing(apple) === appleBefore,
      );
    }

    // The Screen's CSP (read from the real index.html) allows the wallpaper URL; without file: it doesn't.
    const html = readFileSync(resolve("src/renderer/index.html"), "utf8");
    const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? "";
    check("index.html has a CSP", csp.length > 0, csp);
    const url = files.url("aaaaaaaaaaaa");
    let pageNo = 0;
    const loads = async (policy: string) => {
      const page = join(userData, `page-${(pageNo += 1)}.html`);
      writeFileSync(
        page,
        `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><img id=i src="${url}">`,
      );
      const win = new BrowserWindow({
        show: false,
        focusable: false,
        webPreferences: { sandbox: true },
      });
      await win.loadURL(pathToFileURL(page).href);
      await new Promise((r) => setTimeout(r, 300));
      const ok = await win.webContents.executeJavaScript(
        "(() => { const i = document.getElementById('i'); return i.complete && i.naturalWidth > 0; })()",
      );
      win.destroy();
      await new Promise((r) => setTimeout(r, 200));
      return ok as boolean;
    };
    check("the Screen's CSP lets the wallpaper load", await loads(csp));
    check(
      "control: a CSP without file: blocks it",
      !(await loads("default-src 'none'; img-src data:")),
    );

    // The clock's box at 1920x1080: no blur band behind it any more (#35, the digits are glass), only the band behind the tiles.
    {
      const sheet = (f: string) => readFileSync(resolve("src/renderer", f), "utf8");
      const { GLASS, lookCss } = await import(resolve("src/shared/look.ts"));
      const look = lookCss(GLASS, { unit: "var(--u)", defineUnit: true });
      const page = join(userData, "home-clock.html");
      writeFileSync(
        page,
        `<!doctype html><style>html,body{margin:0}${look}${sheet("glass.css")}${sheet("home.css")}</style>` +
          `<div class="screen-glass home photo" style="position:relative;width:1920px;height:1080px">` +
          `<div class="h-photo"><i class="h-photo-blur bottom"></i></div>` +
          `<div class="h-clock on"><div class="t num">8:05<small>PM</small></div><div class="d">Good evening · Wednesday 28 October</div></div></div>`,
      );
      const win = new BrowserWindow({
        show: false,
        focusable: false,
        width: 1920,
        height: 1080,
        useContentSize: true,
      });
      await win.loadURL(pathToFileURL(page).href);
      const m = (await win.webContents.executeJavaScript(`(() => {
        const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; };
        return { t: r('.h-clock .t'), d: r('.h-clock .d'), clock: r('.h-clock'), blur: r('.h-photo-blur.bottom'), vw: innerWidth };
      })()`)) as any;
      win.destroy();
      await new Promise((r) => setTimeout(r, 200));
      check("viewport is 1920 wide", m.vw === 1920, String(m.vw));
      check("clock starts near y=210", Math.abs(m.clock.top - 210) < 1, String(m.clock.top));
      check("the date sits under the time", m.d.top >= m.t.bottom, `${m.d.top} >= ${m.t.bottom}`);
      check("the tiles' blur stays clear of the clock", m.blur.top > m.d.bottom, `${m.blur.top}`);
    }

    // A real App session, held as one object, cancels file: loads; another session doesn't.
    const { ElectronWebApp } = await import(resolve("src/main/web/electron-web-app.ts"));
    const { youtubeDescription } = await import(resolve("src/main/apps/youtube/youtube-web.ts"));
    const host = new BrowserWindow({ show: false, focusable: false });
    const ses = session.fromPartition("persist:youtube");
    check(
      "fromPartition returns one object per partition",
      ses === session.fromPartition("persist:youtube"),
    );
    const webApp = new ElectronWebApp(youtubeDescription("130.0.0.0"), host);
    const fetched = async (s: Electron.Session) => {
      try {
        return (await s.fetch(url)).ok;
      } catch {
        return false;
      }
    };
    check(
      "control: an ordinary session can fetch the file",
      await fetched(session.fromPartition("persist:control")),
    );
    check("the YouTube App's session cancels the wallpaper file:", !(await fetched(ses)));
    void webApp;
    host.destroy();
  } catch (error) {
    check("script ran to the end", false, String(error));
  }
  console.log(results.join("\n"));
  rmSync(userData, { recursive: true, force: true });
  app.exit(failed ? 1 : 0);
});
