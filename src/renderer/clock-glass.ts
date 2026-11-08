import { designUnit } from "../shared/design-unit.ts";
import { GLASS } from "../shared/look.ts";

/** One character of the time, where the DOM laid it out (relative to the time's box). */
interface Glyph {
  ch: string;
  /** The SVG text attributes of its font. */
  font: string;
  /** Its baseline, and the middle of the character itself (its cell less the letter spacing Chromium adds after it). */
  x: number;
  y: number;
}

const LAYERS = ["shadow", "frost", "edge"] as const;
type Layer = (typeof LAYERS)[number];

/**
 * Home's glass clock (#35): the digits are cut out of a frosted layer, with a soft shadow outside them and a light
 * edge along their tops. CSS can't mask by live text, so each character is written into an SVG picture in the page's
 * own font, where the DOM laid it out, and the pictures become the three layers' masks (styled in home.css). They are
 * rewritten only when the time's text or its box changes: once a minute, or when the Screen changes size. Writing them
 * is a few strings; Chromium draws the pictures off the main thread.
 */
export class ClockGlass {
  readonly #time: HTMLElement;
  readonly #layers: Record<Layer, HTMLElement>;
  readonly #resize: ResizeObserver | undefined;
  #drawn = "";

  /** Puts the three glass layers right after `time` (the clock's `.t`), inside its clock. */
  constructor(time: HTMLElement) {
    this.#time = time;
    const layers = LAYERS.map((name) => {
      const layer = document.createElement("i");
      layer.className = `cg cg-${name}`;
      return [name, layer] as const;
    });
    time.after(...layers.map(([, layer]) => layer));
    this.#layers = Object.fromEntries(layers) as Record<Layer, HTMLElement>;
    this.#resize =
      typeof ResizeObserver === "function" ? new ResizeObserver(() => this.draw()) : undefined;
    this.#resize?.observe(time);
  }

  /** Redraws the masks if the time's text or size changed since the last drawing; otherwise does nothing. */
  draw(): void {
    const time = this.#time;
    const box = time.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const key = `${time.textContent}|${box.width}×${box.height}`;
    if (key === this.#drawn) return;
    const masks = writeMasks(
      glyphsOf(time, box),
      box,
      designUnit(window.innerWidth, window.innerHeight),
    );
    for (const name of LAYERS) {
      const style = this.#layers[name].style;
      style.width = `${masks.width}px`;
      style.height = `${masks.height}px`;
      style.maskImage = style.webkitMaskImage = masks[name];
    }
    time.classList.add("cg-drawn");
    this.#drawn = key;
  }

  dispose(): void {
    this.#resize?.disconnect();
  }
}

/** Every visible character of the time and its AM/PM, as laid out. */
function glyphsOf(time: HTMLElement, box: DOMRect): Glyph[] {
  const glyphs: Glyph[] = [];
  const walker = document.createTreeWalker(time, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  const probe = document.createElement("canvas").getContext("2d");
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const style = getComputedStyle(node.parentElement!);
    const font = `font-family="${escape(style.fontFamily)}" font-size="${style.fontSize}" font-weight="${style.fontWeight}" style="font-variant-numeric:${style.fontVariantNumeric}"`;
    const spacing = parseFloat(style.letterSpacing) || 0;
    // Where the baseline sits below the top of a line box's content area: the font's ascent.
    let ascent = parseFloat(style.fontSize) * 0.95;
    if (probe) {
      probe.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
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
        x: r.left - box.left + (r.width - spacing) / 2,
        y: r.top - box.top + ascent,
      });
    }
  }
  return glyphs;
}

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** The three masks as SVG pictures, sized to the time's box plus the glass's room on every side. */
function writeMasks(
  glyphs: Glyph[],
  box: DOMRect,
  u: number,
): { width: number; height: number } & Record<Layer, string> {
  const g = GLASS.metrics.home.clockGlass;
  const pad = g.pad * u;
  const width = box.width + pad * 2;
  const height = box.height + pad * 2;
  const text = (dy: number, fill: string) =>
    `<g fill="${fill}" text-anchor="middle">${glyphs
      .map(
        (glyph) =>
          `<text x="${(pad + glyph.x).toFixed(2)}" y="${(pad + glyph.y + dy).toFixed(2)}" ${glyph.font}>${escape(glyph.ch)}</text>`,
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
    frost: svg(text(0, "white")),
    // Outside the digits only, a little below them: inside, it would darken the glass from behind.
    shadow: svg(
      `<defs><filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${g.shadowBlur * u}"/></filter>${without("out", text(0, "black"))}</defs>` +
        `<g mask="url(#out)"><g filter="url(#soft)">${text(g.shadowDrop * u, "white")}</g></g>`,
    ),
    // The top-facing edge of each stroke: the digits less themselves moved down.
    edge: svg(
      `<defs>${without("below", text(g.edge * u, "black"))}</defs><g mask="url(#below)">${text(0, "white")}</g>`,
    ),
  };
}
