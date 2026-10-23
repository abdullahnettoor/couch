import { pageFocusFunction } from "../../web/page-focus.ts";
import { runFocusScript } from "../../web/page-focus-runner.ts";
import { snapshotPage, type FakeEl, type Snapshot } from "../../web/snapshot-page.ts";
import { netflixDescription } from "./netflix-web.ts";

export const netflixDesc = netflixDescription("130.0.6723.58");

/** Connect or disconnect an element and everything under it, as a pop-up or row the page adds and removes. */
export function connect(el: FakeEl, on: boolean) {
  el.connected = on;
  el.children.forEach((c) => connect(c, on));
}

/** The Netflix page focus script as the App runs it, on a snapshot; keys go through the page's own listeners. */
export function netflixPage(
  snap: Snapshot,
  focus = netflixDesc.focus!,
  /** Shapes the page (hides a pop-up, a row) before the script starts and sees it. */
  prepare?: (page: ReturnType<typeof snapshotPage>) => void,
) {
  const page = snapshotPage(snap);
  prepare?.(page);
  const run = runFocusScript(pageFocusFunction(focus.selectors, focus.layout), {
    document: page.doc,
    href: snap.url,
    width: snap.view.width,
    height: snap.view.height,
    scroll: page.scroll,
    getComputedStyle: (e: FakeEl) => ({
      visibility: e.hiddenStyle ? "hidden" : "visible",
      display: "block",
      zIndex: "auto",
      position: e.stuck ? "fixed" : "static",
    }),
  });
  /** OK: the element that was clicked, if any. */
  const ok = (): FakeEl | undefined => {
    const before = new Map(page.all.map((e) => [e, e.clicks]));
    run.key("Enter");
    return page.all.find((e) => e.clicks > before.get(e)!);
  };
  /** The element the ring is on (OK clicks it; the click is undone). */
  const on = (): FakeEl | undefined => {
    const el = ok();
    if (el) el.clicks--;
    return el;
  };
  return { ...page, ...run, ok, on };
}
