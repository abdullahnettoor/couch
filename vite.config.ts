import { existsSync } from "node:fs";
import { defineConfig } from "vite-plus";

// A git-ignored `.env` may hold COUCH_TMDB_TOKEN; the real environment wins.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  // Renderer (src/renderer) is built by `vp build`; main and preload by `vp pack`.
  root: "src/renderer",
  base: "./",
  build: { outDir: "../../dist/renderer", emptyOutDir: true },
  test: { root: import.meta.dirname, include: ["src/**/*.test.ts", "scripts/**/*.test.ts"] },
  pack: [
    {
      entry: { index: "src/main/index.ts" },
      outDir: "dist/main",
      format: "esm",
      platform: "node",
      // Couch.app ships without node_modules, so every runtime dependency must be inside the bundle.
      deps: { neverBundle: ["electron"], alwaysBundle: [/^(?!electron$|node:)/] },
      // The TMDB project key goes into the main process bundle only (never the renderer or preload).
      define: { __COUCH_TMDB_TOKEN__: JSON.stringify(process.env.COUCH_TMDB_TOKEN ?? "") },
      clean: true,
    },
    {
      entry: { index: "src/preload/index.ts" },
      outDir: "dist/preload",
      format: "cjs",
      platform: "node",
      deps: { neverBundle: ["electron"] },
      clean: true,
    },
  ],
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
});
