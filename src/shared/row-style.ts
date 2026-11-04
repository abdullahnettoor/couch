import { GLASS } from "./look.ts";

/** Settings' row, in design pixels (a 1920-wide Screen), from the Look. `.g-row` in glass.css reads the same numbers as `--row-*` variables. */
export const ROW = GLASS.metrics.row;

/** The row look shared with Settings: size, padding, radius, label and value type, and the focus highlight. */
export function rowCss(selector: string, unit: string): string {
  const px = (n: number) => `calc(${n} * ${unit})`;
  return `${selector} { display:flex; align-items:center; justify-content:space-between; box-sizing:border-box; width:100%; height:${px(ROW.height)}; margin-bottom:${px(ROW.gap)}; padding:0 ${px(ROW.padX)}; border-radius:var(--radius-row); font-size:var(--row-font); font-weight:var(--weight-semibold); color:var(--text-secondary); background:var(--glass); box-shadow:var(--shadow-glass-edge); }
${selector} .v { display:flex; align-items:center; gap:${px(14)}; font-size:var(--row-value-font); font-weight:var(--weight-medium); color:var(--text-tertiary); }
${selector}.focus { background:var(--focus-bg); color:var(--focus-fg); }
${selector}.focus .v { color:var(--focus-fg); }`;
}
