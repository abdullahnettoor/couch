import "./couch-ui/screen.css";
import "./couch-ui/remote.css";
import "./style.css";
import { intro } from "./intro.ts";

const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
const reduced = () => motionQuery.matches;

intro(reduced, (fn) => {
  motionQuery.addEventListener("change", fn);
  return () => motionQuery.removeEventListener("change", fn);
});

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

// The Remote sequence: finite, ends connected. data-stage drives the visuals (see style.css).
const seq = document.querySelector<HTMLElement>("[data-seq]");
const seqHasMock = !!seq?.querySelector(".h-qr");
const seqSteps = [...document.querySelectorAll<HTMLButtonElement>("[data-go]")];
const replay = document.querySelector<HTMLButtonElement>("[data-replay]");
const stageTimes = [0, 2200, 1900, 700]; // wait before stages 2..4 (index n-1); the press is held a beat so it reads
let seqTimers: number[] = [];
let seqStarted = false;

const clearSeq = () => { seqTimers.forEach(clearTimeout); seqTimers = []; };
const seqTiles = seq ? [...seq.querySelectorAll<HTMLElement>(".cu .h-app")] : [];
const seqRight = seq?.querySelector<HTMLElement>(".cr .dir.r");
const setStage = (n: number) => {
  seq?.setAttribute("data-stage", String(n));
  // Couch's own states: the highlight is the .focused class (its transition does the move), the press is .is-active on the D-pad's Right.
  seqTiles.forEach((t) => t.classList.toggle("focused", t.dataset.id === (n === 4 ? "netflix" : "youtube")));
  seqRight?.classList.toggle("is-active", n === 3);
  seqSteps.forEach((b) => (Number(b.dataset.go) === n ? b.setAttribute("aria-current", "step") : b.removeAttribute("aria-current")));
};
const playSeq = () => {
  clearSeq();
  setStage(1);
  let at = 0;
  for (const n of [2, 3, 4]) { at += stageTimes[n - 1] || 1600; const t = n; seqTimers.push(window.setTimeout(() => setStage(t), at)); }
};
const endSeq = () => { clearSeq(); setStage(4); };

if (seq && seqHasMock) {
  if (replay) replay.hidden = false;
  seqSteps.forEach((b) => b.addEventListener("click", () => { seqStarted = true; clearSeq(); setStage(Number(b.dataset.go)); }));
  replay?.addEventListener("click", () => { if (reduced()) { clearSeq(); setStage(1); } else playSeq(); });
  new IntersectionObserver((entries, io) => {
    if (!entries.some((e) => e.isIntersecting) || seqStarted) return;
    seqStarted = true;
    io.disconnect();
    if (!reduced()) playSeq();
  }, { threshold: 0.5 }).observe(seq);
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
let scrollQueued = false;
const scrollScene = () => {
  scrollQueued = false;
  if (reduced()) {
    for (const el of [room, stage]) if (el) el.style.transform = "";
    if (stageGlow) stageGlow.style.opacity = "";
    return;
  }
  const y = scrollY;
  // read before writing, so a scroll frame never forces a second layout
  const top = stage ? stage.parentElement!.getBoundingClientRect().top : 0;
  if (y < innerHeight * 1.5 && room) room.style.transform = `translate3d(0, ${(y * 0.35).toFixed(1)}px, 0)`;
  if (stage && top < innerHeight * 1.2 && top > -innerHeight) {
    // 0 when the first look's top meets the bottom of the window, 1 when it reaches 35% from the top
    const p = Math.max(0, Math.min(1, (innerHeight - top) / (innerHeight * 0.65)));
    const e = 1 - Math.pow(1 - p, 3);
    stage.style.transform = `rotateX(${((1 - e) * 14).toFixed(2)}deg) translate3d(0, ${((1 - e) * 36).toFixed(1)}px, 0) scale(${(0.94 + e * 0.06).toFixed(4)})`;
    if (stageGlow) stageGlow.style.opacity = (0.35 + e * 0.65).toFixed(3);
  }
};
addEventListener("scroll", () => { if (!scrollQueued) { scrollQueued = true; requestAnimationFrame(scrollScene); } }, { passive: true });
addEventListener("resize", scrollScene, { passive: true });
scrollScene();

// The Screen in the mark "plays" only while the hero is on screen and the tab is visible.
if (hero) {
  let heroVisible = true;
  const playState = () => hero.classList.toggle("paused", !heroVisible || document.hidden);
  new IntersectionObserver((es) => { heroVisible = es.some((e) => e.isIntersecting); playState(); }).observe(hero);
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
if (stage) {
  const clocks = [...stage.querySelectorAll(".cu .h-clock .t, .cu .topbar .clock")].map(rollable).filter((x): x is HTMLElement => !!x);
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

// Couch for Windows: one anonymous count. POST /api/demand/windows (worker/index.ts) with no body;
// localStorage remembers the tap so this browser counts once. No cookies.
const DEMAND_KEY = "couch:demand:windows";
const demandBtn = document.querySelector<HTMLButtonElement>('[data-demand="windows"]');
const demandCard = demandBtn?.closest<HTMLElement>("[data-demand-card]");
const done = demandCard?.querySelector<HTMLElement>("[data-demand-confirmation]");
const fail = demandCard?.querySelector<HTMLElement>("[data-demand-error]");
const live = demandCard?.querySelector<HTMLElement>("[data-demand-live]");
const remembered = () => { try { return localStorage.getItem(DEMAND_KEY) === "1"; } catch { return false; } };
const showCounted = (announce: boolean) => {
  if (!demandBtn || !done) return;
  const hadFocus = document.activeElement === demandBtn;
  demandBtn.hidden = true;
  done.hidden = false;
  if (fail) fail.hidden = true;
  if (announce) {
    demandCard!.classList.add("counted");
    if (live) live.textContent = done.textContent;
    if (hadFocus) done.focus({ preventScroll: true });
  }
};
if (demandBtn && done) {
  if (remembered()) showCounted(false);
  demandBtn.addEventListener("click", async () => {
    if (demandBtn.getAttribute("aria-busy") === "true") return;
    if (remembered()) { showCounted(true); return; }
    demandBtn.setAttribute("aria-busy", "true");
    if (fail) fail.hidden = true;
    let ok = false;
    try {
      const res = await fetch("/api/demand/windows", { method: "POST", credentials: "omit", cache: "no-store" });
      ok = res.ok;
    } catch { ok = false; }
    demandBtn.removeAttribute("aria-busy");
    if (ok) {
      try { localStorage.setItem(DEMAND_KEY, "1"); } catch { /* private mode: still counted once */ }
      showCounted(true);
    } else if (fail) {
      fail.hidden = false;
      if (live) live.textContent = fail.textContent;
    }
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
