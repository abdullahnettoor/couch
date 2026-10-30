import { clockParts } from "../../shared/clock-format.ts";
import { iconSvg, type IconName } from "../../shared/icons.ts";
import { VIEW_LABELS, type ScreenPayload, type View } from "../../shared/protocol.ts";
import { el, focusable, root } from "./dom.ts";

/** The top-right strip: phone count, gear (focusable id "settings"), clock. */
export function topbar(payload: ScreenPayload): HTMLElement {
  const n = payload.state.remotes;
  const { time, suffix } = clockParts(payload.now, payload.timeFormat);
  const bar = el(
    "div",
    "topbar",
    `<div class="phones${n > 0 ? "" : " none"}"><i></i>${
      n > 0 ? `${n} ${n === 1 ? "phone" : "phones"} connected` : "No phone connected"
    }</div>`,
  );
  if (payload.state.view === "library") {
    bar.append(
      focusable(
        el(
          "button",
          `tb-gear${payload.focusedId === "search" ? " focused" : ""}`,
          iconSvg("search"),
        ),
        "search",
      ),
    );
  }
  bar.append(
    focusable(
      el("button", `tb-gear${payload.focusedId === "settings" ? " focused" : ""}`, iconSvg("gear")),
      "settings",
    ),
    el("div", "clock num", `${time}${suffix ? `<small>${suffix}</small>` : ""}`),
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
  /** An App's logo (SVG markup), shown before the label. */
  logo?: string;
  /** A switch in place of the value: on or off. */
  switch?: "on" | "off";
  /** The row a menu is open for. */
  marked?: boolean;
}

/** A Glass list row: solid white when focused, red for danger rows. */
export function glassRow(o: RowOptions): HTMLElement {
  const row = el(
    "button",
    `g-row${o.danger ? " danger" : ""}${o.focused ? " focused" : ""}${o.marked ? " marked" : ""}`,
  );
  const label = el("span", "g-row-label");
  if (o.logo) label.insertAdjacentHTML("beforeend", `<span class="g-row-logo">${o.logo}</span>`);
  label.append(document.createTextNode(o.label));
  const value = el("span", "v");
  if (o.value) value.append(document.createTextNode(o.value));
  if (o.switch) {
    const sw = el("span", `g-switch ${o.switch}`);
    sw.setAttribute("role", "switch");
    sw.setAttribute("aria-checked", String(o.switch === "on"));
    value.append(sw);
  }
  if (o.chevron !== false) value.insertAdjacentHTML("beforeend", iconSvg("chev"));
  row.append(label, value);
  return focusable(row, o.id);
}

export interface BackOptions {
  /** The view Back goes to; it names the link. */
  to: View;
  /** An overlay is open over the page: the link sits under it and does nothing. */
  covered?: boolean;
  /** Names the place Back returns to when it isn't the view's own name (e.g. an App's menu over the Apps list). */
  label?: string;
}

let shown: ScreenPayload | undefined;
/** The payload being drawn, so every back link (including Settings' own) knows when something covers it. */
export function showing(payload: ScreenPayload): void {
  shown = payload;
}

/** "‹ Settings": a small line above a page's title that sends Back. Not a grid item, so the D-pad never lands on it. */
export function backLink(
  to: View,
  covered = false,
  label = VIEW_LABELS[to],
  corner = false,
): HTMLElement {
  const link = el("button", corner ? "g-back corner" : "g-back") as HTMLButtonElement;
  link.append(document.createTextNode(`‹ ${label}`));
  link.setAttribute("aria-label", `Back to ${label}`);
  link.tabIndex = -1;
  link.disabled = covered || (shown !== undefined && overlayOpen(shown));
  link.addEventListener("click", () => window.couch.send({ command: "back" }));
  return link;
}

/** Something is drawn over the page, so the link under it must not take clicks: a confirmation, Quick settings, the Apps menu, Picture off. */
export function overlayOpen(payload: ScreenPayload): boolean {
  return (
    payload.state.confirm !== undefined ||
    payload.quick !== undefined ||
    payload.appMenu !== undefined ||
    payload.state.pictureOff
  );
}

/** The back link for pages with a layout of their own: pinned to the page's top-left, so nothing moves. The label is the core's (`payload.back`); a page the core gives none has no link. */
export function cornerBack(payload: ScreenPayload): HTMLElement[] {
  if (!payload.back) return [];
  return [backLink("library", overlayOpen(payload), payload.back.label, true)];
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

type SplitArt =
  | { icon: IconName }
  | { image: string; alt: string }
  | { html: string }
  | { logo: string };

/** Big art on the left, content on the right. `art` is an icon name, an image, or ready-made HTML (QR). */
export function splitPage(art: SplitArt, content: HTMLElement[], back?: BackOptions): void {
  root.replaceChildren();
  const page = el("div", "screen-glass");
  page.append(splitArt(art));
  const list = el("div", "split-list");
  if (back) list.append(backLink(back.to, back.covered, back.label));
  list.append(...content);
  page.append(list);
  root.append(page);
}

function splitArt(art: SplitArt) {
  if ("icon" in art) return el("div", "split-art", iconSvg(art.icon));
  if ("logo" in art) return el("div", "split-art logo-art", art.logo);
  if ("html" in art) return el("div", "split-art qr-art", art.html);
  const img = el("img", "") as HTMLImageElement;
  img.src = art.image;
  img.alt = art.alt;
  const box = el("div", "split-art image-art");
  box.append(img);
  return box;
}
