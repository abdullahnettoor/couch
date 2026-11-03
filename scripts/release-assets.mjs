// Turns a packaged Couch.app (`vp run package`) into the files a GitHub Release carries, in out/release:
// the .zip the updater installs, the .dmg people download, the GPL source bundle and SHA256SUMS.txt.
// Needs Homebrew with the same mpv that was bundled: the source bundle is fetched from Homebrew.
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { cachedName, currentKegVersion, isBottle, manifestFormulae } from "./lib/gpl-sources.mts";

const run = (command, args, options = {}) =>
  execFileSync(command, args, { stdio: "inherit", ...options });
const read = (command, args) =>
  execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const arch = process.arch;
const app = join("out", `Couch-darwin-${arch}`, "Couch.app");
if (!existsSync(app)) throw new Error(`${app} is missing: run \`vp run package\` first`);
const release = join("out", "release");
rmSync(release, { recursive: true, force: true });
mkdirSync(release, { recursive: true });

run("codesign", ["--verify", "--deep", "--strict", app]);

// The updater (update.electronjs.org) picks the asset whose name has "darwin" and the arch, and ends in .zip.
// ditto keeps the frameworks' symlinks, which a plain zip would break.
run("ditto", [
  "-c",
  "-k",
  "--sequesterRsrc",
  "--keepParent",
  app,
  join(release, `Couch-darwin-${arch}-${version}.zip`),
]);

const stage = join("out", "dmg");
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage);
run("ditto", [app, join(stage, "Couch.app")]);
symlinkSync("/Applications", join(stage, "Applications"));
// No version in the name: .../releases/latest/download/Couch-<arch>.dmg then always downloads the newest stable release.
const dmg = join(release, `Couch-${arch}.dmg`);
// hdiutil now and then fails with "Resource busy" on CI runners; a retry is enough.
for (let attempt = 1; ; attempt++) {
  try {
    run("hdiutil", [
      "create",
      "-volname",
      "Couch",
      "-srcfolder",
      stage,
      "-fs",
      "HFS+",
      "-format",
      "UDZO",
      "-ov",
      dmg,
    ]);
    break;
  } catch (error) {
    if (attempt === 3) throw error;
    console.warn(`hdiutil failed (attempt ${attempt}); retrying`);
  }
}
rmSync(stage, { recursive: true, force: true });
// The dmg stays unsigned: Gatekeeper checks a signed dmg on open, and with no Developer ID that is a second
// "can't verify" warning before the one for Couch itself. The app inside is signed.

writeGplSources(
  join(app, "Contents", "Resources"),
  join(release, `Couch-${version}-gpl-sources.tar`),
);

run("sh", ["-c", "shasum -a 256 * > SHA256SUMS.txt"], { cwd: release });
console.log(`Release files in ${release}:\n${readdirSync(release).join("\n")}`);

/** The source of every bundled Homebrew formula (with its resources, patches and formula file), as GPLv3 §6(d) asks. */
function writeGplSources(resources, tarball) {
  const manifest = readFileSync(join(resources, "THIRD-PARTY-LIBRARIES.md"), "utf8");
  const bundled = manifestFormulae(manifest);
  if (!bundled.length) throw new Error("THIRD-PARTY-LIBRARIES.md lists no libraries");
  const names = bundled.map((b) => b.formula);

  // The sources must be of the versions bundled, so Homebrew's formulae must not have moved on since packaging.
  const info = JSON.parse(read("brew", ["info", "--json=v2", ...names])).formulae;
  for (const { formula, version: bundledVersion } of bundled) {
    const now = currentKegVersion(info.find((f) => f.name === formula));
    if (now !== bundledVersion)
      throw new Error(`${formula}: bundled ${bundledVersion}, but Homebrew would now fetch ${now}`);
  }

  const cache = read("brew", ["--cache"]);
  const started = Date.now() - 2000;
  // Upstream servers (ffmpeg.org and others) sometimes fail a download; a retry keeps what was already fetched.
  for (let attempt = 1; ; attempt++) {
    try {
      run("brew", [
        "fetch",
        "--build-from-source",
        ...(attempt === 1 ? ["--force"] : []),
        ...names,
      ]);
      break;
    } catch (error) {
      if (attempt === 4) throw error;
      console.warn(`brew fetch failed (attempt ${attempt}); retrying`);
      execFileSync("sleep", [String(attempt * 20)]);
    }
  }
  const fresh = (path) => statSync(path).mtimeMs >= started;

  const root = join("out", basename(tarball, ".tar"));
  rmSync(root, { recursive: true, force: true });
  const sources = join(root, "sources");
  mkdirSync(sources, { recursive: true });
  cpSync(join(resources, "THIRD-PARTY-LIBRARIES.md"), join(root, "THIRD-PARTY-LIBRARIES.md"));
  cpSync(join(resources, "licenses"), join(root, "licenses"), { recursive: true });

  const add = (path) => {
    const name = cachedName(basename(path));
    if (statSync(path).isDirectory()) {
      // A git checkout at the formula's pinned revision: ship the tree at that revision.
      const revision = read("git", ["-C", path, "rev-parse", "HEAD"]);
      run("git", [
        "-C",
        path,
        "archive",
        "--format=tar.gz",
        `--prefix=${name}/`,
        "-o",
        resolve(sources, `${name}-${revision}.tar.gz`),
        "HEAD",
      ]);
    } else {
      const target = join(sources, existsSync(join(sources, name)) ? basename(path) : name);
      cpSync(path, target);
    }
  };
  const added = new Set();
  const addOnce = (path) => {
    if (added.has(path)) return;
    added.add(path);
    add(path);
  };
  for (const name of names) {
    const main = read("brew", ["--cache", "--build-from-source", name]);
    if (!existsSync(main)) throw new Error(`${name}: no source at ${main} after brew fetch`);
    addOnce(main);
  }
  // Resources and patches: whatever the fetch above just downloaded (formula files come from the kegs below).
  const downloads = join(cache, "downloads");
  for (const file of readdirSync(downloads)) {
    const path = join(downloads, file);
    if (isBottle(file) || /\.(rb|json|incomplete)$/.test(file)) continue;
    if (fresh(path)) addOnce(path);
  }
  for (const entry of readdirSync(cache)) {
    const path = join(cache, entry);
    if (/--(git|svn|hg)$/.test(entry) && fresh(path)) addOnce(path);
  }
  // Each keg's own formula file: the exact build steps and patch list of the installed version.
  const cellar = read("brew", ["--cellar"]);
  mkdirSync(join(root, "formulae"));
  for (const { formula, version: kegVersion } of bundled) {
    const file = join(cellar, formula, kegVersion, ".brew", `${formula}.rb`);
    if (existsSync(file)) cpSync(file, join(root, "formulae", `${formula}.rb`));
    else console.warn(`!! no formula file for ${formula} in its keg`);
  }

  writeFileSync(
    join(root, "README.txt"),
    `Corresponding source for the free software libraries bundled in Couch ${version}.

THIRD-PARTY-LIBRARIES.md lists each library, its version, licence, source url, what it is pinned to and the
patches Homebrew applies. sources/ holds those sources as Homebrew fetched them to build the bundled
binaries (source archives, git trees at the pinned revision, patches and extra resources), and formulae/
holds Homebrew's build steps for each. Couch's own source is at https://github.com/abdullahnettoor/couch.
`,
  );
  run("tar", ["-cf", tarball, "-C", "out", basename(root)]);
  rmSync(root, { recursive: true, force: true });
}
