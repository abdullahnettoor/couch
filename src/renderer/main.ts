import { HOME_ITEMS } from "../shared/home-grid.ts";
import type { CouchApi } from "../shared/ipc.ts";
import type { CommandName, GridItem, ScreenPayload } from "../shared/protocol.ts";
import "./style.css";

declare global {
  interface Window {
    couch: CouchApi;
  }
}

const KEYS: Record<string, CommandName> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Enter: "ok",
  Escape: "back",
  Backspace: "back",
  h: "home",
  H: "home",
  " ": "playpause",
};

window.addEventListener("keydown", (event) => {
  const command = KEYS[event.key];
  if (!command) return;
  event.preventDefault();
  window.couch.send({ command });
});

const root = document.getElementById("screen")!;
const toast = document.getElementById("toast")!;
const notice = document.getElementById("notice")!;

const ICONS: Record<string, string> = {
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

function el(tag: string, className: string, html = ""): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.innerHTML = html;
  return node;
}

function renderHome(payload: ScreenPayload): void {
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
  root.append(view);
}

let lastViewKey = "";
window.couch.onScreen((payload) => {
  if (payload.viewKey !== lastViewKey || payload.grid.length === 0) {
    lastViewKey = payload.viewKey;
    const grids: Record<string, GridItem[]> = { home: HOME_ITEMS };
    const items = grids[payload.viewKey];
    if (items && payload.grid.length === 0) {
      window.couch.reportGrid({ viewKey: payload.viewKey, items });
    }
  }
  if (payload.state.view === "home") renderHome(payload);
  toast.textContent = payload.state.toast ?? "";
  toast.classList.toggle("show", Boolean(payload.state.toast));
});

window.couch.onMpv((status) => {
  notice.hidden = !status.missing && !status.message;
  notice.textContent = status.missing
    ? "Couch needs mpv to play videos. Install it with: brew install mpv"
    : (status.message ?? "");
});
