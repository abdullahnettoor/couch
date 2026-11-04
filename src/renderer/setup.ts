import { confirmMouseCommand, describeConfirm } from "../shared/confirm-layout.ts";
import type { ScreenPayload } from "../shared/protocol.ts";
import { setupControls } from "../shared/setup-controls.ts";
import { qrSvg } from "./views/dom.ts";

const panel = document.getElementById("setup")!;
let drawn = "";

const px = (n: number) => `calc(${n} * var(--u))`;

/** Setup's panel: step dots, the step's words and Couch's usual question buttons, over Home's wallpaper. */
export function renderSetup(payload: ScreenPayload): void {
  const s = payload.setup;
  const key = s ? JSON.stringify([s, s.qr ? payload.pairingUrl : ""]) : "";
  if (key === drawn) return;
  drawn = key;
  panel.classList.toggle("show", Boolean(s));
  panel.replaceChildren();
  if (!s) return;
  const box = document.createElement("div");
  box.className = "box glass";
  const dots = document.createElement("div");
  dots.className = "dots";
  for (let i = 0; i < s.steps; i++) {
    const dot = document.createElement("i");
    dot.className = i === s.step ? "on" : "";
    dots.append(dot);
  }
  const title = document.createElement("b");
  title.textContent = s.title;
  box.append(dots, title);
  if (s.body) {
    const body = document.createElement("p");
    body.textContent = s.body;
    box.append(body);
  }
  if (s.qr) {
    const qr = document.createElement("div");
    qr.className = "qr";
    qr.innerHTML = qrSvg(payload.pairingUrl);
    box.append(qr);
  }
  if (s.tips) {
    const tips = document.createElement("ul");
    for (const tip of s.tips) {
      const item = document.createElement("li");
      item.textContent = tip;
      tips.append(item);
    }
    box.append(tips);
  }
  if (s.list?.length) {
    const list = document.createElement("ul");
    list.className = "list";
    for (const entry of s.list) {
      const item = document.createElement("li");
      item.textContent = entry;
      list.append(item);
    }
    box.append(list);
  }
  const controls = setupControls(s);
  const lead = controls.filter((c) => c.on !== undefined).length;
  if (s.switches?.length) {
    const list = document.createElement("div");
    list.className = "switches";
    s.switches.forEach((sw, i) => {
      const item = document.createElement("div");
      item.className = i === s.focus ? "row focused" : "row";
      const label = document.createElement("span");
      label.textContent = sw.label;
      const toggle = document.createElement("i");
      toggle.className = sw.on ? "g-switch on" : "g-switch";
      item.append(label, toggle);
      item.addEventListener("mouseenter", () => window.couch.send(confirmMouseCommand("hover", i)));
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        window.couch.send(confirmMouseCommand("click", i));
      });
      list.append(item);
    });
    box.append(list);
  }
  const row = document.createElement("div");
  row.className = "buttons";
  const view = describeConfirm({ title: s.title, buttons: s.buttons, focus: s.focus - lead }, px);
  for (const button of view.buttons) {
    const b = document.createElement("span");
    b.textContent = button.label;
    for (const [k, v] of Object.entries(button.style)) b.style.setProperty(k, v);
    b.addEventListener("mouseenter", () =>
      window.couch.send(confirmMouseCommand("hover", lead + button.index)),
    );
    b.addEventListener("click", (event) => {
      event.stopPropagation();
      window.couch.send(confirmMouseCommand("click", lead + button.index));
    });
    row.append(b);
  }
  box.append(row);
  panel.append(box);
}
