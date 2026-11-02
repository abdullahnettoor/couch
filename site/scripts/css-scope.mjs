// CSS scoping and name-isolation helpers for sync-couch-ui.mjs (tested by css-scope.test.mjs).

/** Rewrites every top-level selector of a stylesheet to live under `root` (a stand-in for :root and <body>). */
export function scope(css, root, { active = false } = {}) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let i = 0;
  let res = "";
  const mapSel = (raw) => {
    let s = raw.trim();
    if (!s) return "";
    if (active) s = s.replace(/:active/g, ":is(:active,.is-active)");
    if (/^(:root|html|body)$/.test(s)) return root;
    if (/^(html|body)[.#:\s]/.test(s)) return root + s.replace(/^(html|body)/, "");
    return `${root} ${s}`;
  };
  while (i < css.length) {
    while (/\s/.test(css[i] ?? "")) i++;
    if (i >= css.length) break;
    const open = css.indexOf("{", i);
    const prelude = css.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (depth && j < css.length) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    const body = css.slice(open + 1, j - 1);
    i = j;
    if (/^@(media|supports)/.test(prelude)) {
      res += `${prelude}{${scope(body, root, { active })}}\n`;
    } else if (/^@/.test(prelude)) {
      res += `${prelude}{${body}}\n`;
    } else {
      const sels = [];
      let d = 0;
      let cur = "";
      for (const ch of prelude) {
        if (ch === "(") d++;
        if (ch === ")") d--;
        if (ch === "," && d === 0) {
          sels.push(cur);
          cur = "";
        } else cur += ch;
      }
      sels.push(cur);
      const mapped = [...new Set(sels.map(mapSel).filter(Boolean))];
      res += `${mapped.join(",")}{${body.trim()}}\n`;
    }
  }
  return res;
}

/**
 * Gives every @keyframes and @font-face family in a scoped stylesheet a prefix (cu- / cr-) and rewrites the
 * references in animation / animation-name / font-family, so two copied sheets and the site never share a name.
 * Fails loudly on what it cannot isolate: @import and url() that is not an inline data: URI.
 */
export function namespace(css, prefix) {
  if (/@import/.test(css)) throw new Error(`${prefix}: @import is not supported in copied CSS`);
  const bad = [...css.matchAll(/url\(\s*(['"]?)(?!data:)([^)'"]*)\1\s*\)/g)].filter((m) => !m[2].startsWith("#"));
  if (bad.length) throw new Error(`${prefix}: unsupported url() in copied CSS (copy and rebase the asset first): ${bad.map((m) => m[0]).join(", ")}`);
  const kf = [...new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]))];
  const ff = [...new Set([...css.matchAll(/@font-face\s*\{[^}]*?font-family:\s*(?:"([^"]+)"|'([^']+)'|([^;}]+))/g)].map((m) => (m[1] ?? m[2] ?? m[3]).trim()))];
  const esc = (n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const n of kf) {
    css = css.replace(new RegExp(`@keyframes\\s+${esc(n)}(?![\\w-])`, "g"), `@keyframes ${prefix}${n}`);
    css = css.replace(/(animation(?:-name)?\s*:)([^;}]*)/g, (_m, p, v) => p + v.replace(new RegExp(`(^|[\\s,])${esc(n)}(?![\\w-])`, "g"), `$1${prefix}${n}`));
  }
  for (const n of ff) {
    const re = new RegExp(`(["']?)${esc(n)}\\1(?=\\s*[,;}]|$)`, "g");
    css = css.replace(/(font-family\s*:)([^;}]*)/g, (_m, p, v) => p + v.replace(re, (_x, q) => `${q || '"'}${prefix}${n}${q || '"'}`));
    css = css.replace(/(font(?:-family)?\s*:)([^;}]*)/g, (m) => m);
  }
  return css;
}
