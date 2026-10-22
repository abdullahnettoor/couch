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

/** What the page script logs (console.debug) when a text field takes or loses focus, so the host can let keys through to it. */
export const FIELD_FOCUSED = "couch:field-focused";
export const FIELD_BLURRED = "couch:field-blurred";

/** Source text: whether an element takes typed text (not a checkbox, button, slider...). */
const TEXT_FIELD_SOURCE = `function (el) {
  if (!el) return false;
  if (el.isContentEditable === true || el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  return ['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file', 'range', 'color', 'hidden'].indexOf(String(el.type || '').toLowerCase()) < 0;
}`;

/**
 * Page script source (an expression) that types `text` into the page's focused text field the way the
 * page's own framework notices (the native value setter, then input and change events). Evaluates to
 * false, having done nothing, when no text field has focus.
 */
export function typeIntoFieldScript(text: string): string {
  return `(function (text) {
  try {
    var isField = (${TEXT_FIELD_SOURCE});
    var el = document.activeElement;
    if (!isField(el)) return false;
    if (el.isContentEditable === true) return !!document.execCommand('insertText', false, text);
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var d = Object.getOwnPropertyDescriptor(proto, 'value');
    if (!d || !d.set) return false;
    d.set.call(el, (el.value || '') + text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  } catch (e) { return false; }
})(${JSON.stringify(text)})`;
}

/**
 * Main-world page script (a `function () { ... }` source) that turns the Remote's arrow keys into a
 * visible focus ring moving between the page's controls, and Enter into a click. The ring is always
 * somewhere once the page has controls: it appears when the page is ready, after navigation, and the
 * moment the focused element goes away. Keys are acted on only after the page's own handlers have had
 * their chance (end of dispatch), and only if none of them prevented the default. Never throws into
 * the page.
 */
export function pageFocusFunction(extraSelectors: string[] = []): string {
  const selector = [...DEFAULT_FOCUS_SELECTORS, ...extraSelectors].join(",");
  return `function () {
  try {
    if (window.__couchFocus) return;
    window.__couchFocus = true;
    var pick = (${PICK_SOURCE});
    var isTextField = (${TEXT_FIELD_SOURCE});
    var SELECTOR = ${JSON.stringify(selector)};
    var DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    var current = null;
    var ring = null;
    var href = function () { try { return String(location.href); } catch (e) { return ''; } };
    var lastHref = href();

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
      return !!el && (isTextField(el) || el.tagName === 'SELECT');
    };
    var ensureRing = function () {
      if (ring) return ring;
      if (!document.body) return null;
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
        if (!el) return;
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
    var view = function () { return { width: innerWidth, height: innerHeight }; };
    var ensure = function () {
      try {
        if (current && usable(current)) return;
        current = null;
        var list = candidates();
        if (list.length) {
          var i = pick(null, list.map(function (c) { return c.rect; }), 'down', view());
          if (i >= 0) current = list[i].el;
        }
        draw();
      } catch (e) {}
    };
    var move = function (dir) {
      var list = candidates();
      var from = current && usable(current) ? rectOf(current) : null;
      var i = pick(from, list.map(function (c) { return c.rect; }), dir, view());
      if (i < 0) return;
      if (list[i].el === current) return;
      var active = document.activeElement;
      if (editable(active) && active.blur) active.blur();
      current = list[i].el;
      try { current.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
      draw();
    };
    var act = function (key, dir) {
      if (dir) return move(dir);
      if (!current || !usable(current)) { current = null; ensure(); return; }
      if (editable(current)) current.focus(); else current.click();
    };
    var onKey = function (e) {
      try {
        if (e.defaultPrevented) return;
        var dir = DIRS[e.key];
        if (!dir && e.key !== 'Enter') return;
        var typing = editable(document.activeElement);
        if (dir && typing && (dir === 'left' || dir === 'right')) return;
        if (!dir && typing) return;
        // Stop the browser's own arrow/Enter action now, but remember whether the page prevents it too.
        var pagePrevented = false;
        var original = e.preventDefault;
        e.preventDefault = function () { pagePrevented = true; return original.apply(this, arguments); };
        original.call(e);
        setTimeout(function () {
          try { if (!pagePrevented) act(e.key, dir); } catch (err) {}
        }, 0);
      } catch (err) {}
    };
    var changed = function () {
      try {
        if (href() !== lastHref) { lastHref = href(); current = null; }
        ensure();
      } catch (e) {}
    };
    addEventListener('keydown', onKey, false);
    addEventListener('focusin', function (e) {
      try { if (editable(e.target)) console.debug(${JSON.stringify(FIELD_FOCUSED)}); } catch (err) {}
    }, true);
    addEventListener('focusout', function (e) {
      try { if (editable(e.target)) console.debug(${JSON.stringify(FIELD_BLURRED)}); } catch (err) {}
    }, true);
    try {
      new MutationObserver(changed).observe(document.documentElement || document, { childList: true, subtree: true });
    } catch (e) {}
    addEventListener('scroll', draw, true);
    addEventListener('resize', draw, true);
    addEventListener('popstate', changed, true);
    addEventListener('hashchange', changed, true);
    addEventListener('load', changed, true);
    if (document.readyState !== 'loading') ensure();
    else addEventListener('DOMContentLoaded', ensure, true);
  } catch (e) {}
}`;
}
