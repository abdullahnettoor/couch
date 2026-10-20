import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import { COMMAND_NAMES, type Command, type CommandName } from "../../shared/protocol.ts";
import type { Core } from "../core/core.ts";
import { REMOTE_PAGE } from "./page.ts";

export interface RemoteServer {
  port: number;
  close(): Promise<void>;
}

export function parseCommand(raw: string): Command | undefined {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof msg !== "object" || msg === null) return undefined;
  const { type, command, args } = msg as Record<string, unknown>;
  if (type !== "command" || !COMMAND_NAMES.includes(command as CommandName)) return undefined;
  const out: Command = { command: command as CommandName };
  if (typeof args === "object" && args !== null) {
    const { seconds, text } = args as Record<string, unknown>;
    out.args = {
      ...(typeof seconds === "number" && Number.isFinite(seconds) ? { seconds } : {}),
      ...(typeof text === "string" ? { text } : {}),
    };
  }
  return out;
}

/** Serves the Remote page and the WebSocket that carries commands and snapshots. */
export async function startRemoteServer(
  core: Core,
  options: { port: number; host?: string },
): Promise<RemoteServer> {
  const http: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(REMOTE_PAGE);
    } else {
      res.writeHead(404).end();
    }
  });
  const wss = new WebSocketServer({ server: http, path: "/ws" });
  const sockets = new Map<WebSocket, string>();
  let nextId = 1;

  const sendSnapshots = () => {
    for (const [ws, id] of sockets) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(core.snapshot(id)));
    }
  };
  const unsubscribe = core.onChange(sendSnapshots);

  wss.on("connection", (ws) => {
    const id = `remote-${nextId++}`;
    sockets.set(ws, id);
    core.connect(id);
    ws.on("message", (data) => {
      const command = parseCommand(data.toString());
      if (command) core.handle(command, id);
    });
    ws.on("close", () => {
      sockets.delete(ws);
      core.disconnect(id);
    });
  });

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(options.port, options.host, resolve);
  });

  return {
    port: (http.address() as AddressInfo).port,
    async close() {
      unsubscribe();
      for (const ws of sockets.keys()) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => {
        http.close(() => resolve());
        http.closeAllConnections();
      });
    },
  };
}
