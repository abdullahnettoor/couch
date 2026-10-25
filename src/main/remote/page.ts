import { glassTokensCss } from "../../shared/glass-tokens.ts";
import { ICON_MARKUP } from "../../shared/icons.ts";
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
<meta name="theme-color" content="#161412">
<title>Couch Remote</title>
<link rel="icon" type="image/png" sizes="192x192" href="/icon.png">
<link rel="apple-touch-icon" href="/touch-icon.png">
<link rel="manifest" id="manifest" href="/manifest.webmanifest">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Couch">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<style>
  __TOKENS__
  :root { font-family:-apple-system,"SF Pro Text",system-ui,sans-serif; -webkit-font-smoothing:antialiased; color:var(--t1); background:#000; }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html, body { margin:0; height:100%; background:radial-gradient(80% 60% at 50% 0%, var(--card), #000 70%) fixed; overscroll-behavior:none; }
  body { display:flex; flex-direction:column; min-height:100dvh; padding:max(18px, env(safe-area-inset-top)) 24px max(24px, env(safe-area-inset-bottom)); max-width:480px; margin:0 auto; user-select:none; -webkit-user-select:none; font-size:16px; }
  [hidden] { display:none !important; }
  button { font:inherit; color:inherit; border:0; background:none; padding:0; cursor:pointer; }
  button:disabled { opacity:.35; }
  svg.i { width:1em; height:1em; display:block; fill:currentColor; flex:none; }
  .top { display:flex; justify-content:space-between; align-items:center; color:var(--t3); font-size:14px; }
  .top b { display:block; color:var(--t1); font-size:19px; margin-top:2px; }
  .live { display:flex; align-items:center; gap:6px; font-size:13px; }
  .live i { width:8px; height:8px; border-radius:4px; background:var(--live); }
  .off .live i { background:var(--danger); }
  .banner { margin-top:12px; padding:12px 16px; border-radius:var(--r-row); background:var(--glass-strong); backdrop-filter:blur(40px) saturate(1.8); box-shadow:var(--glass-edge); color:var(--t1); font-size:14px; font-weight:600; display:flex; align-items:center; gap:10px; }
  .banner::before { content:""; width:8px; height:8px; border-radius:4px; background:var(--danger); flex:none; }
  .note { margin-top:10px; padding:0 16px; font-size:14px; color:var(--t3); }
  main { flex:1; display:flex; flex-direction:column; transition:opacity .2s; }
  .off main { opacity:.35; pointer-events:none; }
  .pad { margin:26px auto 0; width:min(270px, 70vw); aspect-ratio:1; border-radius:50%; position:relative; background:radial-gradient(circle at 50% 35%, #3a3a3c, var(--card)); box-shadow:inset 0 0 0 1px rgba(255,255,255,.06), 0 18px 40px rgba(0,0,0,.4); flex:none; }
  .dir { position:absolute; width:24%; height:24%; display:grid; place-items:center; color:var(--t3); font-size:26px; border-radius:50%; }
  .dir:active { background:rgba(255,255,255,.12); }
  .dir.u { left:38%; top:2%; } .dir.d { left:38%; bottom:2%; } .dir.l { left:2%; top:38%; } .dir.r { right:2%; top:38%; }
  .ok { position:absolute; left:25%; top:25%; width:50%; height:50%; border-radius:50%; background:var(--card-2); box-shadow:inset 0 1px 0 rgba(255,255,255,.12); font-size:19px; font-weight:600; }
  .ok:active { background:#5a5a5c; }
  .vslider button { width:44px; height:44px; flex:none; display:grid; place-items:center; font-size:22px; color:var(--t2); border-radius:22px; }
  .vslider button:active { background:rgba(255,255,255,.14); }
  .k { height:64px; border-radius:32px; background:var(--card); display:flex; align-items:center; justify-content:center; gap:8px; font-weight:600; box-shadow:inset 0 1px 0 rgba(255,255,255,.07); transition:transform .12s; }
  .k:active { transform:scale(.95); background:var(--card-2); }
  .k.hero { background:#fff; color:#000; }
  .k.txt { font-size:15px; }
  .search { margin-top:18px; height:56px; border-radius:28px; background:var(--card); display:flex; align-items:center; gap:12px; padding:0 20px; color:var(--t3); font-size:17px; width:100%; }
  .search svg { font-size:22px; }
  .search.dim { opacity:.35; }
  .cw { margin-top:18px; display:flex; gap:14px; align-items:center; padding:10px; border-radius:20px; background:var(--card); width:100%; text-align:left; }
  .cw .pic { width:104px; height:58px; border-radius:10px; background:#3a3a3c center/cover; flex:none; }
  .cw.nx { margin:10px 0 0; }
  .cw b { display:block; font-size:16px; }
  .cw span.l { font-size:13px; color:var(--t3); }
  .cw .txt { min-width:0; flex:1; }
  .cw .txt b { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .cw .go { width:44px; height:44px; border-radius:22px; background:#fff; color:#000; display:grid; place-items:center; font-size:22px; flex:none; }
  .other { margin-top:16px; padding:12px 16px; border-radius:14px; background:var(--card); font-size:14px; color:var(--t2); }
  body.idle, body.np { width:100%; height:100dvh; min-height:0; overflow:hidden; padding:max(10px, env(safe-area-inset-top)) 20px max(14px, env(safe-area-inset-bottom)); }
  body.idle .top, body.np .top { font-size:12px; }
  body.idle .top b, body.np .top b { display:inline; font-size:13px; margin:0 0 0 6px; }
  body.idle .pbtn, body.np .pbtn { width:32px; height:32px; font-size:16px; margin-left:8px; }
  body.idle main { min-height:0; gap:8px; padding-top:8px; }
  body.idle .cw, body.idle .search { margin:0; flex:none; }
  body.idle .search { height:52px; }
  .padwrap { flex:1; min-height:0; display:grid; place-items:center; }
  body.idle .pad { margin:0; width:min(320px, 82vw, 100%, 46dvh); }
  body.idle .other { margin:0; }
  body.idle .vpill { margin-top:2px; }
  .nowp, .npad { flex:1; min-height:0; display:flex; flex-direction:column; gap:8px; padding-top:8px; transition:opacity .2s; }
  .off .nowp, .off .npad { opacity:.35; pointer-events:none; }
  .bar { display:grid; grid-auto-flow:column; grid-auto-columns:1fr; gap:10px; flex:none; }
  .bar button { height:44px; border-radius:22px; background:var(--glass); box-shadow:var(--glass-edge); backdrop-filter:blur(30px) saturate(1.6); -webkit-backdrop-filter:blur(30px) saturate(1.6); display:flex; align-items:center; justify-content:center; gap:8px; font-size:22px; color:var(--t1); transition:transform .12s; }
  .bar button:active { transform:scale(.95); background:rgba(255,255,255,.14); }
  .bar button.on { background:#fff; color:#000; }
  .art { position:relative; flex:1; min-height:72px; border-radius:22px; overflow:hidden; background:var(--card) center/cover; touch-action:none; box-shadow:0 18px 40px rgba(0,0,0,.45), inset 0 0 0 1px rgba(255,255,255,.06); cursor:pointer; }
  .art .face { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; color:#fff; font-size:15px; font-weight:600; }
  .art .face svg { width:clamp(36px, 18vmin, 76px); height:clamp(36px, 18vmin, 76px); }
  .art.has .face { display:none; }
  .art[data-app="youtube"] { background-image:linear-gradient(160deg,#ff3b30,#c4141f); }
  .art[data-app="netflix"] { background-image:linear-gradient(160deg,#2a2a2d,#0b0b0c); }
  .art[data-app="library"] { background-image:linear-gradient(160deg,#f5f5f7,#c9c9cf); }
  .art[data-app="library"] .face { color:#1c1c1e; }
  .art.has { background-size:cover; }
  .toast { position:absolute; top:12px; left:50%; transform:translateX(-50%) scale(.9); padding:8px 16px; border-radius:18px; background:rgba(0,0,0,.62); color:#fff; font-size:14px; font-weight:600; opacity:0; pointer-events:none; transition:opacity .15s, transform .15s; white-space:nowrap; }
  .toast.show { opacity:1; transform:translateX(-50%) scale(1); }
  .prompt { position:absolute; left:12px; right:12px; bottom:12px; height:48px; border-radius:24px; background:#fff; color:#000; font-size:16px; font-weight:700; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 8px 24px rgba(0,0,0,.4); }
  .prompt:active { transform:scale(.97); }
  .ttlrow { display:flex; align-items:center; gap:10px; flex:none; margin-top:2px; }
  .ttlrow .t { min-width:0; flex:1; }
  .ttlrow h3 { margin:0; font-size:20px; line-height:1.2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .ttlrow .f { color:var(--t3); font-size:14px; margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .ttlrow .more { width:40px; height:40px; border-radius:20px; display:grid; place-items:center; font-size:20px; color:var(--t2); background:var(--glass); box-shadow:var(--glass-edge); flex:none; }
  .seek { flex:none; padding:10px 0; touch-action:none; cursor:pointer; position:relative; }
  .seek .bar2 { height:8px; border-radius:4px; background:rgba(255,255,255,.2); position:relative; }
  .seek .fill { position:absolute; inset:0 auto 0 0; width:0; background:#fff; border-radius:4px; }
  .seek .knob { position:absolute; top:-7px; left:0; width:22px; height:22px; margin-left:-11px; border-radius:11px; background:#fff; box-shadow:0 2px 6px rgba(0,0,0,.4); }
  .seek.ro { cursor:default; }
  .seek.ro .knob { display:none; }
  .tm { display:flex; justify-content:space-between; font-size:13px; color:var(--t3); font-weight:600; font-variant-numeric:tabular-nums; flex:none; margin-top:-4px; }
  .tr { display:flex; justify-content:space-around; align-items:center; flex:none; font-size:34px; }
  .tr button { width:56px; height:56px; display:grid; place-items:center; border-radius:50%; }
  .tr button:active { background:rgba(255,255,255,.12); }
  .tr .pp { width:76px; height:76px; background:#fff; color:#000; font-size:36px; transition:transform .12s; }
  .tr .pp:active { transform:scale(.94); background:#e5e5e5; }
  .chips { display:flex; gap:8px; flex:none; }
  .chip { flex:1 0 auto; min-width:44px; height:44px; border-radius:22px; background:var(--card); display:flex; align-items:center; justify-content:center; gap:4px; padding:0 8px; font-size:13px; font-weight:600; box-shadow:inset 0 1px 0 rgba(255,255,255,.07); }
  .chip svg { font-size:20px; }
  .chip .cc { font-variant-numeric:tabular-nums; letter-spacing:.02em; }
  .chip.pad-chip { flex:0 0 44px; padding:0; }
  .chip.pad-chip svg { font-size:22px; }
  .chip span { white-space:nowrap; }
  .chip:active { background:var(--card-2); }
  .chip.on { background:#fff; color:#000; }
  .vpill { align-self:center; flex:none; height:44px; width:176px; border-radius:22px; background:var(--glass); box-shadow:var(--glass-edge); display:flex; align-items:center; justify-content:space-between; padding:0 4px; }
  .vpill button { width:40px; height:40px; border-radius:20px; display:grid; place-items:center; font-size:20px; color:var(--t2); }
  .vpill button:active { background:rgba(255,255,255,.14); }
  .vpill b { font-size:16px; font-variant-numeric:tabular-nums; }
  .vpill.muted b { color:var(--t3); }
  .npad { align-items:stretch; }
  .npad .pad { margin:auto; width:min(270px, 70vw, 40vh); }
  .npad .back { height:56px; border-radius:28px; background:#fff; color:#000; font-size:17px; font-weight:700; display:flex; align-items:center; justify-content:center; gap:10px; flex:none; margin-top:auto; }
  .npad .back svg { font-size:24px; }
  .npad .hint { text-align:center; color:var(--t3); font-size:14px; flex:none; }
  .sheet .rows { width:100%; max-width:480px; margin:0 auto; padding:18px 16px max(22px, env(safe-area-inset-bottom)); background:var(--card); border-radius:30px 30px 0 0; display:grid; gap:6px; box-shadow:0 -20px 50px rgba(0,0,0,.5); max-height:70dvh; overflow-y:auto; animation:rise .22s ease-out; }
  .sheet .rows .h { font-size:14px; font-weight:600; color:var(--t3); padding:0 8px 6px; }
  .sheet .rows button { height:52px; border-radius:16px; background:var(--card-2); text-align:left; padding:0 16px; font-size:17px; display:flex; align-items:center; justify-content:space-between; }
  .sheet .rows button.cur { background:#fff; color:#000; font-weight:700; }
  @keyframes rise { from { transform:translateY(40px); opacity:0; } to { transform:none; opacity:1; } }
  @media (prefers-reduced-motion:reduce) { .sheet .rows { animation:none; } .toast { transition:none; } }
  .pbtn { width:40px; height:40px; border-radius:20px; display:grid; place-items:center; font-size:20px; color:var(--t2); background:var(--glass); box-shadow:var(--glass-edge); margin-left:12px; }
  .pbtn:active { background:rgba(255,255,255,.14); }
  .topr { display:flex; align-items:center; }
  .pw { position:fixed; inset:0; z-index:8; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; text-align:center; background:radial-gradient(80% 60% at 50% 0%, var(--card), #000 70%); padding:24px; }
  .pw img { width:84px; height:84px; border-radius:20px; box-shadow:0 12px 30px rgba(0,0,0,.5); }
  .pw h1 { margin:8px 0 0; font-size:26px; font-weight:600; }
  .pw p { margin:0; font-size:15px; color:var(--t3); }
  .pw .big { margin-top:22px; width:120px; height:120px; border-radius:60px; display:grid; place-items:center; font-size:52px; background:var(--glass-strong); backdrop-filter:blur(40px) saturate(1.8); -webkit-backdrop-filter:blur(40px) saturate(1.8); box-shadow:var(--glass-edge); transition:transform .12s; }
  .pw .big:active { transform:scale(.94); }
  .spin { width:34px; height:34px; margin-top:22px; border-radius:50%; border:3px solid rgba(255,255,255,.18); border-top-color:#fff; animation:spin .9s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .sheet { position:fixed; inset:0; background:rgba(0,0,0,.6); display:flex; align-items:flex-end; z-index:5; }
  .sheet form, .sheet .form { width:100%; max-width:480px; margin:0 auto; padding:22px 20px; background:var(--card); border-radius:30px 30px 0 0; display:grid; gap:12px; box-shadow:0 -20px 50px rgba(0,0,0,.5); }
  .sheet input { width:100%; height:56px; border-radius:16px; border:0; background:#1c1c1e; color:#fff; font:inherit; font-size:19px; padding:0 16px; user-select:text; -webkit-user-select:text; caret-color:#0a84ff; }
  .sheet .btns { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .sheet .btns .k { background:var(--card-2); border-radius:16px; height:56px; font-size:17px; }
  .sheet .btns .k.hero { background:#fff; }
</style>
</head>
<body>
<div class="top"><div>On the Screen<b id="where"></b></div><div class="topr"><div class="live"><i></i><span id="status">Connecting…</span><span id="count"></span></div><button class="pbtn" id="pbtn" aria-label="Power" data-i="power"></button></div></div>
<div class="pw" id="pw" hidden>
  <img src="/touch-icon.png" alt="">
  <h1 id="pw-title">Couch is off</h1>
  <p id="pw-sub">Press Power to turn it on.</p>
  <button class="big" id="pw-btn" data-cmd="power" aria-label="Power" data-i="power"></button>
  <div class="spin" id="pw-spin" hidden></div>
</div>
<div class="sheet" id="confirm" hidden>
  <div class="form" role="dialog" aria-label="Turn Couch off?">
    <b style="font-size:19px">Turn Couch off?</b>
    <div class="btns"><button type="button" class="k txt" id="confirm-cancel">Cancel</button><button type="button" class="k hero txt" id="confirm-off" data-cmd="power">Turn off</button></div>
  </div>
</div>
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
  <div class="bar">__BAR_PAD__</div>
  <div class="hint">Menus on the Screen</div>
  <div class="pad">__PAD__</div>
  <button class="back" id="npad-back"><span data-i="monitorPlay"></span>Now Playing</button>
</section>
<div class="sheet" id="np-sheet" hidden>
  <div class="rows" id="np-rows" role="dialog"></div>
</div>
<main id="controls">
  <div class="bar" id="ibar">__BAR_ID__<button id="qs" data-cmd="quickSettings" aria-label="Quick settings" data-i="sliders"></button><button id="gear" data-cmd="openSettings" aria-label="Settings" data-i="gear" hidden></button></div>
  <button class="cw" id="cw" data-cmd="resume" hidden><span class="pic" id="cw-pic"></span><span class="txt"><b id="cw-title"></b><span class="l" id="cw-left"></span></span><span class="go" data-i="play"></span></button>
  <button class="search" id="fixbtn" data-cmd="menu" hidden><span id="fix-label">Fix match</span></button>
  <button class="search" id="search" data-cmd="typeOpen" hidden><span data-i="search"></span><span id="search-label">Search</span></button>
  <div class="other" id="other" hidden>Typing on another phone</div>
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

  function setOnline(on) {
    open = on;
    document.body.classList.toggle("off", !on);
    $("banner").hidden = on;
    $("hint").hidden = on || retry < 3;
    $("status").textContent = on ? "Connected" : "Offline";
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

  function render(s) {
    last = s;
    var L = s.layout || "other";
    $("where").textContent = s.where;
    $("count").textContent = s.remotes === 1 ? " · 1 phone" : " · " + s.remotes + " phones";
    var np = s.nowPlaying;
    if (!np) { padOpen = false; closeSheet(); }
    document.body.classList.toggle("np", !!np);
    document.body.classList.toggle("idle", !np);
    $("gear").hidden = L !== "home";
    var noBack = L === "home" && !np && !s.confirm;
    $("id-back").hidden = $("np-back").hidden = $("pad-back").hidden = noBack;
    var padShown = padOpen || !!s.quickSettings;
    $("nowp").hidden = !np || padShown;
    $("npad").hidden = !np || !padShown;
    $("qs").classList.toggle("on", !!s.quickSettings);
    $("controls").hidden = !!np;
    setMute(!!s.muted);
    if (np) {
      renderNow(s);
    }
    $("id-vol-n").textContent = $("np-vol-n").textContent = s.muted ? "Muted" : String(Math.round(s.volume));
    $("id-vol").classList.toggle("muted", !!s.muted);
    $("np-vol").classList.toggle("muted", !!s.muted);
    $("cw").hidden = L !== "home" || !s.continueCard;
    if (s.continueCard) {
      $("cw-title").textContent = s.continueCard.title;
      $("cw-left").textContent = s.continueCard.left;
      $("cw-pic").style.backgroundImage = s.continueCard.thumbKey ? thumb(s.continueCard.thumbKey) : "none";
    }
    $("fixbtn").hidden = !s.fixAvailable || !!np;
    $("search").hidden = !(s.typeLabel && s.typeAvailable) || !!np || !!s.fixAvailable;
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
  var pstate = "on";
  function setPower(state, failed) {
    if (state === "on" && pstate === "on") return;
    pstate = state;
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

  function sendArgs(command, args) {
    if (!open) return;
    if (navigator.vibrate) navigator.vibrate(12);
    ws.send(JSON.stringify({ type: "command", command: command, args: args }));
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
  $("npad-back").addEventListener("click", function () { padOpen = false; if (last) render(last); });
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

  function connect() {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(proto + "//" + location.host + "/ws?key=" + encodeURIComponent(key));
    ws.onopen = function () { retry = 0; setOnline(true); };
    ws.onmessage = function (e) {
      var msg = JSON.parse(e.data);
      if (msg.type === "snapshot") { setPower("on"); render(msg); }
      else if (msg.type === "power") setPower(msg.state, msg.failed);
    };
    ws.onclose = function () {
      setOnline(false);
      $("confirm").hidden = true;
      var wait = Math.min(1000 * Math.pow(1.6, retry++), 8000);
      clearTimeout(timer);
      timer = setTimeout(connect, wait);
    };
  }

  function send(command, text) {
    if (!open) return;
    var m = { type: "command", command: command };
    if (text !== undefined) m.args = { text: text };
    ws.send(JSON.stringify(m));
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
  });

  document.addEventListener("click", function (e) {
    var el = e.target.closest ? e.target.closest("[data-cmd]") : null;
    if (!el || el.disabled || !open) return;
    if (navigator.vibrate) navigator.vibrate(12);
    var msg = { type: "command", command: el.getAttribute("data-cmd") };
    var secs = el.getAttribute("data-seconds");
    if (secs) msg.args = { seconds: Number(secs) };
    var raw = el.getAttribute("data-args");
    if (raw) msg.args = JSON.parse(raw);
    if (el.getAttribute("data-close")) closeSheet();
    ws.send(JSON.stringify(msg));
  });

  setOnline(false);
  if (typeof window !== "undefined" && window.COUCH_UNPAIRED) {
    $("pw").hidden = false;
    $("pw-btn").hidden = true;
    $("pw-spin").hidden = true;
    $("pbtn").hidden = true;
    $("banner").hidden = true;
    $("status").textContent = "Not paired";
    $("pw-title").textContent = "Couch isn't paired yet";
    $("pw-sub").textContent = "Open Couch on the Mac once to pair a phone.";
    return;
  }
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
  .replace("__TOKENS__", glassTokensCss({ unit: "1px" }));
