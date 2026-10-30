import type { ScreenPayload } from "../../shared/protocol.ts";
import { el, focusable, root } from "./dom.ts";
import { cornerBack, glassRow } from "./glass.ts";

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Fix match: the top TMDB results (name, year, poster) and "Use video frames". */
export function render(payload: ScreenPayload): void {
  const fix = payload.fixMatch;
  if (!fix) return;
  root.replaceChildren();
  const page = el("div", "screen-glass");
  const box = el("div", "fm-box");
  box.append(el("h1", "", `Fix match<small>${escape(fix.name)}</small>`));
  if (fix.loading) box.append(el("p", "fm-note", "Looking for matches…"));
  else if (!fix.options.length) box.append(el("p", "fm-note", "No matches found."));
  for (const o of fix.options) {
    const node = el(
      "button",
      `g-row fm-row${payload.focusedId === o.id ? " focused" : ""}`,
      `<div class="fm-poster">${o.poster ? `<img src="${escape(o.poster)}" alt="">` : ""}</div><span>${escape(o.name)}</span><span class="v">${o.year ?? ""}</span>`,
    );
    box.append(focusable(node, o.id));
  }
  box.append(
    glassRow({
      id: "frames",
      label: "Use video frames",
      focused: payload.focusedId === "frames",
      chevron: false,
    }),
  );
  page.append(box, ...cornerBack(payload));
  root.append(page);
}
