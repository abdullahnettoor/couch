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

/** Where the output list comes from: the running mpv core, which also says when it changes. */
export interface OutputDeviceSource {
  list(): Promise<OutputDevice[] | undefined>;
  onChanged(listener: () => void): () => void;
}

/**
 * Lists the Mac's outputs with their CoreAudio UIDs (read-only: nothing is opened or changed).
 * Nothing polls: the running mpv core reports hotplug; without a core the list is read once, on demand,
 * by a short `mpv --audio-device=help`.
 */
export function createOutputDevices(source?: OutputDeviceSource): {
  list(): Promise<OutputDevice[]>;
  onChanged(listener: () => void): () => void;
} {
  let last = "";
  const remember = (devices: OutputDevice[]) => {
    last = JSON.stringify(devices);
    return devices;
  };
  const read = async () => (await source?.list()) ?? (await defaultList());
  const list = async () => remember(await read());
  return {
    list,
    onChanged(listener) {
      if (!source) return () => {};
      return source.onChanged(() => {
        // mpv notifies on any change of its device list; the callers only want real changes.
        void read()
          .then((devices) => {
            if (JSON.stringify(devices) === last) return;
            remember(devices);
            listener();
          })
          .catch(() => {});
      });
    },
  };
}

function defaultList(): Promise<OutputDevice[]> {
  const mpv = findMpv();
  return mpv ? listWithMpv(mpv) : Promise.resolve([]);
}
