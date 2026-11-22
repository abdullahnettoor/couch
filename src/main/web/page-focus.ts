import { KEY_CLAIM_ATTRIBUTE } from "./page-hooks.ts";
import { SHIELD_ID, WAKE_POINTER_SOURCE } from "./pointer-wake.ts";

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
  /** Overlays that never count as covering a control (a hover preview): the highlight stays on the control beneath. */
  passive?: string[];
  /** Inside a pop-up the highlight and the page's own focus stay together: the entry control takes the focus, and the highlight follows it when the page moves it with the arrows (a menu's roving focus), so OK presses what the highlight is on. */
  followFocus?: boolean;
  /** Where the highlight lands when a pop-up opens: the first usable match of the first selector that has one, inside the pop-up. While none matches yet, the highlight waits (never on a text link); the wait ends when one does or the household moves, and from then on it stays where they put it. */
  modalEntry?: string[];
  /** Rows of cards: Left/Right stay in the row, Up/Down leave it; at the row's end `next`/`prev` (inside the row) page it. */
  rows?: { row: string; next?: string; prev?: string };
  /** The page binds the arrow keys itself (volume, seeking) but the highlight takes them: the page's handlers never see them. */
  takeArrows?: boolean;
  /** Docked regions that stay put while the page scrolls (a sidebar, a player bar): a move stays inside the region it starts in (or in the page, from the page) while that has a control that way; from a dock it then goes to the page, never to another dock. */
  docks?: string[];
  /** Where Down lands in a bottom dock (one no taller than a quarter of the screen, with its top in the lower half), by dock selector: the first usable control matching the first of its selectors that has one; none matching, the control nearest. Down with nothing further down, in the page or a side dock, goes to a bottom dock, whatever the height of its controls' centres. */
  dockEntry?: Record<string, string[]>;
  /** Panels that stay open across pages, and the control that closes each: Back presses it (the first open one, when no pop-up is on screen) instead of going back a page. */
  closers?: Array<{ open: string; press: string }>;
  /** The highlight starts on the first control of the page's first row (the topmost, then the leftmost; on screen first), not the one nearest the middle, and is placed again as the page settles until the household first moves it. */
  startFirst?: boolean;
  /** The ring outlines only the part of a control that is on screen (not past an edge, not under a dock that doesn't hold it). Off: the whole control, even where it runs off screen. */
  clipRing?: boolean;
  /** A control inside an element matching this is outlined as that whole element (a song row, not its small Play button); OK still presses the control. */
  ringAround?: string;
  /** RegExp source whose first group is a title's id in a link's `href`: how a control opened from a card is found again after the page redraws it. */
  titleId?: string;
  /**
   * A player's own control bar, which Couch brings up with Down (by moving the pointer over the page, as the site expects)
   * and walks with the arrow keys while the player's normal keys stay the player's. `url` is a RegExp source for the player's address.
   */
  playerBar?: {
    url: string;
    /** The bar's controls. */
    controls: string[];
    /** A menu the bar opens: while one is on screen the highlight stays on its `items`. */
    menus: string[];
    items: string[];
    /** Where the highlight starts. */
    start?: string;
    /** The bar goes away after this long without a key. */
    idleMs: number;
  };
}

/** Page script expression: what Back should do in the page, as `backAction` reads it. */
export const BACK_QUERY = `(function () {
  try {
    var b = window.__couchPlayerBack && window.__couchPlayerBack();
    if (b) return b;
    if (window.__couchPopupOpen && window.__couchPopupOpen()) return 'escape';
    return window.__couchClosePanel && window.__couchClosePanel() ? 'handled' : '';
  } catch (e) { return ''; }
})()`;

/** What the host does with the page's answer to Back: press the site's Escape, nothing (the page handled it), or history back. */
export function backAction(answer: unknown): "press" | "none" | "history" {
  if (answer === "escape") return "press";
  if (answer === "handled") return "none";
  return "history";
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
 * Page script expression: whether a text field (or a select) of the page has focus now. An address change can be
 * the page's own pushState (Netflix's search writes each typed letter into the address), which keeps the field focused.
 */
export const FIELD_FOCUSED_QUERY = `(function () {
  try {
    var isField = (${TEXT_FIELD_SOURCE});
    var el = document.activeElement;
    return !!el && (isField(el) || el.tagName === 'SELECT');
  } catch (e) { return false; }
})()`;

/**
 * Page script source (an expression) that types `text` into the page's focused text field the way the
 * page's own framework notices (the native value setter, then input and change events). The text is the
 * whole of what was typed, so it replaces what the field held (a site's search field keeps the last search). Evaluates to
 * false, having done nothing, when no text field has focus.
 */
export function typeIntoFieldScript(text: string): string {
  return `(function (text) {
  try {
    var isField = (${TEXT_FIELD_SOURCE});
    var el = document.activeElement;
    if (!isField(el)) return false;
    if (el.isContentEditable === true) {
      document.execCommand('selectAll', false);
      return !!document.execCommand('insertText', false, text);
    }
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var d = Object.getOwnPropertyDescriptor(proto, 'value');
    if (!d || !d.set) return false;
    d.set.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  } catch (e) { return false; }
})(${JSON.stringify(text)})`;
}

/** How long the ring waits for the page to put a replaced control back before it falls back to the middle. */
export const REFIND_WAIT_MS = 400;

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
    var SHIELD_ID = ${JSON.stringify(SHIELD_ID)};
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
    // What the page paints at a point, looking through Couch's own D-pad shield.
    var hitAt = function (x, y) {
      if (typeof document.elementsFromPoint === 'function') {
        var all = document.elementsFromPoint(x, y);
        for (var i = 0; i < all.length; i++) if (all[i].id !== SHIELD_ID) return all[i];
        return null;
      }
      return document.elementFromPoint(x, y);
    };
    // Whether el is what the browser paints at a point: the element itself or something inside it.
    var paintedAt = function (el, x, y) {
      var hit = hitAt(x, y);
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
        var top = hitAt(x, y);
        if (top && LAYOUT.passive && LAYOUT.passive.length && typeof document.elementsFromPoint === 'function') {
          var stack = document.elementsFromPoint(x, y);
          top = null;
          for (var q = 0; q < stack.length; q++) {
            if (stack[q].id === SHIELD_ID) continue;
            if (stack[q] !== el && !el.contains(stack[q]) && matchesAny(stack[q], LAYOUT.passive)) continue;
            if (stack[q] !== el && !el.contains(stack[q]) && stack[q].closest && stack[q].closest(LAYOUT.passive.join(','))) continue;
            top = stack[q]; break;
          }
        }
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
    // Where a control sits, by more than the element: it is what finds the control again after the page redraws it.
    var rowsAll = function () { try { return LAYOUT.rows ? document.querySelectorAll(LAYOUT.rows.row) : []; } catch (e) { return []; } };
    var idOf = function (el) {
      try {
        if (!LAYOUT.titleId) return '';
        var a = el.closest && el.closest('a[href]') || el.querySelector && el.querySelector('a[href]');
        var m = a && new RegExp(LAYOUT.titleId).exec(String(a.getAttribute('href')));
        return m ? m[1] : '';
      } catch (e) { return ''; }
    };
    var posIn = function (row, el) {
      try { return Array.prototype.indexOf.call(row.querySelectorAll(SELECTOR), el); } catch (e) { return -1; }
    };
    var pathTo = function (el) {
      try {
        var parts = [];
        for (var e = el; e && e.parentElement; e = e.parentElement) {
          parts.push(Array.prototype.indexOf.call(e.parentElement.children, e));
        }
        return parts.join('/');
      } catch (e) { return ''; }
    };
    // Where the page and the card's row were scrolled when the card was held: what puts the card back in the same place.
    var viewOf = function (el) {
      try {
        var sc = {}, r = rectOf(el);
        for (var e = el, d = 0; e && e.parentElement; e = e.parentElement, d++) if (e.scrollLeft > 0) sc[d] = e.scrollLeft;
        return { x: window.scrollX || 0, y: window.scrollY || 0, left: r.left, sc: sc };
      } catch (err) { return null; }
    };
    var keyOf = function (el) {
      try {
        var row = rowOf(el);
        return {
          view: viewOf(el),
          id: idOf(el),
          rowIndex: row ? Array.prototype.indexOf.call(rowsAll(), row) : -1,
          rowCount: row ? rowsAll().length : 0,
          pos: row ? posIn(row, el) : -1,
          path: pathTo(el),
        };
      } catch (e) { return null; }
    };
    // Strictly the saved title (in its row, or anywhere); loosely, whatever sits in its row and slot now.
    var refind = function (key, loose) {
      try {
        if (!key) return null;
        var list = candidates(), rows = rowsAll(), i, el;
        if (key.id && key.rowIndex >= 0) {
          for (i = 0; i < list.length; i++) {
            el = list[i].el;
            if (idOf(el) === key.id && rows[key.rowIndex] && rowOf(el) === rows[key.rowIndex]) return el;
          }
        }
        if (key.id) {
          for (i = 0; i < list.length; i++) if (idOf(list[i].el) === key.id) return list[i].el;
        }
        if (!loose) return null;
        // A row's number means something only while the page has as many rows as it had.
        if (key.rowIndex >= 0 && rows[key.rowIndex] && rows.length === key.rowCount) {
          for (i = 0; i < list.length; i++) {
            el = list[i].el;
            if (rowOf(el) === rows[key.rowIndex] && posIn(rows[key.rowIndex], el) === key.pos) return el;
          }
        }
        if (key.path) {
          for (i = 0; i < list.length; i++) if (pathTo(list[i].el) === key.path) return list[i].el;
        }
      } catch (e) {}
      return null;
    };
    // Back from a pop-up: make sure the control is on screen, where the household left it.
    var reveal = function (el) {
      try {
        var r = rectOf(el);
        if (r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth) return;
        el.scrollIntoView({ block: rowOf(el) ? 'center' : 'nearest', inline: 'nearest' });
      } catch (e) {}
    };
    // The page and the row's carousel go back to how they were when the card was held, so the card is where it was, not merely somewhere on screen.
    var putBack = function (el, key) {
      try {
        var v = key && key.view;
        if (!v) return;
        for (var e = el, d = 0; e && e.parentElement; e = e.parentElement, d++) {
          if (v.sc && v.sc[d] !== undefined && e.scrollLeft !== undefined) e.scrollLeft = v.sc[d];
        }
        if ((window.scrollX || 0) !== v.x || (window.scrollY || 0) !== v.y) window.scrollTo({ left: v.x, top: v.y, behavior: 'instant' });
        var row = rowOf(el), pages = 0;
        var step = function () {
          try {
            if (!row || !LAYOUT.rows || !el.isConnected || pages++ >= 4) return;
            var dx = rectOf(el).left - v.left;
            if (Math.abs(dx) <= 8) return;
            var handle = row.querySelector(dx > 0 ? LAYOUT.rows.next : LAYOUT.rows.prev);
            if (!handle || !shown(handle)) return;
            handle.click();
            setTimeout(step, 750);
          } catch (err) {}
        };
        step();
      } catch (err) {}
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
    // The part of a box that is visible: not past the screen's edge, and not under a dock that doesn't hold the control (an open side panel).
    var visiblePart = function (r, el) {
      try {
        var out = { left: Math.max(r.left, 0), top: Math.max(r.top, 0), right: Math.min(r.right, innerWidth), bottom: Math.min(r.bottom, innerHeight) };
        var docks = LAYOUT.docks && LAYOUT.docks.length ? document.querySelectorAll(LAYOUT.docks.join(',')) : [];
        for (var i = 0; i < docks.length; i++) {
          var d = docks[i], dr = shown(d);
          if (!dr || d.contains(el)) continue;
          if (dr.bottom <= out.top || dr.top >= out.bottom || dr.right <= out.left || dr.left >= out.right) continue;
          var tall = dr.top <= out.top && dr.bottom >= out.bottom, wide = dr.left <= out.left && dr.right >= out.right;
          if (tall && dr.left > out.left) out.right = dr.left;
          else if (tall && dr.right < out.right) out.left = dr.right;
          else if (wide && dr.top > out.top) out.bottom = dr.top;
        }
        return out.right > out.left && out.bottom > out.top ? out : r;
      } catch (e) { return r; }
    };
    var draw = function () {
      try {
        var r = barOn ? barCur && shown(barCur) : !noRing() && current && usable(current);
        if (r && !barOn && LAYOUT.ringAround) {
          try { var around = current.closest(LAYOUT.ringAround); var ar = around && shown(around); if (ar) r = ar; } catch (e) {}
        }
        var el = ensureRing();
        if (!el) return;
        if (!r) { el.style.display = 'none'; return; }
        if (!barOn) lastRect = r;
        if (!barOn && LAYOUT.clipRing) r = visiblePart(r, current);
        el.style.display = 'block';
        // 6 px outside the control, but never past the window's edge: on a side where it would end off screen, the ring is drawn inside that edge.
        var rl = Math.max(r.left - 6, 0), rt = Math.max(r.top - 6, 0);
        var rr = Math.min(r.right + 6, innerWidth), rb = Math.min(r.bottom + 6, innerHeight);
        el.style.left = rl + 'px'; el.style.top = rt + 'px';
        el.style.width = (rr - rl) + 'px'; el.style.height = (rb - rt) + 'px';
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
    // Where the highlight starts: the nearest the middle, or (layout.startFirst) the first control of the first row, on screen first.
    var startIndex = function (list) {
      if (!LAYOUT.startFirst) return pick(null, list.map(function (c) { return c.rect; }), 'down', view());
      var vw = view();
      var seen = [];
      for (var n = 0; n < list.length; n++) { var q = list[n].rect; if (q.right > 0 && q.bottom > 0 && q.left < vw.width && q.top < vw.height) seen.push(n); }
      var from = seen.length ? seen : list.map(function (c, n) { return n; });
      var top = Infinity;
      for (var a = 0; a < from.length; a++) top = Math.min(top, list[from[a]].rect.top);
      var best = -1;
      for (var b = 0; b < from.length; b++) {
        var rb = list[from[b]].rect;
        if (rb.top > top + 40) continue;
        if (best < 0 || rb.left < list[best].rect.left) best = from[b];
      }
      return best;
    };
    // Until the household first moves, the starting highlight is provisional: the page is still loading and shifting, so it is placed again whenever the page changes, before a key, and on a few ticks after it first appears.
    var settleTicks = 0;
    var startSettle = function () {
      if (!LAYOUT.startFirst || settleTicks > 0) return;
      settleTicks = 6;
      var tick = function () {
        if (landed || settleTicks <= 0) { settleTicks = 0; return; }
        settleTicks--;
        try { replaceStart(); } catch (e) {}
        setTimeout(tick, 1000);
      };
      setTimeout(tick, 1000);
    };
    var replaceStart = function () {
      if (!LAYOUT.startFirst || landed || layers.length || pending || lost || barOn || !current) return;
      var list = candidates();
      if (LAYOUT.docks && LAYOUT.docks.length) {
        var inPage = list.filter(function (c) { try { return !c.el.closest(LAYOUT.docks.join(',')); } catch (e) { return true; } });
        if (inPage.length) list = inPage;
      }
      var i = list.length ? startIndex(list) : -1;
      if (i >= 0 && list[i].el !== current) { current = list[i].el; heldKey = keyOf(current); }
      draw();
    };
    // displaced: the control the household held until something (a dialog still sliding in) covered it.
    // layers: one frame per open modal, bottom first, each with the control held when it opened.
    var layers = [], displaced = null, displacedKey = null, heldKey = null;
    // The control to give the highlight back to once the page has redrawn it (a pop-up just closed and it is not there yet).
    var pending = null;
    // The control held when the page replaced it (its node left the page): looked for again, by the key it was held under, for a moment before the ring falls back to the middle.
    var lost = null, lastRect = null;
    // The pop-up's own first choice (layout.modalEntry): the first usable match of the first selector that has one.
    var entryControl = function (modal) {
      try {
        var sels = LAYOUT.modalEntry || [];
        for (var i = 0; i < sels.length; i++) {
          var found = modal.querySelectorAll(sels[i]);
          for (var j = 0; j < found.length; j++) if (usable(found[j], modal)) return found[j];
        }
      } catch (e) {}
      return null;
    };
    // Put on a dock before the page was there, and not moved by the household: the page takes the highlight when it arrives.
    var leaveEarlyDock = function () {
      try {
        if (!current || landed || !LAYOUT.docks || !LAYOUT.docks.length) return;
        var sel = LAYOUT.docks.join(',');
        if (!current.closest(sel)) return;
        var early = candidates().filter(function (c) { return !c.el.closest(sel); });
        if (!early.length) return;
        var ei = pick(null, early.map(function (c) { return c.rect; }), 'down', view());
        if (ei >= 0) { current = early[ei].el; heldKey = keyOf(current); draw(); }
      } catch (e) {}
    };
    var ensure = function () {
      try {
        if (barOn) { barTick(); if (barOn) return; }
        if (noRing()) { current = null; lost = null; draw(); return; }
        var modal = scopeEl();
        var top = layers.length ? layers[layers.length - 1].modal : null;
        var layersChanged = false;
        if (modal !== top || layers.some(function (l) { return !shown(l.modal); })) {
          layersChanged = true;
          lost = null;
          // Modals closed: go back to what was held when the lowest of them opened, if it is still there.
          var restore = null, kept = [];
          for (var n = 0; n < layers.length; n++) {
            if (shown(layers[n].modal)) kept.push(layers[n]);
            else if (!restore && layers[n].opener) restore = layers[n];
          }
          layers = kept;
          // A modal opened: remember what was held, and go inside.
          if (modal && !kept.some(function (l) { return l.modal === modal; })) {
            var held = displaced || (current && current.isConnected ? current : null);
            layers.push({ modal: modal, opener: held, key: displaced ? displacedKey : heldKey, entering: !!(LAYOUT.modalEntry && LAYOUT.modalEntry.length) });
          }
          if (restore) {
            var back = restore.opener && usable(restore.opener) ? restore.opener : refind(restore.key, !restore.key || !restore.key.id);
            if (back) { current = back; putBack(back, restore.key); reveal(back); heldKey = keyOf(back); pending = null; }
            else if (restore.key) {
              // The title is waited for, not swapped for whatever is in its slot yet; after 3 s the slot is all there is.
              var wait = { key: restore.key, expired: false };
              pending = wait;
              setTimeout(function () { if (pending === wait) { wait.expired = true; ensure(); } }, 3000);
            }
          }
          displaced = null;
        }
        if (pending) {
          var found = refind(pending.key, pending.expired || !pending.key.id);
          if (found) { current = found; putBack(found, pending.key); reveal(found); heldKey = keyOf(found); pending = null; }
          else if (pending.expired) pending = null;
        }
        var topLayer = layers.length ? layers[layers.length - 1] : null;
        if (topLayer && topLayer.entering && topLayer.modal === modal) {
          // Until the household moves, the ring waits for an entry control: geometry never picks a text link here.
          var entry = entryControl(modal);
          if (entry) {
            if (entry !== current) {
              current = entry; heldKey = keyOf(entry); displaced = null;
              // The page's focus starts where the highlight is, so its own arrow moves go on from the entry.
              if (LAYOUT.followFocus) { try { entry.focus({ preventScroll: true }); } catch (e) {} }
            }
          }
          else { current = null; displaced = null; draw(); return; }
        }
        leaveEarlyDock();
        replaceStart();
        if (current && usable(current)) { draw(); return; }
        if (current && current.isConnected && !displaced) { displaced = current; displacedKey = heldKey; }
        if (current && !current.isConnected && !lost && heldKey && !layersChanged) {
          var gone = { key: heldKey, rect: lastRect, expired: false };
          lost = gone;
          setTimeout(function () { if (lost === gone) { gone.expired = true; ensure(); } }, ${REFIND_WAIT_MS});
        }
        current = null;
        if (pending && pending.key.id) { draw(); return; }
        if (lost) {
          var again = refind(lost.key, lost.expired || !lost.key.id);
          if (again) { current = again; heldKey = keyOf(again); lost = null; draw(); return; }
          if (!lost.expired) { draw(); return; }
          lost = null;
        }
        var list = candidates();
        // With docks the highlight starts on the page, not on a sidebar or a bar, when the page has anything.
        if (LAYOUT.docks && LAYOUT.docks.length) {
          var inPage = list.filter(function (c) { try { return !c.el.closest(LAYOUT.docks.join(',')); } catch (e) { return true; } });
          if (inPage.length) list = inPage;
        }
        if (list.length) {
          var i = startIndex(list);
          if (i >= 0) { current = list[i].el; heldKey = keyOf(current); startSettle(); }
        }
        draw();
      } catch (e) {}
    };
    // The player's bar (layout.playerBar): up while barOn, the highlight on barCur.
    var BAR = LAYOUT.playerBar || null;
    var barOn = false, barCur = null, barLast = null, barReturn = null, barIdle = 0, barMoves = 0, pumping = false;
    var inPlayer = function () { try { return !!BAR && new RegExp(BAR.url).test(href()); } catch (e) { return false; } };
    var barMenu = function () {
      try {
        var all = document.querySelectorAll(BAR.menus.join(','));
        for (var i = 0; i < all.length; i++) if (shown(all[i])) return all[i];
      } catch (e) {}
      return null;
    };
    var barCands = function () {
      var out = [];
      try {
        var menu = barMenu();
        var all = (menu || document).querySelectorAll((menu ? BAR.items : BAR.controls).join(','));
        for (var i = 0; i < all.length; i++) {
          if (all[i] === menu) continue;
          var r = shown(all[i]);
          if (r) out.push({ el: all[i], rect: r });
        }
      } catch (e) {}
      return out;
    };
    // Moves the pointer over the player: the site shows its bar for it, and keeps it up while it keeps moving.
    var wakePointer = (${WAKE_POINTER_SOURCE});
    var wake = function () {
      try { wakePointer(++barMoves); } catch (e) {}
    };
    var touch = function () {
      var token = ++barIdle;
      setTimeout(function () { if (token === barIdle) barOff(); }, BAR.idleMs);
    };
    var pump = function () {
      if (pumping) return;
      pumping = true;
      var again = function () {
        setTimeout(function () {
          if (!barOn) { pumping = false; return; }
          wake();
          again();
        }, 1000);
      };
      again();
    };
    var barOff = function () {
      barOn = false; barCur = null; barLast = null; barReturn = null;
      barIdle++;
      draw();
    };
    var barUp = function () {
      barOn = true; barCur = null; barLast = null; barReturn = null;
      wake(); touch(); pump();
      barTick();
    };
    // Keeps the highlight on something that is there: the menu's first item when one opens, the control it came from when it closes.
    var barTick = function () {
      try {
        if (!barOn) return;
        if (!inPlayer()) { barOff(); return; }
        var list = barCands();
        if (barCur && barCur.isConnected && list.some(function (c) { return c.el === barCur; })) { draw(); return; }
        var next = null, i;
        if (barMenu()) next = list.length ? list[0].el : null;
        else if (barReturn && list.some(function (c) { return c.el === barReturn; })) next = barReturn;
        else if (barLast) {
          var bestD = Infinity;
          for (i = 0; i < list.length; i++) {
            var dx = (list[i].rect.left + list[i].rect.right - barLast.left - barLast.right) / 2;
            var dy = (list[i].rect.top + list[i].rect.bottom - barLast.top - barLast.bottom) / 2;
            if (dx * dx + dy * dy < bestD) { bestD = dx * dx + dy * dy; next = list[i].el; }
          }
        } else {
          for (i = 0; i < list.length && !next; i++) if (BAR.start && list[i].el.matches(BAR.start)) next = list[i].el;
          if (!next && list.length) next = list[0].el;
        }
        if (next && !barMenu()) barReturn = null;
        barCur = next;
        if (barCur) barLast = rectOf(barCur);
        draw();
      } catch (e) {}
    };
    var barMove = function (dir) {
      var list = barCands();
      var from = barCur && barCur.isConnected ? rectOf(barCur) : null;
      var i = pick(from, list.map(function (c) { return c.rect; }), dir, view());
      if (i < 0 || list[i].el === barCur) return;
      barCur = list[i].el;
      barLast = list[i].rect;
      if (barMenu()) { try { barCur.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
      draw();
    };
    var barPress = function () {
      var el = barCur;
      if (!el || !el.isConnected) { barTick(); return; }
      if (!barMenu()) barReturn = el;
      el.click();
    };
    var stop = function (e) {
      e.preventDefault();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    };
    // The host sends keys of its own (a skip's arrows) for the player: for this long they are not Couch's to take.
    var rawUntil = 0;
    window.__couchRawKeys = function (ms) { rawUntil = Date.now() + ms; };
    // Before the player's own handlers: with the bar up the arrows and OK are the bar's; Down brings it up.
    var onBarKey = function (e) {
      try {
        if (Date.now() < rawUntil) return;
        if (!BAR || !inPlayer()) return;
        var dir = DIRS[e.key];
        if (!barOn) {
          if (dir === 'down' && !editable(document.activeElement)) { stop(e); barUp(); }
          return;
        }
        touch();
        if (!dir && e.key !== 'Enter') return;
        stop(e);
        if (dir) barMove(dir); else barPress();
      } catch (err) {}
    };
    // Back with a panel open: its own closer is pressed, and the page stays where it is.
    var firstShown = function (sel) {
      var all = document.querySelectorAll(sel);
      for (var i = 0; i < all.length; i++) if (shown(all[i])) return all[i];
      return null;
    };
    // Only a control that can be pressed closes anything: a disabled one does nothing, so Back must not count it.
    var firstEnabled = function (sel) {
      var all = document.querySelectorAll(sel);
      for (var i = 0; i < all.length; i++) {
        var b = all[i];
        if (!shown(b) || b.disabled || b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true') continue;
        return b;
      }
      return null;
    };
    window.__couchClosePanel = function () {
      try {
        var cl = LAYOUT.closers || [];
        for (var i = 0; i < cl.length; i++) {
          var open = firstShown(cl[i].open), btn = open && firstEnabled(cl[i].press);
          if (!btn) continue;
          btn.click();
          return true;
        }
      } catch (e) {}
      return false;
    };
    // Back in the player: 'escape' (the host presses the site's Escape: it closes the menu, or hides the bar Netflix keeps up after Couch stops moving the pointer), '' (leave).
    window.__couchPlayerBack = function () {
      try {
        if (!barOn || !inPlayer()) return '';
        if (barMenu()) { touch(); return 'escape'; }
        barOff();
        return 'escape';
      } catch (e) { return ''; }
    };
    var paging = false;
    // Whether the household has moved the highlight yet.
    var landed = false;
    // The held control when a scroll of the household's left it wholly off screen.
    var strayed = null;
    var offScreen = function (r) { return r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight; };
    // With docks: the controls in the same region as the held one (the page, or one dock) come first; the rest only when none lies that way.
    var dockOf = function (el) {
      try { return LAYOUT.docks && LAYOUT.docks.length && el.closest ? el.closest(LAYOUT.docks.join(',')) : null; } catch (e) { return null; }
    };
    var bottomOf = function (el) {
      var d = dockOf(el), r = d && rectOf(d);
      return r && r.bottom - r.top <= innerHeight / 4 && r.top >= innerHeight / 2 ? d : null;
    };
    // The control Down reaches in a bottom dock: the layout's entry control, else the one nearest across.
    var bottomDock = function (from, list) {
      var cx = (from.left + from.right) / 2, near = -1, nearDx = Infinity, entries = {}, widest = 0, q;
      for (var key0 in (LAYOUT.dockEntry || {})) widest = Math.max(widest, LAYOUT.dockEntry[key0].length);
      for (q = 0; q < list.length; q++) {
        var d = bottomOf(list[q].el);
        if (!d) continue;
        var dx = Math.abs((list[q].rect.left + list[q].rect.right) / 2 - cx);
        if (dx < nearDx) { near = q; nearDx = dx; }
        var want = null;
        for (var key in (LAYOUT.dockEntry || {})) { try { if (d.matches(key)) want = LAYOUT.dockEntry[key]; } catch (e) {} }
        for (var w = 0; want && w < want.length; w++) {
          try { if (list[q].el.matches(want[w]) && (entries[w] === undefined)) entries[w] = q; } catch (e) {}
        }
      }
      for (var e = 0; e < widest; e++) if (entries[e] !== undefined) return entries[e];
      return near;
    };
    var rects = function (l) { return l.map(function (c) { return c.rect; }); };
    var pickIn = function (from, list, dir) {
      if (!LAYOUT.docks || !LAYOUT.docks.length) return pick(from, rects(list), dir, view());
      if (!from || !current) {
        // Starting from nothing: on the page, when it has anything.
        var onPage = [];
        for (var m = 0; m < list.length; m++) if (!dockOf(list[m].el)) onPage.push(m);
        var first = pick(from, rects(onPage.map(function (n) { return list[n]; })), dir, view());
        return first >= 0 ? onPage[first] : pick(from, rects(list), dir, view());
      }
      var home = dockOf(current), near = [], k, side = dir === 'left' || dir === 'right';
      for (k = 0; k < list.length; k++) {
        if (dockOf(list[k].el) !== home) continue;
        // A sideways move stays on its line (a shelf's cards, a bar's buttons); inside a dock an up or down move does too (a sidebar's links).
        var r = list[k].rect;
        if (side ? r.bottom <= from.top || r.top >= from.bottom : home && (r.right <= from.left || r.left >= from.right)) continue;
        near.push(k);
      }
      var through = function (idx) {
        var j = pick(from, rects(idx.map(function (n) { return list[n]; })), dir, view());
        return j >= 0 ? idx[j] : -1;
      };
      var found = through(near);
      // A control partly under a side dock (a panel open over a shelf): sideways, the dock is next, before the shelf's cards beyond the screen.
      if (side && !home && (found < 0 || offScreen(list[found].rect))) {
        var over = [];
        for (k = 0; k < list.length; k++) {
          var od = dockOf(list[k].el), odr = od && rectOf(od);
          if (!odr || odr.bottom - odr.top <= innerHeight / 2) continue;
          var ahead = dir === 'right' ? odr.left >= from.left : odr.right <= from.right;
          if (ahead && odr.left < from.right && odr.right > from.left) over.push(k);
        }
        if (over.length) {
          var edge = rectOf(dockOf(list[over[0]].el));
          var start = dir === 'right' ? edge.left : edge.right;
          var o = pick({ left: start, right: start, top: from.top, bottom: from.bottom }, rects(over.map(function (n) { return list[n]; })), dir, view());
          if (o >= 0) return over[o];
        }
      }
      if (found >= 0) return found;
      if (dir === 'down' && (!home || rectOf(home).bottom - rectOf(home).top > innerHeight / 4 )) {
        var toBar = bottomDock(from, list);
        if (toBar >= 0) return toBar;
      }
      if (!home) {
        // From the end of its line a sideways move can only go to a side dock (one as tall as the screen's half): a bar along the bottom is for Down.
        if (!side) return pick(from, rects(list), dir, view());
        var docked = [];
        for (k = 0; k < list.length; k++) {
          var d = dockOf(list[k].el), dr = d && rectOf(d);
          if (dr && dr.bottom - dr.top > innerHeight / 2) docked.push(k);
        }
        return through(docked);
      }
      // From a dock, on to the page, never to another dock.
      var page = [];
      for (k = 0; k < list.length; k++) {
        if (dockOf(list[k].el)) continue;
        // Sideways, only what is on screen: a row of cards runs on past the edge, and the far end isn't "to the right" of a panel.
        var rk = list[k].rect;
        if (side && offScreen(rk)) continue;
        // And beyond the dock's far edge: Right from a panel on the right has nowhere to go, not to a card under it.
        var hr = home && rectOf(home);
        if (side && hr && (dir === 'right' ? rk.right <= hr.right : rk.left >= hr.left)) continue;
        page.push(k);
      }
      return through(page);
    };
    var move = function (dir, afterPaging) {
      leaveEarlyDock();
      var list = candidates();
      var from = current && usable(current) ? rectOf(current) : (lost && lost.rect ? lost.rect : null);
      // The household scrolled the held control off screen: start again from what is on screen (nearest the middle), instead of scrolling back to it.
      if (strayed && strayed === current && current.isConnected && !offScreen(rectOf(current))) strayed = null;
      if (strayed && strayed === current && current.isConnected) {
        var seen = list.filter(function (c) { return !offScreen(c.rect); });
        if (seen.length) {
          var j = pick(null, seen.map(function (c) { return c.rect; }), dir, view());
          strayed = null;
          if (j >= 0) { land(seen[j].el, false); return; }
        }
      }
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
      } else i = pickIn(from, list, dir);
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
      land(list[i].el, !!row);
    };
    // The household's move puts the highlight on el.
    var land = function (el, inRow) {
      landed = true;
      var active = document.activeElement;
      if (editable(active) && active.blur) active.blur();
      current = el;
      heldKey = keyOf(current);
      lost = null;
      displaced = null;
      pending = null;
      strayed = null;
      if (layers.length) layers[layers.length - 1].entering = false;
      try { current.scrollIntoView({ block: inRow || rowOf(current) ? 'center' : 'nearest', inline: 'nearest' }); } catch (e) {}
      draw();
    };
    var act = function (key, dir) {
      replaceStart();
      if (dir) return move(dir);
      if (!current && lost) {
        // The held control was replaced a moment ago: OK looks for it now, and otherwise the wait is over.
        var back = refind(lost.key, true);
        if (back) { current = back; heldKey = keyOf(back); lost = null; draw(); }
        else { lost.expired = true; ensure(); return; }
      }
      if (!current || !usable(current)) { current = null; ensure(); return; }
      if (editable(current)) current.focus(); else current.click();
    };
    // Under a native view this script lives in an isolated world and cannot see the page's own preventDefault; the page world leaves the event's time on the root element instead.
    var claimed = function (e) {
      try { return document.documentElement.getAttribute(${JSON.stringify(KEY_CLAIM_ATTRIBUTE)}) === String(e.timeStamp); } catch (err) { return false; }
    };
    var onKey = function (e) {
      try {
        if (e.defaultPrevented || Date.now() < rawUntil) return;
        if (noRing()) return;
        var dir = DIRS[e.key];
        if (!dir && e.key !== 'Enter') return;
        var typing = editable(document.activeElement);
        if (dir && typing && (dir === 'left' || dir === 'right')) return;
        if (!dir && typing) return;
        // Stop the browser's own arrow/Enter action now, but remember whether the page prevents it too.
        var pagePrevented = false;
        // A page with its own arrow shortcuts (volume, say): the arrows are the highlight's, and never reach it.
        if (dir && LAYOUT.takeArrows && e.stopImmediatePropagation) e.stopImmediatePropagation();
        var original = e.preventDefault;
        e.preventDefault = function () { pagePrevented = true; return original.apply(this, arguments); };
        original.call(e);
        setTimeout(function () {
          try { if ((!pagePrevented || (dir && LAYOUT.takeArrows)) && !claimed(e)) act(e.key, dir); } catch (err) {}
        }, 0);
      } catch (err) {}
    };
    var changed = function () {
      try {
        if (href() !== lastHref) {
          // A modal opening or closing changes only the query (/browse to /browse?jbv=): the page is the same. Another path is a new page.
          var moved = pathOf(href()) !== pathOf(lastHref);
          lastHref = href();
          if (moved) { current = null; layers = []; displaced = null; lost = null; if (LAYOUT.startFirst) landed = false; }
        }
        ensure();
      } catch (e) {}
    };
    // A search of Couch's own: the page is the same (a /search stays /search), but the highlight starts over, on the first result.
    window.__couchResetFocus = function () {
      try {
        current = null; layers = []; displaced = null; lost = null; pending = null; strayed = null; heldKey = null; lastRect = null;
        if (LAYOUT.startFirst) landed = false;
        if (barOn) barOff();
        ensure();
      } catch (e) {}
    };
    // Whether a pop-up is on screen: Back should close it the site's way instead of going back in history. Never in a player.
    window.__couchPopupOpen = function () {
      try { return !noRing() && !!scopeEl(); } catch (e) { return false; }
    };
    // D-pad mode: after a key the pointer is hidden and inert (a mouse resting over a row would otherwise
    // hover it); real mouse movement beyond a few pixels ends it. Couch's synthetic events are untrusted: ignored.
    // The pointer is hidden and made inert by a transparent shield over the viewport, built through the CSSOM
    // (YouTube's CSP ignores an injected <style>). hitAt() and the pointer wake look through it.
    var DPAD = 'data-couch-dpad', dpadAnchor = null, shield = null;
    var shieldUp = function () {
      try {
        if (shield) return;
        var de = document.documentElement;
        if (!de || !de.appendChild) return;
        shield = document.createElement('div');
        shield.id = SHIELD_ID;
        var s = shield.style;
        s.position = 'fixed'; s.left = '0'; s.top = '0'; s.width = '100vw'; s.height = '100vh';
        s.background = 'transparent'; s.cursor = 'none'; s.pointerEvents = 'auto'; s.zIndex = '2147483646';
        de.appendChild(shield);
      } catch (e) {}
    };
    var shieldDown = function () {
      try { if (shield && shield.remove) shield.remove(); } catch (e) {}
      shield = null;
    };
    var dpadOn = function () {
      try { dpadAnchor = null; document.documentElement.setAttribute(DPAD, ''); shieldUp(); } catch (e) {}
    };
    addEventListener('keydown', dpadOn, true);
    addEventListener('mousemove', function (e) {
      try {
        if (!e.isTrusted) return;
        // Couch's own wake of a player's bar arrives as a real move under WebKit: not the household's mouse.
        var wk = window.__couchWake;
        if (wk && Date.now() - wk.at < 750 && Math.abs(e.clientX - wk.x) <= 2 && Math.abs(e.clientY - wk.y) <= 2) return;
        if (!dpadAnchor) { dpadAnchor = { x: e.clientX, y: e.clientY }; return; }
        if (Math.abs(e.clientX - dpadAnchor.x) + Math.abs(e.clientY - dpadAnchor.y) > 8) {
          document.documentElement.removeAttribute(DPAD);
          shieldDown();
        }
      } catch (err) {}
    }, true);
    addEventListener('keydown', onBarKey, true);
    addEventListener('keydown', onKey, false);
    // With followFocus a key of the household's ends the wait for the entry control, before the page's own handlers move its focus.
    addEventListener('keydown', function (e) {
      try {
        if (LAYOUT.followFocus && DIRS[e.key] && layers.length) layers[layers.length - 1].entering = false;
      } catch (err) {}
    }, true);
    addEventListener('focusin', function (e) {
      try { if (editable(e.target)) console.debug(${JSON.stringify(FIELD_FOCUSED)}); } catch (err) {}
      try {
        if (!LAYOUT.followFocus || barOn || noRing() || !layers.length || !e.target || e.target === current) return;
        var top = layers[layers.length - 1];
        // The pop-up's own first focus is not the household's move: the entry control still waits.
        if (top.entering || top.modal !== scopeEl()) return;
        if (!matchesAny(e.target, [SELECTOR]) || !usable(e.target)) return;
        current = e.target; heldKey = keyOf(current); lost = null; displaced = null; pending = null; strayed = null; landed = true;
        draw();
      } catch (err) {}
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
    // A click of the household's on a control makes it the held one: the pop-up it opens is then opened from, and closes back to, that control.
    addEventListener('click', function (e) {
      try {
        if (!e.isTrusted || barOn || noRing()) return;
        var el = e.target && e.target.closest ? e.target.closest(SELECTOR) : null;
        if (!el || el === current || !usable(el)) return;
        current = el; heldKey = keyOf(el); lost = null; displaced = null; pending = null; strayed = null; landed = true;
        if (layers.length) layers[layers.length - 1].entering = false;
        draw();
      } catch (err) {}
    }, true);
    addEventListener('scroll', function (e) {
      draw();
      try { if (e && e.isTrusted && current && current.isConnected && !scopeEl() && offScreen(rectOf(current))) strayed = current; } catch (err) {}
      try { if (current && heldKey && !scopeEl() && !pending) heldKey.view = viewOf(current); } catch (e) {}
    }, true);
    // A resize (a Text size change too) draws at once, then again once the page has laid itself out again: Netflix moves
    // its row controls for a moment after a resize with no event the ring hears.
    addEventListener('resize', function () { draw(); setTimeout(draw, 500); }, true);
    addEventListener('popstate', changed, true);
    addEventListener('hashchange', changed, true);
    addEventListener('load', changed, true);
    if (document.readyState !== 'loading') ensure();
    else addEventListener('DOMContentLoaded', ensure, true);
  } catch (e) {}
}`;
}
