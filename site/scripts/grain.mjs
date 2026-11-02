// Writes src/shots/grain.png: the hero's film grain, a 128 × 128 tile of static grey noise (seeded, so it is the
// same every time). Shown at 64 CSS px (two device pixels per grain on most screens), overlay blend, 15% (style.css).
//   node scripts/grain.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const N = 128;
let seed = 142;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
// near-Gaussian (sum of four uniforms), centred on mid grey so overlay leaves the average brightness alone
const raw = Buffer.alloc((N + 1) * N);
for (let y = 0; y < N; y++) {
  raw[y * (N + 1)] = 0; // filter: none
  for (let x = 0; x < N; x++) raw[y * (N + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(128 + (rnd() + rnd() + rnd() + rnd() - 2) * 90)));
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 0; // 8-bit greyscale
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
writeFileSync(new URL("../src/shots/grain.png", import.meta.url), png);
console.log(`wrote src/shots/grain.png (${png.length} bytes)`);
