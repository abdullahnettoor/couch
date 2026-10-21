import { packager } from "@electron/packager";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";

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
  prune: false,
  // The add-on must be a real file on disk; Electron loads it from app.asar.unpacked.
  asar: { unpack: "**/*.node" },
  // Unsigned on purpose in v1: no osxSign, no osxNotarize.
  ignore: [
    /^\/\.(?!$)/,
    /^\/(node_modules|src|scripts|build|out|\.issues|\.wayfinder)(\/|$)/,
    /^\/(README|GLOSSARY)\.md$/,
    /^\/(tsconfig|vite\.config)\./,
    /^\/pnpm-/,
    /^\/native\/mpv-embed\/(?!mpv_embed\.node$)/,
  ],
});

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
console.log(`Built ${appPath}/Couch.app`);
