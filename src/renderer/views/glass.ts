import { iconSvg, type IconName } from "../../shared/icons.ts";
import type { ScreenPayload } from "../../shared/protocol.ts";
import { el, focusable, root } from "./dom.ts";

/** The top-right strip: phone count, gear (focusable id "settings"), clock. */
export function topbar(payload: ScreenPayload): HTMLElement {
  const n = payload.state.remotes;
  const time = new Date(payload.now)
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    .replace(/\s?[AP]M/i, "");
  const bar = el(
    "div",
    "topbar",
    `<div class="phones${n > 0 ? "" : " none"}"><i></i>${
      n > 0 ? `${n} ${n === 1 ? "phone" : "phones"} connected` : "No phone connected"
    }</div>`,
  );
  bar.append(
    focusable(
      el("button", `tb-gear${payload.focusedId === "settings" ? " focused" : ""}`, iconSvg("gear")),
      "settings",
    ),
    el("div", "clock num", time),
  );
  return bar;
}

export interface RowOptions {
  id: string;
  label: string;
  focused: boolean;
  /** Right-hand text, shown before the chevron. */
  value?: string;
  danger?: boolean;
  /** Draw the chevron (default true). */
  chevron?: boolean;
}

/** A Glass list row: solid white when focused, red for danger rows. */
export function glassRow(o: RowOptions): HTMLElement {
  const row = el("button", `g-row${o.danger ? " danger" : ""}${o.focused ? " focused" : ""}`);
  const label = el("span", "");
  label.textContent = o.label;
  const value = el("span", "v");
  if (o.value) value.append(document.createTextNode(o.value));
  if (o.chevron !== false) value.insertAdjacentHTML("beforeend", iconSvg("chev"));
  row.append(label, value);
  return focusable(row, o.id);
}

/** A Glass pill button, e.g. Done. */
export function glassPill(
  id: string,
  label: string,
  focused: boolean,
  icon?: IconName,
): HTMLElement {
  const pill = el("button", `g-pill${focused ? " focused" : ""}`, icon ? iconSvg(icon) : "");
  pill.append(document.createTextNode(label));
  return focusable(pill, id);
}

/** Big art on the left, content on the right. `art` is an icon name or ready-made HTML (QR). */
export function splitPage(
  art: { icon: IconName } | { html: string },
  content: HTMLElement[],
): void {
  root.replaceChildren();
  const page = el("div", "screen-glass");
  page.append(
    "icon" in art
      ? el("div", "split-art", iconSvg(art.icon))
      : el("div", "split-art qr-art", art.html),
  );
  const list = el("div", "split-list");
  list.append(...content);
  page.append(list);
  root.append(page);
}
