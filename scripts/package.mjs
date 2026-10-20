import { packager } from "@electron/packager";
import { rmSync } from "node:fs";

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
  // Unsigned on purpose in v1: no osxSign, no osxNotarize.
  ignore: [
    /^\/\.(?!$)/,
    /^\/(node_modules|src|scripts|build|out|\.issues|\.wayfinder)(\/|$)/,
    /^\/(README|GLOSSARY)\.md$/,
    /^\/(tsconfig|vite\.config)\./,
    /^\/pnpm-/,
  ],
});
console.log(`Built ${appPath}/Couch.app`);
