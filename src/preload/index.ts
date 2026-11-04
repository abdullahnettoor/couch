import { contextBridge, ipcRenderer } from "electron";
import { Channel, type CouchApi } from "../shared/ipc.ts";

const api: CouchApi = {
  send: (command) => ipcRenderer.send(Channel.command, command),
  onScreen: (listener) => {
    ipcRenderer.on(Channel.screen, (_event, payload) => listener(payload));
  },
  reportGlass: (rects) => ipcRenderer.send(Channel.glass, rects),
  onTint: (listener) => {
    ipcRenderer.on(Channel.tint, (_event, rgb) => listener(rgb));
  },
  onSound: (listener) => {
    ipcRenderer.on(Channel.sound, (_event, sound) => listener(sound));
  },
  onMpv: (listener) => {
    ipcRenderer.on(Channel.mpv, (_event, status) => listener(status));
  },
};

contextBridge.exposeInMainWorld("couch", api);
