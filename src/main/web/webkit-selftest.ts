/** Keys the self-test sends through the native NSEvent path to a detached, never-shown WKWebView. */
export const SELF_TEST_KEYS = ["Up", "Down", "Left", "Right", "Return", "Escape"];

/**
 * An async expression run in a detached WKWebView on a secure origin: which key systems it grants
 * (FairPlay is `com.apple.fps.3_0`), whether `HTMLMediaElement.prototype.setSinkId` exists, what
 * `enumerateDevices` lists, and the key events the page received.
 */
export const SELF_TEST_SCRIPT = `(async function () {
  var out = { keySystems: {} };
  var systems = ["com.apple.fps", "com.apple.fps.3_0", "com.widevine.alpha"];
  for (var i = 0; i < systems.length; i++) {
    try {
      await navigator.requestMediaKeySystemAccess(systems[i], [{
        initDataTypes: ["sinf", "skd", "cenc"],
        videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.640028"' }],
      }]);
      out.keySystems[systems[i]] = "granted";
    } catch (e) { out.keySystems[systems[i]] = "denied: " + (e && e.name); }
  }
  out.ua = navigator.userAgent;
  out.setSinkId = typeof HTMLMediaElement.prototype.setSinkId;
  out.audioContextSetSinkId = typeof (window.AudioContext && window.AudioContext.prototype.setSinkId);
  out.mediaDevices = !!navigator.mediaDevices;
  try {
    out.devices = (await navigator.mediaDevices.enumerateDevices()).map(function (d) { return { kind: d.kind }; });
  } catch (e) { out.devices = []; out.devicesError = String(e && e.name); }
  out.sinkCalls = {};
  try {
    var el = new Audio();
    var tries = { empty: "", bogus: "couch-no-such-output" };
    for (var name in tries) {
      try { await el.setSinkId(tries[name]); out.sinkCalls[name] = "resolved"; }
      catch (e) { out.sinkCalls[name] = "rejected: " + (e && e.name); }
    }
  } catch (e) { out.sinkCalls = { error: String(e && e.name) }; }
  out.keys = (window.__keys || []).slice();
  return out;
})()`;

export interface SelfTestSummary {
  /** `com.apple.fps.3_0` was granted. */
  fairPlay: boolean;
  /** `HTMLMediaElement.prototype.setSinkId` exists. */
  setSinkId: boolean;
  /** `enumerateDevices()` lists at least one `audiooutput`. */
  audioOutputListed: boolean;
  keys: string[];
  userAgent: string;
}

export function summarizeSelfTest(raw: unknown): SelfTestSummary {
  const r = (raw ?? {}) as {
    keySystems?: Record<string, string>;
    setSinkId?: string;
    devices?: Array<{ kind?: string }>;
    keys?: string[];
    ua?: string;
  };
  return {
    fairPlay: r.keySystems?.["com.apple.fps.3_0"] === "granted",
    setSinkId: r.setSinkId === "function",
    audioOutputListed: (r.devices ?? []).some((d) => d.kind === "audiooutput"),
    keys: r.keys ?? [],
    userAgent: r.ua ?? "",
  };
}
