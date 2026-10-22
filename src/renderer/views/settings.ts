import { SETTINGS_ITEMS } from "../../shared/settings-grid.ts";
import type { ScreenPayload } from "../../shared/protocol.ts";
import { el } from "./dom.ts";
import { glassRow, splitPage } from "./glass.ts";

export function render(payload: ScreenPayload): void {
  splitPage({ icon: "gear" }, [
    el("h1", "", "Settings"),
    ...SETTINGS_ITEMS.map((item) =>
      glassRow({
        id: item.id,
        label: item.label,
        focused: item.id === payload.focusedId,
        danger: item.id === "quit",
        value:
          item.id === "remotes" && payload.state.remotes > 0
            ? `${payload.state.remotes} connected`
            : item.id === "library"
              ? payload.details?.hint
              : item.id === "sound"
                ? payload.sound?.label
                : undefined,
      }),
    ),
  ]);
}
