/**
 * The Look guard's scanner: finds raw style values (colours, type, radii, shadows, blurs, easing, durations)
 * in each surface's styles, so every one comes from the Look. Used by the guard tests only
 * (src/renderer/look-guard.test.ts for the Screen, src/main/look-guard.test.ts for the others).
 */
import { readFileSync } from "node:fs";
import { REMOTE_PAGE } from "../remote/page.ts";
import { GLASS, lookTokens } from "../../shared/look.ts";
import { quickSettingsPage } from "../../shared/quick-settings-page.ts";

export type SurfaceName = "Screen" | "phone" | "Quick settings" | "Web App controls";

/** One part of a surface: a CSS file, a page's built styles, or a TypeScript source that writes styles. */
export interface StyleSource {
  surface: SurfaceName;
  name: string;
  /** `css`: stylesheet text. `script`: TypeScript that sets styles through the CSSOM or style objects. */
  kind: "css" | "script";
  text: string;
  /** Custom properties this part sets itself (at run time or in its own rules), not the Look's. */
  own: ReadonlySet<string>;
}

/**
 * Raw values that must stay, each with its reason. `surface: "*"` applies on every surface; `text` is
 * exactly what the scanner reports.
 */
export const ALLOWED: readonly { surface: SurfaceName | "*"; text: string; reason: string }[] = [
  {
    surface: "*",
    text: "border-radius: 50%",
    reason:
      "a circle (a dot, a round button, the D-pad, the spinner), whatever its size; not a corner radius",
  },
  {
    surface: "Screen",
    text: "hsl(var(--hue), 18%, 22%)",
    reason:
      "a placeholder tinted by the item's own hue, set on the element at run time; as a Look token, --hue would resolve on :root instead",
  },
  {
    surface: "Screen",
    text: "hsl(var(--hue, 0) 25% 22%)",
    reason:
      "a Library placeholder tinted by the item's own hue, set on the element at run time; as a Look token, --hue would resolve on :root instead",
  },
  {
    surface: "Screen",
    text: "hsl(var(--h), 18%, 22%)",
    reason:
      "a player thumbnail placeholder tinted by the item's own hue, set on the element at run time; as a Look token, --h would resolve on :root instead",
  },
];

export const isAllowed = (surface: SurfaceName, text: string) =>
  ALLOWED.some((a) => (a.surface === "*" || a.surface === surface) && a.text === text);

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");

/** The Look's own variables block (`:root { --x: …; }`) holds the raw values; only the rules after it count. */
const withoutTokens = (css: string) => css.replace(/:root\s*\{\s*--[^}]*\}/g, "");

const COLOUR = [/#[0-9a-fA-F]{3,8}\b(?![-\w])/g, /(?:rgba?|hsla?)\((?:[^()]|\([^()]*\))*\)/g];
const TIMING_FUNCTION = /(?:cubic-bezier|steps)\([^)]*\)/g;
const DURATION = /(?<![\w.-])\d*\.?\d+m?s\b(?![-\w])/g;
const EASE_KEYWORD = /^(?:linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end)$/;
const LAYERED =
  /(?:^|[\s;{])((?:-webkit-)?backdrop-filter|box-shadow|text-shadow|filter)\s*:\s*([^;}]+)/g;
const TYPE_OR_RADIUS =
  /(?:^|[\s;{])(font-size|font-weight|font-family|font|line-height|letter-spacing|border-radius)\s*:\s*([^;}]+)/g;
const MOTION =
  /(?:^|[\s;{])(transition|animation|transition-timing-function|animation-timing-function)\s*:\s*([^;}]+)/g;

const onlyVars = /^(?:var\(--[\w-]+(?:,\s*[^()]*)?\)\s*)+$/;
/** Values that are not a style fact of their own: no value, inherit the parent's, or a plain zero. */
const NEUTRAL = /^(?:0|none|inherit|normal)$/;

/** Every raw style value in a stylesheet, e.g. `#abc`, `0.3s`, `border-radius: 12px`. */
export function rawInCss(source: string): string[] {
  const css = withoutTokens(stripComments(source));
  const found: string[] = [];
  for (const re of [...COLOUR, TIMING_FUNCTION, DURATION]) found.push(...(css.match(re) ?? []));
  for (const m of css.matchAll(LAYERED)) {
    for (const layer of m[2]!.split(/,(?![^(]*\))/).map((s) => s.trim())) {
      // A plain `filter` is checked for its shadows and blurs only; brightness and saturation are effects.
      if (m[1] === "filter" && !/drop-shadow\(|blur\(/.test(layer)) continue;
      if (!NEUTRAL.test(layer) && !onlyVars.test(layer)) found.push(`${m[1]}: ${layer}`);
    }
  }
  for (const m of css.matchAll(TYPE_OR_RADIUS)) {
    const value = m[2]!.trim();
    // Each part of a shorthand (`a b`, `size/line-height`) is a variable or neutral.
    const parts = value.split(/\s*\/\s*|\s+(?![^(]*\))/);
    if (!parts.every((p) => NEUTRAL.test(p) || onlyVars.test(p))) found.push(`${m[1]}: ${value}`);
  }
  for (const m of css.matchAll(MOTION)) {
    for (const word of m[2]!.split(/[\s,]+(?![^(]*\))/)) {
      if (EASE_KEYWORD.test(word)) found.push(`${m[1]}: ${word}`);
    }
  }
  return found;
}

/** Every raw style value in TypeScript that builds styles (CSSOM objects, style records, template CSS). */
export function rawInScript(source: string): string[] {
  const code = stripComments(source).replace(/^\s*\/\/.*$/gm, "");
  const found: string[] = [];
  for (const re of [...COLOUR, TIMING_FUNCTION]) found.push(...(code.match(re) ?? []));
  const quoted =
    /['"](font-size|font-weight|line-height|letter-spacing|border-radius|box-shadow|text-shadow|backdrop-filter|-webkit-backdrop-filter)['"]\s*:\s*([^,}]+)/g;
  for (const m of code.matchAll(quoted)) {
    if (/\d/.test(m[2]!.replace(/\$\{[^}]*\}/g, ""))) found.push(`${m[1]}: ${m[2]!.trim()}`);
  }
  for (const m of code.matchAll(/\bfont\s*:\s*([^,}]+)/g)) {
    if (/\d/.test(m[1]!.replace(/\$\{[^}]*\}/g, ""))) found.push(`font: ${m[1]!.trim()}`);
  }
  for (const m of code.matchAll(/\b(duration|easing)\s*:\s*(?!\$\{)([^,}]+)/g)) {
    found.push(`${m[1]}: ${m[2]!.trim()}`);
  }
  for (const m of code.matchAll(
    /\b(fontSize|fontWeight|lineHeight|letterSpacing|radius|color|background|scrim|focusedBackground|focusedColor|focusedScale)\s*:\s*([\d'"`][^,}]*)/g,
  )) {
    found.push(`${m[1]}: ${m[2]!.trim()}`);
  }
  return found;
}

/** The custom properties a stylesheet or script reads. */
export const varsUsed = (text: string) =>
  [...stripComments(text).matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!);

/** Every custom property the Look writes, for a prefix (`--couch-…`) or none. */
export const lookNames = (prefix = "") =>
  new Set(lookTokens(GLASS, "1px", true).map(([n]) => `--${prefix}${n}`));

/** The `<style>` blocks of a page, then each inline `style="…"` as a rule of its own. */
function pageStyles(html: string): string {
  const blocks = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  const inline = [...html.matchAll(/\sstyle="([^"]*)"/g)].map((m) => `[style] { ${m[1]}; }`);
  return [...blocks, ...inline].join("\n");
}

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Variables the Screen sets from the renderer's TypeScript or by the window (run-time values, not the Look's).
 * The ones its CSS declares itself count too.
 */
const SCREEN_OWN = [
  "--u",
  "--chrome-top",
  "--hue",
  "--h",
  "--wp-base",
  "--wp-glow",
  "--wp-photo",
  "--wp-dim",
  "--wp-drift",
  "--dock-tint",
  "--sx",
  "--sy",
  "--cols",
];

/** The Screen's stylesheets, in src/renderer. */
export const SCREEN_CSS = ["glass.css", "home.css", "player-overlay.css", "style.css"];

/** Every part of the four surfaces that carries styles. */
export function lookSurfaces(): StyleSource[] {
  const screenCss = SCREEN_CSS.map((f) => [f, read(`../../renderer/${f}`)] as const);
  const screenOwn = new Set([
    ...SCREEN_OWN,
    ...screenCss.flatMap(([, css]) =>
      [...stripComments(css).matchAll(/(?:^|[\s;{])(--[\w-]+)\s*:/g)].map((m) => m[1]!),
    ),
  ]);
  return [
    ...screenCss.map(([f, text]): StyleSource => ({
      surface: "Screen",
      name: f,
      kind: "css",
      text,
      own: screenOwn,
    })),
    {
      surface: "Screen",
      name: "picture-off.ts",
      kind: "css",
      // Interpolations are the Look's values; read each as a variable.
      text: read("../../shared/picture-off.ts").replace(/\$\{[^}]*\}/g, "var(--look)"),
      own: new Set(["--u", "--look"]),
    },
    {
      surface: "phone",
      name: "page.ts",
      kind: "css",
      text: pageStyles(REMOTE_PAGE),
      own: new Set(),
    },
    ...[false, true].map((glass): StyleSource => ({
      surface: "Quick settings",
      name: glass ? "quick-settings-page.ts (native glass)" : "quick-settings-page.ts",
      kind: "css",
      text: pageStyles(quickSettingsPage({ glass })),
      own: new Set(),
    })),
    ...["../web/web-hud.ts", "../../shared/confirm-layout.ts"].map((path): StyleSource => ({
      surface: "Web App controls",
      name: path.split("/").pop()!,
      kind: "script",
      text: read(path),
      own: new Set(["--couch-u"]),
    })),
  ];
}

/** The raw values in one part that are not on the allowlist. */
export function rawIn(source: StyleSource): string[] {
  const raw = source.kind === "css" ? rawInCss(source.text) : rawInScript(source.text);
  return raw.filter((text) => !isAllowed(source.surface, text));
}

/** The variables one part reads that neither the Look writes nor the part sets itself. */
export function unknownVarsIn(source: StyleSource): string[] {
  const written = lookNames();
  return [...new Set(varsUsed(source.text))].filter((n) => !written.has(n) && !source.own.has(n));
}
