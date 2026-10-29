import { MESSAGE_HANDLER_NAME } from "./webkit-messages.ts";

/**
 * `couchHost.send(message)`: the one way Couch's page scripts tell the host something, whatever engine draws the page.
 * The message is plain JSON of a shape `parsePageMessage` knows. Each host defines it its own way before the scripts run:
 * a WebKit view posts to its script message handler (in the `couch` content world, so the page can't call or spoof it),
 * Chromium logs it through the console, which its host already listens to.
 */
export const HOST_CONSOLE_PREFIX = "couch:host:";

/** WebKit: defined in the couch world, where the message handler exists. */
export const COUCH_HOST_WEBKIT = `function () {
  if (window.couchHost) return;
  var h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.${MESSAGE_HANDLER_NAME};
  if (!h) return;
  Object.defineProperty(window, 'couchHost', {
    value: Object.freeze({ send: function (m) { try { h.postMessage(m); } catch (e) {} } }),
    configurable: false
  });
}`;

/** Chromium: its host reads `console.debug` lines, so a message is one prefixed JSON line. */
export const COUCH_HOST_CONSOLE = `function () {
  if (window.couchHost) return;
  var debug = console.debug.bind(console);
  Object.defineProperty(window, 'couchHost', {
    value: Object.freeze({ send: function (m) { try { debug(${JSON.stringify(HOST_CONSOLE_PREFIX)} + JSON.stringify(m)); } catch (e) {} } }),
    configurable: false
  });
}`;

/** A real (trusted) mouse press on the page is the household's own input: the host cannot see it with a native view. */
export const MOUSE_INPUT_REPORTER = `function () {
  addEventListener('mousedown', function (e) {
    try { if (e.isTrusted && window.couchHost) window.couchHost.send({ type: 'input' }); } catch (err) {}
  }, true);
}`;
