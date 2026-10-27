import type { ScreenPayload, View } from "../../shared/protocol.ts";
import { VIEW_LABELS } from "../../shared/protocol.ts";
import { homeAppSwitch } from "../../shared/home-apps.ts";
import { el, root } from "./dom.ts";
import { glassRow, splitPage } from "./glass.ts";

/** A Settings group page (Remotes and Devices, Library, Apps) or an App's page: one row per item. */
export function render(payload: ScreenPayload): void {
  const view = payload.state.view;
  const l = payload.listener;
  const menu = view === "settingsApps" ? payload.appMenu : undefined;
  const rows =
    view === "settingsApps"
      ? (payload.homeApps ?? []).map((a) =>
          glassRow({
            id: a.id,
            label: a.label,
            focused: menu ? false : a.id === payload.focusedId,
            marked: a.id === menu?.id,
            switch: homeAppSwitch(payload.homeApps, a.id),
            logo: a.icon || undefined,
          }),
        )
      : payload.grid.map((item) =>
          glassRow({
            id: item.id,
            label: item.label,
            focused: item.id === payload.focusedId,
            value: rowValue(item.id, payload),
          }),
        );
  splitPage({ icon: "gear" }, [
    el("h1", "", VIEW_LABELS[view as View]),
    ...rows,
    ...(view === "settingsRemotes" && l
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
  if (menu) {
    const box = el("div", "g-menu");
    box.append(
      el("h2", "", menu.label),
      ...payload.grid.map((item) =>
        glassRow({
          id: item.id,
          label: item.label,
          focused: item.id === payload.focusedId,
          chevron: false,
        }),
      ),
    );
    root.append(box);
  }
}

function rowValue(id: string, payload: ScreenPayload): string | undefined {
  switch (id) {
    case "add-phone":
      return "Show the QR code";
    case "forget-phones":
      return payload.state.remotes > 0 ? `${payload.state.remotes} connected` : undefined;
    case "listener":
      return payload.listener?.on ? "On" : "Off";
    case "details":
      return payload.details?.hint;
    case "addons":
      return `${payload.addons?.filter((a) => a.on).length ?? 0} on`;
    default:
      return undefined;
  }
}
