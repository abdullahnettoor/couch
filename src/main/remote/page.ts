/** The Remote page, served as one self-contained document (no build step for it). Plain ES5-ish JS, no template literals. */
export const REMOTE_PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#161412">
<title>Couch Remote</title>
<style>
  :root { --ink:#f3ede4; --ink-2:#c9bfb1; --ink-3:#8f8577; --surface:#1b1916; --surface-2:#26231f; --surface-3:#34302a; --lamp:#f2b45a; font-family: system-ui, sans-serif; color: var(--ink); background:#161412; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { margin:0; height:100%; background:#161412; overscroll-behavior:none; }
  body { display:flex; flex-direction:column; padding:18px 18px 24px; max-width:480px; margin:0 auto; user-select:none; -webkit-user-select:none; }
  .top { display:flex; justify-content:space-between; font-size:13px; color:var(--ink-3); padding:4px 6px 0; }
  .top .who { display:flex; align-items:center; gap:8px; color:var(--ink-2); font-weight:500; }
  .dot { width:8px; height:8px; border-radius:50%; background:#7bc47f; }
  .off .dot { background:#8a4a44; }
  .where { margin:14px 6px 0; font-size:14px; color:var(--ink-3); }
  .where b { color:var(--ink); font-weight:600; }
  .banner { margin:12px 6px 0; padding:10px 14px; border-radius:12px; background:#3a2a10; color:#f2d9a8; font-size:14px; }
  main { flex:1; display:flex; flex-direction:column; justify-content:center; }
  [hidden] { display:none !important; }
  button { font:inherit; color:inherit; border:0; cursor:pointer; }
  button:disabled { opacity:.35; }
  .controls { transition: opacity .2s; }
  .off .controls { opacity:.35; pointer-events:none; }
  .dpad { position:relative; width:min(268px, 72vw); aspect-ratio:1; margin:0 auto 28px; border-radius:50%; background:var(--surface); box-shadow: inset 0 0 0 1px #2c2925; }
  .arrow { position:absolute; width:31%; height:31%; background:transparent; border-radius:50%; color:var(--ink-2); display:grid; place-items:center; }
  .arrow:active { background:var(--surface-3); }
  .arrow svg, .rbtn svg { width:24px; height:24px; }
  .up { left:34.5%; top:1.5%; } .down { left:34.5%; bottom:1.5%; } .left { left:1.5%; top:34.5%; } .right { right:1.5%; top:34.5%; }
  .ok { position:absolute; left:27.6%; top:27.6%; width:44.8%; height:44.8%; border-radius:50%; background:var(--surface-3); font-weight:600; font-size:17px; letter-spacing:.02em; box-shadow:0 6px 16px rgba(0,0,0,.4); }
  .ok:active { background:#403a33; }
  .row { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
  .rbtn { height:60px; background:var(--surface-2); border-radius:18px; display:grid; place-items:center; transition: transform .12s; }
  .rbtn:active { transform:scale(.94); background:var(--surface-3); }
  .rbtn.primary { background:var(--ink); color:#16130f; }
  .np { margin:0 auto 24px; width:100%; }
  .np .t { font-size:20px; font-weight:600; text-align:center; }
  .np .f { font-size:14px; color:var(--ink-3); text-align:center; margin-top:4px; }
  .seek { margin:22px 0 6px; padding:12px 0; cursor:pointer; touch-action:none; }
  .seek .track { height:8px; border-radius:4px; background:var(--surface-3); overflow:hidden; }
  .seek .fill { height:100%; width:0; background:var(--lamp); }
  .times { display:flex; justify-content:space-between; font-size:13px; color:var(--ink-3); margin-bottom:18px; }
  .np .row { margin-bottom:12px; }
  .np .rbtn { font-size:15px; font-weight:600; }
  .np .rbtn.on { color:var(--lamp); }
  .type.dim { opacity:.35; }
  .sheet { position:fixed; inset:0; background:rgba(0,0,0,.6); display:flex; align-items:flex-end; z-index:5; }
  .sheet form { width:100%; max-width:480px; margin:0 auto; padding:18px; background:var(--surface); border-radius:22px 22px 0 0; display:grid; gap:12px; }
  .sheet input { width:100%; height:52px; border-radius:14px; border:1px solid var(--surface-3); background:var(--surface-2); color:var(--ink); font:inherit; font-size:18px; padding:0 14px; user-select:text; -webkit-user-select:text; }
  .sheet .btns { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .sheet .btns button { height:50px; border-radius:16px; background:var(--surface-2); }
  .sheet .btns .go { background:var(--lamp); color:#16130f; font-weight:600; }
  .type { margin-top:12px; width:100%; height:54px; border-radius:18px; background:var(--surface-2); color:var(--ink-2); font-size:15px; font-weight:500; }
</style>
</head>
<body>
<div class="top"><span class="who"><span class="dot"></span><span id="status">Connecting…</span></span><span id="count"></span></div>
<div class="where" id="where"></div>
<div class="banner" id="banner" hidden>Can't reach Couch. Is the Mac awake and Couch open?</div>
<div class="where" id="hint" hidden>Still nothing? Scan the QR code on the Screen again to pair this phone.</div>
<main class="controls" id="controls">
  <div class="np" id="np" hidden>
    <div class="t" id="np-title"></div>
    <div class="f" id="np-folder"></div>
    <div class="seek" id="seek"><div class="track"><div class="fill" id="np-fill"></div></div></div>
    <div class="times"><span id="np-elapsed"></span><span id="np-remaining"></span></div>
    <div class="row">
      <button class="rbtn" data-cmd="seekBy" data-seconds="-10" aria-label="Back 10 seconds">−10 s</button>
      <button class="rbtn primary" data-cmd="playpause" aria-label="Play or pause" id="np-pp">Pause</button>
      <button class="rbtn" data-cmd="seekBy" data-seconds="10" aria-label="Forward 10 seconds">+10 s</button>
    </div>
    <div class="row">
      <button class="rbtn" data-cmd="volDown" aria-label="Volume down">Vol −</button>
      <button class="rbtn" data-cmd="subtitles" id="np-subs">Subtitles</button>
      <button class="rbtn" data-cmd="volUp" aria-label="Volume up">Vol +</button>
    </div>
    <div class="times"><span></span><span id="np-vol"></span></div>
  </div>
  <div class="dpad" id="dpad">
    <button class="arrow up" data-cmd="up" aria-label="Up"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg></button>
    <button class="arrow down" data-cmd="down" aria-label="Down"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>
    <button class="arrow left" data-cmd="left" aria-label="Left"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg></button>
    <button class="arrow right" data-cmd="right" aria-label="Right"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button>
    <button class="ok" data-cmd="ok">OK</button>
  </div>
  <div class="row">
    <button class="rbtn" data-cmd="back" aria-label="Back"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/></svg></button>
    <button class="rbtn" data-cmd="home" aria-label="Home"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/></svg></button>
    <button class="rbtn primary" data-cmd="playpause" aria-label="Play or pause"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5v14l9-7z" fill="currentColor" stroke="none"/><path d="M15 5v14M20 5v14"/></svg></button>
  </div>
  <div class="row vol" id="vol" hidden style="margin-top:12px;grid-template-columns:1fr 1fr">
    <button class="rbtn" data-cmd="volDown" aria-label="Volume down"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 12h14"/></svg></button>
    <button class="rbtn" data-cmd="volUp" aria-label="Volume up"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 12h14M12 5v14"/></svg></button>
  </div>
  <div class="row" id="skip" hidden style="margin-top:12px;grid-template-columns:1fr 1fr">
    <button class="rbtn" data-cmd="seekBy" data-seconds="-10" aria-label="Back 10 seconds">⏪ 10 s</button>
    <button class="rbtn" data-cmd="seekBy" data-seconds="10" aria-label="Forward 10 seconds">⏩ 10 s</button>
  </div>
  <button class="type" id="type" data-cmd="typeOpen">Type</button>
  <div class="where" id="other" hidden>Typing on another phone</div>
</main>
<div class="sheet" id="sheet" hidden>
  <form id="form" autocomplete="off">
    <input id="text" type="text" enterkeyhint="search" autocapitalize="none" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="Search YouTube">
    <div class="btns"><button type="button" id="cancel">Cancel</button><button type="submit" class="go">Search</button></div>
  </form>
</div>
<script>
(function () {
  var ws = null, retry = 0, timer = null, open = false;
  var KEY = "couch-key";
  var fromUrl = new URLSearchParams(location.search).get("key");
  if (fromUrl) {
    try { localStorage.setItem(KEY, fromUrl); } catch (e) {}
    history.replaceState(null, "", location.pathname);
  }
  var key = fromUrl || (function () { try { return localStorage.getItem(KEY); } catch (e) { return null; } })() || "";
  var $ = function (id) { return document.getElementById(id); };

  function setOnline(on) {
    open = on;
    document.body.classList.toggle("off", !on);
    $("banner").hidden = on;
    $("hint").hidden = on || retry < 3;
    $("status").textContent = on ? "Connected" : "Offline";
  }

  function render(s) {
    $("where").innerHTML = "On the Screen: <b></b>";
    $("where").firstChild.nextSibling.textContent = s.where;
    $("count").textContent = s.remotes === 1 ? "1 phone" : s.remotes + " phones";
    var np = s.nowPlaying;
    $("np").hidden = !np;
    $("dpad").hidden = !!np;
    $("type").hidden = !!np;
    if (np) {
      duration = np.duration;
      $("np-title").textContent = np.title;
      $("np-folder").textContent = np.folder;
      $("np-fill").style.width = (np.duration > 0 ? Math.min(100, (np.position / np.duration) * 100) : 0) + "%";
      $("np-elapsed").textContent = fmt(np.position);
      $("np-remaining").textContent = "-" + fmt(Math.max(0, np.duration - np.position));
      $("np-pp").textContent = np.paused ? "Play" : "Pause";
      $("np-subs").textContent = np.subtitlesOn ? "Subtitles on" : "Subtitles off";
      $("np-subs").classList.toggle("on", np.subtitlesOn);
      $("np-vol").textContent = "Volume " + s.volume + "%";
    }
    $("type").classList.toggle("dim", !s.typeAvailable);
    $("other").hidden = s.typing !== "other";
    var mine = s.typing === "you";
    if (mine && $("sheet").hidden) { $("text").value = ""; $("sheet").hidden = false; $("text").focus(); }
    if (!mine) { $("sheet").hidden = true; $("text").blur(); }
    $("vol").hidden = !s.showVolume;
    $("skip").hidden = !s.showSkip;
  }

  var duration = 0;
  function fmt(t) {
    t = Math.max(0, Math.floor(t));
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
    return (h ? h + ":" + (m < 10 ? "0" : "") + m : m) + ":" + (sec < 10 ? "0" : "") + sec;
  }

  $("seek").addEventListener("click", function (e) {
    if (!open || !(duration > 0)) return;
    var r = this.getBoundingClientRect();
    var frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    ws.send(JSON.stringify({ type: "command", command: "seekTo", args: { seconds: Math.round(frac * duration) } }));
  });

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
`;
