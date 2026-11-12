/**
 * The first look's live TV (ticket 145). Couch's Home, over the screenshot of it, works as it does on a real Screen:
 * the highlight (Couch's .focused, its .38s lift) moves along the row, and a tile opens. Opening grows the tile's face
 * to fill the Screen (a .9s clip, the mark riding along), then its view comes up: YouTube is the launch video in
 * YouTube's own player (cued: the visitor's press on YouTube's play starts it, so it counts as a view; the placeholder
 * poster while there is no video), the Library a glimpse of Couch's Library, Continue Couch's player on Big Buck
 * Bunny, Netflix a card. "Home" (or Esc) goes back. Nothing is requested from YouTube until the YouTube tile is
 * highlighted: then its player loads over the tile, so one click on the tile plays it (see placePlayer).
 *
 * Use: the mouse (pointing at a tile moves the highlight to it, a click opens it), the keys (the row is a toolbar, one
 * tab stop: ← → Home End move the highlight while the focus is in the TV, Enter or Space opens; a click into the TV
 * focuses it), touch (a tap opens). A hint over the Screen says how, until the visitor first uses it, and each time
 * the TV comes into place (until then) an overlay over the whole Screen says it large, for VEIL_MS.
 *
 * The scroll: with motion, the TV is pinned below the nav while its track scrolls past (style.css, "first look").
 * Until the visitor uses the TV, the track's progress moves the highlight for them, in even steps: Continue →
 * Library → Netflix → YouTube (scrolling back moves it back), and on YouTube the hint says how to watch. The scroll
 * never opens anything, and once the visitor has used the TV it no longer moves the highlight.
 *
 * Phones: a small Couch Remote under the TV ([data-remote]), only its D-pad, drives it like the keys: ← → move the
 * highlight, OK opens; the Home pill on the Screen goes back. Its caption says what OK will do. A press keeps the
 * focus on the Remote.
 *
 * Skip ([data-skip], shown while the TV is pinned) scrolls on to the next section; it leaves the TV as it is.
 *
 * Reduced motion: no pin, no scroll-driven highlight, no growth and no transitions; the TV works the same.
 * Without script: the screenshot of Home.
 */

const OPEN_MS = 900;
/** The Remote's key press on the lifted tile before it opens (page.ts: .12s), held a little. */
const PRESS_MS = 140;
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
/** How long the overlay stays before it fades (Couch's .7s fade, in style.css). */
export const VEIL_MS = 2500;
const VEIL_FADE_MS = 700;
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
  // the Library's Home is its screenshot's own "‹ Home" (an invisible button over it); the others have the Home pill
  const libHome = lv.querySelector<HTMLButtonElement>(".lv-libhome");
  const homeButton = (id: string) => (id === "library" && libHome ? libHome : back);
  const hint = lv.querySelector<HTMLElement>(".lv-hint")!;
  const touch = matchMedia("(hover: none), (pointer: coarse)");

  let live = false;
  let used = false;
  let focus = "continue";
  let opened: string | null = null;
  /** YouTube's cued player, once the YouTube tile has been highlighted (see mountPlayer). */
  let frame: HTMLIFrameElement | null = null;
  let anims: Animation[] = [];
  let timers: number[] = [];
  const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
  const clearLater = () => { timers.forEach(clearTimeout); timers = []; anims.forEach((a) => a.cancel()); anims = []; };

  // The overlay: each time the TV comes into place (it pins; under reduced motion, 60% in view) until the visitor first
  // uses it, a veil over the Screen says how, for VEIL_MS, then fades. Any use of the TV (a pointer moving over the
  // Screen, a key in it, a tap or click) or the TV leaving its place takes it away at once, and after a use it never
  // comes back. It never takes a pointer or a scroll (pointer-events: none).
  let veilDone = false;
  let veilTimer = 0;
  const veilOff = () => { clearTimeout(veilTimer); veilTimer = 0; delete lv.dataset.veil; };
  const veilOn = () => {
    if (veilDone || opened || !live) return;
    clearTimeout(veilTimer);
    lv.dataset.veil = "on";
    veilTimer = window.setTimeout(() => {
      lv.dataset.veil = "fade";
      veilTimer = window.setTimeout(veilOff, VEIL_FADE_MS);
    }, VEIL_MS);
  };
  const veilGone = () => { veilDone = true; veilOff(); };
  let inPlace = false;
  const setInPlace = (now: boolean) => {
    if (!live || now === inPlace) return;
    inPlace = now;
    if (now) veilOn();
    else veilOff();
  };

  const updateHint = () => {
    if (used || !live) { delete lv.dataset.hint; return; }
    const d = hint.dataset;
    const text = focus === "youtube" ? (touch.matches ? d.ytTouch : d.ytKey) : (touch.matches ? d.touch : d.key);
    hint.textContent = text ?? "";
    lv.dataset.hint = "";
  };
  /** The visitor used the TV: the hint goes, and the scroll no longer moves the highlight. */
  const interact = () => {
    veilGone();
    if (used) return;
    used = true;
    lv.dataset.used = "";
    updateHint();
  };

  // the phone Remote's caption: what OK does on the highlighted tile, or Back in an opened App
  const remote = document.querySelector<HTMLElement>("[data-remote]");
  const caption = remote?.querySelector<HTMLElement>(".fl-cap");
  const liveRegion = remote?.querySelector<HTMLElement>(".fl-live");
  const captionFor = () => remote?.getAttribute(`data-cap-${opened ? "open" : focus}`) ?? "";
  const updateCaption = () => { if (caption) caption.textContent = captionFor(); };

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
    if (id === "youtube") mountPlayer();
    updateHint();
    updateCaption();
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
  const px = (n: number) => `${n.toFixed(1)}px`;

  /**
   * YouTube's player waits on its tile (#46): created (cued, as ever) the first time the YouTube tile is highlighted,
   * Screen-sized (YouTube's play button and thumbnail at their full size) and moved so its middle is the lifted tile's
   * face, clipped to it. So the visitor's click or tap on the tile is a press on YouTube's own player, which starts
   * the video with sound and counts as a view, and the TV then opens around it. It shows (and takes the pointer) only
   * once loaded and while YouTube is highlighted (style.css); off YouTube it stays, hidden, so passing over the tile
   * again reloads nothing. Until it has loaded, a click is the tile's (YouTube opens, and its play is a second press).
   */
  const placePlayer = () => {
    if (!frame || opened) return;
    const b = tileBox("youtube");
    frame.style.transform = `translate(${px(b.cx - b.W / 2)}, ${px(b.cy - b.H / 2)})`;
    frame.style.clipPath = `inset(${px((b.H - b.h) / 2)} ${px((b.W - b.w) / 2)} round ${px(b.r)})`;
  };
  const mountPlayer = () => {
    if (frame || !live || !lv.dataset.embed) return;
    const f = frame = document.createElement("iframe");
    f.className = "lv-frame";
    f.src = lv.dataset.embed;
    f.title = `${lv.dataset.title} (YouTube video)`;
    f.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    f.referrerPolicy = "strict-origin-when-cross-origin";
    f.allowFullscreen = true;
    // on the tile it is the tile's face: the tile's button stays the one tab stop and the name
    f.tabIndex = -1;
    f.setAttribute("aria-hidden", "true");
    f.addEventListener("load", () => { f.dataset.ready = ""; }, { once: true });
    f.addEventListener("focus", played);
    placePlayer();
    back.before(f);
  };
  /** A press inside the player over the tile moves the focus into it: the video is playing, so YouTube opens around it. */
  const played = () => { if (frame && !opened && document.activeElement === frame) openApp("youtube", true, true); };
  addEventListener("blur", () => setTimeout(played, 0));
  addEventListener("resize", () => placePlayer(), { passive: true });

  /** Grows the tile's face to the Screen: a clip from the tile's box, and its mark (or picture) riding along. */
  const grow = (id: string) => {
    const b = tileBox(id);
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

  /** Opens a tile. `played`: the visitor's press on YouTube's player over the tile has started it; it grows as it plays. */
  const openApp = (id: string, keepFocus = false, played = false) => {
    if (!live || opened || !tiles.has(id)) return;
    interact();
    setFocus(id);
    opened = id;
    const view = views.get(id)!;
    const player = id === "youtube" ? frame : null;
    const show = () => {
      view.classList.add("on");
      if (player && !keepFocus) player.focus();
      else if (!player && !keepFocus) homeButton(id).focus({ preventScroll: true });
    };
    const start = () => {
      tiles.get(id)!.classList.remove("lv-pressed");
      lv.dataset.open = id;
      updateCaption();
      if (!keepFocus) homeButton(id).focus({ preventScroll: true });
      if (player) {
        // the player leaves the tile for the whole Screen (the same element: moving it would reload it)
        const from = { transform: player.style.transform, clipPath: player.style.clipPath };
        player.style.transform = player.style.clipPath = "";
        player.removeAttribute("aria-hidden");
        player.removeAttribute("tabindex");
        if (!reduced() && from.transform) anims.push(player.animate([from, { transform: "none", clipPath: "inset(0px 0px 0px 0px round 0px)" }], { duration: OPEN_MS, easing: EASE }));
      }
      if (reduced()) { show(); return; }
      grow(id);
      later(OPEN_MS * 0.7, show);
    };
    if (reduced() || played) { start(); return; }
    tiles.get(id)!.classList.add("lv-pressed");
    later(PRESS_MS, start);
  };

  /** Back to Home: the view goes (and YouTube's player with it), and the highlight is where it was. */
  const close = (keepFocus = false) => {
    if (!opened) return;
    const id = opened;
    clearLater();
    tiles.get(id)!.classList.remove("lv-pressed");
    const view = views.get(id)!;
    if (id === "youtube") { frame?.remove(); frame = null; }
    view.classList.remove("on");
    delete lv.dataset.open;
    opened = null;
    setFocus(id, !keepFocus);
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
      if (remote) remote.inert = false;
      lv.dataset.step = "row";
      setFocus(focus);
      drive();
      if (reduced()) setInPlace(seen60);
      else place();
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
  /** Whether the TV is pinned (its track's top at the sticky offset, its bottom not yet past the pin's): Skip shows,
   *  and (once Home is alive) the overlay comes. */
  const place = () => {
    if (!track || !pin) return;
    let pinned = false;
    if (!reduced()) {
      const r = track.getBoundingClientRect();
      const t = stickyTop();
      pinned = r.height - pin.offsetHeight > 1 && r.top <= t + 1 && r.bottom >= t + pin.offsetHeight - 1;
    }
    track.toggleAttribute("data-pinned", pinned);
    if (live && !reduced()) setInPlace(pinned);
  };
  // Skip: on to the next section, its top under the nav (smoothly, or at once under reduced motion); the TV is untouched
  document.querySelector("[data-skip]")?.addEventListener("click", () => {
    const next = track?.closest("section")?.nextElementSibling;
    if (!next) return;
    const nav = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-h")) || 66;
    scrollTo({ top: next.getBoundingClientRect().top + scrollY - nav, behavior: reduced() ? "auto" : "smooth" });
  });
  addEventListener("scroll", () => { if (!queued) { queued = true; requestAnimationFrame(() => { drive(); place(); }); } }, { passive: true });

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
  // any use of the Screen takes the overlay away for good: a pointer moving over it (a real move), a tap or click, a key
  const screen = lv.parentElement!;
  screen.addEventListener("pointermove", (e) => { if (live && e.pointerType !== "touch" && (e.movementX || e.movementY)) veilGone(); });
  screen.addEventListener("pointerdown", () => { if (live) veilGone(); });
  lv.addEventListener("keydown", () => veilGone(), { capture: true });
  back.addEventListener("click", () => close());
  libHome?.addEventListener("click", () => close());
  // the phone Remote: the keys' work, the focus kept on the Remote, and a polite word for screen readers on a move
  remote?.addEventListener("click", (e) => {
    const cmd = (e.target as HTMLElement).closest<HTMLElement>("[data-cmd]")?.dataset.cmd;
    if (!cmd || !live) return;
    interact();
    if (opened) return; // in an opened App, the Home pill on the Screen goes back
    if (cmd === "ok") { openApp(focus, true); return; }
    const i = ids.indexOf(focus) + (cmd === "left" ? -1 : 1);
    if (i < 0 || i >= ids.length) return;
    setFocus(ids[i]!);
    if (liveRegion) liveRegion.textContent = button(focus).getAttribute("aria-label") ?? "";
  });
  touch.addEventListener("change", updateHint);

  const motion = () => {
    lv.classList.toggle("lv-now", reduced());
    if (!reduced()) { drive(); place(); }
    else setInPlace(seen60);
  };
  // under reduced motion nothing pins: the TV is in place when 60% of it is in view (or 60% of a window it doesn't fit)
  let seen60 = false;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([e]) => {
      if (!e) return;
      const room = (e.rootBounds?.height ?? innerHeight) * 0.6;
      seen60 = e.isIntersecting && (e.intersectionRatio >= 0.6 || e.intersectionRect.height >= room);
      if (reduced()) setInPlace(seen60);
    }, { threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] }).observe(tv);
  }
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
