import { contextBridge, ipcRenderer } from "electron";
import { Channel, type CouchApi } from "../shared/ipc.ts";

const api: CouchApi = {
  send: (command) => ipcRenderer.send(Channel.command, command),
  reportGrid: (report) => ipcRenderer.send(Channel.grid, report),
  onScreen: (listener) => {
    ipcRenderer.on(Channel.screen, (_event, payload) => listener(payload));
  },
  onMpv: (listener) => {
    ipcRenderer.on(Channel.mpv, (_event, status) => listener(status));
  },
};

contextBridge.exposeInMainWorld("couch", api);
