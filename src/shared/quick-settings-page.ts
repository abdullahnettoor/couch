import { glassTokensCss } from "./glass-tokens.ts";
import { ICON_PATHS } from "./icons.ts";
import { rowCss } from "./row-style.ts";

/** How long the drawer takes to slide in or out. */
export const QUICK_SLIDE_MS = 250;

/** The panel's width as a share of the Screen's, and its inner corner radius in design pixels. */
const DRAWER = { widthPercent: 33, radius: 36 } as const;

/** The panel's rectangle in window points, for the native glass behind it. `r` is the corner radius. */
export function drawerGlassRect(width: number, height: number) {
  const w = (width * DRAWER.widthPercent) / 100;
  return { x: width - w, y: 0, w, h: height, r: (DRAWER.radius * width) / 1920 };
}

const ICONS = JSON.stringify({
  check: ICON_PATHS.check,
  minus: ICON_PATHS.minus,
  plus: ICON_PATHS.plus,
  speaker: ICON_PATHS.speaker,
  speakerMute: ICON_PATHS.speakerMute,
  monitorSlash: ICON_PATHS.monitorSlash,
  gear: ICON_PATHS.gear,
});

const css = (glass: boolean) => `
${glassTokensCss({ unit: "var(--u)" })}
html,body { margin:0; height:100%; background:transparent; overflow:hidden; font-family:-apple-system,"SF Pro Display",system-ui,sans-serif; color:var(--t1); user-select:none; cursor:default; }
:root { --u: calc(100vw / 1920); }
#scrim { position:fixed; inset:0; }
#drawer { position:fixed; right:0; top:0; bottom:0; width:${DRAWER.widthPercent}vw; box-sizing:border-box; padding:calc(56*var(--u)) calc(36*var(--u)); display:flex; flex-direction:column; gap:calc(12*var(--u)); ${glass ? "background:transparent;" : "background:var(--glass-strong);"} border-radius:calc(${DRAWER.radius}*var(--u)) 0 0 calc(${DRAWER.radius}*var(--u)); ${glass ? "" : "box-shadow:var(--glass-edge), 0 0 calc(90*var(--u)) rgba(0,0,0,.45); backdrop-filter:blur(40px) saturate(1.8);"} transform:translateX(100%); transition:transform ${QUICK_SLIDE_MS}ms var(--ease); }
#drawer.in { transform:none; }
h2 { margin:calc(14*var(--u)) calc(10*var(--u)) calc(4*var(--u)); font-size:calc(24*var(--u)); font-weight:600; letter-spacing:.04em; text-transform:uppercase; color:var(--t3); }
h1 { margin:0 calc(10*var(--u)) calc(8*var(--u)); font-size:calc(44*var(--u)); font-weight:700; }
${rowCss(".row", "var(--u)")}
.row.note { color:var(--t3); }
.end { margin-top:auto; }
.row .l { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
.row svg { width:calc(34*var(--u)); height:calc(34*var(--u)); fill:currentColor; flex:none; }
.row .l { flex:1; }
.row .sp { width:calc(34*var(--u)); height:calc(34*var(--u)); }
.row.vol { gap:calc(12*var(--u)); padding-right:calc(12*var(--u)); }
.row.vol .num { min-width:calc(110*var(--u)); text-align:center; font-size:calc(36*var(--u)); font-weight:600; font-variant-numeric:tabular-nums; }
.btn { width:calc(72*var(--u)); height:calc(72*var(--u)); border-radius:var(--r-row); display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,.14); }
.btn svg { width:calc(32*var(--u)); height:calc(32*var(--u)); fill:currentColor; }
.btn.on { background:var(--danger); color:#fff; }
`;

/**
 * The Quick settings drawer as one page for the view that sits above everything. The core decides
 * what is shown and highlighted; this page only draws the payload and reports clicks. With `glass`, a
 * native glass panel sits right under this view, so the panel drops its tint and blur and shows it.
 */
export function quickSettingsPage({ glass = false }: { glass?: boolean } = {}): string {
  return `<!doctype html><meta charset="utf-8"><title>Quick settings</title><style>${css(glass)}</style><body><div id="scrim"></div><div id="drawer"></div><script>
(function () {
  var ICONS = ${ICONS}, drawer = document.getElementById("drawer");
  var ESC = { "&": "&#38;", "<": "&#60;", ">": "&#62;", '"': "&#34;", "'": "&#39;", "\\x60": "&#96;" };
  function esc(t) { return String(t).replace(/[&<>"'\\x60]/g, function (c) { return ESC[c]; }); }
  function icon(n) { return '<svg viewBox="0 0 256 256" aria-hidden="true">' + ICONS[n] + "</svg>"; }
  function focusClass(q, id) { return q.focusedId === id ? " focus" : ""; }
  function byId(q, id) { return q.items.filter(function (i) { return i.id === id; })[0]; }
  function outputRow(q, i) {
    return '<div class="row' + focusClass(q, i.id) + '" data-id="' + esc(i.id) + '"><span class="l">' + esc(i.label) + "</span>" + (i.checked ? '<span class="v">' + icon("check") + "</span>" : "") + "</div>";
  }
  function volumeButton(id, label, name, on) {
    return '<span class="btn' + (on ? " on" : "") + '" data-id="' + id + '" aria-label="' + label + '">' + icon(name) + "</span>";
  }
  function volumeRow(q, i) {
    var level = q.muted ? "Muted" : String(Math.round(Number(q.volume)) || 0);
    return '<div class="row vol' + focusClass(q, i.id) + '" data-id="' + esc(i.id) + '"><span class="l">' + esc(i.label) + '</span>' + volumeButton("vol:down", "Volume down", "minus") + '<b class="num">' + esc(level) + "</b>" + volumeButton("vol:up", "Volume up", "plus") + volumeButton("vol:mute", "Mute", q.muted ? "speakerMute" : "speaker", q.muted) + "</div>";
  }
  function actionRow(q, i, name) {
    return '<div class="row' + focusClass(q, i.id) + '" data-id="' + esc(i.id) + '"><span class="l">' + esc(i.label) + "</span>" + icon(name) + "</div>";
  }
  function draw(q) {
    var html = "<h1>Quick settings</h1><h2>Sound output</h2>";
    q.items.forEach(function (i) { if (i.id.indexOf("out:") === 0) html += outputRow(q, i); });
    (q.notes || []).forEach(function (t) { html += '<div class="row note">' + esc(t) + "</div>"; });
    var vol = byId(q, "vol"), picture = byId(q, "picture"), settings = byId(q, "settings");
    if (vol) html += "<h2>Volume</h2>" + volumeRow(q, vol);
    if (picture) html += actionRow(q, picture, "monitorSlash");
    if (settings) html += '<div class="end">' + actionRow(q, settings, "gear") + "</div>";
    drawer.innerHTML = html;
  }
  var open = false, shown = false;
  window.couchQuick.onQuick(function (q) {
    if (!q) {
      open = false;
      if (shown) { shown = false; drawer.className = ""; window.couchQuick.slideStart("out"); }
      return;
    }
    draw(q);
    if (open) return;
    open = true;
    requestAnimationFrame(function () {
      if (!open) return;
      drawer.className = "in";
      shown = true;
      window.couchQuick.slideStart("in");
    });
  });
  document.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest("[data-id]") : null;
    if (t) window.couchQuick.pick(t.getAttribute("data-id"));
    else if (!drawer.contains(e.target)) window.couchQuick.close();
  });
  document.addEventListener("contextmenu", function (e) { e.preventDefault(); window.couchQuick.close(); });
})();
</script>`;
}
