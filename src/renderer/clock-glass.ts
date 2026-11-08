import { designUnit } from "../shared/design-unit.ts";
import { GLASS } from "../shared/look.ts";

/** One character of the time, where the DOM laid it out (relative to the time's box). */
interface Glyph {
  ch: string;
  font: string;
  /** The letter spacing Chromium adds after the character. */
  spacing: number;
  left: number;
  top: number;
  width: number;
}

const LAYERS = ["shadow", "frost", "edge"] as const;
type Layer = (typeof LAYERS)[number];

/**
 * Home's glass clock (#35): the digits are cut out of a frosted layer, with a soft shadow outside them and a light
 * edge along their tops. CSS can't mask by live text, so each character is drawn to a canvas in the page's own font,
 * where the DOM laid it out, and the canvases become the three layers' masks (styled in home.css). They are redrawn
 * only when the time's text or its box changes: once a minute, or when the Screen changes size.
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
    const ratio = window.devicePixelRatio || 1;
    const key = `${time.textContent}|${box.width}×${box.height}|${ratio}`;
    if (key === this.#drawn) return;
    const u = designUnit(window.innerWidth, window.innerHeight);
    const masks = paintMasks(glyphsOf(time, box), box, u, ratio);
    if (!masks) {
      this.#drawn = "";
      time.classList.remove("cg-drawn");
      return;
    }
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
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const style = getComputedStyle(node.parentElement!);
    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const spacing = parseFloat(style.letterSpacing) || 0;
    for (let i = 0; i < node.length; i++) {
      const ch = node.data[i]!;
      if (!ch.trim()) continue;
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const r = range.getBoundingClientRect();
      glyphs.push({
        ch,
        font,
        spacing,
        left: r.left - box.left,
        top: r.top - box.top,
        width: r.width,
      });
    }
  }
  return glyphs;
}

/** The three masks as image URLs, sized to the time's box plus the glass's room on every side; none if there's no canvas. */
function paintMasks(
  glyphs: Glyph[],
  box: DOMRect,
  u: number,
  ratio: number,
): ({ width: number; height: number } & Record<Layer, string>) | undefined {
  const g = GLASS.metrics.home.clockGlass;
  const pad = g.pad * u;
  const width = box.width + pad * 2;
  const height = box.height + pad * 2;
  const draw = (
    scale: number,
    paint: (ctx: CanvasRenderingContext2D, text: (dy?: number) => void) => void,
  ) => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.scale(scale, scale);
    ctx.fillStyle = "white";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const text = (dy = 0) => {
      for (const glyph of glyphs) {
        ctx.font = glyph.font;
        const ascent = ctx.measureText(glyph.ch).fontBoundingBoxAscent;
        ctx.fillText(
          glyph.ch,
          pad + glyph.left + (glyph.width - glyph.spacing) / 2,
          pad + glyph.top + ascent + dy,
        );
      }
    };
    paint(ctx, text);
    return `url(${canvas.toDataURL()})`;
  };
  const frost = draw(ratio, (_, text) => text());
  // Outside the digits only, a little below them: inside, it would darken the glass from behind.
  const shadow = draw(1, (ctx, text) => {
    ctx.filter = `blur(${g.shadowBlur * u}px)`;
    text(g.shadowDrop * u);
    ctx.filter = "none";
    ctx.globalCompositeOperation = "destination-out";
    text();
  });
  // The top-facing edge of each stroke: the digits less themselves moved down.
  const edge = draw(ratio, (ctx, text) => {
    text();
    ctx.globalCompositeOperation = "destination-out";
    text(g.edge * u);
  });
  if (!frost || !shadow || !edge) return undefined;
  return { width, height, shadow, frost, edge };
}
