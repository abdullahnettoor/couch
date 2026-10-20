export interface Clock {
  now(): number;
  /** Returns a function that cancels the timer. */
  setTimeout(fn: () => void, ms: number): () => void;
  setInterval(fn: () => void, ms: number): () => void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
  setInterval: (fn, ms) => {
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  },
};
