import { designUnit } from "../shared/design-unit.ts";
import { GLASS } from "../shared/look.ts";
import type { MapGlyph, MapJob, Maps } from "./clock-glass-maps.ts";

/** One character of the time, where the DOM laid it out (relative to the time's box). */
interface Glyph {
  ch: string;
  /** The SVG text attributes of its font. */
  font: string;
  /** The same font as a canvas font, for the worker. */
  canvasFont: string;
  /** Its baseline, and the middle of the character itself (its cell less the letter spacing Chromium adds after it). */
  x: number;
  y: number;
}

const LAYERS = ["shadow", "lens", "rim"] as const;
type Layer = (typeof LAYERS)[number];

/** What the clock needs of a Worker (a fake one in tests). */
export type MapWorker = Pick<Worker, "postMessage" | "terminate"> & {
  onmessage: ((e: MessageEvent<Maps>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
};

export interface ClockGlassOptions {
  /** Starts a worker that builds one minute's maps; none (no Worker here) leaves the glass with its tint and lift. */
  worker?: () => MapWorker | undefined;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** The worker is its own file in the build: the Screen's CSP allows only its own scripts. */
const startWorker = (): MapWorker | undefined =>
  typeof Worker === "function"
    ? (new Worker(new URL("./clock-glass-worker.ts", import.meta.url), {
        type: "module",
      }) as MapWorker)
    : undefined;

let filterCount = 0;

/**
 * Home's liquid glass clock (#35, #37). The time's own text is see-through; over it sit a light shadow outside the
 * digits, the lens (the digits' shape, which bends the Wallpaper behind it near its edges) and the rim (a thin edge lit
 * from the top left). CSS can't mask by live text, so each character is written into SVG masks in the page's font,
 * where the DOM laid it out. The lens's displacement map and the rim are built from the same characters in a worker,
 * at half resolution, and arrive as pictures: the displacement map behind a new SVG filter each time (Chromium ignores
 * changes to a filter an element already uses), the rim as a still image; the new masks go up with them, in one frame.
 * Everything is redrawn only when the time's text or its box changes: once a minute, or when the Screen changes size.
 */
export class ClockGlass {
  readonly #time: HTMLElement;
  readonly #layers: Record<Layer, HTMLElement>;
  readonly #filters: SVGSVGElement;
  readonly #resize: ResizeObserver | undefined;
  readonly #startWorker: () => MapWorker | undefined;
  /** The worker building the latest drawing's maps, until it answers. */
  #worker: MapWorker | undefined;
  #drawn = "";

  /** Puts the glass layers right after `time` (the clock's `.t`), inside its clock. */
  constructor(time: HTMLElement, { worker = startWorker }: ClockGlassOptions = {}) {
    this.#time = time;
    this.#startWorker = worker;
    const layers = LAYERS.map((name) => {
      const layer = document.createElement("i");
      layer.className = `cg cg-${name}`;
      return [name, layer] as const;
    });
    this.#filters = document.createElementNS(SVG_NS, "svg");
    this.#filters.setAttribute("class", "cg-filters");
    this.#filters.setAttribute("width", "0");
    this.#filters.setAttribute("height", "0");
    this.#filters.setAttribute("aria-hidden", "true");
    time.after(...layers.map(([, layer]) => layer), this.#filters);
    this.#layers = Object.fromEntries(layers) as Record<Layer, HTMLElement>;
    this.#resize =
      typeof ResizeObserver === "function" ? new ResizeObserver(() => this.draw()) : undefined;
    this.#resize?.observe(time);
  }

  /** Redraws the glass if the time's text or size changed since the last drawing; otherwise does nothing. */
  draw(): void {
    const start = performance.now();
    const time = this.#time;
    const box = time.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const key = `${time.textContent}|${box.width}×${box.height}`;
    if (key === this.#drawn) return;
    const u = designUnit(window.innerWidth, window.innerHeight);
    const glyphs = glyphsOf(time, box);
    const masks = writeMasks(glyphs, box, u);
    this.#drawn = key;
    // The digits' new shape goes up with their maps, in one frame: never the old rim over new digits.
    const apply = () => {
      for (const name of LAYERS) {
        const style = this.#layers[name].style;
        style.width = `${masks.width}px`;
        style.height = `${masks.height}px`;
      }
      const shadow = this.#layers.shadow.style;
      shadow.maskImage = shadow.webkitMaskImage = masks.shadow;
      const lens = this.#layers.lens.style;
      lens.maskImage = lens.webkitMaskImage = masks.lens;
      time.classList.add("cg-drawn");
    };
    this.#buildMaps(glyphs, masks.width, masks.height, u, start, apply);
    measure("clock-glass:draw", start);
  }

  dispose(): void {
    this.#resize?.disconnect();
    this.#worker?.terminate();
    this.#worker = undefined;
  }

  /**
   * Asks a fresh worker for this drawing's maps, and shows them with `apply` (the new masks) once they arrive; a worker
   * still busy with an older drawing is let go. Without a worker, or if it fails, the masks go up alone.
   */
  #buildMaps(
    glyphs: Glyph[],
    width: number,
    height: number,
    u: number,
    start: number,
    apply: () => void,
  ): void {
    this.#worker?.terminate();
    const worker = this.#startWorker();
    this.#worker = worker;
    if (!worker) return apply();
    const { clockGlass: g, clockGlassMap: map } = GLASS.metrics.home;
    const done = () => {
      worker.terminate();
      if (this.#worker === worker) this.#worker = undefined;
    };
    worker.onmessage = (e) => {
      if (this.#worker !== worker) return;
      done();
      const shown = performance.now();
      apply();
      this.#show(e.data, width, height, g.refraction * u);
      measure("clock-glass:show", shown);
      measure("clock-glass:map", start);
    };
    worker.onerror = (e) => {
      if (this.#worker !== worker) return;
      done();
      apply();
      console.error("clock glass: the maps' worker failed", e.message);
    };
    const job: MapJob = {
      glyphs: glyphs.map((glyph): MapGlyph => ({
        ch: glyph.ch,
        x: glyph.x,
        y: glyph.y,
        font: glyph.canvasFont,
      })),
      pad: g.pad * u,
      width,
      height,
      scale: map.scale,
      lensBlur: g.lensSlope * u,
      rimBlur: g.rimWidth * u,
      rimStrength: map.rimStrength,
      bevelStrength: map.bevelStrength,
      light: map.light,
    };
    worker.postMessage(job);
  }

  /** Points the rim at its picture and the lens at a new filter over the displacement map; the old filter goes later. */
  #show(maps: Maps, width: number, height: number, scale: number): void {
    const id = `cg-refraction-${++filterCount}`;
    const filter = document.createElementNS(SVG_NS, "filter");
    for (const [name, value] of Object.entries({
      id,
      x: "0",
      y: "0",
      width: String(width),
      height: String(height),
      filterUnits: "userSpaceOnUse",
      primitiveUnits: "userSpaceOnUse",
      "color-interpolation-filters": "sRGB",
    }))
      filter.setAttribute(name, value);
    const image = document.createElementNS(SVG_NS, "feImage");
    for (const [name, value] of Object.entries({
      x: "0",
      y: "0",
      width: String(width),
      height: String(height),
      preserveAspectRatio: "none",
      result: "map",
      href: maps.displacement,
    }))
      image.setAttribute(name, value);
    const displace = document.createElementNS(SVG_NS, "feDisplacementMap");
    for (const [name, value] of Object.entries({
      in: "SourceGraphic",
      in2: "map",
      scale: String(scale),
      xChannelSelector: "R",
      yChannelSelector: "G",
    }))
      displace.setAttribute(name, value);
    filter.append(image, displace);
    // At most the one on screen and this one: an older one is no longer used.
    const old = Array.from(this.#filters.children);
    for (const f of old.slice(0, -1)) f.remove();
    this.#filters.append(filter);
    this.#layers.rim.style.backgroundImage = `url("${maps.rim}")`;
    this.#layers.lens.style.setProperty("--cg-refraction", `url(#${id})`);
    // The one before stays until the lens has moved on to the new one, then goes.
    requestAnimationFrame(() => requestAnimationFrame(() => old.at(-1)?.remove()));
  }
}

/** Times a step of the clock's drawing for `pnpm clock:frames`; the entry is cleared at once so none pile up. */
function measure(name: string, start: number): void {
  performance.measure(name, { start, end: performance.now() });
  performance.clearMeasures(name);
}

/** Every visible character of the time and its AM/PM, as laid out. */
function glyphsOf(time: HTMLElement, box: DOMRect): Glyph[] {
  const glyphs: Glyph[] = [];
  const walker = document.createTreeWalker(time, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  const probe = document.createElement("canvas").getContext("2d");
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const style = getComputedStyle(node.parentElement!);
    const font = `font-family="${escapeXml(style.fontFamily)}" font-size="${style.fontSize}" font-weight="${style.fontWeight}" style="font-variant-numeric:${style.fontVariantNumeric}"`;
    const canvasFont = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const spacing = parseFloat(style.letterSpacing) || 0;
    // Where the baseline sits below the top of a line box's content area: the font's ascent.
    let ascent = parseFloat(style.fontSize) * 0.95;
    if (probe) {
      probe.font = canvasFont;
      ascent = probe.measureText(node.data).fontBoundingBoxAscent;
    }
    for (let i = 0; i < node.length; i++) {
      const ch = node.data[i]!;
      if (!ch.trim()) continue;
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const r = range.getBoundingClientRect();
      glyphs.push({
        ch,
        font,
        canvasFont,
        x: r.left - box.left + (r.width - spacing) / 2,
        y: r.top - box.top + ascent,
      });
    }
  }
  return glyphs;
}

const escapeXml = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** The shadow's and the lens's masks as SVG pictures, sized to the time's box plus the glass's room on every side. */
function writeMasks(
  glyphs: Glyph[],
  box: DOMRect,
  u: number,
): { width: number; height: number; shadow: string; lens: string } {
  const g = GLASS.metrics.home.clockGlass;
  const pad = g.pad * u;
  const width = box.width + pad * 2;
  const height = box.height + pad * 2;
  const text = (dy: number, fill: string) =>
    `<g fill="${fill}" text-anchor="middle">${glyphs
      .map(
        (glyph) =>
          `<text x="${(pad + glyph.x).toFixed(2)}" y="${(pad + glyph.y + dy).toFixed(2)}" ${glyph.font}>${escapeXml(glyph.ch)}</text>`,
      )
      .join("")}</g>`;
  /** Everything but `cut`. */
  const without = (id: string, cut: string) =>
    `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/>${cut}</mask>`;
  const svg = (body: string) =>
    `url("data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`,
    )}")`;
  return {
    width,
    height,
    lens: svg(text(0, "white")),
    // Outside the digits only, a little below them: inside, it would darken the glass from behind.
    shadow: svg(
      `<defs><filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${g.shadowBlur * u}"/></filter>${without("out", text(0, "black"))}</defs>` +
        `<g mask="url(#out)"><g filter="url(#soft)">${text(g.shadowDrop * u, "white")}</g></g>`,
    ),
  };
}
