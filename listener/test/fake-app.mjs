// A stand-in for Couch on the app port: node fake-app.mjs <port> <support dir> <delay ms>
import { readFileSync, appendFileSync } from "node:fs";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const [port, support, delay] = [
  Number(process.argv[2]),
  process.argv[3],
  Number(process.argv[4] ?? 0),
];
const record = (line) => appendFileSync(`${support}/fake-app.log`, `${line}\n`);

const http = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/local/quit") {
    const token = JSON.parse(readFileSync(`${support}/listener.json`, "utf8")).token;
    if (req.headers.authorization !== `Bearer ${token}`) return void res.writeHead(401).end();
    record("quit");
    res.writeHead(200).end();
    setTimeout(() => process.exit(0), 100);
    return;
  }
  res.writeHead(200, { "content-type": "text/plain" }).end(`FAKEAPP ${req.url}`);
});
const wss = new WebSocketServer({ server: http });
wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "snapshot" }));
  ws.on("message", (m) => record(m.length > 1000 ? `ws big ${m.length}` : `ws ${m.toString()}`));
});
setTimeout(() => http.listen(port, "127.0.0.1"), delay);
