import { confirmMouseCommand, describeConfirm } from "../shared/confirm-layout.ts";
import type { ScreenPayload } from "../shared/protocol.ts";
import { ICON_PATHS } from "../shared/icons.ts";

const toast = document.getElementById("toast")!;
const confirm = document.getElementById("confirm")!;
const volume = document.getElementById("volume")!;

volume.innerHTML = `<span class="n num"></span><div class="lvl"><i></i></div><svg class="i" viewBox="0 0 256 256">${ICON_PATHS.speaker}</svg>`;
const volumeNumber = volume.querySelector<HTMLElement>(".n")!;
const volumeFill = volume.querySelector<HTMLElement>(".lvl i")!;

/** Toast and volume level over the Screen; every view gets them for free. */
export function renderHud(payload: ScreenPayload): void {
  const level = Math.max(0, Math.min(100, Math.round(payload.state.volume)));
  volumeNumber.textContent = String(level);
  volumeFill.style.height = `${level}%`;
  volume.classList.toggle("show", Boolean(payload.state.volumeShown));
  if (payload.state.toast) toast.textContent = payload.state.toast;
  toast.classList.toggle("show", Boolean(payload.state.toast));
}

let confirmKey = "";
let shape = "";
let buttonEls: HTMLElement[] = [];

/** The question (Leave YouTube?, Quit Couch?) over every view; YouTube draws its own over the web view. */
export function renderConfirm(payload: ScreenPayload): void {
  const c = payload.state.confirm;
  const key = c ? `${c.title}|${c.body ?? ""}|${c.buttons.join("|")}|${c.focus}` : "";
  if (key === confirmKey) return;
  confirmKey = key;
  confirm.classList.toggle("show", Boolean(c));
  if (!c) {
    confirm.querySelector(".in")?.classList.remove("in");
    shape = "";
    return;
  }
  const same = `${c.title}|${c.body ?? ""}|${c.buttons.join("|")}`;
  if (same === shape && confirm.firstElementChild?.classList.contains("in")) {
    // Only the focus moved: keep the box, so its fade-in carries on instead of restarting at once.
    const d = describeConfirm(c, (n) => `calc(${n} * var(--u))`);
    d.buttons.forEach((button, i) => {
      for (const [k, v] of Object.entries(button.style)) buttonEls[i]?.style.setProperty(k, v);
    });
    return;
  }
  shape = same;
  buttonEls = [];
  const fresh = !confirm.firstElementChild?.classList.contains("in");
  confirm.replaceChildren();
  const d = describeConfirm(c, (n) => `calc(${n} * var(--u))`);
  const style = (el: HTMLElement, props: Record<string, string>) => {
    for (const [k, v] of Object.entries(props)) el.style.setProperty(k, v);
  };
  const box = document.createElement("div");
  box.className = "box glass";
  style(box, d.boxStyle);
  const title = document.createElement("b");
  title.textContent = d.title;
  const row = document.createElement("div");
  style(row, d.rowStyle);
  for (const button of d.buttons) {
    const b = document.createElement("span");
    b.textContent = button.label;
    style(b, button.style);
    b.addEventListener("mouseenter", () =>
      window.couch.send(confirmMouseCommand("hover", button.index)),
    );
    b.addEventListener("click", (event) => {
      event.stopPropagation();
      window.couch.send(confirmMouseCommand("click", button.index));
    });
    buttonEls.push(b);
    row.append(b);
  }
  if (d.body) {
    const body = document.createElement("span");
    body.textContent = d.body;
    style(body, d.bodyStyle);
    box.append(title, body, row);
  } else box.append(title, row);
  confirm.append(box);
  if (fresh) void box.offsetWidth;
  box.classList.add("in");
}
