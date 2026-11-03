import type { ScreenPayload } from "../../shared/protocol.ts";
import { INTERFACE_SOUNDS_ID as INTERFACE_SOUNDS } from "../../shared/settings-grid.ts";
import { el } from "./dom.ts";
import { glassRow, splitPage } from "./glass.ts";

/** "Sound output": System default, then each device; the one in use is marked. Interface sounds' On/Off comes last. */
export function render(payload: ScreenPayload): void {
  const sound = payload.sound;
  const devices = payload.grid.filter((item) => item.id !== INTERFACE_SOUNDS);
  const toggle = payload.grid.find((item) => item.id === INTERFACE_SOUNDS);
  splitPage(
    { icon: "speaker" },
    [
      el("h1", "", "Sound output"),
      ...devices.map((item) =>
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
      ...(toggle
        ? [
            glassRow({
              id: toggle.id,
              label: toggle.label,
              focused: toggle.id === payload.focusedId,
              value: payload.interfaceSounds ? "On" : "Off",
              chevron: false,
            }),
          ]
        : []),
      ...(sound?.hint ? [el("p", "details-hint", sound.hint)] : []),
    ],
    { to: "settings" },
  );
}
