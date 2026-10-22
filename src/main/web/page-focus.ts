export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export type Direction = "up" | "down" | "left" | "right";

/**
 * Source text of the geometry: shared by the tests and the page script, so what is tested is what runs.
 * Index of the best candidate from `cur` in a direction, -1 if none. With no `cur` it is the
 * candidate nearest the viewport centre. On-screen candidates win over off-screen ones.
 */
const PICK_SOURCE = `function (cur, cands, dir, view) {
  var inView = function (r) { return r.right > 0 && r.bottom > 0 && r.left < view.width && r.top < view.height; };
  var pass = function (onlyInView) {
    var best = -1, bestScore = Infinity;
    for (var i = 0; i < cands.length; i++) {
      var r = cands[i];
      if (onlyInView && !inView(r)) continue;
      var score;
      if (!cur) {
        var dx0 = (r.left + r.right) / 2 - view.width / 2, dy0 = (r.top + r.bottom) / 2 - view.height / 2;
        score = dx0 * dx0 + dy0 * dy0;
      } else {
        var dx = (r.left + r.right) / 2 - (cur.left + cur.right) / 2;
        var dy = (r.top + r.bottom) / 2 - (cur.top + cur.bottom) / 2;
        var along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy;
        if (along <= 0) continue;
        var across = Math.abs(dir === 'left' || dir === 'right' ? dy : dx);
        score = along + 3 * across;
      }
      if (score < bestScore) { best = i; bestScore = score; }
    }
    return best;
  };
  var found = pass(true);
  return found >= 0 ? found : pass(false);
}`;

export const pickInDirection: (
  cur: Box | null,
  cands: Box[],
  dir: Direction,
  view: { width: number; height: number },
) => number = new Function(`return ${PICK_SOURCE}`)();

export const DEFAULT_FOCUS_SELECTORS = [
  "a[href]",
  "button",
  "[role=button]",
  "[role=link]",
  "[role=tab]",
  "[tabindex]:not([tabindex='-1'])",
  "input:not([type=hidden])",
  "select",
  "textarea",
];

/**
 * Main-world page script (a `function () { ... }` source) that turns the Remote's arrow keys into a
 * visible focus ring moving between the page's controls, and Enter into a click. It acts only on
 * keys the page did not handle itself, never throws into the page, and finds focus again when the
 * focused element goes away.
 */
export function pageFocusFunction(extraSelectors: string[] = []): string {
  const selector = [...DEFAULT_FOCUS_SELECTORS, ...extraSelectors].join(",");
  return `function () {
  try {
    if (window.__couchFocus) return;
    window.__couchFocus = true;
    var pick = (${PICK_SOURCE});
    var SELECTOR = ${JSON.stringify(selector)};
    var DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    var current = null;
    var ring = null;

    var rectOf = function (el) {
      var r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    var usable = function (el) {
      try {
        if (!el || !el.isConnected) return null;
        if (el.disabled || el.hasAttribute('disabled') || el.getAttribute && el.getAttribute('aria-disabled') === 'true') return null;
        var r = rectOf(el);
        if (r.right - r.left <= 0 || r.bottom - r.top <= 0) return null;
        var s = getComputedStyle(el);
        if (s.visibility === 'hidden' || s.display === 'none') return null;
        return r;
      } catch (e) { return null; }
    };
    var editable = function (el) {
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable === true);
    };
    var ensureRing = function () {
      if (ring) return ring;
      ring = document.createElement('div');
      var s = ring.style;
      s.position = 'fixed'; s.pointerEvents = 'none'; s.zIndex = '2147483647';
      s.border = '2px solid rgba(255,255,255,0.9)'; s.borderRadius = '10px';
      s.background = 'rgba(255,255,255,0.12)';
      s.boxShadow = '0 0 0 1px rgba(0,0,0,0.35), 0 4px 24px rgba(0,0,0,0.45)';
      s.transition = 'all 120ms ease-out'; s.display = 'none';
      document.body.appendChild(ring);
      return ring;
    };
    var draw = function () {
      try {
        var r = current && usable(current);
        var el = ensureRing();
        if (!r) { el.style.display = 'none'; return; }
        el.style.display = 'block';
        el.style.left = (r.left - 4) + 'px'; el.style.top = (r.top - 4) + 'px';
        el.style.width = (r.right - r.left + 8) + 'px'; el.style.height = (r.bottom - r.top + 8) + 'px';
      } catch (e) {}
    };
    var candidates = function () {
      var out = [];
      var all = document.querySelectorAll(SELECTOR);
      for (var i = 0; i < all.length; i++) {
        var r = usable(all[i]);
        if (r) out.push({ el: all[i], rect: r });
      }
      return out;
    };
    var move = function (dir) {
      var list = candidates();
      var from = current && usable(current) ? rectOf(current) : null;
      var view = { width: innerWidth, height: innerHeight };
      var i = pick(from, list.map(function (c) { return c.rect; }), dir, view);
      if (i < 0) return;
      if (list[i].el === current) return;
      current = list[i].el;
      try { current.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
      draw();
    };
    var onKey = function (e) {
      try {
        if (e.defaultPrevented) return;
        var dir = DIRS[e.key];
        var typing = editable(document.activeElement);
        if (dir) {
          if (typing && (dir === 'left' || dir === 'right')) return;
          e.preventDefault();
          move(dir);
        } else if (e.key === 'Enter') {
          if (typing) return;
          e.preventDefault();
          if (!current || !usable(current)) { current = null; move('down'); return; }
          if (editable(current)) current.focus(); else current.click();
        }
      } catch (err) {}
    };
    addEventListener('keydown', onKey, false);
    try {
      new MutationObserver(function () {
        if (current && !current.isConnected) { current = null; draw(); }
      }).observe(document.documentElement || document, { childList: true, subtree: true });
    } catch (e) {}
    addEventListener('scroll', draw, true);
    addEventListener('resize', draw, true);
  } catch (e) {}
}`;
}
