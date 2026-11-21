import type { PagePreload } from "../../web/web-app.ts";

/**
 * BitChord's page relay (what its Firefox extension's content script does): the page's bridge requests, window messages on
 * its channel addressed to the extension, go to the host through `couchHost.send`. Only the page's own window and origin count;
 * the host answers by posting the response envelope back as a window message.
 */
export const BITCHORD_RELAY: PagePreload = {
  name: "BitChord bridge relay",
  func: `function () {
  window.addEventListener('message', function (event) {
    if (event.source !== window || event.origin !== location.origin) return;
    var m = event.data;
    if (!m || m.channel !== 'bitchord-bridge' || m.direction !== 'to-extension') return;
    try { if (window.couchHost) window.couchHost.send({ type: 'bridge', request: m }); } catch (e) {}
  });
}`,
};
