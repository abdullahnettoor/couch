import { pickOutputId } from "../shared/output-id.ts";
import type { UiSound, UiSoundEvent } from "../shared/protocol.ts";

/** Held arrows repeat faster than this; their ticks run together into one per gap. */
const MOVE_GAP_MS = 70;
/** The loudest a sound gets at Couch's full volume: well under the video's level. */
const PEAK = 0.12;

/**
 * Which sounds to play: a move or a bump within MOVE_GAP_MS of the last one is dropped, so a held arrow
 * ticks at a steady pace; Select and Back always play.
 */
export function soundGate(gapMs = MOVE_GAP_MS): (sound: UiSound, now: number) => boolean {
  let last = -Infinity;
  return (sound, now) => {
    if (sound !== "move" && sound !== "blocked") return true;
    if (now - last < gapMs) return false;
    last = now;
    return true;
  };
}

interface Tone {
  type: OscillatorType;
  from: number;
  to: number;
  /** Seconds to fade out (each sound is shorter than 120 ms). */
  length: number;
  /** Share of the peak. */
  level: number;
}

/** Soft, low-passed tones: a tick, a fuller click, a falling note for Back and a muted low bump. */
const TONES: Record<UiSound, { cutoff: number; tones: Tone[] }> = {
  move: {
    cutoff: 2400,
    tones: [{ type: "triangle", from: 700, to: 560, length: 0.045, level: 0.7 }],
  },
  select: {
    cutoff: 2600,
    tones: [
      { type: "triangle", from: 520, to: 480, length: 0.09, level: 0.9 },
      { type: "sine", from: 780, to: 720, length: 0.06, level: 0.4 },
    ],
  },
  back: {
    cutoff: 2000,
    tones: [{ type: "triangle", from: 620, to: 400, length: 0.08, level: 0.8 }],
  },
  blocked: { cutoff: 600, tones: [{ type: "sine", from: 190, to: 140, length: 0.07, level: 1 }] },
};

type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };

/**
 * Plays the Interface sounds the core sends, on the Screen's own audio. One AudioContext, made on the
 * first sound and resumed when suspended; it plays on the output Couch uses (found by name, as the web
 * Apps do), else the System default. Nothing here throws: without audio the Screen is just silent.
 */
export function interfaceSounds(now: () => number = () => performance.now()) {
  const gate = soundGate();
  let ctx: SinkContext | undefined;
  let output: string | undefined;
  let routed: string | undefined | null = null;

  const route = async (audio: SinkContext): Promise<void> => {
    const wanted = output;
    if (routed === wanted || !audio.setSinkId) return;
    routed = wanted;
    let id = "";
    if (wanted !== undefined) {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices
        .filter((d) => d.kind === "audiooutput")
        .map((d) => ({ deviceId: d.deviceId, label: d.label }));
      const pick = pickOutputId(wanted, outputs);
      if ("id" in pick) id = pick.id;
    }
    if (routed === wanted) await audio.setSinkId(id);
  };

  const context = (): SinkContext | undefined => {
    if (ctx) return ctx;
    if (typeof AudioContext === "undefined") return undefined;
    ctx = new AudioContext({ latencyHint: "interactive" });
    navigator.mediaDevices?.addEventListener?.("devicechange", () => {
      routed = null;
    });
    return ctx;
  };

  return (event: UiSoundEvent): void => {
    try {
      if (!gate(event.sound, now())) return;
      const audio = context();
      if (!audio) return;
      output = event.output;
      route(audio).catch(() => {
        routed = null;
      });
      if (audio.state === "suspended") audio.resume().catch(() => {});
      play(audio, event.sound, (PEAK * Math.max(0, Math.min(100, event.volume))) / 100);
    } catch {
      // No audio on this Mac right now: stay silent.
    }
  };
}

function play(audio: AudioContext, sound: UiSound, peak: number): void {
  if (peak <= 0) return;
  const { cutoff, tones } = TONES[sound];
  const start = audio.currentTime + 0.005;
  const filter = audio.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = cutoff;
  filter.connect(audio.destination);
  for (const tone of tones) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = tone.type;
    osc.frequency.setValueAtTime(tone.from, start);
    osc.frequency.exponentialRampToValueAtTime(tone.to, start + tone.length);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak * tone.level, start + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.length);
    osc.connect(gain).connect(filter);
    osc.start(start);
    osc.stop(start + tone.length + 0.01);
  }
}
