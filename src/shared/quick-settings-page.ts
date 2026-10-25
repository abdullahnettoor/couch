import { glassTokensCss } from "./glass-tokens.ts";
import { ICON_PATHS } from "./icons.ts";

/** How long the drawer takes to slide in or out. */
export const QUICK_SLIDE_MS = 250;

const ICONS = JSON.stringify({
  check: ICON_PATHS.check,
  minus: ICON_PATHS.minus,
  plus: ICON_PATHS.plus,
  speaker: ICON_PATHS.speaker,
  speakerMute: ICON_PATHS.speakerMute,
  monitorSlash: ICON_PATHS.monitorSlash,
  gear: ICON_PATHS.gear,
});

const CSS = `
${glassTokensCss({ unit: "var(--u)" })}
html,body { margin:0; height:100%; background:transparent; overflow:hidden; font-family:-apple-system,"SF Pro Display",system-ui,sans-serif; color:var(--t1); user-select:none; cursor:default; }
body { --u: calc(100vw / 1920); }
#scrim { position:fixed; inset:0; }
#drawer { position:fixed; left:0; top:0; bottom:0; width:33vw; box-sizing:border-box; padding:calc(56*var(--u)) calc(36*var(--u)); display:flex; flex-direction:column; gap:calc(12*var(--u)); background:var(--glass-strong); border-radius:0 calc(36*var(--u)) calc(36*var(--u)) 0; box-shadow:var(--glass-edge), 0 0 calc(90*var(--u)) rgba(0,0,0,.45); backdrop-filter:blur(40px) saturate(1.8); transform:translateX(-102%); transition:transform ${QUICK_SLIDE_MS}ms var(--ease); }
#drawer.in { transform:none; }
h2 { margin:calc(14*var(--u)) calc(10*var(--u)) calc(4*var(--u)); font-size:calc(24*var(--u)); font-weight:600; letter-spacing:.04em; text-transform:uppercase; color:var(--t3); }
h1 { margin:0 calc(10*var(--u)) calc(8*var(--u)); font-size:calc(44*var(--u)); font-weight:700; }
.row { display:flex; align-items:center; gap:calc(18*var(--u)); min-height:calc(84*var(--u)); padding:0 calc(28*var(--u)); border-radius:var(--r-row); font-size:calc(34*var(--u)); font-weight:500; background:var(--glass); box-shadow:var(--glass-edge); box-sizing:border-box; }
.row .l { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.row svg { width:calc(34*var(--u)); height:calc(34*var(--u)); fill:currentColor; flex:none; }
.row.focus, .btn.focus { background:#fff; color:#000; }
.vol { display:flex; gap:calc(12*var(--u)); align-items:stretch; }
.vol .num { flex:1; display:flex; align-items:center; justify-content:center; font-size:calc(40*var(--u)); font-weight:600; font-variant-numeric:tabular-nums; }
.btn { width:calc(96*var(--u)); min-height:calc(84*var(--u)); border-radius:var(--r-row); display:flex; align-items:center; justify-content:center; background:var(--glass); box-shadow:var(--glass-edge); }
.btn svg { width:calc(36*var(--u)); height:calc(36*var(--u)); fill:currentColor; }
.btn.on { background:var(--danger); }
`;

/**
 * The Quick settings drawer as one page for the view that sits above everything. The core decides
 * what is shown and highlighted; this page only draws the payload and reports clicks.
 */
export function quickSettingsPage(): string {
  return `<!doctype html><meta charset="utf-8"><title>Quick settings</title><style>${CSS}</style><body><div id="scrim"></div><div id="drawer"></div><script>
(function () {
  var ICONS = ${ICONS}, drawer = document.getElementById("drawer");
  function icon(n) { return '<svg viewBox="0 0 256 256" aria-hidden="true">' + ICONS[n] + "</svg>"; }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
  function cls(base, q, id) { return base + (q.focusedId === id ? " focus" : ""); }
  function draw(q) {
    var by = {}; q.items.forEach(function (i) { by[i.id] = i; });
    var html = "<h1>Quick settings</h1><h2>Sound output</h2>";
    q.items.forEach(function (i) {
      if (i.id.indexOf("out:") === 0) html += '<div class="' + cls("row", q, i.id) + '" data-id="' + esc(i.id) + '"><span class="l">' + esc(i.label) + "</span>" + (i.checked ? icon("check") : "") + "</div>";
    });
    html += '<h2>Volume</h2><div class="vol"><div class="' + cls("btn", q, "vol:down") + '" data-id="vol:down" aria-label="Volume down">' + icon("minus") + '</div><div class="num">' + (q.muted ? "Muted" : Math.round(q.volume)) + '</div><div class="' + cls("btn", q, "vol:up") + '" data-id="vol:up" aria-label="Volume up">' + icon("plus") + '</div><div class="' + cls("btn", q, "vol:mute") + (q.muted ? " on" : "") + '" data-id="vol:mute" aria-label="Mute">' + icon(q.muted ? "speakerMute" : "speaker") + "</div></div>";
    if (by.picture) html += '<div class="' + cls("row", q, "picture") + '" data-id="picture" style="margin-top:calc(14*var(--u))">' + icon("monitorSlash") + '<span class="l">Picture off</span></div>';
    html += '<div class="' + cls("row", q, "settings") + '" data-id="settings" style="margin-top:auto">' + icon("gear") + '<span class="l">All settings</span></div>';
    drawer.innerHTML = html;
  }
  window.couch.onQuick(function (q) {
    if (!q) { drawer.className = ""; return; }
    draw(q);
    requestAnimationFrame(function () { drawer.className = "in"; });
  });
  document.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest("[data-id]") : null;
    if (t) window.couch.send({ command: "quickPick", args: { item: t.getAttribute("data-id") } });
    else if (!drawer.contains(e.target)) window.couch.send({ command: "quickClose" });
  });
  document.addEventListener("contextmenu", function (e) { e.preventDefault(); window.couch.send({ command: "quickClose" }); });
})();
</script>`;
}
