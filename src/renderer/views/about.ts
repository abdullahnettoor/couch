import type { ScreenPayload } from "../../shared/protocol.ts";
import { el } from "./dom.ts";
import { glassRow, splitPage } from "./glass.ts";

/** Settings → About: the version as a line focus never lands on, then Check for updates, Restart to update and Beta updates. */
export function render(payload: ScreenPayload): void {
  const about = payload.about;
  const version = el("div", "g-row g-row-note");
  const value = el("span", "v");
  value.append(document.createTextNode(about?.version ?? ""));
  version.append(el("span", "g-row-label", "Version"), value);
  splitPage(
    { icon: "gear" },
    [
      el("h1", "", "About"),
      version,
      ...payload.grid.map((item) =>
        glassRow({
          id: item.id,
          label: item.label,
          focused: item.id === payload.focusedId,
          value:
            item.id === "check"
              ? about?.check
              : item.id === "beta"
                ? about?.beta
                  ? "On"
                  : "Off"
                : undefined,
          chevron: item.id === "restart",
        }),
      ),
      ...(about?.hint ? [el("p", "details-hint", about.hint)] : []),
    ],
    { to: "settings" },
  );
}
