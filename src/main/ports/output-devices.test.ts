import { afterEach, expect, test, vi } from "vite-plus/test";
import { createOutputDevices, parseOutputDevices } from "./output-devices.ts";

afterEach(() => vi.useRealTimers());

const HELP = `List of detected audio devices:
  'auto' (Autoselect device)
  'coreaudio/30AEC067-0000-0000-1A24-0104B53C2278' (L27h-4A)
  'coreaudio/9C-43-1E-02-83-31:output' (Abdu's Rockerz 333ANC)
  'coreaudio/~:AMS2_StackedOutput:0' (Multi-Output Device)
  'avfoundation/30AEC067-0000-0000-1A24-0104B53C2278' (L27h-4A)
`;

test("reads CoreAudio outputs from mpv's device list, leaving out auto and avfoundation", () => {
  expect(parseOutputDevices(HELP)).toEqual([
    { uid: "30AEC067-0000-0000-1A24-0104B53C2278", name: "L27h-4A" },
    { uid: "9C-43-1E-02-83-31:output", name: "Abdu's Rockerz 333ANC" },
    { uid: "~:AMS2_StackedOutput:0", name: "Multi-Output Device" },
  ]);
});

test("tells listeners only when the list changes, and stops polling with the last listener", async () => {
  vi.useFakeTimers();
  let devices = [{ uid: "a", name: "A" }];
  const calls = vi.fn(() => Promise.resolve(devices));
  const outputs = createOutputDevices(calls);
  const changed = vi.fn();
  await outputs.list();
  const off = outputs.onChanged(changed);
  await vi.advanceTimersByTimeAsync(5000);
  expect(changed).not.toHaveBeenCalled();
  devices = [...devices, { uid: "b", name: "B" }];
  await vi.advanceTimersByTimeAsync(5000);
  expect(changed).toHaveBeenCalledTimes(1);
  off();
  const seen = calls.mock.calls.length;
  await vi.advanceTimersByTimeAsync(20000);
  expect(calls.mock.calls.length).toBe(seen);
});
