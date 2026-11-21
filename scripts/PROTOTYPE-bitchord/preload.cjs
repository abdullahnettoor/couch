// PROTOTYPE (throwaway, do not merge): BitChord's Firefox relay content script (web/extension/entrypoints/relay.content.ts),
// with Couch's main process in place of the extension's background worker.
const { ipcRenderer } = require("electron");

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const m = event.data;
  if (!m || m.channel !== "bitchord-bridge" || m.direction !== "to-extension") return;
  ipcRenderer.invoke("bitchord-bridge", m).then((response) => window.postMessage(response, location.origin));
});
