/** How long a "does Couch's Chromium hold a sign-in?" lookup may take before the answer is "no". */
export const AVAILABILITY_TIMEOUT_MS = 1500;

/** Asks `check`, but answers false if it rejects or takes longer than the limit; never waits on a lookup that hangs. */
export function availableWithin(
  check: () => Promise<boolean>,
  ms = AVAILABILITY_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    const done = (v: boolean) => {
      clearTimeout(timer);
      resolve(v);
    };
    try {
      check().then(done, () => done(false));
    } catch {
      done(false);
    }
  });
}
