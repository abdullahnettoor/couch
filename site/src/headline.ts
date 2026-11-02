/*
 * The hero headline's one turn (ticket 143): after the intro, "Settle in." gives way to the phrases in the h1's
 * data-rotate ("Sit back." → "Press play." → "Lights down."), about 2.6s each, then comes back and stays.
 * One cycle, never a loop. The h1's real text is always "Settle in." (its first span: LCP, screen readers, no
 * script, reduced motion); the other phrases are drawn by aria-hidden spans laid over it (absolutely placed,
 * so nothing moves) whose words come from CSS (content: attr(data-text)), so they are not in the page's text.
 * A soft blur and fade in the headline's own gradient. It waits while the pointer is on the headline, while
 * something in the hero has focus, while the headline is off screen and while the tab is hidden; a switch to
 * reduced motion puts "Settle in." back at once.
 */
const HOLD = 2600; // each phrase, "Settle in." included, is on screen about this long
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)"; // Couch's ease

export function headline(reduced: () => boolean, onChange: (fn: () => void) => () => void) {
  const h1 = document.querySelector<HTMLElement>(".hero h1[data-rotate]");
  const real = h1?.firstElementChild as HTMLElement | null;
  const hero = h1?.closest<HTMLElement>(".hero");
  if (!h1 || !real || !hero || reduced() || !h1.animate) return;
  const words = (h1.dataset.rotate ?? "").split("|").map((w) => w.trim()).filter(Boolean);
  if (!words.length) return;

  const alts = words.map((w) => {
    const s = document.createElement("span");
    s.className = "h1-alt";
    s.dataset.text = w;
    s.setAttribute("aria-hidden", "true");
    h1.append(s);
    return s;
  });
  const items = [real, ...alts];
  // a phrase wider than the column (only on the narrowest phones) is scaled to fit, not wrapped
  const fit = new Map<HTMLElement, number>();
  const measure = () => {
    const room = h1.parentElement!.clientWidth;
    for (const el of alts) fit.set(el, Math.min(1, room / Math.max(1, el.offsetWidth)));
  };
  measure();

  const anims = new Map<HTMLElement, Animation>();
  const play = (el: HTMLElement, frames: Keyframe[], ms: number, easing: string) => {
    const old = anims.get(el);
    anims.set(el, el.animate(frames, { duration: ms, easing, fill: "forwards" }));
    old?.cancel();
  };
  const at = (el: HTMLElement, y: number, s = 1) => `translate3d(0, ${y}em, 0) scale(${((fit.get(el) ?? 1) * s).toFixed(4)})`;
  let showing = 0;
  const show = (i: number) => {
    const from = items[showing]!, to = items[i]!;
    showing = i;
    h1.dataset.showing = String(i);
    play(from, [
      { opacity: 1, filter: "blur(0)", transform: at(from, 0) },
      { opacity: 0, filter: "blur(.09em)", transform: at(from, -0.1, 1.015) },
    ], 440, "cubic-bezier(0.4, 0, 1, 1)");
    play(to, [
      { opacity: 0, filter: "blur(.11em)", transform: at(to, 0.12, 0.985), offset: 0 },
      { opacity: 0, filter: "blur(.11em)", transform: at(to, 0.12, 0.985), offset: 0.26 },
      { opacity: 1, filter: "blur(0)", transform: at(to, 0) },
    ], 1040, EASE);
  };

  // the turn: hold "Settle in.", then each phrase, then back to "Settle in." for good
  const order = [...alts.map((_, k) => k + 1), 0];
  let step = 0, timer = 0, due = 0, left = HOLD, started = false, done = false;
  const blockers = new Set<string>();
  const tick = () => {
    timer = 0;
    show(order[step]!);
    step++;
    if (step >= order.length) return finish();
    left = HOLD;
    run();
  };
  const run = () => {
    if (!started || done || timer || blockers.size) return;
    h1.dataset.rotation = "running";
    due = performance.now() + left;
    timer = window.setTimeout(tick, left);
  };
  const pause = (why: string) => {
    blockers.add(why);
    if (!timer) return;
    clearTimeout(timer);
    timer = 0;
    left = Math.max(400, due - performance.now());
    h1.dataset.rotation = "paused";
  };
  const resume = (why: string) => { blockers.delete(why); run(); };
  const offs: Array<() => void> = [];
  const on = <K extends keyof HTMLElementEventMap>(el: EventTarget, type: K | string, fn: () => void) => {
    el.addEventListener(type, fn, { passive: true });
    offs.push(() => el.removeEventListener(type, fn));
  };
  function finish(how: "rested" | "stopped" = "rested") {
    done = true;
    clearTimeout(timer);
    timer = 0;
    offs.forEach((f) => f());
    io.disconnect();
    offMotion();
    h1!.dataset.rotation = how;
    if (how === "stopped") {
      // straight back to the real text, no fade
      anims.forEach((a) => a.cancel());
      anims.clear();
      showing = 0;
      h1!.dataset.showing = "0";
    }
  }

  on(h1, "pointerenter", () => pause("hover"));
  on(h1, "pointerleave", () => resume("hover"));
  on(hero, "focusin", () => pause("focus"));
  on(hero, "focusout", () => setTimeout(() => { if (!hero.contains(document.activeElement)) resume("focus"); }));
  on(document, "visibilitychange", () => (document.hidden ? pause("hidden") : resume("hidden")));
  on(window, "resize", measure);
  const io = new IntersectionObserver((es) => (es.some((e) => e.isIntersecting) ? resume("away") : pause("away")));
  io.observe(h1);
  const offMotion = onChange(() => { if (reduced()) finish("stopped"); });
  h1.dataset.showing = "0";
  h1.dataset.rotation = "waiting";

  // after the intro (or at once when there is none): the hero is whole before anything turns
  const root = document.documentElement;
  const begin = () => { started = true; measure(); run(); };
  if (!root.classList.contains("intro") || root.classList.contains("intro-done")) begin();
  else {
    const mo = new MutationObserver(() => { if (root.classList.contains("intro-done")) { mo.disconnect(); begin(); } });
    mo.observe(root, { attributes: true, attributeFilter: ["class"] });
    offs.push(() => mo.disconnect());
  }
}
