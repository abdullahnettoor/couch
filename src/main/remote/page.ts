import { glassTokensCss } from "../../shared/glass-tokens.ts";
import { ICON_PATHS } from "../../shared/icons.ts";

/** The Remote page, served as one self-contained document (no build step for it). Plain ES5-ish JS, no template literals. */
export const REMOTE_PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#161412">
<title>Couch Remote</title>
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
  .banner { margin-top:12px; padding:10px 14px; border-radius:14px; background:#3a2a10; color:#f2d9a8; font-size:14px; }
  .note { margin-top:10px; font-size:14px; color:var(--t3); }
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
  .vol .k:nth-child(2) { gap:2px; color:var(--t3); }
  .vol .k:nth-child(2) svg { margin:0 4px; }
  .volpill { justify-content:space-around; padding:0 4px; font-size:20px; }
  .volpill button { width:38px; height:48px; display:grid; place-items:center; }
  .volpill span { color:var(--t3); font-size:22px; display:grid; }
  .bottom { margin-top:auto; padding-top:22px; }
  .search { margin-top:18px; height:56px; border-radius:28px; background:var(--card); display:flex; align-items:center; gap:12px; padding:0 20px; color:var(--t3); font-size:17px; width:100%; }
  .search svg { font-size:22px; }
  .search.dim { opacity:.35; }
  .cw { margin-top:18px; display:flex; gap:14px; align-items:center; padding:10px; border-radius:20px; background:var(--card); width:100%; text-align:left; }
  .cw .pic { width:104px; height:58px; border-radius:10px; background:#3a3a3c center/cover; flex:none; }
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
  .ex { display:grid; grid-template-columns:1.3fr 1fr 1fr; gap:10px; margin-top:10px; }
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
  .sheet { position:fixed; inset:0; background:rgba(0,0,0,.6); display:flex; align-items:flex-end; z-index:5; }
  .sheet form { width:100%; max-width:480px; margin:0 auto; padding:22px 20px; background:var(--card); border-radius:30px 30px 0 0; display:grid; gap:12px; box-shadow:0 -20px 50px rgba(0,0,0,.5); }
  .sheet input { width:100%; height:56px; border-radius:16px; border:0; background:#1c1c1e; color:#fff; font:inherit; font-size:19px; padding:0 16px; user-select:text; -webkit-user-select:text; caret-color:#0a84ff; }
  .sheet .btns { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .sheet .btns .k { background:var(--card-2); border-radius:16px; height:56px; font-size:17px; }
  .sheet .btns .k.hero { background:#fff; }
</style>
</head>
<body>
<div class="top"><div>On the Screen<b id="where"></b></div><div class="live"><i></i><span id="status">Connecting…</span><span id="count"></span></div></div>
<div class="banner" id="banner" hidden>Can't reach Couch. Is the Mac awake and Couch open?</div>
<div class="note" id="hint" hidden>Still nothing? Scan the QR code on the Screen again to pair this phone.</div>
<main id="controls">
  <button class="cw" id="cw" data-cmd="resume" hidden><span class="pic" id="cw-pic"></span><span class="txt"><b id="cw-title"></b><span class="l" id="cw-left"></span></span><span class="go" data-i="play"></span></button>
  <button class="search" id="search" data-cmd="typeOpen" hidden><span data-i="search"></span>Search YouTube</button>
  <div class="np" id="np" hidden>
    <div class="art" id="np-art"></div>
    <h3 id="np-title"></h3><div class="f" id="np-folder"></div>
    <div class="seek" id="seek"><div class="bar"><div class="fill" id="np-fill"></div><div class="knob" id="np-knob"></div></div></div>
    <div class="tm"><span id="np-elapsed"></span><span id="np-remaining"></span></div>
    <div class="tr">
      <button data-cmd="seekBy" data-seconds="-10" aria-label="Back 10 seconds" data-i="back10"></button>
      <button class="pp" data-cmd="playpause" aria-label="Play or pause" id="np-pp"></button>
      <button data-cmd="seekBy" data-seconds="10" aria-label="Forward 10 seconds" data-i="fwd10"></button>
    </div>
    <div class="ex">
      <button class="k txt" data-cmd="subtitles" id="np-subs"><span data-i="cc" style="font-size:26px"></span>Subtitles</button>
      <button class="k" data-cmd="volDown" aria-label="Volume down" data-i="minus"></button>
      <button class="k" data-cmd="volUp" aria-label="Volume up" data-i="plus"></button>
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
  <div class="keys vol" id="vol" hidden>
    <button class="k" data-cmd="volDown" aria-label="Volume down" data-i="minus"></button>
    <div class="k" style="pointer-events:none;background:none;box-shadow:none" data-i="speaker"></div>
    <button class="k" data-cmd="volUp" aria-label="Volume up" data-i="plus"></button>
  </div>
  <div class="keys" id="skip" hidden>
    <button class="k" data-cmd="seekBy" data-seconds="-10" aria-label="Back 10 seconds" data-i="back10"></button>
    <div class="k volpill"><button data-cmd="volDown" aria-label="Volume down" data-i="minus"></button><span data-i="speaker"></span><button data-cmd="volUp" aria-label="Volume up" data-i="plus"></button></div>
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
    <input id="text" type="text" enterkeyhint="search" autocapitalize="none" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="Search YouTube">
    <div class="btns"><button type="button" class="k txt" id="cancel">Cancel</button><button type="submit" class="k hero txt">Search</button></div>
  </form>
</div>
<script>
(function () {
  var ICONS = __ICONS__;
  var ws = null, retry = 0, timer = null, open = false, duration = 0, dragging = false;
  var KEY = "couch-key";
  var fromUrl = new URLSearchParams(location.search).get("key");
  if (fromUrl) {
    try { localStorage.setItem(KEY, fromUrl); } catch (e) {}
    history.replaceState(null, "", location.pathname);
  }
  var key = fromUrl || (function () { try { return localStorage.getItem(KEY); } catch (e) { return null; } })() || "";
  var $ = function (id) { return document.getElementById(id); };
  function icon(name) { return '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + "</svg>"; }
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

  function render(s) {
    var L = s.layout || "other";
    $("where").textContent = s.where;
    $("count").textContent = s.remotes === 1 ? " · 1 phone" : " · " + s.remotes + " phones";
    var np = s.nowPlaying;
    $("np").hidden = !np;
    $("dpad").hidden = !!np;
    $("cw").hidden = L !== "home" || !s.continueCard;
    if (s.continueCard) {
      $("cw-title").textContent = s.continueCard.title;
      $("cw-left").textContent = s.continueCard.left;
      $("cw-pic").style.backgroundImage = s.continueCard.thumbKey ? thumb(s.continueCard.thumbKey) : "none";
    }
    $("search").hidden = L !== "youtube" || !!np;
    $("search").classList.toggle("dim", !s.typeAvailable);
    $("vol").hidden = !(L === "home" || L === "other") || !!np;
    $("skip").hidden = !s.showSkip || !!np;
    if (np) {
      duration = np.duration;
      $("np-title").textContent = np.title;
      $("np-folder").textContent = np.folder;
      if (!dragging) showProgress(np.position);
      $("np-pp").innerHTML = icon(np.paused ? "play" : "pause");
      $("np-subs").classList.toggle("on", np.subtitlesOn);
      var playing = (s.upNext || []).filter(function (u) { return u.playing && u.thumbKey; })[0];
      $("np-art").style.backgroundImage = playing ? thumb(playing.thumbKey) : "none";
      renderUpNext(s.upNext);
    }
    $("other").hidden = s.typing !== "other";
    var mine = s.typing === "you";
    if (mine && $("sheet").hidden) { $("text").value = ""; $("sheet").hidden = false; $("text").focus(); }
    if (!mine) { $("sheet").hidden = true; $("text").blur(); }
  }

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
    if (!open || !(duration > 0)) return;
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

  function connect() {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(proto + "//" + location.host + "/ws?key=" + encodeURIComponent(key));
    ws.onopen = function () { retry = 0; setOnline(true); };
    ws.onmessage = function (e) {
      var msg = JSON.parse(e.data);
      if (msg.type === "snapshot") render(msg);
    };
    ws.onclose = function () {
      setOnline(false);
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
  connect();
})();
</script>
</body>
</html>
`
  .replace("__ICONS__", JSON.stringify(ICON_PATHS))
  .replace("__TOKENS__", glassTokensCss({ unit: "1px" }));
