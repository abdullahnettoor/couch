import { contextBridge, ipcRenderer } from "electron";
import type { QuickApi } from "../shared/ipc.ts";

// Sandboxed preloads can't load a shared chunk, so the channel names are written out here; quick-ipc.test.ts checks the source against `Channel`.
const QUICK_CHANNELS = {
  quick: "couch:quick",
  quickCommand: "couch:quick-command",
  quickSlide: "couch:quick-slide",
} as const;
const Channel = QUICK_CHANNELS;

// The Quick settings drawer's page gets only this: pick, close and what to draw.
const api: QuickApi = {
  pick: (item) =>
    ipcRenderer.send(Channel.quickCommand, { command: "quickPick", args: { item: String(item) } }),
  close: () => ipcRenderer.send(Channel.quickCommand, { command: "quickClose" }),
  slideStart: (phase) => ipcRenderer.send(Channel.quickSlide, phase === "out" ? "out" : "in"),
  onQuick: (listener) => {
    ipcRenderer.on(Channel.quick, (_event, quick) => listener(quick));
  },
};

contextBridge.exposeInMainWorld("couchQuick", api);
