// Writes src/brand/wordmark.svg (the COUCH wordmark, standalone) from src/brand/wordmark.ts.
// node scripts/wordmark.mjs          write it
// node scripts/wordmark.mjs --check  exit 1 if the committed file is out of date (part of pnpm test)
import { readFileSync, writeFileSync } from "node:fs";
import { wordmarkSvg } from "../src/brand/wordmark.ts";

const file = new URL("../src/brand/wordmark.svg", import.meta.url);
const svg = wordmarkSvg({ id: "couch-wordmark", attrs: 'width="734" height="100"', title: "Couch" }) + "\n";
if (process.argv.includes("--check")) {
  let current = "";
  try { current = readFileSync(file, "utf8"); } catch { /* missing */ }
  if (current !== svg) { console.error("wordmark: src/brand/wordmark.svg is out of date; run node scripts/wordmark.mjs"); process.exit(1); }
  console.log("wordmark: ok");
} else {
  writeFileSync(file, svg);
  console.log("wrote src/brand/wordmark.svg");
}
