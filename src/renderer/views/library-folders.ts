import type { ScreenPayload } from "../../shared/protocol.ts";
import { el } from "./dom.ts";
import { glassRow, splitPage } from "./glass.ts";

export function render(payload: ScreenPayload): void {
  splitPage(
    { icon: "folder" },
    [
      el("h1", "", "Library folders"),
      ...payload.grid.map((item) => {
        const focused = item.id === payload.focusedId;
        const add = item.id === "add";
        return glassRow({
          id: item.id,
          label: add ? "Add folder…" : item.label,
          focused,
          value: add ? "" : focused ? "OK to remove" : "",
          chevron: add,
        });
      }),
    ],
    { to: "settingsLibrary" },
  );
}
