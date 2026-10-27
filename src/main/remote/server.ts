import { createReadStream, statSync } from "node:fs";
import { join } from "node:path";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import { COMMAND_NAMES, type Command, type CommandName } from "../../shared/protocol.ts";
import type { Core } from "../core/core.ts";
import { safeEqual } from "../constant-time.ts";
import { remoteManifest } from "./manifest.ts";
import { REMOTE_PAGE } from "./page.ts";

export interface RemoteServer {
  port: number;
  close(): Promise<void>;
}

/** The Remote page's tab and home-screen icons, by URL path, as files in `iconDir`. */
const ICON_FILES: Record<string, string> = {
  "/icon.png": "icon-192.png",
  "/touch-icon.png": "touch-icon.png",
  "/icon-512.png": "icon-512.png",
};

/** The most a Remote's WebSocket message may be: the same 1 MiB the Listener allows. */
export const MAX_MESSAGE = 1 << 20;

const MAX_TEXT = 4096;

type Field =
  | { kind: "number" | "integer" | "boolean" }
  | { kind: "string"; max: number }
  | { kind: "enum"; values: readonly string[] };

const text = (max = MAX_TEXT): Field => ({ kind: "string", max });
const number: Field = { kind: "number" };

/** The args each command takes from a Remote; any other field, or a command with none listed, is refused. */
const ARGS: Partial<Record<CommandName, Record<string, Field>>> = {
  seekBy: { seconds: number },
  seekTo: { seconds: number },
  setTrack: { kind: { kind: "enum", values: ["subtitles", "audio"] }, track: text() },
  setSpeed: { speed: number },
  volSet: { percent: number },
  playUpNext: { index: { kind: "integer" } },
  typeOpen: { text: text() },
  typeText: { text: text() },
  toggleAddon: { addon: text() },
  pressPrompt: { id: { kind: "enum", values: ["skipIntro", "skipRecap", "nextEpisode"] } },
  setPictureOff: { on: { kind: "boolean" } },
};

function valid(field: Field, value: unknown): boolean {
  switch (field.kind) {
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string" && Buffer.byteLength(value) <= field.max;
    case "enum":
      return typeof value === "string" && field.values.includes(value);
  }
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
  if (args === undefined || args === null) return out;
  if (typeof args !== "object" || Array.isArray(args)) return undefined;
  const allowed = ARGS[command as CommandName] ?? {};
  const given = Object.entries(args);
  for (const [key, value] of given) {
    const field = Object.hasOwn(allowed, key) ? allowed[key] : undefined;
    if (!field || !valid(field, value)) return undefined;
  }
  out.args = Object.fromEntries(given) as Command["args"];
  return out;
}

/** Serves the Remote page and the WebSocket that carries commands and snapshots. */
export async function startRemoteServer(
  core: Core,
  options: {
    port: number;
    host?: string;
    thumbnailDir?: string;
    iconDir?: string;
    listener?: { token: string };
  },
): Promise<RemoteServer> {
  const serveThumbnail = (url: string, path: string, res: ServerResponse) => {
    const given = new URL(url, "http://localhost").searchParams.get("key");
    const name = /^\/thumb\/((?:tmdb-[a-z]+-)?[0-9a-f]{40})\.jpg$/.exec(path)?.[1];
    const file = name && options.thumbnailDir ? join(options.thumbnailDir, `${name}.jpg`) : "";
    if (!core.acceptsKey(given)) return void res.writeHead(401).end();
    serveFile(file, "image/jpeg", "private, max-age=86400", res);
  };
  const serveFile = (file: string, type: string, cache: string, res: ServerResponse) => {
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
      res.writeHead(200, { "content-type": type, "cache-control": cache });
      stream.pipe(res);
    });
  };
  const localQuit = (req: IncomingMessage, res: ServerResponse) => {
    const token = options.listener?.token;
    const from = req.socket.remoteAddress ?? "";
    const loopback = from === "::1" || from.startsWith("127.") || from.startsWith("::ffff:127.");
    if (req.method !== "POST" || !token || !loopback) return void res.writeHead(404).end();
    if (!safeEqual(req.headers.authorization ?? "", `Bearer ${token}`))
      return void res.writeHead(401).end();
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}', () => core.quit());
  };
  const http: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/local/quit") return localQuit(req, res);
    const icon = Object.hasOwn(ICON_FILES, path) ? ICON_FILES[path] : undefined;
    if (path === "/manifest.webmanifest") {
      res.writeHead(200, {
        "content-type": "application/manifest+json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(remoteManifest());
    } else if (path === "/") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(REMOTE_PAGE);
    } else if (path.startsWith("/thumb/")) {
      serveThumbnail(req.url ?? "", path, res);
    } else if (icon) {
      const file = options.iconDir ? join(options.iconDir, icon) : "";
      serveFile(file, "image/png", "public, max-age=86400", res);
    } else {
      res.writeHead(404).end();
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });
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
    // An oversize or malformed frame emits 'error' on this socket alone, and ws then closes it (1009 or
    // 1002); without a handler the event would be uncaught in main.
    ws.on("error", () => {});
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
