import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { MpvIpcClient } from "./ipc-client.ts";

let dir: string;
let server: Server;
let peer: Socket;
let path: string;
let received: unknown[];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "couch-ipc-"));
  path = join(dir, "mpv.sock");
  received = [];
  server = createServer((socket) => {
    peer = socket;
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let i;
      while ((i = buffer.indexOf("\n")) >= 0) {
        received.push(JSON.parse(buffer.slice(0, i)));
        buffer = buffer.slice(i + 1);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
});

afterEach(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test("matches replies to requests by request_id", async () => {
  const client = await MpvIpcClient.connect(path);
  const pending = client.command(["get_property", "time-pos"]);
  await new Promise((r) => setTimeout(r, 20));
  const request = received[0] as { command: unknown[]; request_id: number };
  expect(request.command).toEqual(["get_property", "time-pos"]);
  peer.write(
    JSON.stringify({ request_id: request.request_id, error: "success", data: 12.5 }) + "\n",
  );
  expect(await pending).toBe(12.5);
  client.close();
});

test("rejects when mpv replies with an error", async () => {
  const client = await MpvIpcClient.connect(path);
  const pending = client.command(["get_property", "nope"]);
  await new Promise((r) => setTimeout(r, 20));
  const { request_id } = received[0] as { request_id: number };
  peer.write(JSON.stringify({ request_id, error: "property unavailable" }) + "\n");
  await expect(pending).rejects.toThrow("property unavailable");
  client.close();
});

test("emits events, including ones split across chunks", async () => {
  const client = await MpvIpcClient.connect(path);
  const events: unknown[] = [];
  client.onEvent((e) => events.push(e));
  peer.write('{"event":"end-file","rea');
  await new Promise((r) => setTimeout(r, 10));
  peer.write('son":"eof"}\n{"event":"idle"}\n');
  await new Promise((r) => setTimeout(r, 20));
  expect(events).toEqual([{ event: "end-file", reason: "eof" }, { event: "idle" }]);
  client.close();
});

test("rejects pending commands and signals close when the socket closes", async () => {
  const client = await MpvIpcClient.connect(path);
  let closed = false;
  client.onClose(() => (closed = true));
  const pending = client.command(["stop"]);
  await new Promise((r) => setTimeout(r, 20));
  peer.destroy();
  await expect(pending).rejects.toThrow();
  await new Promise((r) => setTimeout(r, 10));
  expect(closed).toBe(true);
});

test("connect retries until the socket appears", async () => {
  const late = join(dir, "late.sock");
  const promise = MpvIpcClient.connect(late, { timeoutMs: 2000, retryMs: 20 });
  await new Promise((r) => setTimeout(r, 100));
  const lateServer = createServer();
  await new Promise<void>((resolve) => lateServer.listen(late, resolve));
  const client = await promise;
  client.close();
  lateServer.close();
});
