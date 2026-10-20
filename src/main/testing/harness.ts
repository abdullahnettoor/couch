import { WebSocket } from "ws";
import { HOME_ITEMS } from "../../shared/home-grid.ts";
import { ADD_PHONE_ITEMS, SETTINGS_ITEMS } from "../../shared/settings-grid.ts";
import type { Command, GridItem, RemoteSnapshot, ScreenPayload } from "../../shared/protocol.ts";
import { startApp, type CouchApp } from "../app.ts";
import { MemoryStore, type Store } from "../ports/store.ts";
import { FakeClock, FakeMac, FakePlayer, FakeYouTube } from "../ports/fakes.ts";

/** A pretend phone: a WebSocket client that records every snapshot. */
export class FakePhone {
  snapshots: RemoteSnapshot[] = [];
  #ws: WebSocket;

  private constructor(ws: WebSocket) {
    this.#ws = ws;
    ws.on("message", (data) => this.snapshots.push(JSON.parse(data.toString())));
  }

  static async connect(port: number, key: string): Promise<FakePhone> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?key=${encodeURIComponent(key)}`);
    const phone = new FakePhone(ws);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    await phone.settle();
    return phone;
  }

  get last(): RemoteSnapshot | undefined {
    return this.snapshots.at(-1);
  }

  send(command: Command["command"] | Command): void {
    const c = typeof command === "string" ? { command } : command;
    this.#ws.send(JSON.stringify({ type: "command", ...c }));
  }

  /** Send a command and wait for the next snapshot it causes. */
  async press(command: Command["command"] | Command): Promise<RemoteSnapshot> {
    const before = this.snapshots.length;
    this.send(command);
    await this.waitFor(() => this.snapshots.length > before);
    return this.last!;
  }

  async waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
    const start = Date.now();
    while (!condition()) {
      if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for snapshot");
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  /** Wait until no new snapshots arrive for a moment. */
  async settle(): Promise<void> {
    let seen = -1;
    while (seen !== this.snapshots.length) {
      seen = this.snapshots.length;
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  /** Calls back when the server drops this phone. */
  closed(callback: () => void): void {
    if (this.#ws.readyState === WebSocket.CLOSED) callback();
    else this.#ws.once("close", callback);
  }

  close(): void {
    this.#ws.close();
  }
}

/** The grids the real renderer reports. Tickets add theirs here (same shape as renderer/views). */
const DEFAULT_GRIDS: Record<string, GridItem[]> = {
  home: HOME_ITEMS,
  settings: SETTINGS_ITEMS,
  addPhone: ADD_PHONE_ITEMS,
};

/**
 * Stands in for the Screen renderer: reports the grid for the view being shown
 * (the same items the real renderer draws) and records what it was handed.
 */
export class FakeScreen {
  payloads: ScreenPayload[] = [];
  constructor(app: CouchApp, grids: Record<string, GridItem[]> = DEFAULT_GRIDS) {
    app.onScreen((payload) => {
      this.payloads.push(payload);
      const grid = grids[payload.viewKey];
      if (grid && payload.grid.length === 0) app.reportGrid(payload.viewKey, grid);
    });
    for (const [key, items] of Object.entries(grids)) app.reportGrid(key, items);
  }
  get last(): ScreenPayload {
    return this.payloads.at(-1)!;
  }
}

export interface Harness {
  app: CouchApp;
  screen: FakeScreen;
  player: FakePlayer;
  youtube: FakeYouTube;
  mac: FakeMac;
  clock: FakeClock;
  phones: FakePhone[];
  store: Store;
  /** The current pairing key, as a phone would read it from the QR code. */
  pairingKey(): string;
  /** Connect a paired phone (current key unless given). */
  connectPhone(key?: string): Promise<FakePhone>;
  stop(): Promise<void>;
}

/** Starts Couch's main-process app (core + Remote server) on a random port with fake ports. */
export async function startHarness(store: Store = new MemoryStore()): Promise<Harness> {
  const player = new FakePlayer();
  const youtube = new FakeYouTube();
  const mac = new FakeMac();
  const clock = new FakeClock();
  const app = await startApp({ player, youtube, mac, clock, store, port: 0, host: "127.0.0.1" });
  const screen = new FakeScreen(app);
  const phones: FakePhone[] = [];
  return {
    app,
    screen,
    player,
    youtube,
    mac,
    clock,
    phones,
    store,
    pairingKey: () => new URL(app.core.pairingUrl).searchParams.get("key")!,
    async connectPhone(key = new URL(app.core.pairingUrl).searchParams.get("key")!) {
      const phone = await FakePhone.connect(app.remote.port, key);
      phones.push(phone);
      return phone;
    },
    async stop() {
      for (const p of phones) p.close();
      await app.stop();
    },
  };
}
