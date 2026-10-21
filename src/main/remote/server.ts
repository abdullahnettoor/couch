import { createReadStream, statSync } from "node:fs";
import { join } from "node:path";
import { createServer, type Server, type ServerResponse } from "node:http";
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
    const { seconds, text, percent, index } = args as Record<string, unknown>;
    out.args = {
      ...(typeof seconds === "number" && Number.isFinite(seconds) ? { seconds } : {}),
      ...(typeof percent === "number" && Number.isFinite(percent) ? { percent } : {}),
      ...(typeof index === "number" && Number.isInteger(index) ? { index } : {}),
      ...(typeof text === "string" ? { text } : {}),
    };
  }
  return out;
}

/** Serves the Remote page and the WebSocket that carries commands and snapshots. */
export async function startRemoteServer(
  core: Core,
  options: { port: number; host?: string; thumbnailDir?: string },
): Promise<RemoteServer> {
  const serveThumbnail = (url: string, path: string, res: ServerResponse) => {
    const given = new URL(url, "http://localhost").searchParams.get("key");
    const name = /^\/thumb\/((?:tmdb-[a-z]+-)?[0-9a-f]{40})\.jpg$/.exec(path)?.[1];
    const file = name && options.thumbnailDir ? join(options.thumbnailDir, `${name}.jpg`) : "";
    if (!core.acceptsKey(given)) return void res.writeHead(401).end();
    const isFile = (() => {
      try {
        return statSync(file).isFile();
      } catch {
        return false;
      }
    })();
    if (!file || !isFile) return void res.writeHead(404).end();
    const stream = createReadStream(file);
    stream.once("error", () => {
      if (res.headersSent) res.destroy();
      else res.writeHead(404).end();
    });
    stream.once("open", () => {
      res.writeHead(200, {
        "content-type": "image/jpeg",
        "cache-control": "private, max-age=86400",
      });
      stream.pipe(res);
    });
  };
  const http: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(REMOTE_PAGE);
    } else if (path.startsWith("/thumb/")) {
      serveThumbnail(req.url ?? "", path, res);
    } else {
      res.writeHead(404).end();
    }
  });
  const wss = new WebSocketServer({ noServer: true });
  http.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws" || !core.acceptsKey(url.searchParams.get("key"))) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  const sockets = new Map<WebSocket, string>();
  let nextId = 1;

  const sendSnapshots = () => {
    for (const [ws, id] of sockets) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(core.snapshot(id)));
    }
  };
  const unsubscribe = core.onChange(sendSnapshots);
  const unsubscribeForget = core.onForget(() => {
    for (const ws of sockets.keys()) ws.terminate();
    sockets.clear();
  });

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

  const port = (http.address() as AddressInfo).port;
  core.setPort(port);

  return {
    port,
    async close() {
      unsubscribe();
      unsubscribeForget();
      for (const ws of sockets.keys()) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => {
        http.close(() => resolve());
        http.closeAllConnections();
      });
    },
  };
}
