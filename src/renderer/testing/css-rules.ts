import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Screen's stylesheets parsed by the test DOM, so tests read rules and properties instead of matching CSS text.
 * Needs a DOM environment (`// @vitest-environment happy-dom`).
 */
export interface ParsedCss {
  /** Every style rule in source order, including those inside @media and @supports. */
  rules: CSSStyleRule[];
  /** Every style rule whose selector list has `selector` as one of its selectors, in source order. Fails if there is none. */
  rulesFor: (selector: string) => CSSStyleRule[];
  /** `name` as the last rule for `selector` that sets it has it (source order, @media included), or "" if none sets it. */
  prop: (selector: string, name: string) => string;
  /** The @keyframes rule called `name`. Fails if there is none. */
  keyframes: (name: string) => CSSKeyframesRule;
}

const flatten = (rules: CSSRuleList): CSSRule[] =>
  Array.from(rules).flatMap((r) =>
    r instanceof CSSMediaRule || r instanceof CSSSupportsRule ? flatten(r.cssRules) : [r],
  );

/** The selectors in a rule's selector list, trimmed. */
export const selectorsOf = (rule: CSSStyleRule) =>
  rule.selectorText.split(",").map((s) => s.trim());

/** `files` (paths under src/renderer, e.g. "home.css") parsed as one stylesheet. */
export function readCss(...files: string[]): ParsedCss {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(
    files.map((f) => readFileSync(join(import.meta.dirname, "..", f), "utf8")).join("\n"),
  );
  const all = flatten(sheet.cssRules);
  const rules = all.filter((r): r is CSSStyleRule => r instanceof CSSStyleRule);
  const rulesFor = (selector: string) => {
    const found = rules.filter((r) => selectorsOf(r).includes(selector));
    if (found.length === 0) throw new Error(`no rule for ${selector} in ${files.join(", ")}`);
    return found;
  };
  return {
    rules,
    rulesFor,
    prop: (selector, name) =>
      rulesFor(selector)
        .map((r) => r.style.getPropertyValue(name).trim())
        .filter(Boolean)
        .at(-1) ?? "",
    keyframes: (name) => {
      const found = all.find(
        (r): r is CSSKeyframesRule => r instanceof CSSKeyframesRule && r.name === name,
      );
      if (!found) throw new Error(`no @keyframes ${name} in ${files.join(", ")}`);
      return found;
    },
  };
}
