import "./couch-ui/screen.css";
import "./couch-ui/remote.css";
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
