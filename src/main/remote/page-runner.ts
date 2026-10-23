import vm from "node:vm";
import { REMOTE_PAGE } from "./page.ts";

export const PAGE_HTML = REMOTE_PAGE.slice(0, REMOTE_PAGE.indexOf("<script>"));
const script = REMOTE_PAGE.slice(
  REMOTE_PAGE.indexOf("<script>") + 8,
  REMOTE_PAGE.indexOf("</script>"),
);

export interface FakeSocket {
  onmessage?: (e: { data: string }) => void;
  onopen?: () => void;
}

/** Runs the page's script in a VM with browser globals and a fake socket; callers supply document and any extra globals. */
export function runPage(globals: Record<string, unknown>) {
  const sent: string[] = [];
  const sockets: FakeSocket[] = [];
  class WS {
    onmessage?: (e: { data: string }) => void;
    onopen?: () => void;
    constructor() {
      sockets.push(this);
    }
    send(m: string) {
      sent.push(m);
    }
  }
  vm.runInNewContext(script, {
    WebSocket: WS,
    location: { search: "", protocol: "http:", host: "x", pathname: "/" },
    history: { replaceState() {} },
    localStorage: { getItem: () => "k", setItem() {} },
    navigator: {},
    URLSearchParams,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    encodeURIComponent,
    Number,
    String,
    console,
    Promise,
    ...globals,
  });
  return { sent, sockets };
}
