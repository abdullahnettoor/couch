/** Keys the self-test sends through the native NSEvent paths to a detached, never-shown WKWebView. */
export const SELF_TEST_KEYS = [
  "Up",
  "Down",
  "Left",
  "Right",
  "Return",
  "Escape",
  // A Mac keyboard key handed to the page (ticket 112): `replay:<keyCode>:<characters>:<NSEvent flags>`; a z, then a Shift-A.
  "replay:6:z:0",
  "replay:0:A:131072",
  // A move, a click and a wheel tick at (200, 200), handed to the view as Couch's input monitor hands real ones (ticket 112).
  "pointer:200:200",
];

/** Events the page must have recorded for the keys above: a move reaching WebKit as a trusted `mousemove` (ticket 112). */
export const SELF_TEST_EXPECTED_EVENTS = [
  "keydown:z",
  "keydown:A",
  "mousemove:trusted",
  "mousedown:trusted",
  "click:trusted",
  "wheel:trusted",
];

/** The move at window point (200, 200) of a 720 px high window lands at this client point (top-left origin). */
export const SELF_TEST_EXPECTED_MOVE = [200, 520];

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
  out.moves = (window.__moves || []).slice();
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
  /** `[clientX, clientY]` of each `mousemove` the page got. */
  moves: number[][];
  userAgent: string;
}

export function summarizeSelfTest(raw: unknown): SelfTestSummary {
  const r = (raw ?? {}) as {
    keySystems?: Record<string, string>;
    setSinkId?: string;
    devices?: Array<{ kind?: string }>;
    keys?: string[];
    moves?: number[][];
    ua?: string;
  };
  return {
    fairPlay: r.keySystems?.["com.apple.fps.3_0"] === "granted",
    setSinkId: r.setSinkId === "function",
    audioOutputListed: (r.devices ?? []).some((d) => d.kind === "audiooutput"),
    keys: r.keys ?? [],
    moves: r.moves ?? [],
    userAgent: r.ua ?? "",
  };
}
