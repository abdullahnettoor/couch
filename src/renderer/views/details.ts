import type { ScreenPayload } from "../../shared/protocol.ts";
import { el } from "./dom.ts";
import { glassRow, splitPage } from "./glass.ts";

/** "Show and film details": the TMDB key, On/Off, Refresh and Credits. */
export function render(payload: ScreenPayload): void {
  const d = payload.details;
  const typing = payload.state.typingBy !== undefined;
  const content = [
    el("h1", "", "Show and film details"),
    ...payload.grid.map((item) =>
      glassRow({
        id: item.id,
        label: item.label,
        focused: item.id === payload.focusedId,
        value:
          item.id === "own-key"
            ? typing
              ? "Typing on your phone…"
              : (d?.keyLabel ?? "")
            : item.id === "toggle"
              ? d?.enabled === false
                ? "Off"
                : "On"
              : undefined,
        chevron: item.id === "credits",
      }),
    ),
  ];
  if (d?.hint) content.push(el("p", "details-hint", d.hint));
  splitPage({ icon: "gear" }, content);
}
