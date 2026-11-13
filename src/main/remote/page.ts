import { GLASS, lookCss } from "../../shared/look.ts";
import { ICON_MARKUP } from "../../shared/icons.ts";
import { CHECK_SVG, setupControls } from "../../shared/setup-controls.ts";
import { trackCode } from "../../shared/track-code.ts";

/** Back, Home and Mute: the top of Now Playing, its D-pad view and the idle Remote; `p` keeps the Back ids apart. */
const bar = (p: string) =>
  `<button data-cmd="back" aria-label="Back" data-i="backArrow" id="${p}-back"></button><button data-cmd="home" aria-label="Home" data-i="home"></button><button class="mutebtn" data-cmd="mute" aria-label="Mute" data-i="speaker"></button>`;
/** The compact volume pill (− level +) of Now Playing and the idle Remote; `p` keeps the ids apart. */
const vpill = (p: string) =>
  `<div class="vpill" id="${p}-vol"><button data-cmd="volDown" aria-label="Volume down" data-i="minus"></button><b id="${p}-vol-n" role="status" aria-label="Volume"></b><button data-cmd="volUp" aria-label="Volume up" data-i="plus"></button></div>`;
const PAD = `<button class="dir u" data-cmd="up" aria-label="Up" data-i="up"></button><button class="dir d" data-cmd="down" aria-label="Down" data-i="down"></button><button class="dir l" data-cmd="left" aria-label="Left" data-i="left"></button><button class="dir r" data-cmd="right" aria-label="Right" data-i="right"></button><button class="ok" data-cmd="ok">OK</button>`;

/** The Remote page, served as one self-contained document (no build step for it). Plain ES5-ish JS, no template literals. */
export const REMOTE_PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="__THEME__">
<title>Couch Remote</title>
<link rel="icon" type="image/png" sizes="32x32" href="/mark-32.png">
<link rel="icon" type="image/png" sizes="256x256" href="/mark.png">
<link rel="apple-touch-icon" href="/touch-icon.png">
<link rel="manifest" id="manifest" href="/manifest.webmanifest">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Couch">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<style>
  __TOKENS__
  :root { font-family:var(--font-family); -webkit-font-smoothing:antialiased; color:var(--text-primary); background:var(--backdrop); }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html, body { margin:0; height:100%; background:radial-gradient(80% 60% at 50% 0%, var(--card), var(--backdrop) 70%) fixed; overscroll-behavior:none; }
  body { display:flex; flex-direction:column; min-height:100dvh; padding:max(18px, env(safe-area-inset-top)) 24px max(24px, env(safe-area-inset-bottom)); max-width:480px; margin:0 auto; user-select:none; -webkit-user-select:none; font-size:var(--type-phone-body); }
  [hidden] { display:none !important; }
  button { font:inherit; color:inherit; border:0; background:none; padding:0; cursor:pointer; }
  button:disabled { opacity:.35; }
  svg.i { width:1em; height:1em; display:block; fill:currentColor; flex:none; }
  .top { display:flex; justify-content:space-between; align-items:center; color:var(--text-tertiary); font-size:var(--type-phone-small); }
  .top b { display:block; color:var(--text-primary); font-size:var(--type-phone-heading); margin-top:2px; }
  .live { display:flex; align-items:center; gap:6px; font-size:var(--type-phone-caption); }
  .live i { width:8px; height:8px; border-radius:var(--radius-dot); background:var(--live); }
  .off .live i { background:var(--danger); }
  .connecting .live i { background:var(--text-tertiary); }
  .banner { margin-top:12px; padding:12px 16px; border-radius:var(--radius-row); background:var(--glass-strong); backdrop-filter:var(--blur-glass-heavy); box-shadow:var(--shadow-glass-edge); color:var(--text-primary); font-size:var(--type-phone-small); font-weight:var(--weight-semibold); display:flex; align-items:center; gap:10px; }
  .banner::before { content:""; width:8px; height:8px; border-radius:var(--radius-dot); background:var(--danger); flex:none; }
  .note { margin-top:10px; padding:0 16px; font-size:var(--type-phone-small); color:var(--text-tertiary); }
  main { flex:1; display:flex; flex-direction:column; transition:opacity var(--duration-quick); }
  .off main { opacity:.35; pointer-events:none; }
  .conn { position:relative; height:2px; margin-top:6px; border-radius:var(--radius-hairline); overflow:hidden; background:var(--track-faint); flex:none; }
  .conn::after { content:""; position:absolute; top:0; bottom:0; width:34%; border-radius:var(--radius-hairline); background:var(--text-tertiary); animation:conn var(--duration-sweep) var(--ease-sweep) infinite; }
  @keyframes conn { from { left:-34%; } to { left:100%; } }
  @media (prefers-reduced-motion:reduce) { .conn::after { animation:none; left:33%; opacity:.6; } }
  .pad { margin:26px auto 0; width:min(270px, 70vw); aspect-ratio:1; border-radius:50%; position:relative; background:radial-gradient(circle at 50% 35%, var(--card-raised), var(--card)); box-shadow:var(--shadow-pad); flex:none; }
  .dir { position:absolute; width:24%; height:24%; display:grid; place-items:center; color:var(--text-tertiary); font-size:var(--type-phone-icon-dpad); border-radius:50%; }
  .dir:active { background:var(--press-soft); }
  .dir.u { left:38%; top:2%; } .dir.d { left:38%; bottom:2%; } .dir.l { left:2%; top:38%; } .dir.r { right:2%; top:38%; }
  .ok { position:absolute; left:25%; top:25%; width:50%; height:50%; border-radius:50%; background:var(--card-key); box-shadow:var(--shadow-key-edge-strong); font-size:var(--type-phone-key-ok); font-weight:var(--weight-semibold); }
  .ok:active { background:var(--card-pressed); }
  .vslider button { width:44px; height:44px; flex:none; display:grid; place-items:center; font-size:var(--type-phone-icon); color:var(--text-secondary); border-radius:var(--radius-phone-pill); }
  .vslider button:active { background:var(--press); }
  .k { height:64px; border-radius:var(--radius-key); background:var(--card); display:flex; align-items:center; justify-content:center; gap:8px; font-weight:var(--weight-semibold); box-shadow:var(--shadow-key-edge); transition:transform var(--duration-press); }
  .k:active { transform:scale(.95); background:var(--card-active); }
  .k.hero { background:var(--focus-bg); color:var(--focus-fg); }
  .k.txt { font-size:var(--type-phone-key-text); }
  .search { margin-top:18px; height:56px; border-radius:var(--radius-search); background:var(--card); display:flex; align-items:center; gap:12px; padding:0 20px; color:var(--text-tertiary); font-size:var(--type-phone-control); width:100%; }
  a.search { text-decoration:none; }
  .search svg { font-size:var(--type-phone-icon); }
  .search.dim { opacity:.35; }
  .cw { margin-top:18px; display:flex; gap:14px; align-items:center; padding:10px; border-radius:var(--radius-card); background:var(--card); width:100%; text-align:left; }
  .cw .cwapp { display:grid; place-items:center; width:24px; height:24px; margin:4px; border-radius:var(--radius-badge-small); background:var(--badge-bg); overflow:hidden; }
  .cw .cwapp svg { width:70%; height:70%; }
  .cw .pic { width:104px; height:58px; border-radius:var(--radius-thumb-small); background:var(--card-raised) center/cover; flex:none; }
  .note-card { margin-top:18px; padding:14px 16px; border-radius:var(--radius-card); background:var(--card); width:100%; text-align:left; font-size:var(--type-phone-small); }
  .note-card b { display:block; font-size:var(--type-phone-body); margin-bottom:6px; }
  .note-card ol { margin:0; padding-left:20px; color:var(--text-tertiary); }
  .cw.nx { margin:10px 0 0; }
  .cw b { display:block; font-size:var(--type-phone-body); }
  .cw span.l { font-size:var(--type-phone-caption); color:var(--text-tertiary); }
  .cw span.hold { display:block; margin-top:2px; font-size:var(--type-phone-fine); opacity:.7; }
  .cw .txt { min-width:0; flex:1; }
  .cw .txt b { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .cw .go { width:44px; height:44px; border-radius:var(--radius-phone-pill); background:var(--focus-bg); color:var(--focus-fg); display:grid; place-items:center; font-size:var(--type-phone-icon); flex:none; }
  .other { margin-top:16px; padding:12px 16px; border-radius:var(--radius-card-small); background:var(--card); font-size:var(--type-phone-small); color:var(--text-secondary); }
  body.idle, body.np { width:100%; height:100dvh; min-height:0; overflow:hidden; padding:max(10px, env(safe-area-inset-top)) 20px max(14px, env(safe-area-inset-bottom)); }
  body.idle .top, body.np .top { font-size:var(--type-phone-label); }
  body.idle .top b, body.np .top b { display:inline; font-size:var(--type-phone-caption); margin:0 0 0 6px; }
  body.idle .pbtn, body.np .pbtn { width:32px; height:32px; font-size:var(--type-phone-icon-compact); margin-left:8px; }
  body.idle main { min-height:0; gap:8px; padding-top:8px; }
  body.idle .cw, body.idle .search { margin:0; flex:none; }
  body.idle .search { height:52px; }
  .apps { display:flex; gap:14px; overflow-x:auto; overscroll-behavior-x:contain; scrollbar-width:none; margin:14px -20px 0; padding:2px 20px; flex:none; -webkit-overflow-scrolling:touch; }
  .apps::-webkit-scrollbar { display:none; }
  .apps.few { justify-content:center; }
  .app { flex:0 0 68px; display:flex; flex-direction:column; align-items:center; gap:6px; color:var(--text-tertiary); font-size:var(--type-phone-label); font-weight:var(--weight-semibold); min-width:0; }
  .app .ic { width:56px; height:56px; border-radius:var(--radius-app-icon-phone); background:var(--card); display:grid; place-items:center; overflow:hidden; box-shadow:var(--shadow-key-edge); }
  .app .ic svg { width:30px; height:30px; font-size:var(--type-phone-icon-app); }
  .app:active .ic { background:var(--card-active); }
  .app span.n { max-width:68px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .padwrap { flex:1; min-height:0; display:grid; place-items:center; }
  body.idle .pad { margin:0; width:min(320px, 82vw, 100%, 46dvh); }
  body.idle .other { margin:0; }
  body.idle .vpill { margin-top:2px; }
  .nowp, .npad { flex:1; min-height:0; display:flex; flex-direction:column; gap:8px; padding-top:8px; transition:opacity var(--duration-quick); }
  .off .nowp, .off .npad { opacity:.35; pointer-events:none; }
  .bar { display:grid; grid-auto-flow:column; grid-auto-columns:1fr; gap:10px; flex:none; }
  .bar button { height:44px; border-radius:var(--radius-phone-pill); background:var(--glass); box-shadow:var(--shadow-glass-edge); backdrop-filter:var(--blur-glass); -webkit-backdrop-filter:var(--blur-glass); display:flex; align-items:center; justify-content:center; gap:8px; font-size:var(--type-phone-icon); color:var(--text-primary); transition:transform var(--duration-press); }
  .bar button:active { transform:scale(.95); background:var(--press); }
  .bar button.on { background:var(--focus-bg); color:var(--focus-fg); }
  .art { position:relative; flex:1; min-height:72px; border-radius:var(--radius-art); overflow:hidden; background:var(--card) center/cover; touch-action:none; box-shadow:var(--shadow-art); cursor:pointer; }
  .art .face { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; color:var(--text-primary); font-size:var(--type-phone-subhead); font-weight:var(--weight-semibold); }
  .art .face svg { width:clamp(36px, 18vmin, 76px); height:clamp(36px, 18vmin, 76px); }
  .art.has .face { display:none; }
  .art[data-app="youtube"] { background-image:linear-gradient(160deg,var(--art-youtube-from),var(--art-youtube-to)); }
  .art[data-app="netflix"] { background-image:linear-gradient(160deg,var(--art-netflix-from),var(--art-netflix-to)); }
  .art[data-app="library"] { background-image:linear-gradient(160deg,var(--art-library-from),var(--art-library-to)); }
  .art[data-app="library"] .face { color:var(--on-light); }
  .art.has { background-size:cover; }
  .toast { position:absolute; top:12px; left:50%; transform:translateX(-50%) scale(.9); padding:8px 16px; border-radius:var(--radius-phone-toast); background:var(--toast-bg); color:var(--text-primary); font-size:var(--type-phone-small); font-weight:var(--weight-semibold); opacity:0; pointer-events:none; transition:opacity var(--duration-fade), transform var(--duration-fade); white-space:nowrap; }
  .ptoast { position:fixed; top:calc(env(safe-area-inset-top,0px) + 12px); left:50%; transform:translate(-50%,-6px); max-width:88vw; padding:9px 18px; border-radius:var(--radius-phone-toast); background:var(--toast-strong-bg); color:var(--text-primary); font-size:var(--type-phone-small); font-weight:var(--weight-semibold); text-align:center; opacity:0; pointer-events:none; transition:opacity var(--duration-quick), transform var(--duration-quick); z-index:50; }
  .ptoast.show { opacity:1; transform:translate(-50%,0); }
  .toast.show { opacity:1; transform:translateX(-50%) scale(1); }
  .prompt { position:absolute; left:12px; right:12px; bottom:12px; height:48px; border-radius:var(--radius-prompt); background:var(--focus-bg); color:var(--focus-fg); font-size:var(--type-phone-body); font-weight:var(--weight-bold); display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:var(--shadow-prompt); }
  .prompt:active { transform:scale(.97); }
  .ttlrow { display:flex; align-items:center; gap:10px; flex:none; margin-top:2px; }
  .ttlrow .t { min-width:0; flex:1; }
  .ttlrow h3 { margin:0; font-size:var(--type-phone-title); line-height:var(--line-height-phone-title); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .ttlrow .f { color:var(--text-tertiary); font-size:var(--type-phone-small); margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .ttlrow .more { width:40px; height:40px; border-radius:var(--radius-round-button); display:grid; place-items:center; font-size:var(--type-phone-icon-small); color:var(--text-secondary); background:var(--glass); box-shadow:var(--shadow-glass-edge); flex:none; }
  .seek { flex:none; padding:10px 0; touch-action:none; cursor:pointer; position:relative; }
  .seek .bar2 { height:8px; border-radius:var(--radius-seek); background:var(--track); position:relative; }
  .seek .fill { position:absolute; inset:0 auto 0 0; width:0; background:var(--fill-bright); border-radius:var(--radius-seek); }
  .seek .knob { position:absolute; top:-7px; left:0; width:22px; height:22px; margin-left:-11px; border-radius:var(--radius-knob); background:var(--fill-bright); box-shadow:var(--shadow-knob); }
  .seek.ro { cursor:default; }
  .seek.ro .knob { display:none; }
  .tm { display:flex; justify-content:space-between; font-size:var(--type-phone-caption); color:var(--text-tertiary); font-weight:var(--weight-semibold); font-variant-numeric:tabular-nums; flex:none; margin-top:-4px; }
  .tr { display:flex; justify-content:space-around; align-items:center; flex:none; font-size:var(--type-phone-icon-transport); }
  .tr button { width:56px; height:56px; display:grid; place-items:center; border-radius:50%; }
  .tr button:active { background:var(--press-soft); }
  .tr .pp { width:76px; height:76px; background:var(--focus-bg); color:var(--focus-fg); font-size:var(--type-phone-icon-play); transition:transform var(--duration-press); }
  .tr .pp:active { transform:scale(.94); background:var(--focus-bg-pressed); }
  .chips { display:flex; gap:8px; flex:none; }
  .chip { flex:1 0 auto; min-width:44px; height:44px; border-radius:var(--radius-phone-pill); background:var(--card); display:flex; align-items:center; justify-content:center; gap:4px; padding:0 8px; font-size:var(--type-phone-caption); font-weight:var(--weight-semibold); box-shadow:var(--shadow-key-edge); }
  .chip svg { font-size:var(--type-phone-icon-small); }
  .chip .cc { font-variant-numeric:tabular-nums; letter-spacing:var(--letter-spacing-counter); }
  .chip.pad-chip { flex:0 0 44px; padding:0; }
  .chip.pad-chip svg { font-size:var(--type-phone-icon); }
  .chip span { white-space:nowrap; }
  .chip:active { background:var(--card-active); }
  .chip.on { background:var(--focus-bg); color:var(--focus-fg); }
  .vpill { align-self:center; flex:none; height:44px; width:176px; border-radius:var(--radius-phone-pill); background:var(--glass); box-shadow:var(--shadow-glass-edge); display:flex; align-items:center; justify-content:space-between; padding:0 4px; }
  .vpill button { width:40px; height:40px; border-radius:var(--radius-round-button); display:grid; place-items:center; font-size:var(--type-phone-icon-small); color:var(--text-secondary); }
  .vpill button:active { background:var(--press); }
  .vpill b { font-size:var(--type-phone-body); font-variant-numeric:tabular-nums; }
  .vpill.muted b { color:var(--text-tertiary); }
  .npad { align-items:stretch; }
  .npad .pad { margin:auto; width:min(270px, 70vw, 40vh); }
  .npad .back { height:56px; border-radius:var(--radius-phone-pill-large); background:var(--focus-bg); color:var(--focus-fg); font-size:var(--type-phone-control); font-weight:var(--weight-bold); display:flex; align-items:center; justify-content:center; gap:10px; flex:none; margin-top:auto; }
  .npad .back svg { font-size:var(--type-phone-icon-medium); }
  .npad .hint { text-align:center; color:var(--text-tertiary); font-size:var(--type-phone-small); flex:none; }
  .sheet .rows { width:100%; max-width:480px; margin:0 auto; padding:18px 16px max(22px, env(safe-area-inset-bottom)); background:var(--card); border-radius:var(--radius-sheet) var(--radius-sheet) 0 0; display:grid; gap:6px; box-shadow:var(--shadow-sheet); max-height:70dvh; overflow-y:auto; animation:rise var(--duration-drop-in) var(--ease-rise); }
  .sheet .rows .h { font-size:var(--type-phone-small); font-weight:var(--weight-semibold); color:var(--text-tertiary); padding:0 8px 6px; }
  .sheet .rows button { height:52px; border-radius:var(--radius-sheet-control); background:var(--card-key); text-align:left; padding:0 16px; font-size:var(--type-phone-control); display:flex; align-items:center; justify-content:space-between; }
  .sheet .rows button.cur { background:var(--focus-bg); color:var(--focus-fg); font-weight:var(--weight-bold); }
  @keyframes rise { from { transform:translateY(40px); opacity:0; } to { transform:none; opacity:1; } }
  @media (prefers-reduced-motion:reduce) { .sheet .rows { animation:none; } .toast, .ptoast { transition:none; } }
  .pbtn { width:40px; height:40px; border-radius:var(--radius-round-button); display:grid; place-items:center; font-size:var(--type-phone-icon-small); color:var(--text-secondary); background:var(--glass); box-shadow:var(--shadow-glass-edge); margin-left:12px; }
  .pbtn:active { background:var(--press); }
  .topr { display:flex; align-items:center; }
  .pw { position:fixed; inset:0; z-index:8; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; text-align:center; background:radial-gradient(80% 60% at 50% 0%, var(--card), var(--backdrop) 70%); padding:24px; }
  .pw .mark { position:relative; width:112px; height:112px; }
  .pw .mark::before { content:""; position:absolute; inset:-104px; border-radius:50%; background:var(--setup-glow); pointer-events:none; }
  .pw .mark img { position:relative; display:block; width:100%; height:100%; }
  .pw h1 { margin:8px 0 0; font-size:var(--type-phone-title-large); font-weight:var(--weight-semibold); }
  .pw p { margin:0; font-size:var(--type-phone-subhead); color:var(--text-tertiary); }
  .pw .big { margin-top:22px; width:120px; height:120px; border-radius:var(--radius-power-button); display:grid; place-items:center; font-size:var(--type-phone-icon-power); background:var(--glass-strong); backdrop-filter:var(--blur-glass-heavy); -webkit-backdrop-filter:var(--blur-glass-heavy); box-shadow:var(--shadow-glass-edge); transition:transform var(--duration-press); }
  .pw .big:active { transform:scale(.94); }
  .spin { width:34px; height:34px; margin-top:22px; border-radius:50%; border:3px solid var(--spinner-track); border-top-color:var(--text-primary); animation:spin var(--duration-spinner) var(--ease-spin) infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .sheet { position:fixed; inset:0; background:var(--scrim-sheet); display:flex; align-items:flex-end; z-index:5; }
  .sheet form, .sheet .form { width:100%; max-width:480px; margin:0 auto; padding:22px 20px; background:var(--card); border-radius:var(--radius-sheet) var(--radius-sheet) 0 0; display:grid; gap:12px; box-shadow:var(--shadow-sheet); }
  .sheet input { width:100%; height:56px; border-radius:var(--radius-sheet-control); border:0; background:var(--field); color:var(--text-primary); font:inherit; font-size:var(--type-phone-field); padding:0 16px; user-select:text; -webkit-user-select:text; caret-color:var(--accent); }
  .sheet .btns { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .sheet .btns .k { background:var(--card-key); border-radius:var(--radius-sheet-control); height:56px; font-size:var(--type-phone-control); }
  .sheet .btns .k.hero { background:var(--focus-bg); }
  .sheet .stack { display:grid; gap:10px; }
  .sheet .stack .k { background:var(--card-key); border-radius:var(--radius-sheet-control); min-height:56px; font-size:var(--type-phone-control); padding:0 16px; }
  .sheet .stack .k.sw { display:flex; align-items:center; justify-content:space-between; }
  .sheet .stack .k.hero { background:var(--focus-bg); color:var(--focus-fg); }
  .sheet .tiles { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .sheet .tile { position:relative; height:92px; border-radius:var(--radius-sheet-tile); background:var(--card-key); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; font-size:var(--type-phone-small); font-weight:var(--weight-semibold); transition:opacity var(--duration-quick), box-shadow var(--duration-quick); }
  .sheet .tile .ic { display:grid; place-items:center; height:34px; }
  .sheet .tile .ic svg { width:34px; height:34px; font-size:var(--type-phone-icon-tile); }
  .sheet .tile.off { opacity:.42; }
  .sheet .tile.hero { box-shadow:var(--shadow-tile-hero); }
  .sheet .tick { display:inline-grid; place-items:center; width:20px; height:20px; border-radius:var(--radius-tick); background:var(--tick-bg); color:var(--tick-fg); vertical-align:-3px; }
  .sheet .tick svg { width:12px; height:12px; }
  .sheet .tile .tick { position:absolute; top:8px; right:8px; }
</style>
</head>
<body>
<div class="top"><div>On the Screen<b id="where"></b></div><div class="topr"><div class="live"><i></i><span id="status">Connecting…</span><span id="count"></span></div><button class="pbtn" id="pbtn" aria-label="Power" data-i="power"></button></div></div>
<div class="conn" id="conn" role="status" aria-label="Connecting" hidden></div>
<div class="pw" id="pw" hidden>
  <div class="mark"><img src="/mark.png" alt=""></div>
  <h1 id="pw-title">Couch is off</h1>
  <p id="pw-sub">Press Power to turn it on.</p>
  <button class="big" id="pw-btn" data-cmd="power" aria-label="Power" data-i="power"></button>
  <div class="spin" id="pw-spin" hidden></div>
</div>
<div class="sheet" id="confirm" hidden>
  <div class="form" role="dialog" aria-label="Turn Couch off?">
    <b style="font-size:var(--type-phone-heading)">Turn Couch off?</b>
    <div class="btns"><button type="button" class="k txt" id="confirm-cancel">Cancel</button><button type="button" class="k hero txt" id="confirm-off" data-cmd="power">Turn off</button></div>
  </div>
</div>
<div class="sheet" id="ask" hidden>
  <div class="form" role="dialog" aria-labelledby="ask-title">
    <b id="ask-title" style="font-size:var(--type-phone-heading)"></b>
    <span id="ask-body" style="color:var(--text-tertiary);font-size:var(--type-phone-subhead);white-space:pre-line"></span>
    <div class="tiles" id="ask-tiles" hidden></div>
    <div class="stack" id="ask-btns"></div>
    <span id="ask-foot" style="color:var(--text-tertiary);font-size:var(--type-phone-caption)" hidden></span>
    <div class="btns" id="ask-nav" hidden><button type="button" class="k txt" data-cmd="back" aria-label="Back">Back</button><button type="button" class="k txt" data-cmd="home" aria-label="Home">Home</button></div>
  </div>
</div>
<div class="ptoast" id="phone-toast" role="status" aria-live="polite"></div>
<div class="banner" id="banner" hidden>Can't reach Couch. Is the Mac awake and Couch open?</div>
<div class="note" id="hint" hidden>Still nothing? Scan the QR code on the Screen again to pair this phone.</div>
<section class="nowp" id="nowp" hidden>
  <div class="bar">__BAR_NP__</div>
  <div class="art" id="np-art" role="button" aria-label="Play or pause. Swipe sideways to skip, up or down for volume.">
    <div class="face" id="np-face"></div>
    <div class="toast" id="np-toast" role="status" aria-live="polite"></div>
    <button class="prompt" id="np-prompt" hidden></button>
  </div>
  <div class="ttlrow"><div class="t"><h3 id="np-title"></h3><div class="f" id="np-line"></div></div><button class="more" id="np-more" aria-label="Up next" data-i="list" hidden></button></div>
  <div class="seek" id="seek"><div class="bar2"><div class="fill" id="np-fill"></div><div class="knob" id="np-knob"></div></div></div>
  <div class="tm"><span id="np-elapsed"></span><span id="np-remaining"></span></div>
  <div class="tr">
    <button data-cmd="seekBy" data-seconds="-10" aria-label="Back 10 seconds" data-i="back10"></button>
    <button class="pp" data-cmd="playpause" aria-label="Play or pause" id="np-pp"></button>
    <button data-cmd="seekBy" data-seconds="10" aria-label="Forward 10 seconds" data-i="fwd10"></button>
  </div>
  <div class="chips" id="np-chips">
    <button class="chip" id="chip-subs" aria-label="Subtitles" hidden><span data-i="cc"></span><span class="cc" id="chip-subs-t" hidden></span></button>
    <button class="chip" id="chip-aud" aria-label="Audio" hidden><span data-i="headphones"></span><span class="cc" id="chip-aud-t" hidden></span></button>
    <button class="chip" id="chip-spd" aria-label="Speed" hidden><span data-i="gauge"></span><span class="cc" id="chip-spd-t" hidden></span></button>
    <button class="chip" id="chip-pic" aria-label="Picture off" aria-pressed="false"></button>
    <button class="chip" id="chip-qs" data-cmd="quickSettings" aria-label="Quick settings" data-i="sliders"></button>
    <button class="chip pad-chip" id="chip-pad" aria-label="D-pad" hidden><span data-i="dpad"></span></button>
  </div>
  __VPILL_NP__
</section>
<section class="npad" id="npad" hidden>
  <div class="bar">__BAR_PAD__<button id="npad-qs" data-cmd="quickSettings" aria-label="Quick settings" data-i="sliders"></button></div>
  <div class="hint">Menus on the Screen</div>
  <div class="pad">__PAD__</div>
  <button class="back" id="npad-back"><span data-i="monitorPlay"></span>Now Playing</button>
</section>
<div class="sheet" id="np-sheet" hidden>
  <div class="rows" id="np-rows" role="dialog"></div>
</div>
<main id="controls">
  <div class="bar" id="ibar">__BAR_ID__<button id="qs" data-cmd="quickSettings" aria-label="Quick settings" data-i="sliders"></button><button id="upd" data-cmd="openUpdate" aria-label="Update ready" data-i="update" hidden></button><button id="gear" data-cmd="openSettings" aria-label="Settings" data-i="gear" hidden></button></div>
  <button class="cw" id="cw" data-cmd="resume" hidden><span class="pic" id="cw-pic"><span class="cwapp" id="cw-app" hidden></span></span><span class="txt"><b id="cw-title"></b><span class="l" id="cw-left"></span><span class="l hold" id="cw-hint">Hold to remove</span></span><span class="go" data-i="play"></span></button>
  <div class="note-card" id="playback-note" role="status" hidden><b id="playback-title"></b><ol id="playback-steps"></ol></div>
  <button class="search" id="fixbtn" data-cmd="menu" hidden><span id="fix-label">Fix match</span></button>
  <button class="search" id="search" data-cmd="typeOpen" hidden><span data-i="search"></span><span id="search-label">Search</span></button>
  <a class="search" id="link" href="#" target="_blank" rel="noopener" hidden><span id="link-label"></span></a>
  <div class="other" id="other" hidden>Typing on another phone</div>
  <div class="apps" id="apps" role="group" aria-label="Apps" hidden></div>
  <div class="padwrap"><div class="pad" id="dpad">__PAD__</div></div>
  __VPILL_ID__
</main>
<div class="sheet" id="sheet" hidden>
  <form id="form" autocomplete="off">
    <input id="text" type="text" enterkeyhint="search" autocapitalize="none" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="Search">
    <div class="btns"><button type="button" class="k txt" id="cancel">Cancel</button><button type="submit" class="k hero txt">Search</button></div>
  </form>
</div>
<script>
(function () {
  var ICONS = __ICONS__;
  var ws = null, retry = 0, timer = null, open = false, duration = 0, canSeek = true, dragging = false;
  var KEY = "couch-key";
  var fromUrl = new URLSearchParams(location.search).get("key");
  if (fromUrl) {
    try { localStorage.setItem(KEY, fromUrl); } catch (e) {}
    history.replaceState(null, "", location.pathname);
  }
  var key = fromUrl || (function () { try { return localStorage.getItem(KEY); } catch (e) { return null; } })() || "";
  var $ = function (id) { return document.getElementById(id); };
  function icon(name) { return '<svg class="i" viewBox="0 0 256 256" aria-hidden="true">' + ICONS[name] + "</svg>"; }
  function fill(root) {
    var els = root.querySelectorAll("[data-i]");
    for (var i = 0; i < els.length; i++) els[i].insertAdjacentHTML("afterbegin", icon(els[i].getAttribute("data-i")));
  }
  fill(document);
  function thumb(k) { return "url(/thumb/" + k + ".jpg?key=" + encodeURIComponent(key) + ")"; }

  var pstate = "on";
  /** Three states: Connecting (no socket yet), Connected, and Couch off (the Listener said so); only the last dims. */
  function paint() {
    var couchOff = pstate === "off" || pstate === "starting";
    var connecting = !open && !couchOff;
    document.body.classList.toggle("off", couchOff);
    document.body.classList.toggle("connecting", connecting);
    $("conn").hidden = !connecting;
    var unreachable = connecting && retry >= 3;
    $("banner").hidden = !unreachable;
    $("hint").hidden = !unreachable;
    $("status").textContent = couchOff ? "Offline" : open ? "Connected" : "Connecting…";
  }
  function setOnline(on) {
    open = on;
    paint();
  }

  function fmt(t) {
    t = Math.max(0, Math.floor(t));
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
    return (h ? h + ":" + (m < 10 ? "0" : "") + m : m) + ":" + (sec < 10 ? "0" : "") + sec;
  }

  function showProgress(pos) {
    var pct = duration > 0 ? Math.min(100, Math.max(0, (pos / duration) * 100)) : 0;
    $("np-fill").style.width = pct + "%";
    $("np-knob").style.left = pct + "%";
    $("np-elapsed").textContent = fmt(pos);
    $("np-remaining").textContent = "-" + fmt(Math.max(0, duration - pos));
  }

  var last = null, sheetKind = "";
  function esc(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function speedLabel(x) { return x + "×"; }
  var trackCode = __TRACK_CODE__;
  var setupControls = __SETUP_CONTROLS__;
  var CHECK = __CHECK_SVG__;
  function current(tracks) {
    return (tracks || []).filter(function (t) { return t.on; })[0];
  }
  function setChip(id, label, text, lit) {
    var el = $(id);
    el.setAttribute("aria-label", label);
    el.classList.toggle("on", lit);
    $(id + "-t").textContent = text;
    $(id + "-t").hidden = !text;
  }
  function row(cmd, args, label, cur) {
    return '<button data-cmd="' + cmd + '" data-args="' + esc(JSON.stringify(args)) + '" data-close="1"' + (cur ? ' class="cur"' : "") + ">" + esc(label) + "</button>";
  }
  function sheetHtml(kind, s) {
    var np = s.nowPlaying, h = "";
    if (kind === "subs") {
      h = '<div class="h">Subtitles</div>';
      (np.subtitles || []).forEach(function (t) { h += row("setTrack", { kind: "subtitles", track: t.id }, t.label, t.on); });
    } else if (kind === "aud") {
      h = '<div class="h">Audio</div>';
      (np.audio || []).forEach(function (t) { h += row("setTrack", { kind: "audio", track: t.id }, t.label, t.on); });
    } else if (kind === "spd") {
      h = '<div class="h">Speed</div>';
      (np.speeds || []).forEach(function (x) { h += row("setSpeed", { speed: x }, speedLabel(x), x === np.speed); });
    } else if (kind === "upn") {
      h = '<div class="h">Up next</div>';
      (s.upNext || []).forEach(function (u, i) { h += row("playUpNext", { index: i }, u.title, u.playing); });
    }
    return h;
  }
  function openSheet(kind) {
    if (!last || !last.nowPlaying) return;
    sheetKind = kind;
    $("np-rows").innerHTML = sheetHtml(kind, last);
    $("np-sheet").hidden = false;
  }
  function closeSheet() { sheetKind = ""; $("np-sheet").hidden = true; }

  var toastTimer = null;
  function toast(text) {
    var t = $("np-toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 900);
  }

  var phoneToastTimer = null;
  var lastToastId = 0;
  function phoneToast(t) {
    if (!t || t.id === lastToastId) return;
    lastToastId = t.id;
    var el = $("phone-toast");
    el.textContent = t.text;
    el.classList.add("show");
    clearTimeout(phoneToastTimer);
    phoneToastTimer = setTimeout(function () { el.classList.remove("show"); }, 3000);
  }

  var padOpen = false;
  function setMute(on) {
    var els = document.querySelectorAll(".mutebtn");
    for (var i = 0; i < els.length; i++) {
      els[i].classList.toggle("on", on);
      els[i].setAttribute("aria-pressed", String(on));
      els[i].innerHTML = icon(on ? "speakerMute" : "speaker");
    }
  }

  function renderNow(s) {
    var np = s.nowPlaying;
    var web = typeof np.canSeek === "boolean";
    duration = np.duration;
    canSeek = !web || np.canSeek;
    seek.classList.toggle("ro", !canSeek);
    $("np-title").textContent = np.title;
    $("np-line").textContent = np.line || np.folder || "";
    if (!dragging) showProgress(np.position);
    $("np-pp").innerHTML = icon(np.paused ? "play" : "pause");
    $("np-pp").setAttribute("aria-label", np.paused ? "Play" : "Pause");

    var art = $("np-art");
    var pic = np.artKey ? thumb(np.artKey) : np.artwork ? "url(" + JSON.stringify(np.artwork) + ")" : "";
    art.classList.toggle("has", !!pic);
    art.style.backgroundImage = pic;
    art.setAttribute("data-app", np.app ? np.app.id : "");
    $("np-face").innerHTML = np.app ? np.app.icon + "<span>" + esc(np.app.label) + "</span>" : "";

    var prompt = np.prompt ? { cmd: "pressPrompt", args: { id: np.prompt.id }, label: np.prompt.label } : s.next ? { cmd: "playNext", label: "Play next" } : null;
    var pb = $("np-prompt");
    pb.hidden = !prompt;
    if (prompt) {
      pb.textContent = prompt.label;
      pb.setAttribute("data-cmd", prompt.cmd);
      pb.setAttribute("data-args", prompt.args ? JSON.stringify(prompt.args) : "");
    }

    var subs = !!(np.subtitles && np.subtitles.length);
    var aud = !!(np.audio && np.audio.length);
    var spd = !!(np.speeds && np.speeds.length && typeof np.speed === "number");
    var pad = true;
    var off = !!s.pictureOff;
    $("chip-pic").innerHTML = icon(off ? "monitorSlash" : "monitorPlay");
    $("chip-pic").setAttribute("aria-label", "Picture off");
    $("chip-pic").setAttribute("aria-pressed", off ? "true" : "false");
    $("chip-pic").classList.toggle("on", off);
    $("chip-subs").hidden = !subs;
    $("chip-aud").hidden = !aud;
    $("chip-spd").hidden = !spd;
    $("chip-pad").hidden = !pad;
    var sOn = current(np.subtitles), aOn = current(np.audio);
    var subsLit = !!sOn && sOn.id !== "off" && !/^off$/i.test(sOn.label);
    setChip("chip-subs", "Subtitles: " + (subsLit ? sOn.label : "Off"), subsLit ? trackCode(sOn) : "", subsLit);
    setChip("chip-aud", "Audio: " + (aOn ? aOn.label : "Default"), aOn ? trackCode(aOn) : "", false);
    if (spd) setChip("chip-spd", "Speed " + speedLabel(np.speed), np.speed === 1 ? "" : speedLabel(np.speed), np.speed !== 1);
    $("np-more").hidden = !s.upNext || s.upNext.length < 2;
    if (sheetKind && !$("np-sheet").hidden) $("np-rows").innerHTML = sheetHtml(sheetKind, s);
  }

  var appsRow = "";
  function render(s) {
    phoneToast(s.toast);
    last = s;
    var L = s.layout || "other";
    $("where").textContent = s.where;
    $("count").textContent = !s.remotes ? "" : s.remotes === 1 ? " · 1 phone" : " · " + s.remotes + " phones";
    var np = s.nowPlaying;
    if (!np) { padOpen = false; closeSheet(); }
    document.body.classList.toggle("np", !!np);
    document.body.classList.toggle("idle", !np);
    $("gear").hidden = L !== "home";
    $("upd").hidden = L !== "home" || !s.updateReady;
    var noBack = L === "home" && !np && !s.confirm && !s.setup;
    $("id-back").hidden = $("np-back").hidden = $("pad-back").hidden = noBack;
    var padShown = padOpen || !!s.quickSettings;
    $("nowp").hidden = !np || padShown;
    $("npad").hidden = !np || !padShown;
    $("qs").classList.toggle("on", !!s.quickSettings);
    $("npad-qs").classList.toggle("on", !!s.quickSettings);
    $("controls").hidden = !!np;
    setMute(!!s.muted);
    if (np) {
      renderNow(s);
    }
    $("id-vol-n").textContent = $("np-vol-n").textContent = s.muted ? "0" : String(Math.round(s.volume));
    $("id-vol").classList.toggle("muted", !!s.muted);
    $("np-vol").classList.toggle("muted", !!s.muted);
    var apps = !np && s.apps && s.apps.length ? s.apps : [];
    $("apps").hidden = !apps.length;
    $("apps").classList.toggle("few", apps.length <= 4);
    var row = apps.map(function (a) {
      return '<button type="button" class="app" data-cmd="openApp" data-args="' + esc(JSON.stringify({ app: a.id })) + '" aria-label="Open ' + esc(a.label) + '"><span class="ic">' + a.icon + '</span><span class="n">' + esc(a.label) + "</span></button>";
    }).join("");
    if (row !== appsRow) { appsRow = row; $("apps").innerHTML = row; }
    $("cw").hidden = L !== "home" || !s.continueCard;
    if (s.continueCard) {
      $("cw-title").textContent = s.continueCard.title;
      $("cw-left").textContent = s.continueCard.left;
      var cc = s.continueCard;
      $("cw-pic").style.backgroundImage = cc.thumbKey ? thumb(cc.thumbKey) : "none";
      $("cw-app").innerHTML = cc.app ? cc.app.icon : "";
      $("cw-app").hidden = !cc.app;
    }
    var su = s.setup;
    var q = su ? { title: su.title, check: !!su.connected, body: [su.body, su.note].concat(su.list || [], (su.tips || []).map(function (t) { return t.key + " " + t.text; }), [su.hint]).filter(Boolean).join("\n"), controls: setupControls(su), focus: su.focus, key: su.id, foot: su.footnote } : s.confirm && s.confirm.phone ? { title: s.confirm.title, body: s.confirm.body, controls: s.confirm.buttons.map(function (b) { return { label: b }; }), focus: s.confirm.focus } : null;
    $("ask").hidden = !q;
    $("ask-nav").hidden = !su;
    if (q) {
      if (q.check) $("ask-title").innerHTML = '<span class="tick">' + CHECK + "</span> " + esc(q.title);
      else $("ask-title").textContent = q.title;
      $("ask-body").textContent = q.body || "";
      var answer = function (i) { return 'data-cmd="confirmAnswer" data-args="' + esc(JSON.stringify({ index: i, text: q.key || q.title })) + '"'; };
      var tiles = "", btns = "";
      q.controls.forEach(function (c, i) {
        if (c.on !== undefined) tiles += '<button type="button" class="tile' + (c.on ? "" : " off") + (i === q.focus ? " hero" : "") + '" ' + answer(i) + ' aria-pressed="' + c.on + '" aria-label="' + esc(c.label) + '"><span class="ic">' + (c.icon || "") + "</span>" + esc(c.label) + (c.on ? '<span class="tick">' + CHECK + "</span>" : "") + "</button>";
        else btns += '<button type="button" class="k txt' + (i === q.focus ? " hero" : "") + '" ' + answer(i) + ">" + esc(c.label) + "</button>";
      });
      $("ask-tiles").innerHTML = tiles;
      $("ask-tiles").hidden = !tiles;
      $("ask-btns").innerHTML = btns;
      $("ask-foot").textContent = q.foot || "";
      $("ask-foot").hidden = !q.foot;
    }
    $("playback-note").hidden = !s.playbackNote;
    if (s.playbackNote) {
      $("playback-title").textContent = s.playbackNote.title;
      var steps = $("playback-steps");
      steps.textContent = "";
      s.playbackNote.steps.forEach(function (t) { var li = document.createElement("li"); li.textContent = t; steps.appendChild(li); });
    }
    $("fixbtn").hidden = !s.fixAvailable || !!np;
    $("search").hidden = !(s.typeLabel && s.typeAvailable) || !!np || !!s.fixAvailable;
    $("link").hidden = !s.link;
    if (s.link) { $("link").href = s.link.url; $("link-label").textContent = s.link.label; }
    $("search-label").textContent = s.typeLabel || "Search";
    $("search").classList.toggle("dim", !s.typeAvailable);
    $("other").hidden = s.typing !== "other" && s.typing !== "screen";
    $("other").textContent = s.typing === "screen" ? "Typing on the Screen" : "Typing on another phone";
    var mine = s.typing === "you";
    $("text").placeholder = s.typePlaceholder || "";
    if (mine && $("sheet").hidden) { $("text").value = s.typeSeed || ""; $("sheet").hidden = false; $("text").focus(); }
    if (!mine) { $("sheet").hidden = true; $("text").blur(); }
  }

  var failTimer = null;
  function setPower(state, failed) {
    if (state === "on" && pstate === "on") return;
    pstate = state;
    paint();
    clearTimeout(failTimer);
    var off = state === "off", starting = state === "starting";
    $("pw").hidden = !(off || starting);
    $("confirm").hidden = true;
    $("pw-spin").hidden = !starting;
    $("pw-btn").hidden = !off;
    if (starting) { $("pw-title").textContent = "Starting Couch…"; $("pw-sub").textContent = "This takes a few seconds."; }
    else if (off && failed) {
      $("pw-title").textContent = "Couch didn't start"; $("pw-sub").textContent = "Try again in a moment.";
      failTimer = setTimeout(function () { setPower("off"); }, 4000);
    } else if (off) { $("pw-title").textContent = "Couch is off"; $("pw-sub").textContent = "Press Power to turn it on."; }
  }
  $("pbtn").addEventListener("click", function () { $("confirm").hidden = false; });
  $("confirm-off").addEventListener("click", function () { $("confirm").hidden = true; });
  $("confirm-cancel").addEventListener("click", function () { $("confirm").hidden = true; });

  var queue = [], queueTimer = null, QUEUE_MS = 2000, got = false;
  var SAFE = { volUp: 1, volDown: 1, mute: 1, playpause: 1, seekBy: 1 };
  function notice(text) {
    var el = $("phone-toast");
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(phoneToastTimer);
    phoneToastTimer = setTimeout(function () { el.classList.remove("show"); }, 3000);
  }
  /** Drops entries older than 2 s, each on its own clock; re-arms the timer for the oldest left. */
  function expireQueue() {
    clearTimeout(queueTimer);
    var now = Date.now(), before = queue.length;
    queue = queue.filter(function (q) { return now - q.at < QUEUE_MS; });
    if (queue.length < before) notice("Couldn't reach Couch");
    if (queue.length) queueTimer = setTimeout(expireQueue, QUEUE_MS - (now - queue[0].at));
  }
  function dropQueue() {
    clearTimeout(queueTimer);
    if (queue.length) notice("Couldn't reach Couch");
    queue = [];
  }
  /** Sends at once when connected. While disconnected only context-independent commands wait (up to 2 s each) for the first snapshot; everything else is dropped with a toast. */
  function post(msg) {
    if (open && (got || msg.command === "power")) { ws.send(JSON.stringify(msg)); return; }
    if (msg.command === "power" || pstate !== "on") return;
    if (!Object.prototype.hasOwnProperty.call(SAFE, msg.command)) { notice("Couldn't reach Couch"); return; }
    if (queue.length >= 8) queue.shift();
    queue.push({ at: Date.now(), msg: msg });
    clearTimeout(queueTimer);
    queueTimer = setTimeout(expireQueue, QUEUE_MS - (Date.now() - queue[0].at));
  }
  /** Called on the first snapshot of a connection: only then is the screen known, so only then do held taps go. */
  function flushQueue() {
    clearTimeout(queueTimer);
    var now = Date.now(), q = queue;
    queue = [];
    q.forEach(function (e) { if (now - e.at < QUEUE_MS) ws.send(JSON.stringify(e.msg)); });
  }
  function sendArgs(command, args) {
    if (navigator.vibrate) navigator.vibrate(12);
    post({ type: "command", command: command, args: args });
  }

  var seek = $("seek");
  function fracAt(e) {
    var r = seek.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  }
  seek.addEventListener("pointerdown", function (e) {
    if (!open || !(duration > 0) || !canSeek) return;
    dragging = true;
    seek.setPointerCapture(e.pointerId);
    showProgress(fracAt(e) * duration);
  });
  seek.addEventListener("pointermove", function (e) {
    if (dragging) showProgress(fracAt(e) * duration);
  });
  seek.addEventListener("pointerup", function (e) {
    if (!dragging) return;
    dragging = false;
    sendArgs("seekTo", { seconds: Math.round(fracAt(e) * duration) });
  });
  seek.addEventListener("pointercancel", function () { dragging = false; });

  $("chip-subs").addEventListener("click", function () { openSheet("subs"); });
  $("chip-aud").addEventListener("click", function () { openSheet("aud"); });
  $("chip-spd").addEventListener("click", function () { openSheet("spd"); });
  $("np-more").addEventListener("click", function () { openSheet("upn"); });
  $("chip-pic").addEventListener("click", function () { sendArgs("setPictureOff", { on: !(last && last.pictureOff) }); });
  $("chip-pad").addEventListener("click", function () { padOpen = true; if (last) render(last); });
  $("npad-back").addEventListener("click", function () {
    if (last && last.quickSettings) { sendArgs("quickSettings"); return; }
    padOpen = false; if (last) render(last);
  });
  $("np-sheet").addEventListener("click", function (e) { if (e.target === $("np-sheet")) closeSheet(); });

  var art = $("np-art"), g = null;
  art.addEventListener("pointerdown", function (e) {
    if (!open || (e.target.closest && e.target.closest(".prompt"))) return;
    g = { x: e.clientX, y: e.clientY, axis: "", vy: 0, level: last ? Math.round(last.volume) : 0 };
    art.setPointerCapture(e.pointerId);
  });
  art.addEventListener("pointermove", function (e) {
    if (!g) return;
    var dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (!g.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 14) g.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    if (g.axis === "y") {
      var steps = Math.trunc((g.y - e.clientY) / 28) - g.vy;
      for (var i = 0; i < Math.abs(steps); i++) sendArgs(steps > 0 ? "volUp" : "volDown");
      g.vy += steps;
      if (steps) {
        g.level = Math.max(0, Math.min(100, g.level + steps * 5));
        toast("Volume " + g.level);
      }
    }
  });
  art.addEventListener("pointerup", function (e) {
    if (!g) return;
    var dx = e.clientX - g.x, axis = g.axis;
    g = null;
    if (axis === "x" && Math.abs(dx) >= 40) {
      var secs = dx > 0 ? 10 : -10;
      sendArgs("seekBy", { seconds: secs });
      toast(secs > 0 ? "+10 s" : "−10 s");
    } else if (!axis) {
      sendArgs("playpause");
      toast(last && last.nowPlaying && last.nowPlaying.paused ? "Playing" : "Paused");
    }
  });
  art.addEventListener("pointercancel", function () { g = null; });

  var LAST = "couch-last", saveTimer = null, pending = "";
  /** cyrb53: a small synchronous hash. The cache stores this of the pairing key, never the key. */
  function hash(str) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  var keyHash = key ? hash(key) : "";
  function dropCache() {
    clearTimeout(saveTimer);
    saveTimer = null;
    pending = "";
    try { localStorage.removeItem(LAST); } catch (e) {}
  }
  function text(v, n) { return typeof v === "string" ? v.slice(0, n) : ""; }
  /** What the last view keeps so a reopened Remote can draw at once: display fields only (view, App, title, artwork, paused, volume, mute, power), bound to the pairing key by hash. Never Up next, folders, history, progress or Continue cards. */
  function remember(s) {
    if (!keyHash) { dropCache(); return; }
    var np = s.nowPlaying;
    var c = { v: 1, h: keyHash, view: np ? "np" : "idle", paused: !!(np && np.paused), volume: Number(s.volume) || 0, muted: !!s.muted, power: pstate };
    if (np) {
      c.title = text(np.title, 200);
      c.art = text(np.artwork, 500);
      if (np.app) c.app = { id: text(np.app.id, 40), label: text(np.app.label, 40) };
    }
    pending = JSON.stringify(c);
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = null;
      try { localStorage.setItem(LAST, pending); } catch (e) {}
    }, 1000);
  }
  /** A cache for another key, no key, or the old format is cleared and ignored. */
  function cached() {
    var c = null;
    try { c = JSON.parse(localStorage.getItem(LAST)); } catch (e) {}
    if (!c) return null;
    if (c.v !== 1 || !keyHash || c.h !== keyHash || (c.view !== "idle" && c.view !== "np")) { dropCache(); return null; }
    var snap = { type: "snapshot", where: "", layout: "other", typing: "none", volume: Number(c.volume) || 0, muted: !!c.muted, remotes: 0 };
    if (c.view === "np") {
      snap.nowPlaying = {
        title: text(c.title, 200), folder: "", position: 0, duration: 0, paused: !!c.paused,
        artwork: /^https:\/\//.test(c.art || "") ? c.art : "",
        app: c.app ? { id: text(c.app.id, 40), label: text(c.app.label, 40), icon: "" } : null
      };
    }
    return snap;
  }

  var live = false;
  function connect() {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    live = true;
    var sock = ws = new WebSocket(proto + "//" + location.host + "/ws?key=" + encodeURIComponent(key));
    sock.onopen = function () { retry = 0; got = false; setOnline(true); };
    sock.onmessage = function (e) {
      var msg = JSON.parse(e.data);
      if (msg.type === "snapshot") { setPower("on"); render(msg); remember(msg); if (!got) { got = true; flushQueue(); } }
      else if (msg.type === "power") { setPower(msg.state, msg.failed); if (msg.state !== "on") dropQueue(); }
    };
    sock.onclose = function () {
      if (sock !== ws) return;
      live = false; got = false;
      var wait = Math.min(300 * Math.pow(1.6, retry++), 8000);
      setOnline(false);
      $("confirm").hidden = true;
      clearTimeout(timer);
      timer = setTimeout(connect, wait);
    };
  }

  function send(command, text) {
    var m = { type: "command", command: command };
    if (text !== undefined) m.args = { text: text };
    post(m);
  }
  $("text").addEventListener("input", function () { send("typeText", $("text").value); });
  $("form").addEventListener("submit", function (e) { e.preventDefault(); send("typeSubmit"); });
  $("cancel").addEventListener("click", function () { send("typeCancel"); });

  var fullscreenRequested = false, wasFullscreen = false, fullscreenDismissed = false;
  function canRequestFullscreen() {
    try {
      var de = document.documentElement;
      if (!de || !de.requestFullscreen) return false;
      if (/iPhone|iPad|iPod/.test(navigator.userAgent || "")) return false;
      var mm = window.matchMedia;
      if (mm && (mm("(display-mode: standalone)").matches || mm("(display-mode: fullscreen)").matches)) return false;
      return true;
    } catch (e) { return false; }
  }
  function onFullscreenTap() {
    if (fullscreenRequested || fullscreenDismissed || document.fullscreenElement || !canRequestFullscreen()) return;
    fullscreenRequested = true;
    try {
      var r = document.documentElement.requestFullscreen({ navigationUI: "hide" });
      if (r && r.catch) r.catch(function () { fullscreenRequested = false; });
    } catch (e) { fullscreenRequested = false; }
  }
  document.addEventListener("click", onFullscreenTap, true);
  document.addEventListener("fullscreenchange", function () {
    if (document.fullscreenElement) {
      wasFullscreen = true;
      try {
        var l = screen.orientation.lock("portrait");
        if (l && l.catch) l.catch(function () {});
      } catch (e) {}
    } else if (wasFullscreen) {
      wasFullscreen = false;
      fullscreenRequested = false;
      if (document.visibilityState !== "hidden") fullscreenDismissed = true;
    }
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") fullscreenRequested = false;
    else if (!live && ws) { clearTimeout(timer); connect(); }
  });

  // Holding the Continue watching card removes it from Continue watching (the click that follows a hold is swallowed).
  var cwHold = null, cwHeld = false;
  var cwCard = $("cw");
  cwCard.addEventListener("pointerdown", function () {
    cwHeld = false;
    clearTimeout(cwHold);
    cwHold = setTimeout(function () { cwHeld = true; sendArgs("forgetContinue"); }, 700);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach(function (name) {
    cwCard.addEventListener(name, function () { clearTimeout(cwHold); });
  });
  cwCard.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  cwCard.addEventListener("click", function (e) {
    if (!cwHeld) return;
    cwHeld = false;
    e.stopImmediatePropagation();
  });

  document.addEventListener("click", function (e) {
    var el = e.target.closest ? e.target.closest("[data-cmd]") : null;
    if (!el || el.disabled) return;
    if (navigator.vibrate) navigator.vibrate(12);
    var msg = { type: "command", command: el.getAttribute("data-cmd") };
    var secs = el.getAttribute("data-seconds");
    if (secs) msg.args = { seconds: Number(secs) };
    var raw = el.getAttribute("data-args");
    if (raw) msg.args = JSON.parse(raw);
    if (el.getAttribute("data-close")) closeSheet();
    post(msg);
  });

  document.body.classList.toggle("idle", true);
  paint();
  if (typeof window !== "undefined" && window.COUCH_UNPAIRED) {
    $("pw").hidden = false;
    $("pw-btn").hidden = true;
    $("pw-spin").hidden = true;
    $("pbtn").hidden = true;
    $("banner").hidden = true;
    $("status").textContent = "Not paired";
    dropCache();
    $("pw-title").textContent = "Couch isn't paired yet";
    $("pw-sub").textContent = "Open Couch on the Mac once to pair a phone.";
    return;
  }
  var snap = cached();
  if (snap) render(snap);
  connect();
})();
</script>
</body>
</html>
`
  .replaceAll("__BAR_NP__", bar("np"))
  .replaceAll("__BAR_PAD__", bar("pad"))
  .replaceAll("__BAR_ID__", bar("id"))
  .replaceAll("__PAD__", PAD)
  .replace("__VPILL_NP__", vpill("np"))
  .replace("__VPILL_ID__", vpill("id"))
  .replace("__ICONS__", JSON.stringify(ICON_MARKUP))
  .replace("__TRACK_CODE__", () => trackCode.toString())
  .replace("__SETUP_CONTROLS__", () => setupControls.toString())
  .replace("__CHECK_SVG__", () => JSON.stringify(CHECK_SVG))
  .replace("__THEME__", GLASS.color.phoneTheme)
  .replace("__TOKENS__", lookCss(GLASS, { unit: "1px" }));
