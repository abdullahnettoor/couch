import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PagePreload } from "./web-app.ts";

export interface PreloadSession {
  registerPreloadScript(script: { type: "frame"; filePath: string }): string;
  unregisterPreloadScript(id: string): void;
}

/**
 * One preload file per web App: an ordered list of main-world functions that run before any page
 * script on every navigation. Each change rewrites the file and re-registers it. A failure is
 * logged and leaves the page unpatched; it never throws.
 */
export class SessionPreloads {
  #ses: PreloadSession;
  #dir: string;
  #id: string;
  #log: (message: string) => void;
  #list: PagePreload[] = [];
  #registered: string | undefined;

  constructor(
    ses: PreloadSession,
    dir: string,
    id: string,
    log: (message: string) => void = (m) => console.warn(m),
  ) {
    this.#ses = ses;
    this.#dir = dir;
    this.#id = id;
    this.#log = log;
  }

  /** Appends a function source (`function () { ... }`) to the list and re-registers the file. */
  add(name: string, func: string): void {
    this.#list.push({ name, func });
    this.#sync();
  }

  /** Replaces the whole list and re-registers the file. */
  set(list: PagePreload[]): void {
    this.#list = [...list];
    this.#sync();
  }

  /** Takes the App's preload off the session (the host is going for good). */
  clear(): void {
    this.#list = [];
    if (this.#registered) this.#ses.unregisterPreloadScript(this.#registered);
    this.#registered = undefined;
  }

  #sync(): void {
    try {
      mkdirSync(this.#dir, { recursive: true });
      const filePath = join(this.#dir, `${this.#id}-preload.cjs`);
      writeFileSync(filePath, preloadSource(this.#list.map((p) => p.func)));
      if (this.#registered) this.#ses.unregisterPreloadScript(this.#registered);
      this.#registered = this.#ses.registerPreloadScript({ type: "frame", filePath });
    } catch (error) {
      this.#log(
        `[${this.#id}] preload (${this.#list.map((p) => p.name).join(", ")}) failed: ${String(error)}`,
      );
    }
  }
}

/** Each function runs on its own, so one that throws cannot stop the others. */
export function preloadSource(funcs: string[]): string {
  return funcs
    .map(
      (f) =>
        `try { require('electron').contextBridge.executeInMainWorld({ func: ${f} }); } catch (e) {}\n`,
    )
    .join("");
}
