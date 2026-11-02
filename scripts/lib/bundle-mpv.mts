// Copies Homebrew's libmpv and every non-system library it needs into Couch.app, so a packaged Couch plays
// without Homebrew. The walk and rewrite plan live in bundle-libs.mts; this is the part that touches the disk.
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { collectLibs, rewritePlan, type LibInfo } from "./bundle-libs.mts";
import { isLicenceFile, kegOf, renderManifest, type ThirdParty } from "./third-party.mts";

const run = (command: string, args: string[]) =>
  execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

function inspect(file: string): LibInfo {
  const [, ...lines] = run("otool", ["-L", file]).split("\n");
  const id = run("otool", ["-D", file]).split("\n")[1]?.trim();
  const deps = lines
    .map((l) => /^\s+(\S.*?) \(compatibility/.exec(l)?.[1])
    .filter((r): r is string => !!r);
  const rpaths = [
    ...run("otool", ["-l", file]).matchAll(/cmd LC_RPATH\n\s+cmdsize \d+\n\s+path (.+) \(offset/g),
  ].map((m) => m[1]);
  return { deps: deps.filter((d) => d !== id), rpaths };
}

/** Where the Homebrew libmpv is: `brew --prefix` (Apple Silicon: /opt/homebrew). */
export function homebrewLibmpv(): string {
  return join(run("brew", ["--prefix", "mpv"]).trim(), "lib", "libmpv.2.dylib");
}

/**
 * Copies libmpv and its dependencies into `<app>/Contents/Frameworks/mpv`, rewrites their install names to
 * @loader_path siblings, signs each with `identity`, and writes the licences and manifest into Resources.
 * Returns the bundled libraries' file names.
 */
export function bundleMpv(appContents: string, identity: string): string[] {
  const libs = collectLibs(homebrewLibmpv(), {
    inspect,
    exists: existsSync,
    realpath: realpathSync,
  });
  const dir = join(appContents, "Frameworks", "mpv");
  mkdirSync(dir, { recursive: true });
  for (const lib of libs) {
    const target = join(dir, lib.name);
    copyFileSync(lib.realPath, target);
    run("chmod", ["u+w", target]);
  }
  for (const step of rewritePlan(libs)) {
    const target = join(dir, step.name);
    const args = ["-id", step.id];
    for (const [from, to] of step.changes) args.push("-change", from, to);
    for (const rpath of step.deleteRpaths) args.push("-delete_rpath", rpath);
    run("install_name_tool", [...args, target]);
  }
  for (const lib of libs) {
    const target = join(dir, lib.name);
    const stale = run("otool", ["-L", target])
      .split("\n")
      .filter((l) => /\/opt\/homebrew|\/usr\/local/.test(l));
    if (stale.length)
      throw new Error(`${lib.name} still points outside the app:\n${stale.join("\n")}`);
    run("codesign", ["--force", "--sign", identity, target]);
  }
  writeNotices(appContents, libs);
  return libs.map((l) => l.name);
}

function writeNotices(appContents: string, libs: { realPath: string; name: string }[]) {
  const kegs = new Map<string, ThirdParty & { dir: string }>();
  for (const lib of libs) {
    const keg = kegOf(lib.realPath);
    if (!keg)
      throw new Error(`${lib.realPath} isn't from a Homebrew keg: no licence or source to ship`);
    const entry = kegs.get(keg.formula) ?? {
      formula: keg.formula,
      version: keg.version,
      dir: keg.dir,
      license: undefined,
      source: "",
      libraries: [],
      licenceFiles: [],
    };
    entry.libraries.push(lib.name);
    kegs.set(keg.formula, entry);
  }
  const resources = join(appContents, "Resources");
  for (const entry of kegs.values()) {
    // The keg's own SBOM names the source archive and licence of the version installed (brew info shows the newest formula).
    const sbom = existsSync(join(entry.dir, "sbom.spdx.json"))
      ? (JSON.parse(readFileSync(join(entry.dir, "sbom.spdx.json"), "utf8")) as {
          packages?: { licenseConcluded?: string; downloadLocation?: string }[];
        })
      : {};
    const pkg = sbom.packages?.[0];
    entry.license = pkg?.licenseConcluded;
    entry.source = pkg?.downloadLocation ?? "";
    if (!entry.source || !entry.license)
      console.warn(`!! no source or licence recorded for ${entry.formula}`);
    const out = join(resources, "licenses", entry.formula);
    for (const name of readdirSync(entry.dir).filter(isLicenceFile)) {
      mkdirSync(out, { recursive: true });
      copyFileSync(join(entry.dir, name), join(out, name));
      entry.licenceFiles.push(name);
    }
    if (!entry.licenceFiles.length) console.warn(`!! no licence file found in ${entry.dir}`);
  }
  writeFileSync(join(resources, "THIRD-PARTY-LIBRARIES.md"), renderManifest([...kegs.values()]));
}
