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
  .type { margin-top:12px; width:100%; height:54px; border-radius:18px; background:var(--surface-2); color:var(--ink-2); font-size:15px; font-weight:500; }
</style>
</head>
<body>
<div class="top"><span class="who"><span class="dot"></span><span id="status">Connecting…</span></span><span id="count"></span></div>
<div class="where" id="where"></div>
<div class="banner" id="banner" hidden>Can't reach Couch. Is the Mac awake and Couch open?</div>
<div class="where" id="hint" hidden>Still nothing? Scan the QR code on the Screen again to pair this phone.</div>
<main class="controls" id="controls">
  <div class="dpad">
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
  <button class="type" id="type" data-cmd="typeOpen" disabled>Type</button>
</main>
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
    $("type").disabled = !s.typeAvailable;
  }

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

  document.addEventListener("click", function (e) {
    var el = e.target.closest ? e.target.closest("[data-cmd]") : null;
    if (!el || el.disabled || !open) return;
    if (navigator.vibrate) navigator.vibrate(12);
    ws.send(JSON.stringify({ type: "command", command: el.getAttribute("data-cmd") }));
  });

  setOnline(false);
  connect();
})();
</script>
</body>
</html>
`;
