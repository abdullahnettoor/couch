// What the recorder (look-record.mts) and the snapshotter (look-snap.mts) agree on.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RemoteSnapshot, ScreenPayload } from "../src/shared/protocol.ts";

export const FIXTURE_DIR = join(import.meta.dirname, "look-fixtures");

const PALETTE = ["#3b4a6b", "#6b3b4a", "#3b6b57", "#6b5d3b", "#5b3b6b"];

/** A picture standing in for a thumbnail or poster the harness's own server would have served: a plain colour, picked by the name. */
export function fixturePictureUrl(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const colour = PALETTE[hash % PALETTE.length].slice(1);
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='9'%3E%3Crect width='16' height='9' fill='%23${colour}'/%3E%3C/svg%3E`;
}

export interface Fixtures {
  screen: Record<string, ScreenPayload>;
  phone: Record<string, RemoteSnapshot>;
}

const load = <T>(kind: string): Record<string, T> =>
  Object.fromEntries(
    readdirSync(join(FIXTURE_DIR, kind))
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => [
        f.slice(0, -5),
        JSON.parse(readFileSync(join(FIXTURE_DIR, kind, f), "utf8")) as T,
      ]),
  );

export const loadFixtures = (): Fixtures => ({ screen: load("screen"), phone: load("phone") });
