// Starts the built binary against a temp support folder and a fake app. Run with `vp run listener:test`.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const root = join(fileURLToPath(import.meta.url), "../../..");
const binary = join(root, "out/couch-listener");
const fakeApp = join(root, "listener/test/fake-app.mjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = "pair-key-SECRET-123";
const MARK = "LAUNCHMARK987";

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const cleanups = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function until(fn, what, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await sleep(50);
  }
}

/** Starts a listener; `launch` is "app" (starts the fake app after delayMs), or a literal command. */
async function setup({
  key = KEY,
  launch = "app",
  delayMs = 400,
  startTimeout = 30,
  extra = [],
} = {}) {
  const support = mkdtempSync(join(tmpdir(), "couch-listener-"));
  const web = mkdtempSync(join(tmpdir(), "couch-listener-web-"));
  writeFileSync(join(web, "page.html"), "<html>OFFPAGE</html>");
  writeFileSync(join(web, "icon-192.png"), "PNG192");
  writeFileSync(join(web, "touch-icon.png"), "PNGTOUCH");
  if (key) writeFileSync(join(support, "pairing.json"), JSON.stringify({ key }));
  const [port, appPort] = [await freePort(), await freePort()];
  const launchCmd =
    launch === "app"
      ? `${process.execPath} ${fakeApp} ${appPort} ${support} ${delayMs} # ${MARK}`
      : launch;
  let output = "";
  const child = spawn(
    binary,
    [
      "--support",
      support,
      "--page",
      join(web, "page.html"),
      "--icons",
      web,
      "--launch",
      launchCmd,
      "--start-timeout",
      String(startTimeout),
      ...extra,
    ],
    { env: { ...process.env, COUCH_PORT: String(port), COUCH_APP_PORT: String(appPort) } },
  );
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const env = {
    support,
    port,
    appPort,
    child,
    output: () => output,
    url: (p) => `http://127.0.0.1:${port}${p}`,
    status: () => JSON.parse(readFileSync(join(support, "listener.json"), "utf8")),
    appLog: () =>
      existsSync(join(support, "fake-app.log"))
        ? readFileSync(join(support, "fake-app.log"), "utf8")
        : "",
  };
  cleanups.push(async () => {
    child.kill("SIGTERM");
    await sleep(100);
    try {
      const pid = Number(
        execFileSync("/usr/sbin/lsof", ["-nP", `-iTCP:${appPort}`, "-sTCP:LISTEN", "-t"])
          .toString()
          .split("\n")[0],
      );
      if (pid) process.kill(pid, "SIGKILL");
    } catch {}
    rmSync(support, { recursive: true, force: true });
    rmSync(web, { recursive: true, force: true });
  });
  await until(() => existsSync(join(support, "listener.json")), "listener.json");
  return env;
}

/** A phone: collects the messages it's sent. */
async function phone(env, key = KEY) {
  const ws = new WebSocket(`ws://127.0.0.1:${env.port}/ws?key=${key}`);
  const messages = [];
  let closed = false;
  ws.on("message", (m) => messages.push(JSON.parse(m.toString())));
  ws.on("close", () => (closed = true));
  await new Promise((res, rej) => {
    ws.once("open", res);
    ws.once("error", rej);
  });
  cleanups.push(() => ws.terminate());
  return {
    ws,
    messages,
    closed: () => closed,
    powerStates: () => messages.filter((m) => m.type === "power").map((m) => m.state),
    send: (command) => ws.send(JSON.stringify({ type: "command", command })),
  };
}

const rejected = (env, key) =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${env.port}/ws?key=${key}`);
    ws.on("unexpected-response", (_req, res) => resolve(res.statusCode));
    ws.on("open", () => resolve("open"));
    ws.on("error", () => {});
  });

test("wrong or missing keys get 401, and a missing pairing accepts nothing", async () => {
  const env = await setup();
  assert.equal(await rejected(env, "nope"), 401);
  assert.equal(await rejected(env, ""), 401);
  const bare = await setup({ key: null });
  assert.equal(await rejected(bare, KEY), 401);
  assert.equal(await rejected(bare, ""), 401);
});

test("while off it serves the page and icons, and 404s the rest", async () => {
  const env = await setup();
  const page = await fetch(env.url("/?key=anything"));
  assert.equal(page.status, 200);
  assert.match(await page.text(), /OFFPAGE/);
  assert.equal(await (await fetch(env.url("/icon.png"))).text(), "PNG192");
  assert.equal(await (await fetch(env.url("/touch-icon.png"))).text(), "PNGTOUCH");
  assert.equal((await fetch(env.url("/thumb/" + "a".repeat(40) + ".jpg?key=" + KEY))).status, 404);
  assert.equal((await fetch(env.url("/nothing"))).status, 404);
});

test("the status file has the ports and a token, mode 0600, and goes away on exit", async () => {
  const env = await setup();
  const s = env.status();
  assert.equal(s.pid, env.child.pid);
  assert.equal(s.publicPort, env.port);
  assert.equal(s.appPort, env.appPort);
  assert.ok(s.token.length >= 32);
  assert.equal(statSync(join(env.support, "listener.json")).mode & 0o777, 0o600);
  env.child.kill("SIGTERM");
  await until(() => !existsSync(join(env.support, "listener.json")), "listener.json removed");
});

test("off: only power does anything", async () => {
  const env = await setup();
  const p = await phone(env);
  await until(() => p.powerStates().length, "initial state");
  assert.deepEqual(p.powerStates(), ["off"]);
  p.send("play");
  p.send("quit");
  await sleep(400);
  assert.deepEqual(p.powerStates(), ["off"]);
  assert.equal(env.appLog(), "");
});

test("power runs the launch command: off, starting, on, then Couch's traffic is proxied", async () => {
  const env = await setup();
  const p = await phone(env);
  p.send("power");
  await until(() => p.powerStates().includes("on"), "on");
  assert.deepEqual(p.powerStates(), ["off", "starting", "on"]);
  await until(() => p.closed(), "own socket closed so the phone reconnects");

  const page = await fetch(env.url("/?key=" + KEY));
  assert.equal(await page.text(), "FAKEAPP /?key=" + KEY);

  const q = await phone(env);
  await until(() => q.messages.some((m) => m.type === "snapshot"), "snapshot through the proxy");
  q.send("play");
  await until(() => env.appLog().includes("play"), "command reaches the app");
  assert.equal(await rejected(env, "nope"), 401);
});

test("power while on posts the quit with the token, then goes off", async () => {
  const env = await setup();
  const p = await phone(env);
  p.send("power");
  await until(() => p.closed(), "on");
  const q = await phone(env);
  await until(() => q.messages.length, "proxied");
  q.send("power");
  await until(() => env.appLog().includes("quit"), "quit posted");
  await until(() => q.closed(), "proxied socket dropped");
  assert.ok(!env.appLog().includes("power"), "power is not forwarded to the app");
  const r = await until(() => phone(env).catch(() => null), "reconnect after quit");
  await until(() => r.powerStates().length, "state after quit");
  assert.deepEqual(r.powerStates(), ["off"]);
  assert.equal((await (await fetch(env.url("/"))).text()).includes("OFFPAGE"), true);
});

test("a crash of the app turns the state back to off", async () => {
  const env = await setup();
  const p = await phone(env);
  p.send("power");
  await until(() => p.closed(), "on");
  await sleep(500);
  const pid = Number(
    execFileSync("/usr/sbin/lsof", ["-nP", `-iTCP:${env.appPort}`, "-sTCP:LISTEN", "-t"])
      .toString()
      .split("\n")[0],
  );
  process.kill(pid, "SIGKILL");
  await until(
    async () =>
      (
        await fetch(env.url("/")).then(
          (r) => r.text(),
          () => "",
        )
      ).includes("OFFPAGE"),
    "off again",
    6000,
  );
});

test("a launch that never answers falls back to off and flags it", async () => {
  const env = await setup({ launch: "true", startTimeout: 1 });
  const p = await phone(env);
  p.send("power");
  await until(() => p.messages.some((m) => m.failed), "failure message");
  assert.deepEqual(p.powerStates(), ["off", "starting", "off"]);
});

test("a changed pairing key is picked up", async () => {
  const env = await setup();
  assert.equal(await rejected(env, "second-key"), 401);
  writeFileSync(join(env.support, "pairing.json"), JSON.stringify({ key: "second-key" }));
  assert.equal(await rejected(env, KEY), 401);
  const p = await phone(env, "second-key");
  await until(() => p.powerStates().length, "accepted");
  writeFileSync(join(env.support, "pairing.json"), JSON.stringify({ key: "third-key" }));
  await until(() => p.closed(), "old phone dropped");
});

test("keys, tokens and the launch command are never logged", async () => {
  const env = await setup();
  const p = await phone(env);
  await rejected(env, "wrong-key-xyz");
  p.send("power");
  await until(() => p.closed(), "on");
  await fetch(env.url("/?key=" + KEY));
  const q = await phone(env);
  q.send("power");
  await until(() => q.closed(), "quit proxied");
  const out = env.output();
  assert.ok(out.length > 0);
  for (const secret of [KEY, "wrong-key-xyz", env.status().token, MARK, "fake-app"]) {
    assert.ok(!out.includes(secret), `log leaks ${secret.slice(0, 4)}…`);
  }
});

/** A raw TCP client for malformed traffic. */
function raw(env) {
  const socket = connect(env.port, "127.0.0.1");
  let closed = false;
  let received = Buffer.alloc(0);
  socket.on("data", (d) => (received = Buffer.concat([received, d])));
  socket.on("close", () => (closed = true));
  socket.on("error", () => {});
  cleanups.push(() => socket.destroy());
  return { socket, closed: () => closed, received: () => received };
}

async function rawPhone(env, key = KEY) {
  const c = raw(env);
  c.socket.write(
    `GET /ws?key=${key} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  );
  await until(() => c.received().toString().includes("\r\n\r\n"), "handshake");
  return c;
}

const maskedFrame = (opcode, payload, { fin = true } = {}) => {
  const mask = Buffer.from([1, 2, 3, 4]);
  const body = Buffer.from(payload);
  const head =
    body.length < 126
      ? Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | body.length])
      : Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | 126, body.length >> 8, body.length & 0xff]);
  return Buffer.concat([head, mask, body.map((b, i) => b ^ mask[i % 4])]);
};

const alive = async (env) => (await fetch(env.url("/"))).status === 200;

test("a revoked phone loses control even when a new handshake refreshes the key first", async () => {
  const env = await setup();
  const old = await phone(env);
  await until(() => old.powerStates().length, "initial");
  writeFileSync(join(env.support, "pairing.json"), JSON.stringify({ key: "second-key" }));
  const fresh = await phone(env, "second-key");
  await until(() => old.closed(), "old phone dropped without waiting for the timer");
  old.send("power");
  await sleep(300);
  assert.equal(env.appLog(), "");
  await until(() => fresh.powerStates().length, "new phone works");
  assert.equal(fresh.closed(), false);
});

test("an authenticated socket's power is refused after the key changed", async () => {
  const env = await setup();
  const c = await rawPhone(env);
  writeFileSync(join(env.support, "pairing.json"), JSON.stringify({ key: "second-key" }));
  c.socket.write(maskedFrame(1, JSON.stringify({ type: "command", command: "power" })));
  await until(() => c.closed(), "closed");
  await sleep(500);
  assert.match(await (await fetch(env.url("/"))).text(), /OFFPAGE/, "power did not start the app");
  assert.equal(env.appLog(), "");
});

test("malformed WebSocket frames never crash the listener", async () => {
  const env = await setup();
  const header = (b0, b1, ...rest) => Buffer.from([b0, b1, ...rest]);
  const cases = [
    header(0x81, 0xff, ...Array(8).fill(0xff), 1, 2, 3, 4),
    header(0x81, 0xff, 0x80, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4),
    header(0x81, 0xff, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff, 1, 2, 3, 4),
    header(0x82, 0xfe, 0xff, 0xff, 1, 2, 3, 4),
    header(0x89, 0xfe, 0, 200, 1, 2, 3, 4),
    header(0x00, 0x80, 1, 2, 3, 4),
    header(0xf1, 0x80, 1, 2, 3, 4),
  ];
  const rnd = () => Buffer.from(Array.from({ length: 64 }, () => Math.floor(Math.random() * 256)));
  for (let i = 0; i < 40; i++) cases.push(rnd());
  for (const bytes of cases) {
    const c = await rawPhone(env);
    c.socket.write(bytes);
    await sleep(30);
    c.socket.destroy();
  }
  assert.equal(env.child.exitCode, null, "listener still running");
  assert.equal(await alive(env), true);
});

test("an oversize frame length closes with 1009 and a reserved bit is a protocol error", async () => {
  const env = await setup();
  const big = await rawPhone(env);
  big.socket.write(Buffer.from([0x81, 0xff, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff, 1, 2, 3, 4]));
  await until(() => big.closed(), "closed");
  const tail = big.received().subarray(big.received().indexOf("\r\n\r\n") + 4);
  assert.deepEqual([...tail.subarray(32, 36)], [0x88, 0x02, 0x03, 0xf1]);
  const msb = await rawPhone(env);
  msb.socket.write(Buffer.from([0x81, 0xff, 0xff, ...Array(7).fill(0xff), 1, 2, 3, 4]));
  await until(() => msb.closed(), "closed");
  const t2 = msb.received().subarray(msb.received().indexOf("\r\n\r\n") + 4);
  assert.deepEqual([...t2.subarray(32, 36)], [0x88, 0x02, 0x03, 0xea]);
});

test("idle and header-stalled connections are dropped, and the unauthenticated count is capped", async () => {
  const env = await setup({ extra: ["--header-timeout", "1"] });
  const idle = Array.from({ length: 3 }, () => raw(env));
  const slow = raw(env);
  slow.socket.write("GET / HT");
  await until(() => idle.every((c) => c.closed()) && slow.closed(), "timed out", 4000);
  const flood = Array.from({ length: 60 }, () => raw(env));
  await sleep(500);
  assert.ok(flood.filter((c) => c.closed()).length >= 28, "oldest dropped past the cap");
  assert.equal(await alive(env), true);
});

test("fragmented text frames are assembled, so a fragmented power works", async () => {
  const env = await setup();
  const c = await rawPhone(env);
  const msg = Buffer.from(JSON.stringify({ type: "command", command: "power" }));
  c.socket.write(maskedFrame(1, msg.subarray(0, 10), { fin: false }));
  c.socket.write(maskedFrame(9, "hi"));
  c.socket.write(maskedFrame(0, msg.subarray(10), { fin: true }));
  await until(() => c.received().toString().includes("starting"), "power ran");
});
