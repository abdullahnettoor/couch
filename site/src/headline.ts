/*
 * The hero headline's loop: after the intro, "Settle in." gives way to the phrases in the h1's data-rotate
 * ("Sit back." → "Press play." → "Lights down."), about 3s each, then "Settle in." again, and round it goes.
 * A thin line of four segments under the h1 (.h1-steps, one per phrase, like story bars) says that it turns and
 * when: the current segment fills over its phrase's time, the ones before it stay filled until the loop restarts.
 * The fill is the clock: when a segment is full, the next phrase comes in, so pausing the fill pauses everything
 * with no jump. The h1's real text is always "Settle in." (its first span: LCP, screen readers, no script, reduced
 * motion); the other phrases are drawn by aria-hidden spans laid over it (absolutely placed, so nothing moves) whose
 * words come from CSS (content: attr(data-text)), so they are not in the page's text. A soft blur and fade in the
 * headline's own gradient. It waits while the pointer is on the headline, while something in the hero has focus
 * (so keyboard users pause it by tabbing into the hero), while the headline is off screen and while the tab is
 * hidden; a switch to reduced motion puts "Settle in." back at once and hides the line, for good.
 */
const HOLD = 3000; // each phrase, "Settle in." included, is on screen about this long
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)"; // Couch's ease

export function headline(reduced: () => boolean, onChange: (fn: () => void) => () => void) {
  const h1 = document.querySelector<HTMLElement>(".hero h1[data-rotate]");
  const real = h1?.firstElementChild as HTMLElement | null;
  const hero = h1?.closest<HTMLElement>(".hero");
  const bar = hero?.querySelector<HTMLElement>(".h1-steps");
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
  // one segment per phrase; the markup has the line's place, the segments are made to match the phrases
  const fills = items.map(() => {
    const seg = document.createElement("i");
    const fill = document.createElement("b");
    seg.append(fill);
    bar?.append(seg);
    return fill;
  });
  // a phrase wider than the column (only on the narrowest phones) is scaled to fit, not wrapped. The fit is the
  // span's own `scale`, apart from the animated transform, so a resize applies at once to whatever is showing;
  // measured again once the web font is in (it changes the phrases' widths).
  const measure = () => {
    const room = h1.parentElement!.clientWidth;
    for (const el of alts) {
      const fit = Math.min(1, room / Math.max(1, el.offsetWidth));
      el.style.scale = fit < 1 ? fit.toFixed(4) : "";
    }
  };
  measure();
  document.fonts?.ready.then(measure);

  const anims = new Map<HTMLElement, Animation>();
  const play = (el: HTMLElement, frames: Keyframe[], ms: number, easing: string) => {
    const old = anims.get(el);
    anims.set(el, el.animate(frames, { duration: ms, easing, fill: "forwards" }));
    old?.cancel();
  };
  const at = (y: number, s = 1) => `translate3d(0, ${y}em, 0) scale(${s})`;
  let showing = 0;
  const show = (i: number) => {
    const from = items[showing]!, to = items[i]!;
    showing = i;
    h1.dataset.showing = String(i);
    play(from, [
      { opacity: 1, filter: "blur(0)", transform: at(0) },
      { opacity: 0, filter: "blur(.09em)", transform: at(-0.1, 1.015) },
    ], 440, "cubic-bezier(0.4, 0, 1, 1)");
    play(to, [
      { opacity: 0, filter: "blur(.11em)", transform: at(0.12, 0.985), offset: 0 },
      { opacity: 0, filter: "blur(.11em)", transform: at(0.12, 0.985), offset: 0.26 },
      { opacity: 1, filter: "blur(0)", transform: at(0) },
    ], 1040, EASE);
  };

  // the segments: the current one fills over HOLD (linear, it is a clock), and its end brings the next phrase
  const segs = new Map<HTMLElement, Animation>();
  let clock: Animation | undefined;
  const fillSeg = (k: number) => {
    const el = fills[k]!;
    segs.get(el)?.cancel();
    const a = el.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: HOLD, easing: "linear", fill: "forwards" });
    segs.set(el, a);
    return a;
  };
  /** Back to an empty line as the loop restarts: the full segments fade out together, then empty (the first one
   *  starts filling again at once). */
  const emptySegs = () => {
    for (const el of fills.slice(1)) {
      const a = el.animate([{ transform: "scaleX(1)", opacity: 1 }, { transform: "scaleX(1)", opacity: 0, offset: 0.99 }, { transform: "scaleX(0)", opacity: 1 }], { duration: 440, easing: "ease-out", fill: "forwards" });
      segs.get(el)?.cancel();
      segs.set(el, a);
    }
  };

  let started = false, stopped = false;
  const blockers = new Set<string>();
  const state = () => {
    if (stopped) return;
    h1.dataset.rotation = !started ? "waiting" : blockers.size ? "paused" : "running";
  };
  /** The phrase k holds: its segment fills, and when it is full the next phrase comes in. */
  const hold = (k: number) => {
    clock = fillSeg(k);
    clock.onfinish = () => {
      if (stopped) return;
      const next = (k + 1) % items.length;
      show(next);
      if (next === 0) emptySegs();
      hold(next);
    };
    if (blockers.size) clock.pause();
  };
  const run = () => {
    if (!started || stopped) return;
    if (!clock) hold(0);
    else if (!blockers.size && clock.playState === "paused") clock.play();
    state();
  };
  const pause = (why: string) => {
    blockers.add(why);
    if (clock?.playState === "running") clock.pause();
    state();
  };
  const resume = (why: string) => { blockers.delete(why); run(); };
  const offs: Array<() => void> = [];
  const on = <K extends keyof HTMLElementEventMap>(el: EventTarget, type: K | string, fn: () => void) => {
    el.addEventListener(type, fn, { passive: true });
    offs.push(() => el.removeEventListener(type, fn));
  };
  /** Reduced motion, now: straight back to the real text, no fade, no line, and it does not start again. */
  function stop() {
    stopped = true;
    offs.forEach((f) => f());
    io.disconnect();
    offMotion();
    if (clock) clock.onfinish = null;
    anims.forEach((a) => a.cancel());
    anims.clear();
    segs.forEach((a) => a.cancel());
    segs.clear();
    showing = 0;
    h1!.dataset.showing = "0";
    h1!.dataset.rotation = "stopped";
    if (bar) bar.hidden = true;
  }

  on(h1, "pointerenter", () => pause("hover"));
  on(h1, "pointerleave", () => resume("hover"));
  on(hero, "focusin", () => pause("focus"));
  on(hero, "focusout", () => setTimeout(() => { if (!hero.contains(document.activeElement)) resume("focus"); }));
  on(document, "visibilitychange", () => (document.hidden ? pause("hidden") : resume("hidden")));
  on(window, "resize", measure);
  const io = new IntersectionObserver((es) => (es.some((e) => e.isIntersecting) ? resume("away") : pause("away")));
  io.observe(h1);
  const offMotion = onChange(() => { if (reduced()) stop(); });
  h1.dataset.showing = "0";
  state();

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
