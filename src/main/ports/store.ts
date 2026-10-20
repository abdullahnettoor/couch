import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The Store port: small JSON documents that survive a restart, one per name. */
export interface Store {
  read<T>(name: string, fallback: T): T;
  write(name: string, value: unknown): void;
}

/** JSON files in a folder (the app data folder; tests use a temp one). */
export class FileStore implements Store {
  #dir: string;
  constructor(dir: string) {
    this.#dir = dir;
  }
  read<T>(name: string, fallback: T): T {
    try {
      return JSON.parse(readFileSync(join(this.#dir, `${name}.json`), "utf8")) as T;
    } catch {
      return fallback;
    }
  }
  write(name: string, value: unknown): void {
    mkdirSync(this.#dir, { recursive: true });
    const file = join(this.#dir, `${name}.json`);
    writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2));
    renameSync(`${file}.tmp`, file);
  }
}

export class MemoryStore implements Store {
  #docs = new Map<string, string>();
  read<T>(name: string, fallback: T): T {
    const raw = this.#docs.get(name);
    return raw === undefined ? fallback : (JSON.parse(raw) as T);
  }
  write(name: string, value: unknown): void {
    this.#docs.set(name, JSON.stringify(value));
  }
}
