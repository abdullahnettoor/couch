import { glassTokensCss } from "../../shared/glass-tokens.ts";
import { ICON_MARKUP } from "../../shared/icons.ts";

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
  .keys { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-top:22px; }
  .k { height:64px; border-radius:32px; background:var(--card); display:flex; align-items:center; justify-content:center; gap:8px; font-size:15px; font-weight:600; box-shadow:inset 0 1px 0 rgba(255,255,255,.07); font-size:26px; transition:transform .12s; }
  .k:active { transform:scale(.95); background:var(--card-2); }
  .k.hero { background:#fff; color:#000; }
  .k.txt { font-size:15px; }
  .k.on { background:#fff; color:#000; }
  .skip { grid-template-columns:1fr 1fr; }
  .vslider { margin-top:22px; height:56px; border-radius:28px; background:var(--glass); box-shadow:var(--glass-edge); backdrop-filter:blur(30px) saturate(1.6); -webkit-backdrop-filter:blur(30px) saturate(1.6); display:flex; align-items:center; padding:0 6px; }
  .vslider button { width:44px; height:44px; flex:none; display:grid; place-items:center; font-size:22px; color:var(--t2); border-radius:22px; }
  .vslider button:active { background:rgba(255,255,255,.14); }
  .vtrack { flex:1; align-self:stretch; display:flex; align-items:center; touch-action:none; cursor:pointer; }
  .vbar { flex:1; height:10px; border-radius:5px; background:rgba(255,255,255,.2); overflow:hidden; }
  .vfill { height:100%; width:0; background:#fff; border-radius:5px; }
  .bottom { margin-top:auto; padding-top:22px; }
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
  .art { margin-top:18px; height:180px; border-radius:20px; overflow:hidden; background:linear-gradient(135deg,#3a3a3c,#1c1c1e) center/cover; }
  .np h3 { margin:14px 0 0; font-size:21px; }
  .np .f { color:var(--t3); font-size:14px; margin-top:2px; }
  .seek { margin-top:6px; padding:14px 0; touch-action:none; cursor:pointer; position:relative; }
  .seek .bar { height:8px; border-radius:4px; background:rgba(255,255,255,.2); position:relative; }
  .seek .fill { position:absolute; inset:0 auto 0 0; width:0; background:#fff; border-radius:4px; }
  .seek .knob { position:absolute; top:-7px; left:0; width:22px; height:22px; margin-left:-11px; border-radius:11px; background:#fff; box-shadow:0 2px 6px rgba(0,0,0,.4); }
  .tm { display:flex; justify-content:space-between; font-size:13px; color:var(--t3); font-weight:600; font-variant-numeric:tabular-nums; }
  .tr { display:flex; justify-content:space-around; align-items:center; margin-top:8px; font-size:38px; }
  .tr button { width:64px; height:64px; display:grid; place-items:center; border-radius:50%; }
  .tr button:active { background:rgba(255,255,255,.12); }
  .tr .pp { font-size:56px; }
  .seek.ro { cursor:default; }
  .seek.ro .knob { display:none; }
  .pick { display:flex; flex-direction:column; gap:4px; font-size:13px; color:var(--t3); text-align:left; }
  .pick select { height:48px; border-radius:14px; font-size:16px; color:#fff; background:rgba(255,255,255,.12); border:0; padding:0 12px; }
  .ex { display:grid; grid-template-columns:1fr; gap:10px; margin-top:10px; }
  .ex .k { height:52px; border-radius:16px; font-size:22px; }
  .ex .k.txt { font-size:15px; }
  .upn { margin-top:16px; }
  .upn .h { font-size:14px; font-weight:600; color:var(--t3); margin-bottom:8px; }
  .upn .list { display:flex; gap:10px; overflow-x:auto; scrollbar-width:none; }
  .upn .e { width:120px; flex:none; text-align:left; }
  .upn .e .pic { width:120px; height:68px; border-radius:10px; background:#3a3a3c center/cover; position:relative; }
  .upn .e .prog { position:absolute; left:6px; right:6px; bottom:6px; height:3px; border-radius:2px; background:rgba(255,255,255,.3); }
  .upn .e .prog i { display:block; height:100%; border-radius:2px; background:#fff; }
  .upn .e.now .pic { box-shadow:0 0 0 2px #fff; }
  .upn .e span { display:block; font-size:12px; margin-top:4px; color:var(--t2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .upn .e.seen { opacity:.55; }
  .other { margin-top:16px; padding:12px 16px; border-radius:14px; background:var(--card); font-size:14px; color:var(--t2); }
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
<main id="controls">
  <button class="cw" id="cw" data-cmd="resume" hidden><span class="pic" id="cw-pic"></span><span class="txt"><b id="cw-title"></b><span class="l" id="cw-left"></span></span><span class="go" data-i="play"></span></button>
  <button class="search" id="fixbtn" data-cmd="menu" hidden><span id="fix-label">Fix match</span></button>
  <button class="search" id="search" data-cmd="typeOpen" hidden><span data-i="search"></span><span id="search-label">Search</span></button>
  <div class="np" id="np" hidden>
    <div class="art" id="np-art"></div>
    <h3 id="np-title"></h3><div class="f" id="np-folder"></div><div class="f" id="np-genres" hidden></div>
    <button class="cw nx" id="nx" data-cmd="playNext" hidden><span class="pic" id="nx-pic"></span><span class="txt"><b id="nx-title"></b><span class="l" id="nx-line">Play next</span></span><span class="go" data-i="play"></span></button>
    <div class="seek" id="seek"><div class="bar"><div class="fill" id="np-fill"></div><div class="knob" id="np-knob"></div></div></div>
    <div class="tm"><span id="np-elapsed"></span><span id="np-remaining"></span></div>
    <div class="tr">
      <button data-cmd="seekBy" data-seconds="-10" aria-label="Back 10 seconds" data-i="back10"></button>
      <button class="pp" data-cmd="playpause" aria-label="Play or pause" id="np-pp"></button>
      <button data-cmd="seekBy" data-seconds="10" aria-label="Forward 10 seconds" data-i="fwd10"></button>
    </div>
    <div class="ex">
      <button class="k txt" data-cmd="subtitles" id="np-subs"><span data-i="cc" style="font-size:26px"></span>Subtitles</button>
      <label class="pick" id="np-sub-box" hidden>Subtitles<select id="np-sub-pick" aria-label="Subtitles"></select></label>
      <label class="pick" id="np-aud-box" hidden>Audio<select id="np-aud-pick" aria-label="Audio"></select></label>
    </div>
    <div class="upn" id="upn" hidden><div class="h">Up next</div><div class="list" id="upn-list"></div></div>
  </div>
  <div class="pad" id="dpad">
    <button class="dir u" data-cmd="up" aria-label="Up" data-i="up"></button>
    <button class="dir d" data-cmd="down" aria-label="Down" data-i="down"></button>
    <button class="dir l" data-cmd="left" aria-label="Left" data-i="left"></button>
    <button class="dir r" data-cmd="right" aria-label="Right" data-i="right"></button>
    <button class="ok" data-cmd="ok">OK</button>
  </div>
  <div class="vslider" id="vol">
    <button data-cmd="volDown" aria-label="Volume down" data-i="minus"></button>
    <div class="vtrack" id="vtrack" role="slider" aria-label="Volume" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="vbar"><div class="vfill" id="vfill"></div></div></div>
    <button data-cmd="volUp" aria-label="Volume up" data-i="plus"></button>
  </div>
  <div class="keys skip" id="skip" hidden>
    <button class="k" data-cmd="seekBy" data-seconds="-10" aria-label="Back 10 seconds" data-i="back10"></button>
    <button class="k" data-cmd="seekBy" data-seconds="10" aria-label="Forward 10 seconds" data-i="fwd10"></button>
  </div>
  <div class="other" id="other" hidden>Typing on another phone</div>
  <div class="keys bottom">
    <button class="k" data-cmd="back" aria-label="Back" data-i="backArrow"></button>
    <button class="k" data-cmd="home" aria-label="Home" data-i="home"></button>
    <button class="k" data-cmd="playpause" aria-label="Play or pause" data-i="playpause"></button>
  </div>
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
  var ws = null, retry = 0, timer = null, open = false, duration = 0, canSeek = true, dragging = false, volDragging = false, volSent = 0;
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

  function showVolume(v) {
    $("vfill").style.width = v + "%";
    $("vtrack").setAttribute("aria-valuenow", String(Math.round(v)));
  }

  function renderUpNext(items) {
    var box = $("upn-list");
    $("upn").hidden = !items || items.length < 2;
    box.textContent = "";
    if (!items) return;
    items.forEach(function (it, i) {
      var b = document.createElement("button");
      b.className = "e" + (it.playing ? " now" : "") + (it.watched && !it.playing ? " seen" : "");
      var pic = document.createElement("div");
      pic.className = "pic";
      if (it.thumbKey) pic.style.backgroundImage = thumb(it.thumbKey);
      if (typeof it.progress === "number") {
        var prog = document.createElement("div");
        prog.className = "prog";
        var bar = document.createElement("i");
        bar.style.width = Math.round(it.progress * 100) + "%";
        prog.appendChild(bar);
        pic.appendChild(prog);
      }
      var t = document.createElement("span");
      t.textContent = it.title;
      b.appendChild(pic); b.appendChild(t);
      b.addEventListener("click", function () { sendArgs("playUpNext", { index: i }); });
      box.appendChild(b);
    });
  }

  function fillPicker(id, tracks, kind) {
    var box = $("np-" + id + "-box"), pick = $("np-" + id + "-pick");
    box.hidden = !tracks || !tracks.length;
    if (box.hidden || document.activeElement === pick) return;
    pick.textContent = "";
    tracks.forEach(function (t) {
      var o = document.createElement("option");
      o.value = t.id; o.textContent = t.label; o.selected = t.on;
      pick.appendChild(o);
    });
    pick.onchange = function () { sendArgs("setTrack", { kind: kind, track: pick.value }); };
  }

  function render(s) {
    var L = s.layout || "other";
    $("where").textContent = s.where;
    $("count").textContent = s.remotes === 1 ? " · 1 phone" : " · " + s.remotes + " phones";
    var np = s.nowPlaying;
    $("np").hidden = !np;
    var web = !!np && typeof np.canSeek === "boolean";
    $("dpad").hidden = !!np && !web;
    $("cw").hidden = L !== "home" || !s.continueCard;
    if (s.continueCard) {
      $("cw-title").textContent = s.continueCard.title;
      $("cw-left").textContent = s.continueCard.left;
      $("cw-pic").style.backgroundImage = s.continueCard.thumbKey ? thumb(s.continueCard.thumbKey) : "none";
    }
    $("fixbtn").hidden = !s.fixAvailable || !!np;
    $("search").hidden = !(s.typeLabel && s.typeAvailable) || !!np;
    $("search-label").textContent = s.typeLabel || "Search";
    $("search").classList.toggle("dim", !s.typeAvailable);
    if (typeof s.volume === "number" && !volDragging) showVolume(s.volume);
    $("skip").hidden = !s.showSkip || !!np;
    if (np) {
      duration = np.duration;
      canSeek = !web || np.canSeek;
      seek.classList.toggle("ro", !canSeek);
      $("np-subs").hidden = web;
      fillPicker("sub", np.subtitles, "subtitles");
      fillPicker("aud", np.audio, "audio");
      $("np-title").textContent = np.title;
      $("np-folder").textContent = np.line || np.folder;
      $("np-genres").textContent = np.genres || "";
      $("np-genres").hidden = !np.genres;
      if (!dragging) showProgress(np.position);
      $("np-pp").innerHTML = icon(np.paused ? "play" : "pause");
      $("np-subs").classList.toggle("on", np.subtitlesOn);
      var playing = (s.upNext || []).filter(function (u) { return u.playing && u.thumbKey; })[0];
      $("np-art").style.backgroundImage = playing ? thumb(playing.thumbKey) : np.artwork ? "url(" + JSON.stringify(np.artwork) + ")" : "none";
      renderUpNext(s.upNext);
    }
    $("nx").hidden = !s.next;
    if (s.next) {
      $("nx-title").textContent = s.next.title;
      $("nx-line").textContent = s.next.line || "Play next";
      $("nx-pic").style.backgroundImage = s.next.thumbKey ? thumb(s.next.thumbKey) : "none";
    }
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

  var vtrack = $("vtrack");
  function volAt(e) {
    var r = vtrack.getBoundingClientRect();
    return Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * 100);
  }
  function volMove(e, final) {
    var v = volAt(e);
    showVolume(v);
    var now = Date.now();
    if (final || now - volSent >= 80) { volSent = now; if (open) ws.send(JSON.stringify({ type: "command", command: "volSet", args: { percent: v } })); }
  }
  vtrack.addEventListener("pointerdown", function (e) {
    if (!open) return;
    volDragging = true;
    vtrack.setPointerCapture(e.pointerId);
    volMove(e, false);
  });
  vtrack.addEventListener("pointermove", function (e) { if (volDragging) volMove(e, false); });
  vtrack.addEventListener("pointerup", function (e) {
    if (!volDragging) return;
    volDragging = false;
    volMove(e, true);
  });
  vtrack.addEventListener("pointercancel", function () { volDragging = false; });

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

  document.addEventListener("click", function (e) {
    var el = e.target.closest ? e.target.closest("[data-cmd]") : null;
    if (!el || el.disabled || !open) return;
    if (navigator.vibrate) navigator.vibrate(12);
    var msg = { type: "command", command: el.getAttribute("data-cmd") };
    var secs = el.getAttribute("data-seconds");
    if (secs) msg.args = { seconds: Number(secs) };
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
  .replace("__ICONS__", JSON.stringify(ICON_MARKUP))
  .replace("__TOKENS__", glassTokensCss({ unit: "1px" }));
