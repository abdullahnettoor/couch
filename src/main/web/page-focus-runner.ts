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
    setTimeout: (f: Function) => timers.push(f),
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
  const fire = (type: string, target: unknown) => {
    for (const f of listeners[type] ?? []) f({ type, target });
  };
  return { key, ring, mutate, fire, flush, logs, location };
}
