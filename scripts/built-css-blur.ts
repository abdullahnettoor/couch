// A rule in the built CSS that asks for a blur must keep the unprefixed `backdrop-filter`: Chromium ignores
// `-webkit-backdrop-filter`, and the minifier has dropped the standard one from a rule that set both (#36).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The selectors of every rule in `css` that has a `-webkit-backdrop-filter` blur but no unprefixed `backdrop-filter`. */
export function rulesBlurringOnlyWithPrefix(css: string): string[] {
  const bad: string[] = [];
  for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const decls = m[2]!
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean);
    const value = (prop: string) =>
      decls
        .find((d) => d.toLowerCase().startsWith(`${prop}:`))
        ?.slice(prop.length + 1)
        .trim();
    const prefixed = value("-webkit-backdrop-filter");
    if (prefixed !== undefined && prefixed !== "none" && value("backdrop-filter") === undefined) {
      bad.push(m[1]!.trim());
    }
  }
  return bad;
}

/** Offenders across every built stylesheet under `dir` (the Screen's `dist/renderer`). */
export function builtCssBlurOffenders(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".css"))
        out.push(...rulesBlurringOnlyWithPrefix(readFileSync(p, "utf8")));
    }
  };
  walk(dir);
  return out;
}
