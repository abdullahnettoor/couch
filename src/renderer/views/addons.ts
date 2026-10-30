import type { ScreenPayload } from "../../shared/protocol.ts";
import { el } from "./dom.ts";
import { glassRow, splitPage } from "./glass.ts";

/** "YouTube add-ons": one row per add-on with On/Off, and its one-line description under the list. */
export function render(payload: ScreenPayload): void {
  const addons = payload.addons ?? [];
  splitPage(
    { icon: "gear" },
    [
      el("h1", "", "YouTube add-ons"),
      ...addons.map((a) =>
        glassRow({
          id: a.id,
          label: a.label,
          focused: a.id === payload.focusedId,
          value: a.on ? "On" : "Off",
          chevron: false,
        }),
      ),
      ...addons.map((a) => el("p", "details-hint", `${a.label}: ${a.description}`)),
    ],
    { to: "settingsApps" },
  );
}
