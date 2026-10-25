/** Settings' row, in design pixels (a 1920-wide Screen). `src/renderer/glass.css` `.g-row` must match; a test checks. */
export const ROW = { height: 96, padX: 32, font: 32, gap: 8, valueFont: 26 } as const;

/** The row look shared with Settings: size, padding, radius, label and value type, and the focus highlight. */
export function rowCss(selector: string, unit: string): string {
  const px = (n: number) => `calc(${n} * ${unit})`;
  return `${selector} { display:flex; align-items:center; justify-content:space-between; box-sizing:border-box; width:100%; height:${px(ROW.height)}; margin-bottom:${px(ROW.gap)}; padding:0 ${px(ROW.padX)}; border-radius:var(--r-row); font-size:${px(ROW.font)}; font-weight:600; color:var(--t2); background:var(--glass); box-shadow:var(--glass-edge); }
${selector} .v { display:flex; align-items:center; gap:${px(14)}; font-size:${px(ROW.valueFont)}; font-weight:500; color:var(--t3); }
${selector}.focus { background:#fff; color:#000; }
${selector}.focus .v { color:#000; }`;
}
