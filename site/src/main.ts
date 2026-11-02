import "./style.css";

/*
 * Screenshot slots: drop a file named slot-<name>.(png|jpg|webp) into src/shots/ and it replaces
 * the mock (or the interim picture) in the element marked data-slot="<name>". See README.
 */
const slotFiles = import.meta.glob("./shots/slot-*.{png,jpg,jpeg,webp}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

for (const [path, url] of Object.entries(slotFiles)) {
  const name = path.match(/slot-(.+)\.\w+$/)?.[1];
  const el = name && document.querySelector<HTMLElement>(`[data-slot="${name}"]`);
  if (!el) continue;
  const img = new Image();
  img.src = url;
  img.alt = el.getAttribute("data-alt") ?? `Couch ${name.replace(/-/g, " ")}`;
  img.decoding = "async";
  el.replaceChildren(img);
}

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

// Reveals: anything already on screen shows at once; the rest eases in as it arrives.
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  },
  { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
);
document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

// Home + Remote mock: a D-pad press moves the highlight on the Screen.
type Step = { key: "left" | "right" | "up" | "down" | "ok"; focus: number };
const script: Step[] = [
  { key: "right", focus: 1 }, { key: "right", focus: 2 }, { key: "left", focus: 1 },
  { key: "left", focus: 0 }, { key: "ok", focus: 0 },
];

function runHome(home: HTMLElement, dpad: HTMLElement | null, animate: boolean) {
  const tiles = [...home.querySelectorAll<HTMLElement>(".m-tile")];
  const chip = home.querySelector<HTMLElement>(".m-chip")!;
  const label = home.querySelector<HTMLElement>("[data-conn]")!;
  const setFocus = (i: number) => tiles.forEach((t, n) => t.classList.toggle("focus", n === i));
  const connect = (on: boolean) => { chip.classList.toggle("on", on); label.textContent = on ? "Phone connected" : "No phone connected"; };
  setFocus(0);
  if (!animate) { connect(true); return; }
  let i = 0, timer = 0, visible = false;
  const tick = () => {
    if (i === 0) connect(true);
    const s = script[i % script.length];
    const k = dpad?.querySelector<HTMLElement>(`.${s.key}`);
    k?.classList.add("press");
    setTimeout(() => k?.classList.remove("press"), 280);
    setFocus(s.focus);
    i = (i + 1) % script.length;
    if (i === 0) setTimeout(() => connect(false), 1100);
  };
  const start = () => { if (!timer) { timer = window.setInterval(tick, 1500); setTimeout(tick, 400); } };
  const stop = () => { clearInterval(timer); timer = 0; };
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? start() : stop(); }, { threshold: 0.35 }).observe(home);
}

document.querySelectorAll<HTMLElement>("[data-home]").forEach((home) => {
  const demo = home.closest("[data-demo]");
  runHome(home, demo?.querySelector<HTMLElement>("[data-dpad]") ?? null, !reduced && !!demo);
});

// Apps mock: focus drifts across the App tiles.
document.querySelectorAll<HTMLElement>(".mock-apps").forEach((m) => {
  const tiles = [...m.querySelectorAll<HTMLElement>(".a-tile")];
  const set = (i: number) => tiles.forEach((t, n) => t.classList.toggle("focus", n === i));
  set(0);
  if (reduced) return;
  let i = 0, timer = 0;
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !timer) timer = window.setInterval(() => set(++i % tiles.length), 1800);
    else if (!e.isIntersecting) { clearInterval(timer); timer = 0; }
  }, { threshold: 0.35 }).observe(m);
});

// Hero phone: a light parallax against the TV.
const ph = document.querySelector<HTMLElement>("[data-parallax]");
if (ph && !reduced) {
  addEventListener("scroll", () => { ph.style.translate = `0 ${Math.min(60, scrollY * -0.05)}px`; }, { passive: true });
}
