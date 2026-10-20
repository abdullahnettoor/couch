import { contextBridge, ipcRenderer } from "electron";
import { Channel, type CouchApi, type ScreenCommand, type ScreenStatus } from "../shared/ipc.ts";

const api: CouchApi = {
  send: (command: ScreenCommand) => ipcRenderer.send(Channel.command, command),
  onStatus: (listener: (status: ScreenStatus) => void) => {
    ipcRenderer.on(Channel.status, (_event, status: ScreenStatus) => listener(status));
  },
};

contextBridge.exposeInMainWorld("couch", api);
