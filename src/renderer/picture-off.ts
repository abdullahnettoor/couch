import { PICTURE_OFF_CSS, PICTURE_OFF_MARK } from "../shared/picture-off.ts";
import type { ScreenPayload } from "../shared/protocol.ts";

const cover = document.getElementById("picture-off")!;
document.head.append(
  Object.assign(document.createElement("style"), {
    textContent: `${PICTURE_OFF_CSS}\n#picture-off { z-index:20; }`,
  }),
);
cover.innerHTML = PICTURE_OFF_MARK;

/** Picture off: a black cover over the whole renderer (the video and every view). Only covers; nothing else is touched. */
export function renderPictureOff(payload: ScreenPayload): void {
  cover.hidden = !payload.state.pictureOff;
}
