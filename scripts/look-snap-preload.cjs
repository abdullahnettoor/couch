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
// The Quick settings drawer: __drawerIn settles once the drawer has started sliding in (it waits a frame first).
let drawerIn;
window.__drawerIn = new Promise((r) => (drawerIn = r));
window.couchQuick = {
  pick() {},
  close() {},
  slideStart: (direction) => direction === "in" && drawerIn(),
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

// Every picture the page starts loading, including ones made with `new Image()` that never join the page (Home's
// wallpaper is applied from such an image's onload), so readiness can wait for them.
const loading = new Set();
const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
Object.defineProperty(HTMLImageElement.prototype, "src", {
  ...src,
  set(value) {
    src.set.call(this, value);
    const done = new Promise((r) => {
      this.addEventListener("load", r, { once: true });
      this.addEventListener("error", r, { once: true });
    });
    loading.add(done);
    void done.then(() => loading.delete(done));
  },
});

const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
/** The pictures CSS draws: background images and masks, on elements and their ::before and ::after. */
function cssPictures() {
  const urls = new Set();
  for (const el of document.querySelectorAll("*"))
    for (const pseudo of [null, "::before", "::after"]) {
      const s = getComputedStyle(el, pseudo);
      for (const value of [s.backgroundImage, s.maskImage, s.webkitMaskImage])
        for (const m of (value || "").matchAll(/url\("?([^")]+)"?\)/g)) urls.add(m[1]);
    }
  return urls;
}
const decode = (url) => {
  const image = new Image();
  image.src = url;
  return image.decode().catch(() => {});
};

/**
 * Settles when the page is ready to capture: fonts loaded, every picture it is loading has arrived, every
 * <img> and CSS picture is decoded, and a frame has been drawn since. Repeats until a pass finds nothing new,
 * since a picture arriving can draw more (Home applies its wallpaper only once the picture has loaded).
 */
window.__ready = async () => {
  let seen = "";
  for (let pass = 0; pass < 20; pass++) {
    await document.fonts.ready;
    await Promise.all(loading);
    const imgs = [...document.images];
    const urls = cssPictures();
    await Promise.all([...imgs.map((i) => i.decode().catch(() => {})), ...[...urls].map(decode)]);
    // A tile Chromium drew early can keep an earlier raster of a picture (the sofa mark's edges) until something repaints it, so which
    // of two valid-looking captures came out depended on load. Repainting everything here makes it one.
    document.body.style.display = "none";
    void document.body.offsetHeight;
    document.body.style.display = "";
    await frame();
    const now = JSON.stringify([imgs.map((i) => i.currentSrc), [...urls]]);
    if (now === seen && loading.size === 0 && document.fonts.status === "loaded") return pass;
    seen = now;
  }
  throw new Error("the page kept loading pictures");
};
