import type { Store } from "../ports/store.ts";
import type { WebKitAvailability } from "./native-front.ts";

/** Runs in a detached WKWebView: which of FairPlay's key system answers. Nothing else is asked. */
export const FAIRPLAY_SCRIPT = `(async function () {
  var out = { keySystems: {} };
  try {
    await navigator.requestMediaKeySystemAccess("com.apple.fps.3_0", [{
      initDataTypes: ["sinf", "skd", "cenc"],
      videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.640028"' }],
    }]);
    out.keySystems["com.apple.fps.3_0"] = "granted";
  } catch (e) { out.keySystems["com.apple.fps.3_0"] = "denied: " + (e && e.name); }
  return out;
})()`;

const DOC = "webkit-fairplay";

export interface FairPlayCheck {
  store: Store;
  /** Safari and macOS versions: the cached answer is only good for the same pair. */
  version: string;
  /** Runs the probe in the add-on; absent when the add-on is missing or WebKit is unsupported. */
  run: (() => Promise<unknown>) | undefined;
  timeoutMs?: number;
}

const NO_ADDON: WebKitAvailability = {
  available: false,
  reason: "Couch's WebKit add-on isn't available on this Mac",
};
const CHECKING: WebKitAvailability = {
  available: false,
  reason: "Still checking whether FairPlay is available",
};
const FAILED: WebKitAvailability = {
  available: false,
  reason: "Couldn't check whether FairPlay is available",
};

/** The cached answer for this Safari/macOS pair, if there is one. */
function cachedAnswer(o: FairPlayCheck): WebKitAvailability | undefined {
  const cached = o.store.read<{ version?: string; granted?: boolean }>(DOC, {});
  return cached.version === o.version && typeof cached.granted === "boolean"
    ? answer(cached.granted)
    : undefined;
}

/** Runs the probe once. Only a clear "granted" or "denied: ..." is an answer (and cached); anything else is a failed check. */
async function probe(
  o: FairPlayCheck & { run: () => Promise<unknown> },
): Promise<WebKitAvailability> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([
      o.run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), o.timeoutMs ?? 10_000);
      }),
    ]);
    const system = (raw as { keySystems?: Record<string, unknown> } | null | undefined)
      ?.keySystems?.["com.apple.fps.3_0"];
    const granted = system === "granted";
    const denied = typeof system === "string" && /^denied(: .*)?$/.test(system);
    if (!granted && !denied) return FAILED;
    o.store.write(DOC, { version: o.version, granted });
    return answer(granted);
  } catch {
    return FAILED;
  } finally {
    clearTimeout(timer);
  }
}

/** Whether WebKit's FairPlay is available, asked once per Safari/macOS version and cached; a failed check is never cached. */
export async function checkFairPlay(o: FairPlayCheck): Promise<WebKitAvailability> {
  if (!o.run) return NO_ADDON;
  return cachedAnswer(o) ?? probe({ ...o, run: o.run });
}

/**
 * The same check without waiting for it: a cached answer is used at once; with none, `current()` says it is still
 * checking while the probe runs in the background, and `onAnswer` hears the result (granted, denied or a failed check).
 */
export function startFairPlay(
  o: FairPlayCheck,
  onAnswer: (answer: WebKitAvailability) => void,
): { current(): WebKitAvailability; done: Promise<WebKitAvailability> } {
  if (!o.run) return { current: () => NO_ADDON, done: Promise.resolve(NO_ADDON) };
  const cached = cachedAnswer(o);
  if (cached) return { current: () => cached, done: Promise.resolve(cached) };
  let now = CHECKING;
  const done = probe({ ...o, run: o.run }).then((a) => {
    now = a;
    onAnswer(a);
    return a;
  });
  return { current: () => now, done };
}

function answer(granted: boolean): WebKitAvailability {
  return granted
    ? { available: true }
    : { available: false, reason: "FairPlay isn't available on this Mac" };
}
