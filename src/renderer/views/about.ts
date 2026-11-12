import type { ScreenPayload } from "../../shared/protocol.ts";
import { el, qrSvg, root } from "./dom.ts";
import { glassPill, glassRow, splitPage } from "./glass.ts";

/** Settings → About: the version as a line focus never lands on, then Check for updates, Restart to update and Beta updates. */
export function render(payload: ScreenPayload): void {
  const about = payload.about;
  const version = el("div", "g-row g-row-note");
  const value = el("span", "v");
  value.append(document.createTextNode(about?.version ?? ""));
  version.append(el("span", "g-row-label", "Version"), value);
  const support = about?.support;
  const open = !!support?.open;
  splitPage(
    { icon: "gear" },
    [
      el("h1", "", "About"),
      version,
      ...payload.grid
        .filter((item) => item.id !== "support-close")
        .map((item) =>
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
      ...(support && !open ? [el("p", "details-hint support-line", support.line)] : []),
      ...(about?.hint ? [el("p", "details-hint", about.hint)] : []),
    ],
    { to: "settings" },
  );
  if (support && open) root.append(supportPanel(payload, support));
}

/** The glass panel over About: the QR code for the address, the line, the address in short text and Close. */
function supportPanel(
  payload: ScreenPayload,
  support: NonNullable<NonNullable<ScreenPayload["about"]>["support"]>,
): HTMLElement {
  const box = el("div", "support-box");
  box.append(
    el("div", "support-qr", qrSvg(support.url)),
    el("h2", "support-title", "Support Couch"),
    el("p", "support-text", support.line),
    el("p", "support-url", support.short),
    glassPill("support-close", "Close", payload.focusedId === "support-close"),
  );
  const panel = el("div", "support-panel");
  panel.append(box);
  return panel;
}
