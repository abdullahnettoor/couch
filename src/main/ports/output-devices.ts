import { execFile } from "node:child_process";
import { findMpv } from "../mpv/find-mpv.ts";
import type { OutputDevice } from "./mac.ts";

/** The CoreAudio outputs in `mpv --audio-device=help` (lines like `'coreaudio/<UID>' (Name)`). */
export function parseOutputDevices(text: string): OutputDevice[] {
  const devices: OutputDevice[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*'coreaudio\/(.+?)' \((.*)\)\s*$/.exec(line);
    if (match) devices.push({ uid: match[1]!, name: match[2]! });
  }
  return devices;
}

function listWithMpv(mpv: string): Promise<OutputDevice[]> {
  return new Promise((resolve, reject) =>
    execFile(mpv, ["--no-config", "--audio-device=help"], { timeout: 8000 }, (error, stdout) =>
      error ? reject(error) : resolve(parseOutputDevices(stdout)),
    ),
  );
}

const POLL_MS = 5000;

/**
 * Lists the Mac's outputs with their CoreAudio UIDs by asking mpv (read-only: nothing is opened or
 * changed). CoreAudio change events aren't exposed to Electron, so changes are found by polling
 * while somebody listens.
 */
export function createOutputDevices(list: () => Promise<OutputDevice[]> = defaultList): {
  list(): Promise<OutputDevice[]>;
  onChanged(listener: () => void): () => void;
} {
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let last = "";
  const poll = () => {
    list()
      .then((devices) => {
        const key = JSON.stringify(devices);
        if (key === last) return;
        const first = last === "";
        last = key;
        if (!first) for (const l of [...listeners]) l();
      })
      .catch(() => {});
  };
  return {
    list: () =>
      list().then((devices) => {
        last = JSON.stringify(devices);
        return devices;
      }),
    onChanged(listener) {
      listeners.add(listener);
      timer ??= setInterval(poll, POLL_MS);
      timer.unref();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer) {
          clearInterval(timer);
          timer = undefined;
        }
      };
    },
  };
}

function defaultList(): Promise<OutputDevice[]> {
  const mpv = findMpv();
  return mpv ? listWithMpv(mpv) : Promise.resolve([]);
}
