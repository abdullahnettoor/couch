import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { GUMROAD_URL, GITHUB_URL, RELEASES_URL, SITE_URL, INTRO_MODE, type IntroMode } from "./src/config.ts";
import { home, remote, shelf, sprite } from "./src/mocks.ts";
import { introHead, introSvg, wordmarkSvg } from "./src/brand/wordmark.ts";
import { slots, type Slot, type SlotName } from "./src/slots.ts";

const values: Record<string, string> = { GUMROAD_URL, GITHUB_URL, RELEASES_URL, SITE_URL };
const introMode = (process.env.COUCH_INTRO_MODE || INTRO_MODE) as IntroMode;
if (introMode !== "sequence" && introMode !== "logo-only") throw new Error(`Unknown intro mode "${introMode}" (sequence or logo-only)`);
const shots = resolve(import.meta.dirname, "src/shots");

/** The file a slot shows: a dropped-in slot-<name>.* replacement wins over the manifest's interim file. */
function fileFor(name: string, slot: Slot): string | null {
  for (const ext of ["png", "jpg", "jpeg", "webp"]) {
    if (existsSync(resolve(shots, `slot-${name}.${ext}`))) return `slot-${name}.${ext}`;
  }
  return slot.file;
}

/** The CSS-built stand-ins for slots that have no picture yet: Couch's real UI (src/couch-ui/), see src/mocks.ts. */
const mocks: Record<string, (alt: string) => string> = {
  "hero-screen": (alt) => home({ alt, layout: "empty", focus: "youtube", drift: true }),
  "remote-screen": (alt) => home({ alt, layout: "empty", focus: "netflix", qr: true }),
  "remote-phone": (alt) => remote(alt, true),
  "apps-screen": (alt) => home({ alt, layout: "film", focus: "youtube" }),
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function img(name: string, slot: Slot, file: string): string {
  const hint = slot.loading === "eager" ? ' fetchpriority="high"' : "";
  // the manifest's own picture has smaller copies (scripts/shots.mjs); a dropped-in slot-<name>.* file does not
  let set = "";
  if (slot.srcset && file === slot.file) {
    const stem = file.replace(/\.\w+$/, "");
    const list = slot.srcset.widths.map((w) => `/src/shots/${stem}-${w}.webp ${w}w`).concat(`/src/shots/${file} ${slot.width}w`);
    set = ` srcset="${list.join(", ")}" sizes="${slot.srcset.sizes}"`;
  }
  return `<img src="/src/shots/${file}"${set} width="${slot.width}" height="${slot.height}" alt="${esc(slot.alt)}" loading="${slot.loading}" decoding="async"${hint} />`;
}

const slotOf = (name: string): Slot => {
  const slot = (slots as Record<string, Slot>)[name];
  if (!slot) throw new Error(`index.html uses unknown slot "${name}"; add it to src/slots.ts`);
  return slot;
};

/** Fills {{NAME}} placeholders from src/config.ts and writes every product image from src/slots.ts. */
const sitePlugin = (): Plugin => ({
  name: "couch-site",
  transformIndexHtml: {
    order: "pre",
    handler(html) {
      const used = new Set<string>();
      const out = html
        .replace(/<!--mock:([\w-]+)-->([\s\S]*?)<!--\/mock-->/g, (_m, name: string) => {
          used.add(name);
          const slot = slotOf(name);
          const file = fileFor(name, slot);
          if (file) return img(name, slot, file);
          const build = mocks[name];
          if (!build) throw new Error(`Slot "${name}" has no file and no mock builder in vite.config.ts`);
          return build(slot.alt);
        })
        .replace("{{couch-sprite}}", sprite())
        .replace("{{wordmark:nav}}", wordmarkSvg({ id: "wm-nav", attrs: 'class="wm" width="157" height="20"' }))
        .replace("{{intro:svg}}", introSvg())
        .replace("{{intro:head}}", `<script>${introHead(introMode)}</script>`)
        .replace("{{mock:shelf}}", shelf())
        .replace(/\{\{slot:([\w-]+)\}\}/g, (_m, name: string) => {
          used.add(name);
          const slot = slotOf(name);
          const file = fileFor(name, slot);
          if (!file) throw new Error(`Slot "${name}" has no file and no mock`);
          return img(name, slot, file);
        })
        .replace(/\{\{(\w+)\}\}/g, (m, k: string) => values[k] ?? m);
      for (const name of Object.keys(slots) as SlotName[]) {
        if (!used.has(name)) throw new Error(`Slot "${name}" is in src/slots.ts but not used in index.html`);
      }
      return out;
    },
  },
});

export default defineConfig({
  plugins: [sitePlugin()],
  build: { assetsInlineLimit: 0, target: "es2022" },
});
