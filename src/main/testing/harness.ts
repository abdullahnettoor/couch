import { WebSocket } from "ws";
import { HOME_ITEMS, homeItems } from "../../shared/home-grid.ts";
import {
  ADD_PHONE_ITEMS,
  LIBRARY_ITEMS,
  REMOTES_ITEMS,
  SETTINGS_ITEMS,
} from "../../shared/settings-grid.ts";
import { APP_ERROR_ITEMS } from "../../shared/app-grid.ts";
import { IdleUnloader } from "../web/idle-unload.ts";
import { NetflixApp } from "../apps/netflix/netflix-app.ts";
import { YouTubeApp } from "../apps/youtube/youtube-app.ts";
import type { App } from "../apps/app.ts";
import { APP_ENTRIES, type AppEntry } from "../apps/index.ts";
import type { Command, GridItem, RemoteSnapshot, ScreenPayload } from "../../shared/protocol.ts";
import { startApp, type AppOptions, type CouchApp } from "../app.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore, type Store } from "../ports/store.ts";
import {
  FakeClock,
  FakeMac,
  FakePlayer,
  FakeMetadata,
  FakeThumbnails,
  FakeYouTube,
} from "../ports/fakes.ts";

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
  settingsRemotes: REMOTES_ITEMS,
  settingsLibrary: LIBRARY_ITEMS,
  addPhone: ADD_PHONE_ITEMS,
  appError: APP_ERROR_ITEMS,
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
  netflix: FakeYouTube;
  mac: FakeMac;
  clock: FakeClock;
  thumbnails: FakeThumbnails;
  /** The TMDB stand-in; every search and fetch is recorded. */
  metadata: FakeMetadata;
  /** Folder the Remote server serves thumbnails from. */
  thumbDir: string;
  phones: FakePhone[];
  store: Store;
  /** Whether the stand-in listener "answers" (flip it to simulate the listener coming or going). */
  listenerUp: { alive: boolean };
  /** The current pairing key, as a phone would read it from the QR code. */
  pairingKey(): string;
  /** Connect a paired phone (current key unless given). */
  connectPhone(key?: string): Promise<FakePhone>;
  stop(): Promise<void>;
}

/**
 * Starts Couch's main-process app (core + Remote server) on a random port with fake ports.
 * The Store is a real FileStore in a temp folder (removed on stop) unless one is passed in,
 * which is how tests restart: stop, then start again with the same Store.
 */
export async function startHarness(
  given?: Store,
  options: {
    tmdbProjectKey?: string;
    listener?: { publicPort: number; token: string };
    /** Passed to startApp: lets the listener toggle move the Remote server (fast, fake sleeps). */
    frontdoor?: AppOptions["frontdoorSetup"];
    metadata?: (fake: FakeMetadata) => void;
    /** More web Apps next to YouTube, each with the entry Home shows for it. */
    apps?: Array<{ entry: AppEntry; app: App }>;
  } = {},
): Promise<Harness> {
  const tmp = given ? undefined : mkdtempSync(join(tmpdir(), "couch-store-"));
  const store = given ?? new FileStore(tmp!);
  const player = new FakePlayer();
  const youtube = new FakeYouTube();
  const netflix = new FakeYouTube();
  const mac = new FakeMac();
  const clock = new FakeClock();
  const thumbnails = new FakeThumbnails();
  const metadata = new FakeMetadata();
  options.metadata?.(metadata);
  const thumbDir = mkdtempSync(join(tmpdir(), "couch-thumbs-"));
  const listenerUp = { alive: !!options.listener };
  if (options.listener) {
    store.write("listener", {
      pid: 4242,
      publicPort: options.listener.publicPort,
      appPort: 4748,
      token: options.listener.token,
    });
  }
  const catalog = [...APP_ENTRIES, ...(options.apps ?? []).map((a) => a.entry)];
  const unloader = new IdleUnloader(clock, store);
  youtube.lifecycle = unloader.track("youtube", () => youtube.unload(), { loaded: true });
  netflix.lifecycle = unloader.track("netflix", () => netflix.unload());
  const app = await startApp({
    listenerProbe: {
      pidExists: () => listenerUp.alive,
      portAnswers: () => Promise.resolve(listenerUp.alive),
    },
    frontdoorSetup: options.frontdoor,
    player,
    entries: catalog,
    apps: [
      new YouTubeApp(youtube, clock),
      new NetflixApp(netflix, clock),
      ...(options.apps ?? []).map((a) => a.app),
    ],
    mac,
    clock,
    store,
    thumbnails,
    metadata,
    tmdbProjectKey: options.tmdbProjectKey,
    listener: options.listener,
    thumbnailDir: thumbDir,
    iconDir: join(import.meta.dirname, "../../renderer/public"),
    port: 0,
    host: "127.0.0.1",
  });
  const screen = new FakeScreen(app, {
    ...DEFAULT_GRIDS,
    home: homeItems(catalog),
  });
  const phones: FakePhone[] = [];
  return {
    app,
    screen,
    player,
    youtube,
    netflix,
    mac,
    clock,
    thumbnails,
    metadata,
    thumbDir,
    phones,
    store,
    listenerUp,
    pairingKey: () => new URL(app.core.pairingUrl).searchParams.get("key")!,
    async connectPhone(key = new URL(app.core.pairingUrl).searchParams.get("key")!) {
      const phone = await FakePhone.connect(app.remote.port, key);
      phones.push(phone);
      return phone;
    },
    async stop() {
      for (const p of phones) p.close();
      await app.stop();
      rmSync(thumbDir, { recursive: true, force: true });
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    },
  };
}

/** On the Library's first page, moves down to the Folders row (rows above it depend on what is indexed). */
export async function focusFolders(h: Harness, phone: FakePhone): Promise<void> {
  const onFolder = () => {
    const last = h.screen.last;
    return last.library?.entries.some((e) => e.path === last.focusedId) ?? false;
  };
  for (let i = 0; i < 12 && !onFolder() && h.screen.last.library?.rows?.length; i++) {
    await phone.press("down");
  }
}
