import { HOME_ITEMS } from "../../shared/home-grid.ts";
import type { ScreenPayload } from "../../shared/protocol.ts";
import { el, qrSvg, root } from "./dom.ts";

export const ICONS: Record<string, string> = {
  youtube: '<svg viewBox="0 0 24 24"><path d="M9 7.5v9l7.5-4.5z" fill="currentColor"/></svg>',
  library:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 012-2h4l2 2.5h8a2 2 0 012 2V17a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>',
  settings:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>',
};

function greeting(date: Date): string {
  const h = date.getHours();
  return h < 5
    ? "Good night"
    : h < 12
      ? "Good morning"
      : h < 17
        ? "Good afternoon"
        : "Good evening";
}

export function render(payload: ScreenPayload): void {
  const date = new Date(payload.now);
  root.replaceChildren();
  const view = el("div", "view home");
  view.append(
    el(
      "div",
      "ha-clock",
      `<div class="t">${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M/i, "")}</div>` +
        `<div class="d">${greeting(date)} · ${date.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</div>`,
    ),
  );
  const status = el(
    "div",
    "status",
    `<span class="dot"></span>${
      payload.state.remotes > 0
        ? `${payload.state.remotes} ${payload.state.remotes === 1 ? "phone" : "phones"} connected`
        : "No phone connected"
    }`,
  );
  const row = el("div", "ha-row");
  for (const item of HOME_ITEMS) {
    const focused = item.id === payload.focusedId ? " focused" : "";
    if (item.id === "settings") {
      view.append(el("div", `gear${focused}`, ICONS.settings));
    } else {
      row.append(
        el(
          "div",
          `ha-app${focused}`,
          `<div class="app-icon ${item.id}-bg">${ICONS[item.id]}</div><div class="n">${item.label}</div>`,
        ),
      );
    }
  }
  view.append(status, row);
  if (payload.state.remotes === 0) {
    view.append(
      el(
        "div",
        "qr-card",
        `<div class="qr">${qrSvg(payload.pairingUrl)}</div><div class="c">Scan to use your phone as a remote</div>`,
      ),
    );
  }
  const card = payload.continueCard;
  if (card?.progress) {
    const focused = payload.focusedId === "continue" ? " focused" : "";
    const c = el(
      "div",
      `continue-card${focused}`,
      `<div class="k">Continue watching</div><div class="t">${escapeHtml(card.title)}</div>` +
        `<div class="m">${escapeHtml(card.progress.left)} · ${escapeHtml(card.folder ?? "")}</div>` +
        `<div class="bar"><i style="width:${Math.round(card.progress.fraction * 100)}%"></i></div>`,
    );
    view.classList.add("has-continue");
    view.append(c);
  }
  root.append(view);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}
