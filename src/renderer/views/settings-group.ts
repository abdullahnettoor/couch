import type { ScreenPayload, View } from "../../shared/protocol.ts";
import { VIEW_LABELS } from "../../shared/protocol.ts";
import { appEntry } from "../../main/apps/index.ts";
import { el } from "./dom.ts";
import { glassRow, splitPage } from "./glass.ts";

/** A Settings group page (Remotes and Devices, Library, Apps) or an App's page: one row per item. */
export function render(payload: ScreenPayload): void {
  const view = payload.state.view;
  const l = payload.listener;
  const title =
    view === "settingsApp" ? (payload.appSettings?.label ?? "App") : VIEW_LABELS[view as View];
  const logo = view === "settingsApp" ? appEntry(payload.appSettings?.id)?.icon : undefined;
  splitPage(logo ? { logo } : { icon: "gear" }, [
    el("h1", "", title),
    ...payload.grid.map((item) =>
      glassRow({
        id: item.id,
        label: item.label,
        focused: item.id === payload.focusedId,
        value: rowValue(item.id, payload),
        logo: view === "settingsApps" ? appEntry(item.id)?.icon : undefined,
      }),
    ),
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
