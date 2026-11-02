import { defineConfig, type Plugin } from "vite";
import { GUMROAD_URL, GITHUB_URL, RELEASES_URL, SITE_URL } from "./src/config";

const values: Record<string, string> = { GUMROAD_URL, GITHUB_URL, RELEASES_URL, SITE_URL };

/** Fills {{NAME}} placeholders in HTML from src/config.ts so links work without JavaScript. */
const configPlaceholders = (): Plugin => ({
  name: "config-placeholders",
  transformIndexHtml: (html) => html.replace(/\{\{(\w+)\}\}/g, (m, k) => values[k] ?? m),
});

export default defineConfig({
  plugins: [configPlaceholders()],
  build: { assetsInlineLimit: 0, target: "es2022" },
});
