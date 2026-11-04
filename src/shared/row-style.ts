import { GLASS } from "./look.ts";

/** Settings' row, in design pixels (a 1920-wide Screen), from the Look. `.g-row` in glass.css reads the same numbers as `--row-*` variables. */
export const ROW = GLASS.metrics.row;

/** The row look shared with Settings: size, padding, radius, label and value type, and the focus highlight. */
export function rowCss(selector: string, unit: string): string {
  const px = (n: number) => `calc(${n} * ${unit})`;
  return `${selector} { display:flex; align-items:center; justify-content:space-between; box-sizing:border-box; width:100%; height:${px(ROW.height)}; margin-bottom:${px(ROW.gap)}; padding:0 ${px(ROW.padX)}; border-radius:var(--r-row); font-size:${px(ROW.font)}; font-weight:600; color:var(--text-secondary); background:var(--glass); box-shadow:var(--glass-edge); }
${selector} .v { display:flex; align-items:center; gap:${px(14)}; font-size:${px(ROW.valueFont)}; font-weight:500; color:var(--text-tertiary); }
${selector}.focus { background:${GLASS.focus.bg}; color:${GLASS.focus.fg}; }
${selector}.focus .v { color:${GLASS.focus.fg}; }`;
}
