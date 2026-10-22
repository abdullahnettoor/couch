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
        if (along <= 4) continue;
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

/**
 * What a site's own layout adds to the generic focus. Plain data (it becomes part of the page script);
 * selectors are CSS, `url` a RegExp source tested against the address.
 */
export interface FocusLayout {
  /** Pages that get no highlight at all (a player): every key goes to the page. First match wins; any of `url`/`present` set must hold. */
  noRing?: Array<{ url?: string; present?: string }>;
  /** Controls never highlighted (duplicates, hidden helpers). */
  ignore?: string[];
  /** The site's own modal containers, on top of role=dialog and aria-modal=true: while one is on screen the highlight stays inside the topmost. */
  scopes?: string[];
  /** Rows of cards: Left/Right stay in the row, Up/Down leave it; at the row's end `next`/`prev` (inside the row) page it. */
  rows?: { row: string; next?: string; prev?: string };
}

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
export function pageFocusFunction(extraSelectors: string[] = [], layout: FocusLayout = {}): string {
  const selector = [...DEFAULT_FOCUS_SELECTORS, ...extraSelectors].join(",");
  return `function () {
  try {
    if (window.__couchFocus) return;
    window.__couchFocus = true;
    var pick = (${PICK_SOURCE});
    var isTextField = (${TEXT_FIELD_SOURCE});
    var SELECTOR = ${JSON.stringify(selector)};
    var LAYOUT = ${JSON.stringify(layout)};
    var DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    var current = null;
    var ring = null;
    var href = function () { try { return String(location.href); } catch (e) { return ''; } };
    var pathOf = function (u) { return String(u).split(/[?#]/)[0]; };
    var lastHref = href();

    var rectOf = function (el) {
      var r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    var shown = function (el) {
      try {
        if (!el || !el.isConnected) return null;
        var r = rectOf(el);
        if (r.right - r.left <= 0 || r.bottom - r.top <= 0) return null;
        var s = getComputedStyle(el);
        if (s.visibility === 'hidden' || s.display === 'none') return null;
        return r;
      } catch (e) { return null; }
    };
    var matchesAny = function (el, sels) {
      for (var i = 0; sels && i < sels.length; i++) { try { if (el.matches(sels[i])) return true; } catch (e) {} }
      return false;
    };
    var MODALS = ['[role=dialog]', '[role=alertdialog]', '[aria-modal="true"]'].concat(LAYOUT.scopes || []).join(',');
    // Whether el is what the browser paints at a point: the element itself or something inside it.
    var paintedAt = function (el, x, y) {
      var hit = document.elementFromPoint(x, y);
      return !!hit && (hit === el || el.contains(hit));
    };
    // The topmost modal on screen, or null: a top-layer dialog if any; else the one painted over the most
    // of a few points of its own box (a z-index only counts within its stacking context); else the last in the page.
    var scopeEl = function () {
      try {
        var found = document.querySelectorAll(MODALS), live = [];
        for (var j = 0; j < found.length; j++) if (shown(found[j])) live.push(found[j]);
        if (!live.length) return null;
        var topLayer = null;
        for (var t = 0; t < live.length; t++) {
          try { if (live[t].matches(':modal')) topLayer = live[t]; } catch (e) {}
        }
        if (topLayer) return topLayer;
        var best = live[live.length - 1];
        if (live.length < 2 || typeof document.elementFromPoint !== 'function') return best;
        var bestHits = -1;
        for (var k = 0; k < live.length; k++) {
          var r = rectOf(live[k]), hits = 0;
          var fx = [0.5, 0.25, 0.75, 0.25, 0.75], fy = [0.5, 0.25, 0.25, 0.75, 0.75];
          for (var p = 0; p < fx.length; p++) {
            var x = Math.min(Math.max(r.left + (r.right - r.left) * fx[p], 0), innerWidth - 1);
            var y = Math.min(Math.max(r.top + (r.bottom - r.top) * fy[p], 0), innerHeight - 1);
            if (paintedAt(live[k], x, y)) hits++;
          }
          if (hits >= bestHits) { best = live[k]; bestHits = hits; }
        }
        return best;
      } catch (e) { return null; }
    };
    // Something drawn over the element's visible middle: it can't be pressed.
    var covered = function (el, r) {
      try {
        if (typeof document.elementFromPoint !== 'function') return false;
        // Off screen there is nothing to cover it: it is judged when it scrolls in.
        if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false;
        var x = Math.min(Math.max((Math.max(r.left, 0) + Math.min(r.right, innerWidth)) / 2, 0), innerWidth - 1);
        var y = Math.min(Math.max((Math.max(r.top, 0) + Math.min(r.bottom, innerHeight)) / 2, 0), innerHeight - 1);
        var top = document.elementFromPoint(x, y);
        return !!top && top !== el && !el.contains(top);
      } catch (e) { return false; }
    };
    var noRing = function () {
      var rules = LAYOUT.noRing || [];
      for (var i = 0; i < rules.length; i++) {
        var rule = rules[i];
        if (!rule.url && !rule.present) continue;
        if (rule.url && !new RegExp(rule.url).test(href())) continue;
        if (rule.present) {
          var hit = document.querySelectorAll(rule.present), any = false;
          for (var j = 0; j < hit.length && !any; j++) any = !!shown(hit[j]);
          if (!any) continue;
        }
        return true;
      }
      return false;
    };
    var usable = function (el, scope) {
      try {
        if (el.disabled || el.hasAttribute('disabled') || el.getAttribute && el.getAttribute('aria-disabled') === 'true') return null;
        var r = shown(el);
        if (!r) return null;
        // Never a box that is most of the screen: a highlight on it would cover the page.
        if ((r.right - r.left) * (r.bottom - r.top) > 0.5 * innerWidth * innerHeight) return null;
        if (matchesAny(el, LAYOUT.ignore)) return null;
        var sc = scope === undefined ? scopeEl() : scope;
        if (sc && !sc.contains(el)) return null;
        if (covered(el, r)) return null;
        return r;
      } catch (e) { return null; }
    };
    var pinned = function (el) {
      try {
        for (var e = el; e && e.nodeType !== 9; e = e.parentElement || e.parent) {
          var p = getComputedStyle(e).position;
          if (p === 'fixed' || p === 'sticky') return true;
        }
      } catch (err) {}
      return false;
    };
    var rowOf = function (el) {
      try { return LAYOUT.rows && el.closest ? el.closest(LAYOUT.rows.row) : null; } catch (e) { return null; }
    };
    var editable = function (el) {
      return !!el && (isTextField(el) || el.tagName === 'SELECT');
    };
    var ensureRing = function () {
      if (ring) return ring;
      if (!document.body) return null;
      ring = document.createElement('div');
      var s = ring.style;
      s.position = 'fixed'; s.boxSizing = 'border-box'; s.pointerEvents = 'none'; s.zIndex = '2147483647';
      s.border = '3px solid rgba(255,255,255,0.95)'; s.borderRadius = '10px';
      s.background = 'none';
      s.boxShadow = '0 0 0 1px rgba(0,0,0,0.5)';
      s.transition = 'all 120ms ease-out'; s.display = 'none';
      document.body.appendChild(ring);
      return ring;
    };
    var draw = function () {
      try {
        var r = !noRing() && current && usable(current);
        var el = ensureRing();
        if (!el) return;
        if (!r) { el.style.display = 'none'; return; }
        el.style.display = 'block';
        el.style.left = (r.left - 6) + 'px'; el.style.top = (r.top - 6) + 'px';
        el.style.width = (r.right - r.left + 12) + 'px'; el.style.height = (r.bottom - r.top + 12) + 'px';
      } catch (e) {}
    };
    var candidates = function () {
      var out = [];
      var scope = scopeEl();
      var all = document.querySelectorAll(SELECTOR);
      for (var i = 0; i < all.length; i++) {
        var r = usable(all[i], scope);
        if (r) out.push({ el: all[i], rect: r });
      }
      return out;
    };
    var view = function () { return { width: innerWidth, height: innerHeight }; };
    // displaced: the control the household held until something (a dialog still sliding in) covered it.
    // layers: one frame per open modal, bottom first, each with the control held when it opened.
    var layers = [], displaced = null;
    var ensure = function () {
      try {
        if (noRing()) { current = null; draw(); return; }
        var modal = scopeEl();
        var top = layers.length ? layers[layers.length - 1].modal : null;
        if (modal !== top || layers.some(function (l) { return !shown(l.modal); })) {
          // Modals closed: go back to what was held when the lowest of them opened, if it is still there.
          var restore = null, kept = [];
          for (var n = 0; n < layers.length; n++) {
            if (shown(layers[n].modal)) kept.push(layers[n]);
            else if (!restore && layers[n].opener) restore = layers[n].opener;
          }
          layers = kept;
          // A modal opened: remember what was held, and go inside.
          if (modal && !kept.some(function (l) { return l.modal === modal; })) {
            layers.push({ modal: modal, opener: displaced || (current && current.isConnected ? current : null) });
          }
          if (restore && usable(restore)) current = restore;
          displaced = null;
        }
        if (current && usable(current)) { draw(); return; }
        if (current && current.isConnected && !displaced) displaced = current;
        current = null;
        var list = candidates();
        if (list.length) {
          var i = pick(null, list.map(function (c) { return c.rect; }), 'down', view());
          if (i >= 0) current = list[i].el;
        }
        draw();
      } catch (e) {}
    };
    var paging = false;
    var move = function (dir, afterPaging) {
      var list = candidates();
      var from = current && usable(current) ? rectOf(current) : null;
      // After paging, Netflix may have made the old card unfocusable: it still says which row we are in, and where.
      var held = current && current.isConnected ? current : null;
      var row = held ? rowOf(held) : null;
      var heldRect = held ? rectOf(held) : null;
      // A pinned bar (fixed or sticky) moves among what is on screen; it doesn't send the page scrolling back to reach something above it.
      if (from && pinned(current)) {
        var vw = view();
        list = list.filter(function (c) { return c.rect.right > 0 && c.rect.bottom > 0 && c.rect.left < vw.width && c.rect.top < vw.height; });
      }
      var sideways = dir === 'left' || dir === 'right';
      if (row) {
        var v = view();
        list = list.filter(function (c) {
          var same = rowOf(c.el) === row;
          if (!sideways) return !same;
          // Sideways in a row only to cards fully on screen; past them, the row pages.
          return same && c.rect.left >= 0 && c.rect.right <= v.width;
        });
      }
      var i;
      if (afterPaging && row && sideways) {
        // The row has just slid a page: land on the card at its near edge, whatever the old one did.
        i = -1;
        for (var n = 0; n < list.length; n++) {
          if (i < 0 || (dir === 'right' ? list[n].rect.left < list[i].rect.left : list[n].rect.left > list[i].rect.left)) i = n;
        }
        // Only if the row really moved: the card must lie past the old one in the direction asked.
        if (i >= 0 && heldRect && (dir === 'right' ? list[i].rect.left <= heldRect.left : list[i].rect.left >= heldRect.left)) i = -1;
      } else i = pick(from, list.map(function (c) { return c.rect; }), dir, view());
      if (i < 0) {
        if (row && sideways && !paging && !afterPaging) {
          var handle = row.querySelector(dir === 'right' ? LAYOUT.rows.next : LAYOUT.rows.prev);
          if (handle && shown(handle)) {
            paging = true;
            handle.click();
            setTimeout(function () { paging = false; try { move(dir, true); } catch (e) {} }, 750);
          }
        }
        return;
      }
      if (list[i].el === current) return;
      var active = document.activeElement;
      if (editable(active) && active.blur) active.blur();
      current = list[i].el;
      displaced = null;
      try { current.scrollIntoView({ block: row || rowOf(current) ? 'center' : 'nearest', inline: 'nearest' }); } catch (e) {}
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
        if (noRing()) return;
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
        if (href() !== lastHref) {
          // A modal opening or closing changes only the query (/browse to /browse?jbv=): the page is the same. Another path is a new page.
          var moved = pathOf(href()) !== pathOf(lastHref);
          lastHref = href();
          if (moved) { current = null; layers = []; displaced = null; }
        }
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
      new MutationObserver(function (records) {
        // The ring's own restyling is not the page changing.
        if (records && records.length && records.every(function (r) { return r.target === ring; })) return;
        changed();
      }).observe(document.documentElement || document, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'open', 'hidden', 'aria-modal', 'aria-hidden'],
      });
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
