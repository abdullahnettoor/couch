import { confirmMouseCommand } from "../shared/confirm-layout.ts";
import { iconSvg } from "../shared/icons.ts";
import { CHECK_SVG } from "../shared/setup-controls.ts";
import type { ScreenPayload, SetupPayload } from "../shared/protocol.ts";
import { setupControls } from "../shared/setup-controls.ts";
import sofa from "./assets/sofa.png";
import { qrSvg } from "./views/dom.ts";

const panel = document.getElementById("setup")!;

/** Easings: the Glass ease (expo out), the end card's back.out(1.7) and a quick ease-in for exits. */
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const BACK = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const EXIT = "cubic-bezier(0.4, 0, 1, 1)";
/** When the intro hands over to the panel, and how long that move takes (ms). */
const HANDOFF = 2500;
const HANDOFF_MS = 850;

let shell: { box: HTMLElement; stage: HTMLElement; dots: HTMLElement; mark: HTMLElement } | null =
  null;
let last: SetupPayload | undefined;
let lastPairing = "";
let structure = "";
let introPlayed = false;
let intro: { animations: Animation[]; skip(): void } | null = null;
let closing: number | undefined;

const unit = () => Math.min(innerWidth / 1920, innerHeight / 1080) || 1;
const calm = () => matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
const animate = (
  node: Element,
  frames: Keyframe[],
  options: KeyframeAnimationOptions,
): Animation | undefined =>
  typeof node.animate === "function" ? node.animate(frames, options) : undefined;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Setup's panel over Home's wallpaper: the sofa mark, the step's words and controls, amber step dots.
 * A fresh Setup opens with the intro; steps crossfade with a slight slide; the last one closes into Home
 * under a warm light. Only the focus and the tiles' on/off change in place, so the focus glow animates.
 */
export function renderSetup(payload: ScreenPayload): void {
  const s = payload.setup;
  const pairing = s?.qr ? payload.pairingUrl : "";
  if (!s) {
    if (last) close(last);
    last = undefined;
    return;
  }
  const key = JSON.stringify([
    { ...s, focus: 0, tiles: s.tiles?.map((t) => ({ ...t, on: 0 })) },
    pairing,
  ]);
  if (key === structure && last) {
    if (JSON.stringify(s) !== JSON.stringify(last)) {
      update(shell!.stage.firstElementChild as HTMLElement, s);
      intro?.skip();
    }
    last = s;
    return;
  }
  const before = last;
  structure = key;
  last = s;
  lastPairing = pairing;
  open();
  const page = build(s, lastPairing);
  drawDots(s);
  const turned = before && (before.id !== s.id || before.title !== s.title);
  swap(page, turned ? Math.sign(s.step - before.step) || 1 : 0, s);
  if (s.intro && !introPlayed && !before) playIntro();
  else if (before) intro?.skip();
}

/** Any key on the Mac while the intro plays skips it to the panel and does nothing else. */
export function setupTakesKey(): boolean {
  if (!intro) return false;
  intro.skip();
  return true;
}

function open(): void {
  if (closing !== undefined) {
    window.clearTimeout(closing);
    closing = undefined;
    shell = null;
    panel.replaceChildren();
  }
  panel.classList.add("show");
  if (shell) return;
  const box = el("div", "box glass");
  const mark = el("div", "s-mark");
  const img = el("img", "");
  img.src = sofa;
  img.alt = "";
  mark.append(img);
  const halo = el("div", "s-halo");
  halo.append(el("i", "s-glow"));
  const stage = el("div", "s-stage");
  const dots = el("div", "dots");
  box.append(halo, mark, stage, dots);
  panel.replaceChildren(el("div", "s-veil"), el("div", "s-light"), box);
  shell = { box, stage, dots, mark };
}

function drawDots(s: SetupPayload): void {
  const dots = shell!.dots;
  dots.hidden = s.steps < 2;
  while (dots.children.length < s.steps) dots.append(el("i", ""));
  while (dots.children.length > s.steps) dots.lastElementChild!.remove();
  [...dots.children].forEach((d, i) => (d.className = i === s.step ? "on" : ""));
}

function build(s: SetupPayload, pairing: string): HTMLElement {
  const page = el("div", `s-page s-${s.id.replace(/[^\w-]/g, "")}`);
  if (s.connected) {
    const check = el("div", "s-check");
    check.innerHTML = CHECK_SVG;
    page.append(check);
  }
  page.append(el("h2", "s-title", s.title));
  if (s.body) page.append(el("p", "s-body", s.body));
  if (s.qr) {
    const qr = el("div", "qr");
    qr.innerHTML = qrSvg(pairing);
    page.append(qr);
  }
  if (s.note) page.append(el("p", "s-note", s.note));
  if (s.list?.length) {
    const list = el("ul", "list");
    for (const entry of s.list) {
      const item = el("li", "");
      item.innerHTML = iconSvg("folder");
      item.append(el("span", "", entry));
      list.append(item);
    }
    page.append(list);
  }
  const controls = setupControls(s);
  const lead = s.tiles?.length ?? 0;
  const pointer = (node: HTMLElement, index: number) => {
    node.dataset.i = String(index);
    node.addEventListener("mouseenter", () =>
      window.couch.send(confirmMouseCommand("hover", index)),
    );
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      window.couch.send(confirmMouseCommand("click", index));
    });
  };
  if (s.tiles?.length) {
    const grid = el("div", "s-tiles");
    grid.style.setProperty("--cols", String(s.columns ?? s.tiles.length));
    s.tiles.forEach((t, i) => {
      const tile = el("div", "s-tile");
      const face = el("div", `g-tile ${t.id.replace(/[^\w-]/g, "")}-face`);
      face.innerHTML = t.icon;
      const tick = el("span", "s-tick");
      tick.innerHTML = CHECK_SVG;
      face.append(tick);
      tile.append(face, el("div", "g-cap", t.label));
      pointer(tile, i);
      grid.append(tile);
    });
    page.append(grid);
  }
  if (s.tips?.length) {
    const tips = el("ul", "s-tips");
    for (const tip of s.tips) {
      const item = el("li", "");
      item.append(el("kbd", "", tip.key), el("span", "", tip.text));
      tips.append(item);
    }
    page.append(tips);
  }
  if (s.hint) {
    const hint = el("p", "s-hint");
    hint.innerHTML = iconSvg("keyboard");
    hint.append(el("span", "", s.hint));
    page.append(hint);
  }
  const row = el("div", "buttons");
  controls.slice(lead).forEach((c, j) => {
    const b = el("button", "s-btn", c.label);
    b.type = "button";
    b.tabIndex = -1;
    pointer(b, lead + j);
    row.append(b);
  });
  page.append(row);
  if (s.footnote) page.append(el("p", "s-foot", s.footnote));
  update(page, s);
  return page;
}

/** What changes without a redraw: which control has focus, and which Apps are on. */
function update(page: HTMLElement, s: SetupPayload): void {
  for (const node of page.querySelectorAll<HTMLElement>("[data-i]"))
    node.classList.toggle("focused", Number(node.dataset.i) === s.focus);
  page.querySelectorAll<HTMLElement>(".s-tile").forEach((tile, i) => {
    const on = s.tiles?.[i]?.on === true;
    tile.classList.toggle("on", on);
    tile.classList.toggle("off", !on);
    tile.setAttribute("aria-pressed", String(on));
  });
}

type Size = { width: number; height: number };
/** Layout size, unaffected by the intro's transforms. */
const size = (node: HTMLElement): Size => ({ width: node.offsetWidth, height: node.offsetHeight });

/** The box's and the mark's running size animations, so a quick second press starts from where they are. */
let sizing: Animation[] = [];

/**
 * The new page comes in: a crossfade with a slight slide in the direction of travel. The new layout,
 * the mark's size included, settles at once and is measured, so the panel and the mark ease from where
 * they are to where they end up starting in the same frame as the crossfade, never after it.
 */
function swap(next: HTMLElement, direction: number, s: SetupPayload): void {
  const { box, stage, mark } = shell!;
  const old = stage.firstElementChild as HTMLElement | null;
  const from = size(box);
  const markFrom = size(mark);
  const markFade = getComputedStyle(mark).opacity;
  for (const x of sizing) x.cancel();
  sizing = [];
  box.classList.remove("s-sizing");
  for (const leaving of stage.querySelectorAll(".s-leaving")) leaving.remove();
  box.classList.add("s-measure");
  box.classList.toggle("final", s.final === true);
  box.classList.toggle("connected", s.connected === true);
  const turning = old !== null && direction !== 0;
  if (old && turning) {
    // The leaving page keeps its own width, centred, while the panel changes size under it.
    const width = old.offsetWidth;
    old.classList.add("s-leaving");
    if (width)
      Object.assign(old.style, {
        width: `${width}px`,
        left: "50%",
        right: "auto",
        marginLeft: `${-width / 2}px`,
      });
    old.removeAttribute("aria-live");
    for (const node of old.querySelectorAll("[data-i]")) node.removeAttribute("data-i");
  } else old?.remove();
  stage.append(next);
  const to = size(box);
  const markTo = size(mark);
  const markShow = getComputedStyle(mark).opacity;
  box.classList.remove("s-measure");
  const still = calm();
  if (old && !still) resize(box, mark, { from, to, markFrom, markTo, markFade, markShow });
  if (!old || !turning) return;
  const u = unit();
  const shift = still ? 0 : 56 * u * direction;
  const out = animate(
    old,
    [
      { opacity: 1, transform: "none" },
      { opacity: 0, transform: `translateX(${-shift * 0.6}px)` },
    ],
    { duration: 220, easing: EXIT, fill: "forwards" },
  );
  if (out)
    void out.finished.then(
      () => old.remove(),
      () => old.remove(),
    );
  else old.remove();
  animate(
    next,
    [
      { opacity: 0, transform: `translateX(${shift}px)` },
      { opacity: 1, transform: "none" },
    ],
    { duration: still ? 300 : 520, delay: 90, easing: EASE, fill: "backwards" },
  );
}

/** The panel and the mark ease from their old size to the measured new one, clipped to the panel while they move. */
function resize(
  box: HTMLElement,
  mark: HTMLElement,
  m: { from: Size; to: Size; markFrom: Size; markTo: Size; markFade: string; markShow: string },
): void {
  const timing = { duration: 520, easing: EASE };
  const px = (n: number) => `${n}px`;
  const moved = (a: number, b: number) => Math.abs(a - b) > 1;
  if (moved(m.from.height, m.to.height) || moved(m.from.width, m.to.width)) {
    const run = animate(
      box,
      [
        { width: px(m.from.width), height: px(m.from.height) },
        { width: px(m.to.width), height: px(m.to.height) },
      ],
      timing,
    );
    if (run) {
      box.classList.add("s-sizing");
      const done = () => {
        if (sizing.includes(run)) box.classList.remove("s-sizing");
      };
      void run.finished.then(done, () => {});
      sizing.push(run);
    }
  }
  if (moved(m.markFrom.height, m.markTo.height) || m.markFade !== m.markShow) {
    const run = animate(
      mark,
      [
        { width: px(m.markFrom.width), height: px(m.markFrom.height), opacity: m.markFade },
        { width: px(m.markTo.width), height: px(m.markTo.height), opacity: m.markShow },
      ],
      timing,
    );
    if (run) sizing.push(run);
  }
}

/**
 * The welcome moment, after the launch video's end card: the warm light blooms behind the sofa, which
 * rises, flares and settles; "Couch" comes out of a soft blur, then the tagline. Then the sofa shrinks
 * into the top of the panel as the panel rises in (one move). Reduce motion: a plain fade.
 */
function playIntro(): void {
  introPlayed = true;
  const { box, mark } = shell!;
  const layer = el("div", "s-intro");
  const light = panel.querySelector<HTMLElement>(".s-light")!;
  const veil = panel.querySelector<HTMLElement>(".s-veil")!;
  const big = el("img", "s-sofa");
  big.src = sofa;
  big.alt = "";
  const name = el("div", "s-name", "Couch");
  const tag = el("div", "s-tag", "Turn your Mac into a ");
  tag.append(el("span", "", "smart TV."));
  layer.append(big, name, tag);
  panel.append(layer);
  panel.classList.add("intro");
  const u = unit();
  const a = (node: Element, frames: Keyframe[], options: KeyframeAnimationOptions) =>
    animate(node, frames, options);
  const list: Array<Animation | undefined> = [];
  if (calm()) {
    list.push(
      a(layer, [{ opacity: 0 }, { opacity: 1 }], { duration: 500, fill: "backwards" }),
      a(light, [{ opacity: 0 }, { opacity: 1 }], { duration: 500, fill: "backwards" }),
      a(layer, [{ opacity: 1 }, { opacity: 0 }], {
        duration: 500,
        delay: HANDOFF,
        fill: "forwards",
      }),
      a(veil, [{ opacity: 1 }, { opacity: 0 }], {
        duration: 500,
        delay: HANDOFF,
        fill: "forwards",
      }),
      a(light, [{ opacity: 1 }, { opacity: 0 }], {
        duration: 500,
        delay: HANDOFF,
        fill: "forwards",
      }),
      a(box, [{ opacity: 0 }, { opacity: 1 }], {
        duration: 500,
        delay: HANDOFF,
        fill: "backwards",
      }),
    );
  } else {
    const m = mark.querySelector("img")!.getBoundingClientRect();
    const b = big.getBoundingClientRect();
    const dx = m.left + m.width / 2 - (b.left + b.width / 2);
    const dy = m.top + m.height / 2 - (b.top + b.height / 2);
    const k = b.width ? m.width / b.width : 0.2;
    const land = `translate(${dx}px, ${dy}px) scale(${k})`;
    const at = (delay: number, duration: number, easing = EASE): KeyframeAnimationOptions => ({
      delay,
      duration,
      easing,
      fill: "backwards",
    });
    const then = (delay: number, duration: number, easing = EASE): KeyframeAnimationOptions => ({
      delay,
      duration,
      easing,
      fill: "forwards",
    });
    list.push(
      a(
        light,
        [
          { opacity: 0, transform: "scale(0.7)" },
          { opacity: 1, transform: "none" },
        ],
        at(300, 900),
      ),
      a(
        big,
        [
          { opacity: 0, transform: `translateY(${40 * u}px) scale(0.45)` },
          { opacity: 1, transform: "none" },
        ],
        at(120, 750, BACK),
      ),
      a(
        big,
        [{ filter: "brightness(1.9)" }, { filter: "brightness(1)" }],
        then(400, 700, "cubic-bezier(0.33, 1, 0.68, 1)"),
      ),
      a(
        name,
        [
          { opacity: 0, transform: `translateY(${40 * u}px)`, filter: "blur(12px)" },
          { opacity: 1, transform: "none", filter: "blur(0px)" },
        ],
        at(620, 520),
      ),
      a(
        tag,
        [
          { opacity: 0, transform: `translateY(${24 * u}px)`, filter: "blur(8px)" },
          { opacity: 1, transform: "none", filter: "blur(0px)" },
        ],
        at(1400, 480),
      ),
      // The handoff: words lift away, the dark lifts off Home, the sofa lands in the panel as it rises in.
      ...[name, tag].map((node) =>
        a(
          node,
          [
            { opacity: 1, transform: "none", filter: "blur(0px)" },
            { opacity: 0, transform: `translateY(${-18 * u}px)`, filter: "blur(10px)" },
          ],
          then(HANDOFF, 260, EXIT),
        ),
      ),
      a(big, [{ transform: "none" }, { transform: land }], then(HANDOFF + 60, HANDOFF_MS)),
      a(
        light,
        [
          { opacity: 1, transform: "none" },
          { opacity: 0, transform: `translate(${dx}px, ${dy}px) scale(${Math.max(k * 1.8, 0.3)})` },
        ],
        then(HANDOFF + 60, HANDOFF_MS),
      ),
      a(veil, [{ opacity: 1 }, { opacity: 0 }], then(HANDOFF + 120, HANDOFF_MS)),
      a(
        box,
        [
          { opacity: 0, transform: `translateY(${70 * u}px) scale(0.97)` },
          { opacity: 1, transform: "none" },
        ],
        at(HANDOFF + 220, HANDOFF_MS - 140),
      ),
      a(mark, [{ opacity: 0 }, { opacity: 1 }], at(HANDOFF + HANDOFF_MS, 1, "linear")),
      a(big, [{ opacity: 1 }, { opacity: 0 }], then(HANDOFF + HANDOFF_MS + 20, 1, "linear")),
    );
  }
  const animations = list.filter((x): x is Animation => x !== undefined);
  const end = () => {
    if (intro !== current) return;
    intro = null;
    for (const x of animations) x.cancel();
    layer.remove();
    panel.classList.remove("intro");
  };
  const current = {
    animations,
    skip() {
      for (const x of animations) {
        const t = Number(x.currentTime ?? 0);
        if (t < HANDOFF) x.currentTime = HANDOFF;
        x.playbackRate = 1.7;
      }
      if (!animations.length) end();
    },
  };
  intro = current;
  layer.addEventListener("click", (event) => {
    event.stopPropagation();
    current.skip();
  });
  if (!animations.length) return;
  void Promise.all(animations.map((x) => x.finished)).then(end, end);
}

/** Setup closed: the panel fades; after the last step Home comes in under the warm light. */
function close(s: SetupPayload): void {
  intro?.skip();
  if (intro) {
    for (const x of intro.animations) x.cancel();
    intro = null;
  }
  panel.classList.remove("show", "intro");
  structure = "";
  const box = shell?.box;
  const warm = s.final === true;
  if (box && warm && !calm()) {
    panel.classList.add("farewell");
    document.body.classList.add("setup-farewell");
    animate(
      box,
      [
        { opacity: 1, transform: "none", filter: "blur(0px)" },
        { opacity: 0, transform: "scale(0.96)", filter: "blur(6px)" },
      ],
      { duration: 450, easing: EXIT, fill: "forwards" },
    );
  }
  closing = window.setTimeout(
    () => {
      closing = undefined;
      shell = null;
      panel.replaceChildren();
      panel.classList.remove("farewell");
      document.body.classList.remove("setup-farewell");
    },
    warm ? 1400 : 300,
  );
}
