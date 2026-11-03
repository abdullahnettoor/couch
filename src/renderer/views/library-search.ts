import type { LibraryRow, ScreenPayload } from "../../shared/protocol.ts";
import { designUnit } from "../../shared/design-unit.ts";
import { iconSvg } from "../../shared/icons.ts";
import { el, focusable, root } from "./dom.ts";
import { cornerBack, topbar } from "./glass.ts";
import { card, posterLabel } from "./library.ts";
import { typingSlot } from "./typing.ts";

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

function rowBlock(row: LibraryRow, payload: ScreenPayload): HTMLElement {
  const block = el("div", "lf-block", `<div class="lib-rowh">${escape(row.title)}</div>`);
  const shelf = el("div", "lf-shelf ls-shelf");
  const track = el("div", "lf-track");
  for (const e of row.entries) {
    const c = card(e, payload, false, row.poster ? "post" : "wide");
    if (row.poster) posterLabel(c, e);
    track.append(c);
  }
  shelf.append(track);
  block.append(shelf);
  return block;
}

/** Draws the Library search: the field with the live query, then Shows, Films and Episodes rows. */
export function render(payload: ScreenPayload): void {
  const search = payload.search;
  if (!search) return;
  const entering = !root.querySelector(".ls-page");
  root.replaceChildren();
  const page = el("div", "screen-glass ls-page");
  const onScreen = payload.screenTyping === "librarySearch";
  const typing = onScreen || search.typing;
  const field = focusable(
    el(
      "div",
      `ls-field g-pill glass${entering ? " drop" : ""}${payload.focusedId === "field" ? " focused" : ""}`,
      `${iconSvg("search")}${
        onScreen
          ? ""
          : `<span class="q${search.query ? "" : " ph"}">${
              search.query ? escape(search.query) : "Search your Library"
            }</span>${search.typing ? `<i class="caret"></i>` : ""}`
      }`,
    ),
    "field",
  );
  if (onScreen) field.append(typingSlot());
  if (typing) field.append(el("span", "hint", "Enter for results · Esc to close"));
  const body = el("div", "lib-body ls-body");
  if (search.rows.length) {
    for (const row of search.rows) body.append(rowBlock(row, payload));
  } else if (search.query.trim() && !search.searching) {
    // An empty query needs no prompt: the bar above already says what to do.
    const text = `Nothing matches “${escape(search.query.trim())}”`;
    body.append(el("div", "lib-empty glass", `${iconSvg("search")}<span>${text}</span>`));
  }
  page.append(field, body, topbar(payload), ...cornerBack(payload));
  if (search.searching) page.append(el("div", "ls-searching", "Searching…"));
  root.append(page);

  const focused = body.querySelector<HTMLElement>(".lib-card.focused");
  if (!focused) return;
  const block = focused.closest<HTMLElement>(".lf-block")!;
  body.scrollTop = block.offsetTop;
  const shelf = focused.closest<HTMLElement>(".lf-shelf")!;
  const edge = 120 * designUnit(window.innerWidth, window.innerHeight);
  if (focused.offsetLeft < shelf.scrollLeft) shelf.scrollLeft = focused.offsetLeft;
  else if (focused.offsetLeft + focused.offsetWidth + edge > shelf.scrollLeft + shelf.clientWidth)
    shelf.scrollLeft = focused.offsetLeft + focused.offsetWidth + edge - shelf.clientWidth;
}
