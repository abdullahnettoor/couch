import { SETTINGS_ITEMS } from "../../shared/settings-grid.ts";
import type { ScreenPayload } from "../../shared/protocol.ts";
import { el } from "./dom.ts";
import { glassRow, splitPage } from "./glass.ts";

export function render(payload: ScreenPayload): void {
  const phones = payload.state.remotes;
  const l = payload.listener;
  splitPage({ icon: "gear" }, [
    el("h1", "", "Settings"),
    ...SETTINGS_ITEMS.map((item) =>
      glassRow({
        id: item.id,
        label: item.label,
        focused: item.id === payload.focusedId,
        danger: item.id === "quit",
        value:
          item.id === "add-phone"
            ? "Show the QR code"
            : item.id === "forget-phones" && phones > 0
              ? `${phones} connected`
              : item.id === "details"
                ? payload.details?.hint
                : item.id === "listener"
                  ? payload.listener?.on
                    ? "On"
                    : "Off"
                  : undefined,
      }),
    ),
    ...(l
      ? [
          el(
            "p",
            "details-hint",
            l.available
              ? l.running
                ? "Listener running · Couch will stay reachable"
                : "Listener off"
              : "Available in the installed Couch.app",
          ),
        ]
      : []),
  ]);
}
