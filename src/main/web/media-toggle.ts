/**
 * Play/pause for a page whose App has no playback adapter, run in the page itself: toggles the media element that is
 * playing (else the first one). WebKit has no media key to send a view; Chromium's host presses one instead.
 * Answers whether it found media. A refused play() is swallowed, never thrown into the page.
 */
export const MEDIA_TOGGLE_SCRIPT = `(function () {
  var all = Array.prototype.slice.call(document.querySelectorAll("video,audio"));
  var m = all.filter(function (e) { return !e.paused && !e.ended; })[0] || all[0];
  if (!m) return false;
  if (m.paused) {
    try { var p = m.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
  } else m.pause();
  return true;
})()`;
