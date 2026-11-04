// Runs in every page look-snap.mts loads, before the page's own scripts (no context isolation, so what it sets is the page's own).
// It fixes the clock, stops animations and stands in for what the real preloads and the Remote's server give the page.
const FIXED_NOW = Date.UTC(2026, 9, 20, 8, 30, 0);
const RealDate = Date;
class FixedDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(FIXED_NOW);
    else super(...args);
  }
  static now() {
    return FIXED_NOW;
  }
}
window.Date = FixedDate;

window.__errors = [];
window.addEventListener("error", (e) => window.__errors.push(String(e.message)));
window.addEventListener("unhandledrejection", (e) => window.__errors.push(String(e.reason)));

// The Screen: window.couch hands the page a payload when the snapshotter calls __screen.
window.couch = {
  send() {},
  reportGrid() {},
  reportGlass() {},
  onScreen: (l) => (window.__screen = l),
  onTint: (l) => (window.__tint = l),
  onSound() {},
  onMpv: (l) => (window.__mpv = l),
};
// The Quick settings drawer.
window.couchQuick = {
  pick() {},
  close() {},
  slideStart() {},
  onQuick: (l) => (window.__quick = l),
};
// The phone page: a socket that never connects, and snapshots handed to it by __phone.
window.WebSocket = class {
  constructor() {
    window.__socket = this;
  }
  send() {}
  close() {}
};
window.__phone = (snapshot) => {
  if (window.__socket.onopen) window.__socket.onopen();
  window.__socket.onmessage({ data: JSON.stringify(snapshot) });
};

// The phone page asks for fullscreen on its first tap; the harness never changes a window's size.
Element.prototype.requestFullscreen = () =>
  Promise.reject(new Error("no fullscreen in the harness"));

// Animations started from script (element.animate) jump to their end state; endless ones stop at the start.
const animate = Object.getOwnPropertyDescriptor(Element.prototype, "animate").value;
Element.prototype.animate = function (frames, options) {
  const animation = animate.call(this, frames, options);
  try {
    animation.finish();
  } catch {
    animation.pause();
    animation.currentTime = 0;
  }
  return animation;
};

// Animations and transitions off: every duration is zero, so each element sits at its end state.
document.addEventListener("DOMContentLoaded", () => {
  const style = document.createElement("style");
  style.textContent =
    "*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important}";
  document.head.append(style);
});
