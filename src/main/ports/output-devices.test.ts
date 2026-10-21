import { expect, test } from "vite-plus/test";
import { createOutputDevices, parseOutputDevices } from "./output-devices.ts";
import { parseAudioDeviceList } from "../mpv/mpv-player.ts";

// What `mpv --audio-device=help` and mpv's `audio-device-list` property printed on this Mac.
const HELP = `List of detected audio devices:
  'auto' (Autoselect device)
  'coreaudio/30AEC067-0000-0000-1A24-0104B53C2278' (L27h-4A)
  'coreaudio/9C-43-1E-02-83-31:output' (Abdu's Rockerz 333ANC)
  'avfoundation/30AEC067-0000-0000-1A24-0104B53C2278' (L27h-4A)
`;
const PROPERTY = [
  { name: "auto", description: "Autoselect device" },
  { name: "coreaudio/30AEC067-0000-0000-1A24-0104B53C2278", description: "L27h-4A" },
  { name: "coreaudio/9C-43-1E-02-83-31:output", description: "Abdu's Rockerz 333ANC" },
  { name: "avfoundation/30AEC067-0000-0000-1A24-0104B53C2278", description: "L27h-4A" },
];
const EXPECTED = [
  { uid: "30AEC067-0000-0000-1A24-0104B53C2278", name: "L27h-4A" },
  { uid: "9C-43-1E-02-83-31:output", name: "Abdu's Rockerz 333ANC" },
];

test("recorded mpv device lists reduce to the CoreAudio outputs", () => {
  expect(parseOutputDevices(HELP)).toEqual(EXPECTED);
  expect(parseAudioDeviceList(PROPERTY)).toEqual(EXPECTED);
});

test("the source's change events reach listeners only when the list really changed, with no timers", async () => {
  let devices = [EXPECTED[0]!];
  let fire = () => {};
  const outputs = createOutputDevices({
    list: () => Promise.resolve(devices),
    onChanged: (l) => {
      fire = l;
      return () => {};
    },
  });
  expect(await outputs.list()).toEqual([EXPECTED[0]]);
  let told = 0;
  outputs.onChanged(() => told++);
  fire();
  await new Promise((r) => setTimeout(r, 10));
  expect(told).toBe(0);
  devices = [...EXPECTED];
  fire();
  await new Promise((r) => setTimeout(r, 10));
  expect(told).toBe(1);
});
