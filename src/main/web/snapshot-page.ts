import { readFileSync } from "node:fs";

/** One element of a recorded page snapshot: tag, attributes, box (left, top, width, height), children. */
export interface SnapNode {
  t: string;
  a?: Record<string, string>;
  r: [number, number, number, number];
  hidden?: boolean;
  /** Computed z-index when not auto. */
  z?: number;
  /** position: fixed or sticky: it stays put when the page scrolls. */
  fixed?: boolean;
  c?: SnapNode[];
}
export interface Snapshot {
  url: string;
  view: { width: number; height: number };
  tree: SnapNode;
}

export function loadSnapshot(file: URL): Snapshot {
  return JSON.parse(readFileSync(file, "utf8")) as Snapshot;
}

const ATTR = /^\[([\w-]+)(?:([\^$*]?=)["']?([^"'\]]*)["']?)?\]/;

function compound(sel: string): (el: FakeEl) => boolean {
  const tests: Array<(el: FakeEl) => boolean> = [];
  let rest = sel.trim();
  const tag = /^[a-z][a-z0-9]*/i.exec(rest);
  if (tag) {
    tests.push((el) => el.tagName.toLowerCase() === tag[0].toLowerCase());
    rest = rest.slice(tag[0].length);
  }
  while (rest) {
    const cls = /^\.([\w-]+)/.exec(rest);
    if (cls) {
      tests.push((el) => (el.getAttribute("class") ?? "").split(/\s+/).includes(cls[1]!));
      rest = rest.slice(cls[0].length);
      continue;
    }
    const attr = ATTR.exec(rest);
    const not = /^:not\(/.exec(rest);
    if (attr) {
      const [whole, name, op, val] = attr;
      tests.push((el) => {
        const v = el.getAttribute(name!);
        if (v === null) return false;
        if (!op) return true;
        if (op === "=") return v === val;
        if (op === "^=") return v.startsWith(val!);
        if (op === "$=") return v.endsWith(val!);
        return v.includes(val!);
      });
      rest = rest.slice(whole.length);
    } else if (not) {
      let depth = 0;
      let end = 0;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "(") depth++;
        if (rest[i] === ")" && --depth === 0) {
          end = i;
          break;
        }
      }
      const inner = compound(rest.slice(5, end));
      tests.push((el) => !inner(el));
      rest = rest.slice(end + 1);
    } else throw new Error(`fake dom: unsupported selector part ${rest}`);
  }
  return (el) => tests.every((t) => t(el));
}

export function matcher(selector: string): (el: FakeEl) => boolean {
  // Split on commas outside brackets and parentheses.
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of selector) {
    if (ch === "[" || ch === "(") depth++;
    if (ch === "]" || ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  const tests = parts.map(compound);
  return (el) => tests.some((t) => t(el));
}

export class FakeEl {
  tagName: string;
  attrs: Record<string, string>;
  rect: { left: number; top: number; right: number; bottom: number };
  hiddenStyle: boolean;
  parent: FakeEl | null = null;
  children: FakeEl[] = [];
  connected = true;
  clicks = 0;
  disabled = false;
  isContentEditable = false;
  z?: number;
  fixed: boolean;
  scroll: { y: number; height: number };
  constructor(n: SnapNode, scroll: { y: number; height: number }) {
    this.scroll = scroll;
    this.z = n.z;
    this.fixed = !!n.fixed;
    this.tagName = n.t.toUpperCase();
    this.attrs = n.a ?? {};
    this.rect = { left: n.r[0], top: n.r[1], right: n.r[0] + n.r[2], bottom: n.r[1] + n.r[3] };
    this.hiddenStyle = !!n.hidden;
    this.disabled = "disabled" in this.attrs;
  }
  get isConnected() {
    return this.connected;
  }
  get parentElement() {
    return this.parent;
  }
  get uia() {
    return this.attrs["data-uia"] ?? "";
  }
  get type() {
    return this.attrs.type ?? "";
  }
  getAttribute(n: string) {
    return n in this.attrs ? this.attrs[n]! : null;
  }
  hasAttribute(n: string) {
    return n in this.attrs;
  }
  /** Stacking order: the nearest z-index up the tree (0 when none). */
  get effectiveZ(): number {
    for (let e: FakeEl | null = this; e; e = e.parent) if (e.z !== undefined) return e.z;
    return 0;
  }
  get stuck(): boolean {
    for (let e: FakeEl | null = this; e; e = e.parent) if (e.fixed) return true;
    return false;
  }
  getBoundingClientRect() {
    const dy = this.stuck ? 0 : this.scroll.y;
    const r = {
      left: this.rect.left,
      right: this.rect.right,
      top: this.rect.top - dy,
      bottom: this.rect.bottom - dy,
    };
    return { ...r, width: r.right - r.left, height: r.bottom - r.top };
  }
  matches(sel: string) {
    return matcher(sel)(this);
  }
  closest(sel: string): FakeEl | null {
    const m = matcher(sel);
    for (let e: FakeEl | null = this; e; e = e.parent) if (m(e)) return e;
    return null;
  }
  contains(other: FakeEl | null): boolean {
    for (let e = other; e; e = e.parent) if (e === this) return true;
    return false;
  }
  querySelector(sel: string) {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  querySelectorAll(sel: string): FakeEl[] {
    const m = matcher(sel);
    const out: FakeEl[] = [];
    const walk = (e: FakeEl) => {
      for (const c of e.children) {
        if (m(c)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  click() {
    this.clicks++;
  }
  /** Events the page sent this element (the pointer movement that wakes a player's bar). */
  events: string[] = [];
  dispatchEvent(e: { type: string }) {
    this.events.push(e.type);
    return true;
  }
  /** OK on a text field focuses it: counted like a press. */
  focus() {
    this.clicks++;
  }
  blur() {}
  scrollIntoView(opts: { block?: string } = {}) {
    if (this.stuck) return;
    const r = this.getBoundingClientRect();
    const h = this.scroll.height;
    let dy = 0;
    if (opts.block === "center") dy = (r.top + r.bottom) / 2 - h / 2;
    else if (r.top < 0) dy = r.top;
    else if (r.bottom > h) dy = r.bottom - h;
    this.scroll.y = Math.max(0, this.scroll.y + dy);
  }
}

/** A fake window and document over a recorded snapshot, for running the page focus script in a vm. */
export function snapshotPage(snap: Snapshot) {
  const all: FakeEl[] = [];
  const scroll = { y: 0, height: snap.view.height };
  const build = (n: SnapNode, parent: FakeEl | null): FakeEl => {
    const el = new FakeEl(n, scroll);
    el.parent = parent;
    all.push(el);
    el.children = (n.c ?? []).map((c) => build(c, el));
    return el;
  };
  const root = build(snap.tree, null);
  const find = (uia: string) => all.filter((e) => e.uia === uia);
  const doc: any = {
    activeElement: null,
    readyState: "complete",
    body: { appendChild: () => {} },
    documentElement: root,
    createElement: () => ({ style: {}, remove() {}, setAttribute() {} }),
    querySelectorAll: (sel: string) => root.querySelectorAll(sel).filter((e) => e.connected),
    // The topmost element under the point: highest stacking order, then the later in the page.
    elementFromPoint: (x: number, y: number) => {
      let top: FakeEl | null = null;
      for (const e of all) {
        const r = e.getBoundingClientRect();
        if (!e.connected || e.hiddenStyle) continue;
        if (
          x >= r.left &&
          x < r.right &&
          y >= r.top &&
          y < r.bottom &&
          (!top || e.effectiveZ >= top.effectiveZ)
        )
          top = e;
      }
      return top;
    },
  };
  return { all, root, doc, find, snap, scroll };
}
