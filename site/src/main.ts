import "./style.css";

const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
const reduced = () => motionQuery.matches;

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
const seqHasMock = !!seq?.querySelector(".mock-pair");
const seqSteps = [...document.querySelectorAll<HTMLButtonElement>("[data-go]")];
const replay = document.querySelector<HTMLButtonElement>("[data-replay]");
const stageTimes = [0, 2200, 1900, 1500]; // wait before stages 1..4 (index 0 unused)
let seqTimers: number[] = [];
let seqStarted = false;

const clearSeq = () => { seqTimers.forEach(clearTimeout); seqTimers = []; };
const setStage = (n: number) => {
  seq?.setAttribute("data-stage", String(n));
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
  seqSteps.forEach((b) => b.addEventListener("click", () => { clearSeq(); setStage(Number(b.dataset.go)); }));
  replay?.addEventListener("click", () => { if (reduced()) { clearSeq(); setStage(1); } else playSeq(); });
  new IntersectionObserver((entries, io) => {
    if (!entries.some((e) => e.isIntersecting) || seqStarted) return;
    seqStarted = true;
    io.disconnect();
    if (!reduced()) playSeq();
  }, { threshold: 0.5 }).observe(seq);
}

// Apps mock: one pass of the focus across the tiles, then it rests on the first.
const apps = document.querySelector<HTMLElement>(".mock-apps");
let appsTimers: number[] = [];
if (apps) {
  const tiles = [...apps.querySelectorAll<HTMLElement>(".a-tile")];
  const focus = (i: number) => tiles.forEach((t, n) => t.classList.toggle("focus", n === i));
  const stopApps = () => { appsTimers.forEach(clearTimeout); appsTimers = []; focus(0); };
  const runApps = () => [1, 2, 0].forEach((i, k) => appsTimers.push(window.setTimeout(() => focus(i), 1400 * (k + 1))));
  let ran = false;
  new IntersectionObserver((entries, io) => {
    if (!entries.some((e) => e.isIntersecting) || ran) return;
    ran = true;
    io.disconnect();
    if (!reduced()) runApps();
  }, { threshold: 0.5 }).observe(apps);
  motionQuery.addEventListener("change", () => { if (reduced()) stopApps(); });
}

// Hero phone: a light parallax against the TV.
const ph = document.querySelector<HTMLElement>("[data-parallax]");
const parallax = () => { ph!.style.translate = reduced() ? "" : `0 ${Math.min(60, scrollY * -0.05)}px`; };
if (ph) addEventListener("scroll", parallax, { passive: true });

// Reduced motion can change at any time: settle everything now; going back to motion needs no reset.
motionQuery.addEventListener("change", () => {
  if (reduced()) {
    revealObserver?.disconnect();
    settleAll();
    document.documentElement.classList.remove("reveal-ready");
    if (seq && seqHasMock) endSeq();
    if (ph) parallax();
  } else if (revealObserver) {
    document.documentElement.classList.add("reveal-ready");
  }
});
