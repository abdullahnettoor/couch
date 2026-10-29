import type { ScreenPayload } from "../../shared/protocol.ts";
import { el } from "./dom.ts";
import { glassRow, splitPage } from "./glass.ts";

/** "Sound output": System default, then each device; the one in use is marked. */
export function render(payload: ScreenPayload): void {
  const sound = payload.sound;
  splitPage({ icon: "speaker" }, [
    el("h1", "", "Sound output"),
    ...payload.grid.map((item) =>
      glassRow({
        id: item.id,
        label: item.label,
        focused: item.id === payload.focusedId,
        value:
          (item.id === "default" ? "default" : item.id.slice(4)) === sound?.selected
            ? "In use"
            : "",
        chevron: false,
      }),
    ),
    ...(sound?.notes ?? []).map((text) => el("div", "g-row g-row-note", text)),
    ...(sound?.hint ? [el("p", "details-hint", sound.hint)] : []),
  ]);
}
