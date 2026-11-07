/**
 * The launch video in the first-look TV (ticket 145). Once, when the TV is mostly in view (and the hero's intro is
 * done), Couch's Home comes alive over the screenshot and does what a Remote would make it do: the highlight leaves
 * Big Buck Bunny and moves left to YouTube (three presses of Left: Library, Netflix, YouTube; the hero picture gives
 * way to the wallpaper and the clock, as Couch does), YouTube is pressed, it opens and fills the Screen, and the TV
 * ends on the launch video: its thumbnail and a play button, or the poster while there is no video yet.
 *
 * Motion: Couch's own. The highlight is the .focused class and its transition (glass.css: lift .38s); the hero
 * picture → clock fade is home.css's .7s; the ease everywhere is Couch's cubic-bezier(0.16, 1, 0.3, 1). Couch has no
 * press on a tile, so the press is the Remote's key press (page.ts: .12s, scale .95) on the lifted tile. The opening
 * (the tile's rect → the Screen's) and the ending's fade are the site's, on the same ease.
 *
 * Reduced motion: the end state at once, before the TV is even seen, and a switch to it mid-sequence ends it.
 * Without script: the screenshot of Home, and the links under the TV.
 *
 * With a video (data-mode="video"), the end is the site's own muted, looping teaser of it (once it plays; until
 * then, and without it, the thumbnail). It loads only once the TV comes into view and plays only while the TV is
 * 60% in view and the tab is visible; reduced motion and Save-Data never load it, and if it fails or autoplay is
 * refused, the thumbnail and play button stay. "Watch with sound" (and the play button) is a click-to-load facade:
 * nothing is requested from YouTube until it is pressed (click, Enter or Space); then YouTube's privacy-enhanced
 * player fills the Screen.
 */

/** When each beat starts, in ms from the start (the opening and the ending last OPEN_MS and END_MS). */
export const LAUNCH_TIMES = {
  row: 0, // the live row takes over from the screenshot's (a .25s fade; they are drawn in the same place)
  hops: [800, 1320, 1840] as const, // Home held a moment, then Left, Left, Left (520 ms apart): Library, Netflix, YouTube
  press: 2540, // the Remote's key press on the lifted YouTube tile, held .14s
  release: 2680,
  open: 2720, // YouTube opens: its tile grows to fill the Screen
  end: 3520, // the thumbnail (or the poster) comes up over it
};
const OPEN_MS = 900;
/** How long the teaser may take to start playing (once asked to, in view) before the thumbnail and play button stay. */
const TEASER_WAIT_MS = 6000;
const END_MS = 700;
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
/** The highlight's path: from the screenshot's (the Continue tile) to YouTube. */
const PATH = ["library", "netflix", "youtube"] as const;

export function launch(reduced: () => boolean, onChange: (fn: () => void) => () => void) {
  const lv = document.querySelector<HTMLElement>("[data-launch]");
  if (!lv) return;
  const tv = lv.closest<HTMLElement>(".tv") ?? lv;
  const tiles = new Map([...lv.querySelectorAll<HTMLElement>(".lv-home .h-app")].map((t) => [t.dataset.id!, t]));
  const yt = tiles.get("youtube")!;
  const open = lv.querySelector<HTMLElement>(".lv-open")!;
  const openMark = open.querySelector<HTMLElement>(".lv-open-mark")!;
  const endEl = lv.querySelector<HTMLElement>(".lv-end")!;
  let raf = 0;
  let anims: Animation[] = [];
  let state: "waiting" | "starting" | "playing" | "ended" = "waiting";
  const setState = (s: typeof state) => { state = s; lv.dataset.state = s; };
  setState("waiting");

  const focusOn = (id: string) => tiles.forEach((t, k) => t.classList.toggle("focused", k === id));
  // the end (and its play button) is out of reach until it shows
  endEl.inert = true;
  const step = (s: string) => { lv.dataset.step = s; endEl.inert = s !== "end"; };

  /** The end state, at once (reduced motion): YouTube open, the thumbnail (or poster) on the Screen, no fades. */
  const finish = () => {
    cancelAnimationFrame(raf); raf = 0;
    anims.forEach((a) => a.cancel()); anims = [];
    lv.classList.add("lv-now", "armed");
    focusOn("youtube");
    yt.classList.remove("lv-pressed");
    lv.classList.add("lit");
    step("end");
    setState("ended");
    stopWatching();
    teaserOff();
  };

  /**
   * The lifted YouTube tile's box in the Screen's own coordinates (offsets, so the first look's scroll tilt and
   * scale don't count), as insets from each edge, and its corner radius.
   */
  const tileBox = () => {
    const face = yt.querySelector<HTMLElement>(".g-tile")!;
    let x = 0, y = 0;
    for (let el: HTMLElement | null = face; el && el !== lv; el = el.offsetParent as HTMLElement | null) { x += el.offsetLeft; y += el.offsetTop; }
    const W = lv.offsetWidth, H = lv.offsetHeight, u = W / 1920;
    // Couch's focus: scale(1.09) translateY(-6u), about the tile's centre (glass.css .g-tile)
    const w = face.offsetWidth * 1.09, h = face.offsetHeight * 1.09;
    const cx = x + face.offsetWidth / 2, cy = y + face.offsetHeight / 2 - 6 * u;
    const r = (parseFloat(getComputedStyle(face).borderTopLeftRadius) || 0) * 1.09;
    return { top: cy - h / 2, right: W - (cx + w / 2), bottom: H - (cy + h / 2), left: cx - w / 2, r, cx, cy, W, H };
  };

  const openApp = () => {
    const b = tileBox();
    const px = (n: number) => `${n.toFixed(1)}px`;
    step("open");
    anims.push(open.animate(
      [{ clipPath: `inset(${px(b.top)} ${px(b.right)} ${px(b.bottom)} ${px(b.left)} round ${px(b.r)})` }, { clipPath: "inset(0px 0px 0px 0px round 0px)" }],
      { duration: OPEN_MS, easing: EASE },
    ));
    // the mark rides with the tile: from the tile's centre at its own size to the Screen's centre, larger
    const markW = openMark.offsetWidth || 1;
    const from = (112 * (b.W / 1920) * 1.09) / markW;
    anims.push(openMark.animate(
      [{ transform: `translate(${px(b.cx - b.W / 2)}, ${px(b.cy - b.H / 2)}) scale(${from.toFixed(4)})` }, { transform: "none" }],
      { duration: OPEN_MS, easing: EASE },
    ));
  };

  const play = () => {
    if (state !== "starting") return;
    if (reduced()) { finish(); return; }
    setState("playing");
    const T = LAUNCH_TIMES;
    const beats: Array<[number, () => void]> = [
      [T.row, () => step("row")],
      ...PATH.map((id, i): [number, () => void] => [T.hops[i]!, () => { focusOn(id); if (i === 0) lv.classList.add("lit"); }]),
      [T.press, () => yt.classList.add("lv-pressed")],
      [T.release, () => yt.classList.remove("lv-pressed")],
      [T.open, openApp],
      [T.end, () => { step("end"); syncTeaser(); }],
      [T.end + END_MS, () => { setState("ended"); anims.forEach((a) => a.cancel()); anims = []; }],
    ];
    // on the document's animation clock, like the CSS it drives (so it pauses with a hidden tab, and DevTools'
    // animation speed slows it too); data-start is that clock's time at the start
    const t0 = document.timeline.currentTime as number;
    lv.dataset.start = String(t0);
    let k = 0;
    const tick = () => {
      const t = (document.timeline.currentTime as number) - t0;
      while (k < beats.length && beats[k]![0] <= t) beats[k++]![1]();
      raf = k < beats.length ? requestAnimationFrame(tick) : 0;
    };
    tick();
  };

  // The teaser (with a video): data-teaser is "wait" (it may come), "on" (playing) or "off" (the thumbnail and play
  // button). It plays only at the end, while the TV is 60 % in view (as the sequence's start) and the tab is visible,
  // and pauses otherwise, going on from where it was.
  const video = endEl.querySelector<HTMLVideoElement>(".lv-video");
  const pauseBtn = endEl.querySelector<HTMLButtonElement>(".lv-pause");
  const saveData = () => !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  let teaser: "wait" | "on" | "off" = video && !reduced() && !saveData() ? "wait" : "off";
  if (video) lv.dataset.teaser = teaser;
  let inView = false;
  let userPaused = false;
  let waitTimer = 0;
  let vio: IntersectionObserver | undefined;
  const onVisibility = () => syncTeaser();
  const teaserOff = () => {
    if (!video || teaser === "off") return;
    teaser = "off";
    lv.dataset.teaser = "off";
    clearTimeout(waitTimer);
    vio?.disconnect(); vio = undefined;
    document.removeEventListener("visibilitychange", onVisibility);
    video.pause();
    if (video.hasAttribute("src")) { video.removeAttribute("src"); video.load(); }
  };
  /** Gives the video its file (once, when the TV first comes near, after the page's load); preload stays "none" until then. */
  const loadTeaser = () => {
    if (!video || teaser === "off" || video.hasAttribute("src")) return;
    if (document.readyState !== "complete") { addEventListener("load", loadTeaser, { once: true }); return; }
    const webm = video.dataset.webm && video.canPlayType('video/webm; codecs="vp9"') === "probably" ? video.dataset.webm : "";
    video.muted = true;
    video.preload = "auto";
    video.src = webm || video.dataset.mp4!;
  };
  const syncTeaser = () => {
    if (!video || teaser === "off") return;
    const go = lv.dataset.step === "end" && inView && !document.hidden && !userPaused;
    if (!go) {
      video.pause();
      if (teaser === "wait") { clearTimeout(waitTimer); waitTimer = 0; }
      return;
    }
    loadTeaser();
    if (!video.paused) return;
    video.play().catch((e: DOMException) => { if (e.name !== "AbortError") teaserOff(); });
    if (teaser === "wait" && !waitTimer) waitTimer = window.setTimeout(() => { if (teaser === "wait") teaserOff(); }, TEASER_WAIT_MS);
  };
  if (video && teaser === "wait" && "IntersectionObserver" in window) {
    video.addEventListener("playing", () => { if (teaser === "wait") { teaser = "on"; lv.dataset.teaser = "on"; clearTimeout(waitTimer); } });
    video.addEventListener("error", () => teaserOff());
    document.addEventListener("visibilitychange", onVisibility);
    vio = new IntersectionObserver(([e]) => {
      if (!e) return;
      const room = (e.rootBounds?.height ?? innerHeight) * 0.6;
      inView = e.isIntersecting && (e.intersectionRatio >= 0.6 || e.intersectionRect.height >= room);
      syncTeaser();
    }, { threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] });
    vio.observe(tv);
  }

  // Its pictures (the Continue tile's, the poster's light or the thumbnail) load once the page's own are in: after
  // the load event and the intro, when the browser is idle, or as soon as the TV starts to come into view.
  const arm = () => lv.classList.add("armed");
  const tileImg = lv.querySelector<HTMLImageElement>(".lv-home img");
  /** Waits (a little, at most) for the Continue tile's picture, so the live row never shows it empty. */
  const ready = () => {
    arm();
    const img = tileImg;
    if (!img || (img.complete && img.naturalWidth)) return Promise.resolve();
    return Promise.race([img.decode().catch(() => {}), new Promise((ok) => setTimeout(ok, 1200))]);
  };

  // Once, when the TV is mostly in view (60 %, or 60 % of a window it does not fit in) and the hero's intro is done.
  let io: IntersectionObserver | undefined;
  let mo: MutationObserver | undefined;
  let seen = false;
  const root = document.documentElement;
  const introDone = () => !root.classList.contains("intro") || root.classList.contains("intro-done");
  const tryStart = () => {
    if (!seen || !introDone() || state !== "waiting") return;
    setState("starting");
    stopWatching();
    ready().then(() => { if (state === "starting") play(); });
  };
  function stopWatching() { io?.disconnect(); mo?.disconnect(); io = mo = undefined; }
  const armWhenIdle = () => {
    if (!introDone() || document.readyState !== "complete") return;
    const idle = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 200));
    idle(arm);
  };

  onChange(() => { if (!reduced()) return; if (state !== "ended") finish(); else teaserOff(); });
  if (reduced()) finish();
  else if ("IntersectionObserver" in window) {
    io = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return;
      arm();
      loadTeaser();
      const room = (e.rootBounds?.height ?? innerHeight) * 0.6;
      seen = e.intersectionRatio >= 0.6 || e.intersectionRect.height >= room;
      tryStart();
    }, { threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] });
    io.observe(tv);
    if (!introDone()) {
      mo = new MutationObserver(() => { if (introDone()) { mo?.disconnect(); tryStart(); armWhenIdle(); } });
      mo.observe(root, { attributes: true, attributeFilter: ["class"] });
    }
    if (document.readyState === "complete") armWhenIdle();
    else addEventListener("load", armWhenIdle, { once: true });
  } else finish();

  // The facade (with a video): YouTube is loaded only now, into the Screen, by the play button or "Watch with sound".
  const btn = endEl.querySelector<HTMLButtonElement>(".lv-play");
  const watch = () => {
    if (lv.querySelector("iframe")) return;
    if (state === "playing") { cancelAnimationFrame(raf); raf = 0; setState("ended"); }
    teaserOff();
    const frame = document.createElement("iframe");
    frame.className = "lv-frame";
    frame.src = lv.dataset.embed!;
    frame.title = `${lv.dataset.title} (YouTube video)`;
    frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.allowFullscreen = true;
    lv.append(frame);
    lv.dataset.playing = "";
    frame.focus();
  };
  btn?.addEventListener("click", watch);
  endEl.querySelector(".lv-sound")?.addEventListener("click", watch);
  pauseBtn?.addEventListener("click", () => {
    userPaused = !userPaused;
    pauseBtn.toggleAttribute("data-paused", userPaused);
    pauseBtn.setAttribute("aria-label", userPaused ? "Play the preview" : "Pause the preview");
    syncTeaser();
  });
}
