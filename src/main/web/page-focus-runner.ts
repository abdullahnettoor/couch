import vm from "node:vm";

export interface FocusEnv {
  /** The suite's DOM model; the runner gives it the ring's `createElement`. */
  document: any;
  href: string;
  width: number;
  height: number;
  getComputedStyle: (el: any) => Record<string, unknown>;
}

/** Runs a page focus script in a VM against a suite's DOM model; drives keys, timers and the mutation observer. */
export function runFocusScript(script: string, env: FocusEnv) {
  const listeners: Record<string, Function[]> = {};
  const timers: Function[] = [];
  // Timers a second or longer wait for the fake clock (`wait`); shorter ones run at the next `flush`.
  const slow: Array<{ f: Function; due: number }> = [];
  let clock = 0;
  const observers: Function[] = [];
  const logs: string[] = [];
  const ring: any = { style: {}, remove() {}, setAttribute() {} };
  env.document.createElement = () => ring;
  const location = { href: env.href };
  const sandbox: any = {
    document: env.document,
    location,
    innerWidth: env.width,
    innerHeight: env.height,
    console: { warn() {}, debug: (m: string) => logs.push(m) },
    addEventListener: (t: string, f: Function) => (listeners[t] ??= []).push(f),
    getComputedStyle: env.getComputedStyle,
    requestAnimationFrame: (f: Function) => f(),
    setTimeout: (f: Function, ms = 0) => {
      if (ms >= 1000) slow.push({ f, due: clock + ms });
      else timers.push(f);
    },
    MouseEvent: class {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    },
    MutationObserver: class {
      constructor(f: Function) {
        observers.push(f);
      }
      observe() {}
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`(${script})()`, sandbox);
  const flush = () => {
    while (timers.length) timers.shift()!();
  };
  /** The page's DOM changed (the observer fires), and any timers that follow run. */
  const mutate = () => {
    for (const f of observers) f([]);
    flush();
  };
  /** One key: the page's handlers (`later` run after Couch's, like a handler registered later) then the end of dispatch. */
  const key = (k: string, extra: any = {}) => {
    const { later, ...rest } = extra;
    const e = {
      key: k,
      defaultPrevented: false,
      preventDefault() {
        e.defaultPrevented = true;
      },
      ...rest,
    };
    for (const f of listeners.keydown ?? []) f(e);
    later?.(e);
    flush();
    return e;
  };
  /** The fake clock moves on: long timers that fall due run, in order, and so do any they set. */
  const wait = (ms: number) => {
    const end = clock + ms;
    for (;;) {
      slow.sort((a, b) => a.due - b.due);
      const next = slow[0];
      if (!next || next.due > end) break;
      slow.shift();
      clock = next.due;
      next.f();
      flush();
    }
    clock = end;
  };
  const fire = (type: string, target: unknown) => {
    for (const f of listeners[type] ?? []) f({ type, target });
  };
  const run = (source: string): unknown => vm.runInContext(source, sandbox);
  return { key, ring, mutate, fire, flush, wait, logs, location, run };
}
