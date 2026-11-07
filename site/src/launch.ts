/**
 * The first look's live TV (ticket 145). Couch's Home, over the screenshot of it, works as it does on a real Screen:
 * the highlight (Couch's .focused, its .38s lift) moves along the row, and a tile opens. Opening grows the tile's face
 * to fill the Screen (a .9s clip, the mark riding along), then its view comes up: YouTube is the launch video in
 * YouTube's own player (cued: the visitor's press on YouTube's play starts it, so it counts as a view; the placeholder
 * poster while there is no video), the Library a glimpse of Couch's Library, Continue Couch's player on Big Buck
 * Bunny, Netflix a card. "Home" (or Esc) goes back. Nothing is requested from YouTube until YouTube is opened.
 *
 * Use: the mouse (pointing at a tile moves the highlight to it, a click opens it), the keys (the row is a toolbar, one
 * tab stop: ← → Home End move the highlight while the focus is in the TV, Enter or Space opens; a click into the TV
 * focuses it), touch (a tap opens). A hint over the Screen says how, until the visitor first uses it.
 *
 * The scroll: with motion, the TV is pinned below the nav while its track scrolls past (style.css, "first look").
 * Until the visitor uses the TV, the track's progress moves the highlight for them, in even steps: Continue →
 * Library → Netflix → YouTube (scrolling back moves it back), and on YouTube the hint says how to watch. The scroll
 * never opens anything, and once the visitor has used the TV it no longer moves the highlight.
 *
 * Reduced motion: no pin, no scroll-driven highlight, no growth and no transitions; the TV works the same.
 * Without script: the screenshot of Home.
 */

const OPEN_MS = 900;
/** The Remote's key press on the lifted tile before it opens (page.ts: .12s), held a little. */
const PRESS_MS = 140;
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
/** The highlight's path as the scroll moves it: from the screenshot's (the Continue tile) left to YouTube. */
export const SCROLL_PATH = ["continue", "library", "netflix", "youtube"] as const;

export function launch(reduced: () => boolean, onChange: (fn: () => void) => () => void) {
  const lv = document.querySelector<HTMLElement>("[data-launch]");
  if (!lv) return;
  const tv = lv.closest<HTMLElement>(".tv") ?? lv;
  const track = document.querySelector<HTMLElement>("[data-fl-track]");
  const pin = track?.firstElementChild as HTMLElement | null;
  const home = lv.querySelector<HTMLElement>(".lv-home")!;
  const row = home.querySelector<HTMLElement>(".h-row")!;
  const tiles = new Map([...row.querySelectorAll<HTMLElement>(".h-app")].map((t) => [t.dataset.id!, t]));
  const ids = [...tiles.keys()];
  const button = (id: string) => tiles.get(id)!.querySelector<HTMLButtonElement>(".lv-tile")!;
  const openEl = lv.querySelector<HTMLElement>(".lv-open")!;
  const views = new Map([...lv.querySelectorAll<HTMLElement>(".lv-view")].map((v) => [v.dataset.view!, v]));
  const back = lv.querySelector<HTMLButtonElement>(".lv-back")!;
  const hint = lv.querySelector<HTMLElement>(".lv-hint")!;
  const touch = matchMedia("(hover: none), (pointer: coarse)");

  let live = false;
  let used = false;
  let focus = "continue";
  let opened: string | null = null;
  let anims: Animation[] = [];
  let timers: number[] = [];
  const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
  const clearLater = () => { timers.forEach(clearTimeout); timers = []; anims.forEach((a) => a.cancel()); anims = []; };

  const updateHint = () => {
    if (used || !live) { delete lv.dataset.hint; return; }
    const d = hint.dataset;
    const text = focus === "youtube" ? (touch.matches ? d.ytTouch : d.ytKey) : (touch.matches ? d.touch : d.key);
    hint.textContent = text ?? "";
    lv.dataset.hint = "";
  };
  /** The visitor used the TV: the hint goes, and the scroll no longer moves the highlight. */
  const interact = () => {
    if (used) return;
    used = true;
    lv.dataset.used = "";
    updateHint();
  };

  /** Moves the highlight (and the toolbar's one tab stop) to `id`; with `move`, the focus too. */
  const setFocus = (id: string, move = false) => {
    if (!tiles.has(id)) return;
    focus = id;
    lv.dataset.focus = id;
    tiles.forEach((t, k) => {
      t.classList.toggle("focused", k === id);
      button(k).tabIndex = k === id ? 0 : -1;
    });
    // off the Continue tile, Home shows its wallpaper, the clock and the greeting, as Couch does
    lv.classList.toggle("lit", id !== "continue");
    if (move) button(id).focus({ preventScroll: true });
    updateHint();
  };

  /** The lifted tile's box in the Screen's own coordinates (offsets, so the first look's tilt and scale don't count). */
  const tileBox = (id: string) => {
    const face = tiles.get(id)!.querySelector<HTMLElement>(".g-tile")!;
    let x = 0, y = 0;
    for (let el: HTMLElement | null = face; el && el !== lv; el = el.offsetParent as HTMLElement | null) { x += el.offsetLeft; y += el.offsetTop; }
    const W = lv.offsetWidth, H = lv.offsetHeight, u = W / 1920;
    // Couch's focus: scale(1.09) translateY(-6u), about the tile's centre (glass.css .g-tile)
    const w = face.offsetWidth * 1.09, h = face.offsetHeight * 1.09;
    const cx = x + face.offsetWidth / 2, cy = y + face.offsetHeight / 2 - 6 * u;
    const r = (parseFloat(getComputedStyle(face).borderTopLeftRadius) || 0) * 1.09;
    return { top: cy - h / 2, right: W - (cx + w / 2), bottom: H - (cy + h / 2), left: cx - w / 2, r, cx, cy, w, h, W, H };
  };

  /** Grows the tile's face to the Screen: a clip from the tile's box, and its mark (or picture) riding along. */
  const grow = (id: string) => {
    const b = tileBox(id);
    const px = (n: number) => `${n.toFixed(1)}px`;
    anims.push(openEl.animate(
      [{ clipPath: `inset(${px(b.top)} ${px(b.right)} ${px(b.bottom)} ${px(b.left)} round ${px(b.r)})` }, { clipPath: "inset(0px 0px 0px 0px round 0px)" }],
      { duration: OPEN_MS, easing: EASE },
    ));
    const rider = id === "continue" ? openEl.querySelector<HTMLElement>(".lv-open-art") : openEl.querySelector<HTMLElement>(`.lv-open-mark[data-for="${id}"]`);
    if (!rider) return;
    // a mark goes from its size on the tile (112u, lifted) to its own; the picture from the tile's box to the Screen
    const from = id === "continue" ? b.w / b.W : (112 * (b.W / 1920) * 1.09) / (rider.offsetWidth || 1);
    anims.push(rider.animate(
      [{ transform: `translate(${px(b.cx - b.W / 2)}, ${px(b.cy - b.H / 2)}) scale(${from.toFixed(4)})` }, { transform: "none" }],
      { duration: OPEN_MS, easing: EASE },
    ));
  };

  /** Opens a tile: YouTube's player is created only now. */
  const openApp = (id: string) => {
    if (!live || opened || !tiles.has(id)) return;
    interact();
    setFocus(id);
    opened = id;
    const view = views.get(id)!;
    const show = () => {
      view.classList.add("on");
      // YouTube's player goes in once its view shows (a player loaded while hidden may not draw its thumbnail)
      if (id === "youtube" && lv.dataset.embed) {
        const frame = document.createElement("iframe");
        frame.className = "lv-frame";
        frame.src = lv.dataset.embed;
        frame.title = `${lv.dataset.title} (YouTube video)`;
        frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
        frame.referrerPolicy = "strict-origin-when-cross-origin";
        frame.allowFullscreen = true;
        view.append(frame);
        frame.focus();
      } else back.focus({ preventScroll: true });
    };
    const start = () => {
      tiles.get(id)!.classList.remove("lv-pressed");
      lv.dataset.open = id;
      back.focus({ preventScroll: true });
      if (reduced()) { show(); return; }
      grow(id);
      later(OPEN_MS * 0.7, show);
    };
    if (reduced()) { start(); return; }
    tiles.get(id)!.classList.add("lv-pressed");
    later(PRESS_MS, start);
  };

  /** Back to Home: the view goes (and YouTube's player with it), and the highlight is where it was. */
  const close = () => {
    if (!opened) return;
    const id = opened;
    clearLater();
    tiles.get(id)!.classList.remove("lv-pressed");
    const view = views.get(id)!;
    view.querySelector("iframe")?.remove();
    view.classList.remove("on");
    delete lv.dataset.open;
    opened = null;
    setFocus(id, true);
  };

  /** Brings Home to life over the screenshot (they are drawn in the same place), once its picture is in. */
  const arm = () => lv.classList.add("armed");
  const wake = () => {
    if (live) return;
    arm();
    const img = home.querySelector<HTMLImageElement>(".h-film-art img");
    const ready = !img || (img.complete && img.naturalWidth)
      ? Promise.resolve()
      : Promise.race([img.decode().catch(() => {}), new Promise((ok) => setTimeout(ok, 1200))]);
    ready.then(() => {
      if (live) return;
      live = true;
      home.inert = false;
      home.removeAttribute("aria-hidden");
      lv.dataset.step = "row";
      setFocus(focus);
      drive();
    });
  };

  // The scroll moves the highlight while the TV is pinned, until the visitor uses it.
  let queued = false;
  const drive = () => {
    queued = false;
    if (!live || used || opened || reduced() || !track || !pin) return;
    const r = track.getBoundingClientRect();
    const range = r.height - pin.offsetHeight;
    if (range < 1 || r.bottom < -innerHeight || r.top > innerHeight * 2) return;
    const into = Math.max(0, Math.min(1, (stickyTop() - r.top) / range));
    const k = Math.min(SCROLL_PATH.length - 1, Math.floor(into * SCROLL_PATH.length));
    if (SCROLL_PATH[k] !== focus) setFocus(SCROLL_PATH[k]!);
  };
  let topCache = NaN;
  const stickyTop = () => (Number.isNaN(topCache) ? (topCache = parseFloat(getComputedStyle(pin!).top) || 0) : topCache);
  addEventListener("resize", () => { topCache = NaN; }, { passive: true });
  addEventListener("scroll", () => { if (!queued) { queued = true; requestAnimationFrame(drive); } }, { passive: true });

  // the mouse: pointing moves the highlight (only a real move: a tile sliding under a still pointer as the page
  // scrolls is not the visitor's doing); a click (or a tap) opens
  row.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" || opened || (!e.movementX && !e.movementY)) return;
    const id = (e.target as HTMLElement).closest<HTMLElement>(".h-app")?.dataset.id;
    if (!id) return;
    interact();
    if (id !== focus) setFocus(id, row.contains(document.activeElement));
  });
  row.addEventListener("click", (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>(".h-app")?.dataset.id;
    if (!id) return;
    button(id).focus({ preventScroll: true });
    openApp(id);
  });
  // a click into the TV, off the tiles, puts the keys in it
  home.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest(".lv-tile")) return;
    e.preventDefault();
    button(focus).focus({ preventScroll: true });
  });
  // the keys, only while the focus is in the TV
  lv.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && opened) { e.preventDefault(); close(); return; }
    if (opened || !row.contains(e.target as Node)) return;
    const i = ids.indexOf(focus);
    const to = e.key === "ArrowLeft" ? i - 1 : e.key === "ArrowRight" ? i + 1 : e.key === "Home" ? 0 : e.key === "End" ? ids.length - 1 : null;
    if (to == null) return;
    e.preventDefault();
    interact();
    setFocus(ids[Math.max(0, Math.min(ids.length - 1, to))]!, true);
  });
  row.addEventListener("focusin", () => { if (live) interact(); });
  back.addEventListener("click", close);
  touch.addEventListener("change", updateHint);

  const motion = () => { lv.classList.toggle("lv-now", reduced()); if (!reduced()) drive(); };
  onChange(motion);
  motion();

  // Home comes to life once the page's own pictures are in: after the load event and the intro, when the browser is
  // idle, or as soon as the TV starts to come into view
  const root = document.documentElement;
  const introDone = () => !root.classList.contains("intro") || root.classList.contains("intro-done");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { io.disconnect(); wake(); } }, { rootMargin: "0px 0px 25% 0px" });
    io.observe(tv);
  }
  const whenIdle = () => {
    if (!introDone()) { setTimeout(whenIdle, 400); return; }
    const idle = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 200));
    idle(wake);
  };
  if (document.readyState === "complete") whenIdle();
  else addEventListener("load", whenIdle, { once: true });
}
