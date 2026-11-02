import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { GUMROAD_URL, GITHUB_URL, RELEASES_URL, SITE_URL, INTRO_MODE, SOCIAL, type IntroMode, type SocialLink } from "./src/config.ts";
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

/** Marks for the footer's social links (Phosphor, regular weight, MIT: public/licenses/). */
const SOCIAL_ICONS: Record<NonNullable<SocialLink["icon"]>, string> = {
  github: `<path d="M208.31,75.68A59.78,59.78,0,0,0,202.93,28,8,8,0,0,0,196,24a59.75,59.75,0,0,0-48,24H124A59.75,59.75,0,0,0,76,24a8,8,0,0,0-6.93,4,59.78,59.78,0,0,0-5.38,47.68A58.14,58.14,0,0,0,56,104v8a56.06,56.06,0,0,0,48.44,55.47A39.8,39.8,0,0,0,96,192v8H72a24,24,0,0,1-24-24A40,40,0,0,0,8,136a8,8,0,0,0,0,16,24,24,0,0,1,24,24,40,40,0,0,0,40,40H96v16a8,8,0,0,0,16,0V192a24,24,0,0,1,48,0v40a8,8,0,0,0,16,0V192a39.8,39.8,0,0,0-8.44-24.53A56.06,56.06,0,0,0,216,112v-8A58.14,58.14,0,0,0,208.31,75.68ZM200,112a40,40,0,0,1-40,40H112a40,40,0,0,1-40-40v-8a41.74,41.74,0,0,1,6.9-22.48A8,8,0,0,0,80,73.83a43.81,43.81,0,0,1,.79-33.58,43.88,43.88,0,0,1,32.32,20.06A8,8,0,0,0,119.82,64h32.35a8,8,0,0,0,6.74-3.69,43.87,43.87,0,0,1,32.32-20.06A43.81,43.81,0,0,1,192,73.83a8.09,8.09,0,0,0,1,7.65A41.72,41.72,0,0,1,200,104Z"/>`,
};

/** The footer's social links: one item per entry in SOCIAL (src/config.ts); no list at all when it is empty. */
function social(links: readonly SocialLink[]): string {
  if (!links.length) return "";
  const item = (l: SocialLink) => {
    const mark = l.icon ? `<svg class="i" viewBox="0 0 256 256" aria-hidden="true" fill="currentColor">${SOCIAL_ICONS[l.icon]}</svg>` : "";
    return `<li><a href="${esc(l.href)}" rel="noopener me">${mark}<span>${esc(l.label)}</span></a></li>`;
  };
  return `<ul class="social" aria-label="Couch elsewhere">${links.map(item).join("")}</ul>`;
}

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
        .replace("{{wordmark:foot}}", wordmarkSvg({ id: "wm-foot", attrs: 'class="wm" width="157" height="20"', title: "Couch" }))
        .replace("{{social}}", social(SOCIAL))
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
