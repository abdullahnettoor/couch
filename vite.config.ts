import { defineConfig } from "vite-plus";

export default defineConfig({
  // Renderer (src/renderer) is built by `vp build`; main and preload by `vp pack`.
  root: "src/renderer",
  base: "./",
  build: { outDir: "../../dist/renderer", emptyOutDir: true },
  test: { root: import.meta.dirname, include: ["src/**/*.test.ts"] },
  pack: [
    {
      entry: { index: "src/main/index.ts" },
      outDir: "dist/main",
      format: "esm",
      platform: "node",
      deps: { neverBundle: ["electron"] },
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
