import { execFile } from "node:child_process";
import { lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { MacEntry, MacWallpapers } from "./pictures.ts";

const APPLE_FOLDER = "/System/Library/Desktop Pictures";

const DESKTOP_JS =
  'ObjC.import("AppKit"); ObjC.unwrap($.NSWorkspace.sharedWorkspace.desktopImageURLForScreen($.NSScreen.mainScreen).path)';

/** Runs `osascript` without blocking: resolves with its output, rejects on failure or after the timeout. */
export type Osascript = (args: string[]) => Promise<string>;

const osascript: Osascript = (args) =>
  new Promise((resolve, reject) =>
    execFile("/usr/bin/osascript", args, { encoding: "utf8", timeout: 3000 }, (err, out) =>
      err ? reject(err) : resolve(out),
    ),
  );

/**
 * The Mac's own wallpaper sources. Everything here only reads: it lists folders, asks AppKit (through
 * `osascript`, which needs no permission) for the desktop picture, and asks for a folder through the
 * chooser it is given.
 */
export class RealMacWallpapers implements MacWallpapers {
  #home: string;
  #choose: (current: string) => Promise<string | undefined>;
  #osascript: Osascript;

  constructor(
    home: string,
    chooseFolder: (current: string) => Promise<string | undefined>,
    runOsascript: Osascript = osascript,
  ) {
    this.#home = home;
    this.#choose = chooseFolder;
    this.#osascript = runOsascript;
  }

  defaultFolder(): string {
    return join(this.#home, "Pictures", "Wallpapers");
  }

  /** Direct children only; symlinks are reported as such and never followed. */
  listFolder(path: string): MacEntry[] | undefined {
    try {
      return readdirSync(path).map((name) => {
        const full = join(path, name);
        try {
          const st = lstatSync(full);
          const kind = st.isSymbolicLink()
            ? "symlink"
            : st.isFile()
              ? "file"
              : st.isDirectory()
                ? "dir"
                : "other";
          return {
            name,
            path: full,
            kind,
            size: st.size,
            mtimeMs: st.mtimeMs,
            dev: st.dev,
            ino: st.ino,
          } as MacEntry;
        } catch {
          return { name, path: full, kind: "other", size: 0, mtimeMs: 0 } as MacEntry;
        }
      });
    } catch {
      return undefined;
    }
  }

  /**
   * The main display's picture. A `.madesktop` entry has no image of its own: its thumbnail
   * (`.thumbnails/<name>.heic` beside it) stands in; without one there is nothing to use.
   */
  async desktopPicture(): Promise<MacEntry | undefined> {
    try {
      const out = (await this.#osascript(["-l", "JavaScript", "-e", DESKTOP_JS])).trim();
      if (!out.startsWith("/")) return undefined;
      let path = out;
      if (/\.madesktop$/i.test(out)) {
        path = join(
          out.slice(0, out.lastIndexOf("/")),
          ".thumbnails",
          `${basename(out, ".madesktop")}.heic`,
        );
      }
      // The household chose this picture, so a link to it is resolved once here; the converter then opens the real file.
      path = realpathSync(path);
      const st = statSync(path);
      if (!st.isFile()) return undefined;
      return {
        name: basename(path),
        path,
        kind: "file",
        size: st.size,
        mtimeMs: st.mtimeMs,
        dev: st.dev,
        ino: st.ino,
      };
    } catch {
      return undefined;
    }
  }

  appleWallpapers(): MacEntry[] {
    return this.listFolder(APPLE_FOLDER) ?? [];
  }

  chooseFolder(current: string): Promise<string | undefined> {
    return this.#choose(current);
  }
}
