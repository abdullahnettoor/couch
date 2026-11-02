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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectLibs, rewritePlan, type LibInfo } from "./bundle-libs.mts";
import { parseFormula } from "./formula.mts";
import { planLicences } from "./licences.mts";
import { parseOtool } from "./otool.mts";
import { describePin, kegOf, renderManifest, type ThirdParty } from "./third-party.mts";

const vendoredLicences = join(dirname(fileURLToPath(import.meta.url)), "..", "licenses");

const run = (command: string, args: string[]) =>
  execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

function inspect(file: string): LibInfo {
  return parseOtool({
    deps: run("otool", ["-L", file]),
    id: run("otool", ["-D", file]),
    loads: run("otool", ["-l", file]),
  });
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
      pins: [],
      patches: [],
      extraSources: [],
      libraries: [],
      licenceFiles: [],
    };
    entry.libraries.push(lib.name);
    kegs.set(keg.formula, entry);
  }
  const resources = join(appContents, "Resources");
  for (const entry of kegs.values()) {
    // The keg's own SBOM names the licence of the version installed (brew info shows the newest formula).
    const sbom = existsSync(join(entry.dir, "sbom.spdx.json"))
      ? (JSON.parse(readFileSync(join(entry.dir, "sbom.spdx.json"), "utf8")) as {
          packages?: { licenseConcluded?: string; downloadLocation?: string }[];
        })
      : {};
    const pkg = sbom.packages?.[0];
    entry.license = pkg?.licenseConcluded;
    if (!entry.license) console.warn(`!! no licence recorded for ${entry.formula}`);

    // The keg's formula file pins the exact revision and lists patches; the SBOM only has a bare url.
    const formulaFile = join(entry.dir, ".brew", `${entry.formula}.rb`);
    const formula = existsSync(formulaFile)
      ? parseFormula(readFileSync(formulaFile, "utf8"))
      : undefined;
    entry.source = formula?.url ?? pkg?.downloadLocation ?? "";
    if (!entry.source) throw new Error(`no source recorded for ${entry.formula}`);
    if (!formula) console.warn(`!! no formula file for ${entry.formula}; source is unpinned`);
    entry.pins = formula ? describePin(formula) : [];
    entry.patches = formula?.patches ?? [];
    entry.extraSources = (formula?.resources ?? []).map(
      (r) => `${r.name}: ${r.url}${describePin(r).length ? ` (${describePin(r).join("; ")})` : ""}`,
    );

    const vendorDir = join(vendoredLicences, entry.formula);
    const plan = planLicences(
      entry.formula,
      readdirSync(entry.dir),
      existsSync(vendorDir) ? readdirSync(vendorDir) : [],
    );
    const out = join(resources, "licenses", entry.formula);
    mkdirSync(out, { recursive: true });
    for (const { name, from } of plan) {
      copyFileSync(join(from === "keg" ? entry.dir : vendorDir, name), join(out, name));
      entry.licenceFiles.push(name);
    }
  }
  writeFileSync(join(resources, "THIRD-PARTY-LIBRARIES.md"), renderManifest([...kegs.values()]));
}
