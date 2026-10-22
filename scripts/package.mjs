import { packager } from "@electron/packager";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";
import { evsState, signPkg, verifyPkg } from "./lib/evs-cli.mts";
import { packagingPlan } from "./lib/evs.mts";

// Couch.app has no node_modules: refuse to package a main bundle that still imports a package.
for (const file of ["dist/main/index.mjs", "dist/preload/index.cjs"]) {
  const code = readFileSync(file, "utf8");
  const bare = [...code.matchAll(/(?:from\s*|import\(|require\()\s*["']([^"'./][^"']*)["']/g)]
    .map((m) => m[1])
    .filter(
      (name) => name !== "electron" && !name.startsWith("node:") && !builtinModules.includes(name),
    )
    // ws loads these optional speed-ups inside try/catch.
    .filter((name) => name !== "bufferutil" && name !== "utf-8-validate");
  if (bare.length)
    throw new Error(
      `${file} imports packages that won't be in Couch.app: ${[...new Set(bare)].join(", ")}`,
    );
}

rmSync("out", { recursive: true, force: true });
const [appPath] = await packager({
  dir: ".",
  out: "out",
  name: "Couch",
  platform: "darwin",
  arch: process.arch,
  icon: "build/icon",
  appBundleId: "local.couch.app",
  appCategoryType: "public.app-category.entertainment",
  overwrite: true,
  // Electron for Content Security (Widevine) comes from castLabs' releases, not electron/electron.
  download: {
    mirrorOptions: { mirror: "https://github.com/castlabs/electron-releases/releases/download/" },
    checksums: JSON.parse(readFileSync("node_modules/electron/checksums.json", "utf8")),
  },
  prune: false,
  // The add-on must be a real file on disk; Electron loads it from app.asar.unpacked.
  asar: { unpack: "**/*.node" },
  // Signing happens below, after VMP signing: packager's own osxSign would run first.
  ignore: [
    /^\/\.(?!$)/,
    /^\/(node_modules|src|scripts|build|out|\.issues|\.wayfinder)(\/|$)/,
    /^\/(README|GLOSSARY)\.md$/,
    /^\/(tsconfig|vite\.config)\./,
    /^\/pnpm-/,
    /^\/native\/mpv-embed\/(?!mpv_embed\.node$)/,
  ],
});

// Packager writes an asar integrity digest into the Electron Framework binary (Electron 41+), and castLabs' EVS
// refuses to VMP-sign a modified binary ("Binary signature denied"). Put the release's own binary back; the digest
// is only enforced with the EnableEmbeddedAsarIntegrityValidation fuse, which Couch leaves off.
const FRAMEWORK = join("Contents", "Frameworks", "Electron Framework.framework", "Versions", "A");
copyFileSync(
  join("node_modules", "electron", "dist", "Electron.app", FRAMEWORK, "Electron Framework"),
  join(appPath, "Couch.app", FRAMEWORK, "Electron Framework"),
);

// macOS order matters: VMP-sign first, then Apple code signing (which would be broken by a later VMP signature).
const plan = packagingPlan(evsState());
if (plan.warning) console.warn(`\n!! ${plan.warning}\n`);
for (const step of plan.steps) {
  const ok = step === "vmp-sign" ? signPkg(appPath) : verifyPkg(appPath);
  if (!ok) throw new Error(`${step} failed for ${appPath}`);
}

// The listener can't read inside app.asar: it sits in Resources as real files, with the page and icons in remote/.
const resources = join(appPath, "Couch.app", "Contents", "Resources");
const remote = join(resources, "remote");
mkdirSync(remote, { recursive: true });
execFileSync(
  "sh",
  ["-c", `swiftc -O -swift-version 5 listener/*.swift -o '${join(resources, "couch-listener")}'`],
  { stdio: "inherit" },
);
copyFileSync("dist/remote/page.html", join(remote, "page.html"));
for (const icon of ["icon-192.png", "touch-icon.png"])
  copyFileSync(join("src/renderer/public", icon), join(remote, icon));
// COUCH_CODESIGN_IDENTITY: a Developer ID identity; unset means an ad-hoc signature (runs here, can't be notarised).
// disable-library-validation lets the Widevine CDM load under the hardened runtime.
execFileSync(
  "codesign",
  [
    "--force",
    "--deep",
    "--options",
    "runtime",
    "--entitlements",
    "build/entitlements.plist",
    "--sign",
    process.env.COUCH_CODESIGN_IDENTITY || "-",
    join(appPath, "Couch.app"),
  ],
  { stdio: "inherit" },
);
console.log(`Built ${appPath}/Couch.app`);
