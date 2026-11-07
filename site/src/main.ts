import "./couch-ui/screen.css";
import "./couch-ui/remote.css";
import "./style.css";
import { intro } from "./intro.ts";
import { headline } from "./headline.ts";
import { launch } from "./launch.ts";

const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
const reduced = () => motionQuery.matches;
const onMotionChange = (fn: () => void) => {
  motionQuery.addEventListener("change", fn);
  return () => motionQuery.removeEventListener("change", fn);
};

intro(reduced, onMotionChange);
headline(reduced, onMotionChange);
launch(reduced, onMotionChange);

document.getElementById("year")!.textContent = String(new Date().getFullYear());

// Scroll progress line
const bar = document.getElementById("progress") as HTMLElement;
let ticking = false;
const paint = () => {
  const max = document.documentElement.scrollHeight - innerHeight;
  bar.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`;
  ticking = false;
};
addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(paint); } }, { passive: true });
paint();

/*
 * Reveals. Everything is visible without this. Once an IntersectionObserver exists, blocks that start
 * below the fold get a slightly shifted "pre" state and settle as they arrive. A block is never dimmed or invisible,
 * and jumping to a section (nav, hash) settles that section at once.
 */
const revealEls = [...document.querySelectorAll<HTMLElement>(".reveal, .shelf")];
const settle = (el: Element) => { el.classList.remove("pre"); el.classList.add("in"); };
const settleAll = () => revealEls.forEach(settle);
let revealObserver: IntersectionObserver | undefined;

if ("IntersectionObserver" in window) {
  revealObserver = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { settle(e.target); revealObserver!.unobserve(e.target); }
  }, { rootMargin: "0px 0px -6% 0px", threshold: 0.05 });
  if (!reduced()) {
    document.documentElement.classList.add("reveal-ready");
    for (const el of revealEls) {
      if (el.getBoundingClientRect().top > innerHeight) el.classList.add("pre");
      revealObserver.observe(el);
    }
  }
}

const settleTarget = (hash: string) => {
  const target = hash.length > 1 ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
  if (target) revealEls.filter((el) => target.contains(el) || el.contains(target)).forEach(settle);
};
addEventListener("hashchange", () => settleTarget(location.hash));
document.addEventListener("click", (ev) => {
  const a = (ev.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
  if (!a) return;
  settleTarget(a.getAttribute("href")!);
  a.closest("details.menu")?.removeAttribute("open");
});
settleTarget(location.hash);

// The Remote stage (#how): four steps, ending connected. data-stage drives the visuals (see style.css).
// From 900 × 740 px with motion (pinQuery, the same query as style.css) the head and the stage are pinned and the
// scroll is the control: the track's progress picks the step, forward and back, and a step's button scrolls to it.
// Native scroll only. Otherwise (phones, short windows, reduced motion) it plays once when the devices and the
// step list are both in view, with Replay; reduced motion shows the end at once.
const seq = document.querySelector<HTMLElement>("[data-seq]");
const seqHasMock = !!seq?.querySelector(".h-qr");
const seqSteps = [...document.querySelectorAll<HTMLButtonElement>("[data-go]")];
const replay = document.querySelector<HTMLButtonElement>("[data-replay]");
const track = document.querySelector<HTMLElement>("[data-how-track]");
const pin = track?.firstElementChild as HTMLElement | null | undefined;
const rail = document.querySelector<HTMLElement>(".seq-rail");
const railFill = rail?.querySelector<HTMLElement>("[data-rail]");
const seqPhone = seq?.querySelector<HTMLElement>(".phone");
const seqDevices = seq?.querySelector<HTMLElement>(".seq-devices");
const pinQuery = matchMedia("(min-width: 900px) and (min-height: 740px) and (prefers-reduced-motion: no-preference) and (scripting: enabled)");
const stageTimes = [0, 2200, 1900, 700]; // wait before stages 2..4 (index n-1); the press is held a beat so it reads
let seqTimers: number[] = [];
let seqStarted = false;
let pinned = false;

const clearSeq = () => { seqTimers.forEach(clearTimeout); seqTimers = []; };
const seqTiles = seq ? [...seq.querySelectorAll<HTMLElement>(".cu .h-app")] : [];
const seqRight = seq?.querySelector<HTMLElement>(".cr .dir.r");
let seqStage = 4;
const setRail = (f: number) => railFill?.style.setProperty("--fill", f.toFixed(4));
const setStage = (n: number, force = false) => {
  if (!pinned) setRail((n - 1) / 3);
  if (n === seqStage && !force) return;
  seqStage = n;
  seq?.setAttribute("data-stage", String(n));
  // Couch's own states: the highlight is the .focused class (its transition does the move), the press is .is-active on the D-pad's Right.
  seqTiles.forEach((t) => t.classList.toggle("focused", t.dataset.id === (n === 4 ? "netflix" : "youtube")));
  seqRight?.classList.toggle("is-active", n === 3);
  seqSteps.forEach((b) => {
    const k = Number(b.dataset.go);
    if (k === n) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
    b.classList.toggle("done", k < n);
  });
};
const playSeq = () => {
  clearSeq();
  setStage(1);
  let at = 0;
  for (const n of [2, 3, 4]) { at += stageTimes[n - 1] || 1600; const t = n; seqTimers.push(window.setTimeout(() => setStage(t), at)); }
};
const endSeq = () => { clearSeq(); setStage(4, true); };

/** The rail runs from the first step's number to the last one's, wherever the labels wrap. */
const placeRail = () => {
  if (!rail || seqSteps.length < 2) return;
  const box = rail.parentElement!.getBoundingClientRect();
  const mid = (b: HTMLButtonElement) => { const r = b.querySelector("b")!.getBoundingClientRect(); return r.top + r.height / 2 - box.top; };
  const top = mid(seqSteps[0]!), end = mid(seqSteps[seqSteps.length - 1]!);
  rail.style.top = `${top.toFixed(1)}px`;
  rail.style.height = `${(end - top).toFixed(1)}px`;
};

// Where each step starts along the track. The pairing (1 → 2) and the highlight's move (3 → 4) get the longer
// stretches before them; the end (4) holds only briefly before the stage lets go.
const STEP_AT = [0, 0.3, 0.55, 0.84];
/**
 * The track's geometry, measured only when layout changes (ResizeObserver), never on a scroll frame:
 * start is the scrollY at which the stage pins (p = 0), len the scroll it stays pinned for (p 0 → 1).
 */
let geo = { start: 0, len: 1 };
let lastP = NaN;
const measureTrack = () => {
  if (!pinned || !track || !pin) return;
  const top = parseFloat(getComputedStyle(pin).top) || 0;
  geo = { start: track.getBoundingClientRect().top + scrollY - top, len: Math.max(1, track.offsetHeight - pin.offsetHeight) };
  lastP = NaN;
};
let stageQueued = false;
const stageScroll = () => {
  stageQueued = false;
  if (!pinned) return;
  const p = Math.max(0, Math.min(1, (scrollY - geo.start) / geo.len));
  if (p === lastP) return; // before the pin, after it lets go, or no move at all: nothing to write
  lastP = p;
  let n = 1;
  STEP_AT.forEach((at, i) => { if (p >= at) n = i + 1; });
  setStage(n);
  setRail(Math.min(1, p / STEP_AT[3]!));
  // the phone comes forward a little as the steps advance (depth only, transform only), never below the stage
  if (seqPhone) seqPhone.style.transform = `translate3d(0, ${(-p * 22).toFixed(1)}px, 0)`;
};
const queueStage = () => {
  if (!pinned || stageQueued) return;
  // only near the track (from a screen before it pins to a screen after it lets go); elsewhere it is out of sight
  const y = scrollY;
  if (y < geo.start - innerHeight || y > geo.start + geo.len + innerHeight * 2) return;
  stageQueued = true;
  requestAnimationFrame(stageScroll);
};
const relayout = () => { placeRail(); measureTrack(); queueStage(); };

/** Pinned (scroll-linked) or not (plays once in view): set from pinQuery at load and whenever it changes. */
const setPinned = () => {
  if (!seq || !seqHasMock) return;
  pinned = pinQuery.matches && !!track && !!pin;
  clearSeq();
  if (replay) replay.hidden = pinned;
  rail?.classList.toggle("eased", !pinned);
  if (seqPhone) seqPhone.style.transform = "";
  placeRail();
  if (pinned) { measureTrack(); stageScroll(); }
  else endSeq();
};

if (seq && seqHasMock) {
  seqSteps.forEach((b) => b.addEventListener("click", () => {
    const n = Number(b.dataset.go);
    if (pinned) {
      // scroll to the middle of that step's stretch of the track; the scroll sets the step
      measureTrack();
      const at = (STEP_AT[n - 1]! + (STEP_AT[n] ?? 1)) / 2;
      scrollTo({ top: geo.start + at * geo.len });
      return;
    }
    seqStarted = true; clearSeq(); setStage(n);
  }));
  replay?.addEventListener("click", () => { if (reduced()) { clearSeq(); setStage(1); } else playSeq(); });
  // Unpinned, it starts only once the devices are mostly in view (60 %, or 60 % of a window they do not fit in)
  // and the first step is fully in view, so the whole sequence is seen; below the nav, not under it.
  const firstStep = seqSteps[0]?.closest("li");
  if (seqDevices && firstStep) {
    const seen = new Map<Element, IntersectionObserverEntry>();
    const navH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-h")) || 0;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => seen.set(e.target, e));
      if (seqStarted) return;
      const dev = seen.get(seqDevices), step = seen.get(firstStep);
      if (!dev?.isIntersecting || !step?.isIntersecting) return;
      const room = (dev.rootBounds?.height ?? innerHeight) * 0.6;
      if (dev.intersectionRatio < 0.6 && dev.intersectionRect.height < room) return;
      if (step.intersectionRatio < 0.99) return;
      seqStarted = true;
      io.disconnect();
      if (!pinned && !reduced()) playSeq();
    }, { threshold: [0, 0.2, 0.4, 0.6, 0.8, 0.99, 1], rootMargin: `-${navH}px 0px 0px 0px` });
    io.observe(seqDevices);
    io.observe(firstStep);
  }
  addEventListener("scroll", queueStage, { passive: true });
  // layout changes anywhere above or in the track (fonts, pictures, the window, the FAQ) move it: measure again then
  if (track && pin) {
    const ro = new ResizeObserver(relayout);
    [document.body, track, pin].forEach((el) => ro.observe(el));
  } else addEventListener("resize", relayout, { passive: true });
  pinQuery.addEventListener("change", setPinned);
  document.fonts?.ready.then(relayout);
  setPinned();
}

// Focus passes: the highlight moves across a row once, as Couch's D-pad would move it, then rests on the first.
// The move itself is Couch's own .focused transition (src/couch-ui/screen.css); this only toggles the class.
const passes: Array<[string, string]> = [
  ['[data-demo="apps"] .cu .h-row', ".h-app:not(.h-film)"],
  ['[data-pass="shelf"] .shelf-cu', ".lib-card.wide:not(:first-child)"],
];
let passTimers: number[] = [];
const passRows = passes
  .map(([root, items]) => {
    const host = document.querySelector<HTMLElement>(root);
    return host ? { host, items: [...host.querySelectorAll<HTMLElement>(items)] } : undefined;
  })
  .filter((p): p is { host: HTMLElement; items: HTMLElement[] } => !!p && p.items.length > 1);
const focusAt = (items: HTMLElement[], i: number) => items.forEach((t, n) => t.classList.toggle("focused", n === i));
const stopPasses = () => { passTimers.forEach(clearTimeout); passTimers = []; passRows.forEach((p) => focusAt(p.items, 0)); };
for (const p of passRows) {
  let ran = false;
  new IntersectionObserver((entries, io) => {
    if (!entries.some((e) => e.isIntersecting) || ran) return;
    ran = true;
    io.disconnect();
    if (reduced()) return;
    [1, 2, 0].forEach((i, k) => passTimers.push(window.setTimeout(() => focusAt(p.items, i % p.items.length), 1400 * (k + 1))));
  }, { threshold: 0.5 }).observe(p.host);
}
motionQuery.addEventListener("change", () => { if (reduced()) stopPasses(); });

// Hero: the room's light moves slower than the page (parallax). The mark stays with the headline it lights, so
// the two never drift apart or overlap at any width. The first look settles in as it arrives.
const hero = document.querySelector<HTMLElement>(".hero");
const room = document.querySelector<HTMLElement>("[data-room]")?.parentElement;
const stage = document.querySelector<HTMLElement>("[data-stage-scroll]");
const stageGlow = stage?.querySelector<HTMLElement>(".stage-glow");
// The TV's growth is a CSS view timeline (style.css, "first look"); where there is none, it is done here instead.
const stageTv = CSS.supports?.("animation-timeline: view()") ? null : stage?.querySelector<HTMLElement>(".tv");
const flTrack = document.querySelector<HTMLElement>("[data-fl-track]");
const flSection = stage?.closest<HTMLElement>(".first-look");
let scrollQueued = false;
const scrollScene = () => {
  scrollQueued = false;
  if (reduced()) {
    for (const el of [room, stage]) if (el) el.style.transform = "";
    if (stageGlow) stageGlow.style.opacity = "";
    if (stageTv) stageTv.style.scale = "";
    return;
  }
  const y = scrollY;
  // read before writing, so a scroll frame never forces a second layout
  const top = flSection ? flSection.getBoundingClientRect().top : 0;
  const trackTop = stageTv && flTrack ? flTrack.getBoundingClientRect().top : 0;
  if (y < innerHeight * 1.5 && room) room.style.transform = `translate3d(0, ${(y * 0.35).toFixed(1)}px, 0)`;
  if (stage && top < innerHeight * 1.2 && top > -innerHeight) {
    // 0 when the first look's top meets the bottom of the window, 1 when it reaches 35% from the top
    const p = Math.max(0, Math.min(1, (innerHeight - top) / (innerHeight * 0.65)));
    const e = 1 - Math.pow(1 - p, 3);
    // the tilt and rise only: the TV's own growth (below, or the CSS view timeline) is its scale
    stage.style.transform = `rotateX(${((1 - e) * 14).toFixed(2)}deg) translate3d(0, ${((1 - e) * 36).toFixed(1)}px, 0)`;
    if (stageGlow) stageGlow.style.opacity = (0.35 + e * 0.65).toFixed(3);
  }
  if (stageTv && trackTop < innerHeight * 1.2 && trackTop > -innerHeight * 3) {
    // the CSS range (entry 0% → entry 100% − the nav): from the track's top entering the window to its reaching the
    // nav, where the TV pins
    const g = Math.max(0, Math.min(1, (innerHeight - trackTop) / (innerHeight - 66)));
    stageTv.style.scale = (0.85 + g * 0.15).toFixed(4);
  }
};
addEventListener("scroll", () => { if (!scrollQueued) { scrollQueued = true; requestAnimationFrame(scrollScene); } }, { passive: true });
addEventListener("resize", scrollScene, { passive: true });
scrollScene();

// The Screen in the mark "plays" only while the hero is on screen and the tab is visible. Once the hero is gone,
// the nav's pill deepens a little and its soft shade (there for the hero's light) goes.
const navEl = document.querySelector<HTMLElement>(".nav");
if (hero) {
  let heroVisible = true;
  const playState = () => hero.classList.toggle("paused", !heroVisible || document.hidden);
  new IntersectionObserver((es) => { heroVisible = es.some((e) => e.isIntersecting); playState(); navEl?.classList.toggle("deep", !heroVisible); }).observe(hero);
  document.addEventListener("visibilitychange", playState);
  if (!reduced()) hero.classList.add("playing");
}

// A soft light follows the pointer in the hero, eased toward it each frame; it rests when the pointer leaves.
const cursorGlow = document.querySelector<HTMLElement>("[data-cursor-glow]");
const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
if (hero && cursorGlow && finePointer.matches) {
  let tx = 0, ty = 0, x = 0, y = 0, raf = 0, placed = false;
  const step = () => {
    x += (tx - x) * 0.12; y += (ty - y) * 0.12;
    cursorGlow.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.5 ? requestAnimationFrame(step) : 0;
  };
  hero.addEventListener("pointermove", (ev) => {
    if (reduced()) return;
    const r = hero.getBoundingClientRect();
    // the room layer moves with the parallax, so place the light in its coordinates
    const shift = room ? scrollY * 0.35 : 0;
    tx = ev.clientX - r.left; ty = ev.clientY - r.top - shift;
    if (!placed) { x = tx; y = ty; placed = true; }
    hero.classList.add("pointing");
    if (!raf) raf = requestAnimationFrame(step);
  });
  hero.addEventListener("pointerleave", () => hero.classList.remove("pointing"));
}

// Cards: a light under the pointer (moved with a transform) and the lift from CSS.
if (finePointer.matches) {
  for (const card of document.querySelectorAll<HTMLElement>(".step, .panel, .dl-card, .win")) {
    card.classList.add("spot");
    card.addEventListener("pointermove", (ev) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${(ev.clientX - r.left).toFixed(0)}px`);
      card.style.setProperty("--my", `${(ev.clientY - r.top).toFixed(0)}px`);
    });
  }
}

// Digits that tick: the old digit lifts out, the new one rises in (Couch's ease, transform and opacity only).
// Running rolls are tracked so a switch to reduced motion can cancel them and show the new digit at once.
const rolling = new Map<HTMLElement, { text: string; anims: Animation[] }>();
const roll = (el: HTMLElement, text: string) => {
  rolling.get(el)?.anims.forEach((a) => a.cancel());
  rolling.delete(el);
  if (reduced() || !el.animate) { el.textContent = text; return; }
  const ease = "cubic-bezier(0.16, 1, 0.3, 1)";
  const entry = { text, anims: [] as Animation[] };
  rolling.set(el, entry);
  const out = el.animate([{ transform: "none", opacity: 1 }, { transform: "translateY(-45%)", opacity: 0 }], { duration: 160, easing: "ease-in" });
  entry.anims.push(out);
  out.onfinish = () => {
    el.textContent = text;
    const inn = el.animate([{ transform: "translateY(45%)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 380, easing: ease });
    entry.anims.push(inn);
    inn.onfinish = () => { if (rolling.get(el) === entry) rolling.delete(el); };
  };
};
const stopRolls = () => {
  for (const [el, { text, anims }] of rolling) { anims.forEach((a) => a.cancel()); el.textContent = text; }
  rolling.clear();
};
/** Wraps the last character of a text node in a .roll span, so it can tick on its own. */
const rollable = (host: Element | null | undefined): HTMLElement | undefined => {
  const node = host && [...host.childNodes].find((n) => n.nodeType === 3 && /\d$/.test(n.textContent ?? ""));
  if (!node) return undefined;
  const t = node.textContent!;
  const span = document.createElement("span");
  span.className = "roll";
  span.textContent = t.slice(-1);
  node.textContent = t.slice(0, -1);
  node.parentNode!.insertBefore(span, node.nextSibling);
  return span;
};

// First look: Home on its own, alive for one moment: the clock ticks over a minute (8:42 → 8:43), once.
// The Remote and the travelling highlight are left to "The Remote is already in your pocket" and its sequence.
// The launch video's live Home (src/launch.ts) keeps the screenshot's 3:36: its clock is not one of these.
if (stage) {
  const clocks = [...stage.querySelectorAll(".cu:not(.lv-home) .h-clock .t, .cu:not(.lv-home) .topbar .clock")].map(rollable).filter((x): x is HTMLElement => !!x);
  let ran = false;
  new IntersectionObserver((entries, io) => {
    if (!entries.some((e) => e.isIntersecting) || ran) return;
    ran = true;
    io.disconnect();
    if (reduced()) return;
    setTimeout(() => { if (!reduced()) clocks.forEach((c) => roll(c, String((Number(c.textContent) + 1) % 10))); }, 2400);
  }, { threshold: 0.55 }).observe(stage);
}

// Nav: a small light slides under the link you point at, and rests under the section you are reading.
const navBar = document.querySelector<HTMLElement>(".nav nav");
if (navBar) {
  const links = [...navBar.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')];
  const ind = document.createElement("i");
  ind.className = "nav-ind";
  ind.setAttribute("aria-hidden", "true");
  navBar.append(ind);
  let current: HTMLAnchorElement | undefined;
  const show = (a?: HTMLAnchorElement) => {
    if (!a) { ind.style.opacity = "0"; return; }
    ind.style.transform = `translateX(${(a.offsetLeft + a.offsetWidth / 2).toFixed(0)}px)`;
    ind.style.opacity = "1";
  };
  links.forEach((a) => a.addEventListener("pointerenter", () => show(a)));
  navBar.addEventListener("pointerleave", () => show(current));
  const sections = links.map((a) => document.getElementById(a.hash.slice(1))).filter((x): x is HTMLElement => !!x);
  const seen = new Map<Element, boolean>();
  const spy = new IntersectionObserver((es) => {
    es.forEach((e) => seen.set(e.target, e.isIntersecting));
    const id = sections.find((s) => seen.get(s))?.id;
    current = links.find((a) => a.hash === `#${id}`);
    links.forEach((a) => a.classList.toggle("is-current", a === current));
    if (!navBar.matches(":hover")) show(current);
  }, { rootMargin: "-45% 0px -50% 0px" });
  sections.forEach((s) => spy.observe(s));
}

// FAQ: let the answer fade before the row closes (opening is CSS).
for (const d of document.querySelectorAll<HTMLDetailsElement>(".acc details")) {
  d.querySelector("summary")!.addEventListener("click", (ev) => {
    if (!d.open || reduced()) return;
    ev.preventDefault();
    d.classList.add("closing");
    setTimeout(() => { d.open = false; d.classList.remove("closing"); }, 200);
  });
}

// Reduced motion can change at any time: settle everything now; going back to motion needs no reset.
motionQuery.addEventListener("change", () => {
  if (reduced()) {
    revealObserver?.disconnect();
    settleAll();
    document.documentElement.classList.remove("reveal-ready");
    if (seq && seqHasMock) endSeq();
    stopRolls();
    scrollScene();
    hero?.classList.remove("playing");
  } else {
    if (revealObserver) document.documentElement.classList.add("reveal-ready");
    hero?.classList.add("playing");
    scrollScene();
  }
});
