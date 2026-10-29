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

/** Whether WebKit's FairPlay is available, asked once per Safari/macOS version and cached; a failed check is never cached. */
export async function checkFairPlay(o: FairPlayCheck): Promise<WebKitAvailability> {
  if (!o.run) {
    return { available: false, reason: "Couch's WebKit add-on isn't available on this Mac" };
  }
  const cached = o.store.read<{ version?: string; granted?: boolean }>(DOC, {});
  if (cached.version === o.version && typeof cached.granted === "boolean")
    return answer(cached.granted);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([
      o.run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), o.timeoutMs ?? 10_000);
      }),
    ]);
    const granted =
      (raw as { keySystems?: Record<string, string> } | undefined)?.keySystems?.[
        "com.apple.fps.3_0"
      ] === "granted";
    o.store.write(DOC, { version: o.version, granted });
    return answer(granted);
  } catch {
    return { available: false, reason: "Couldn't check whether FairPlay is available" };
  } finally {
    clearTimeout(timer);
  }
}

function answer(granted: boolean): WebKitAvailability {
  return granted
    ? { available: true }
    : { available: false, reason: "FairPlay isn't available on this Mac" };
}
