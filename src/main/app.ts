import type { GridItem, ScreenPayload, UiSoundEvent } from "../shared/protocol.ts";
import { Core, type Ports, type Source } from "./core/core.ts";
import type { Command } from "../shared/protocol.ts";
import { createFrontdoor, type FrontdoorOptions } from "./frontdoor.ts";
import { startRemoteServer, type RemoteServer } from "./remote/server.ts";

export interface CouchApp {
  core: Core;
  remote: RemoteServer;
  /** The Screen's keyboard sends the same commands as a phone. */
  screenCommand(command: Command): void;
  reportGrid(viewKey: string, items: GridItem[]): void;
  /** What the Screen renderer would draw right now. */
  screen(): ScreenPayload;
  /** A quiet toast on the Screen (and mirrored on the Remote). */
  toast(text: string): void;
  /** Couch's own ⌘Q: asks "Quit Couch?". Other quits never ask. */
  askQuit(): void;
  /** Saves playback state and stops the player; called on ⌘Q. */
  beforeQuit(): void;
  /** Subscribe to what the renderer should draw. */
  onScreen(listener: (payload: ScreenPayload) => void): () => void;
  /** Subscribe to the Interface sounds the renderer should play. */
  onSound(listener: (event: UiSoundEvent) => void): () => void;
  stop(): Promise<void>;
}

export interface AppOptions extends Ports {
  /** 0 picks a random port (tests). */
  port: number;
  host?: string;
  /** Folder of cached thumbnails the Remote server may serve (by key only). */
  thumbnailDir?: string;
  /** Folder with the Remote page's icons (the renderer's public files). */
  iconDir?: string;
  /** Set to let the listener toggle move the Remote server between the public port and loopback. */
  frontdoorSetup?: Pick<FrontdoorOptions, "env" | "probe" | "sleep" | "windowMs" | "pollMs">;
}

/** Wires the core and the Remote server to the given ports. Tests and Electron both start it. */
export async function startApp(options: AppOptions): Promise<CouchApp> {
  let remote: RemoteServer | undefined;
  const serve = async (
    binding: { port: number; host?: string },
    listener: AppOptions["listener"],
  ) => {
    core.setListener(listener);
    remote = await startRemoteServer(core, {
      ...options,
      port: binding.port,
      host: binding.host,
      listener,
    });
  };
  const frontdoor = options.frontdoorSetup && {
    ...createFrontdoor({
      probe: options.listenerProbe,
      ...options.frontdoorSetup,
      store: options.store,
      remote: {
        release: async () => {
          const old = remote;
          remote = undefined;
          await old?.close();
        },
        bind: async (binding, listener) => {
          await remote?.close();
          remote = undefined;
          await serve(
            binding,
            listener && { publicPort: listener.publicPort, token: listener.token },
          );
        },
      },
    }),
  };
  const core = new Core({ ...options, frontdoor });
  await serve({ port: options.port, host: options.host }, options.listener);
  const screenSource: Source = "screen";
  return {
    core,
    get remote() {
      return remote!;
    },
    screenCommand: (command) => core.handle(command, screenSource),
    reportGrid: (viewKey, items) => core.reportGrid(viewKey, items),
    screen: () => core.screen(),
    toast: (text) => core.showToast(text),
    askQuit: () => core.askQuit(),
    beforeQuit: () => core.beforeQuit(),
    onScreen(listener) {
      return core.onChange(() => listener(core.screen()));
    },
    onSound: (listener) => core.onSound(listener),
    async stop() {
      await remote?.close();
      core.dispose();
    },
  };
}
