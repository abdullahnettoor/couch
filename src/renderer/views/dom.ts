import QRCode from "qrcode";
import type { ScreenPayload } from "../../shared/protocol.ts";

export const root = document.getElementById("screen")!;

export interface ViewModule {
  /** Draw this view into #screen. */
  render(payload: ScreenPayload): void;
}

export function el(tag: string, className: string, html = ""): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.innerHTML = html;
  return node;
}

/** A QR code as inline SVG markup. */
export function qrSvg(text: string): string {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  let path = "";
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) if (qr.modules.get(x, y)) path += `M${x + 2} ${y + 2}h1v1h-1z`;
  return `<svg viewBox="0 0 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#16130f"/></svg>`;
}
