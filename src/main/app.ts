import type { GridItem, ScreenPayload } from "../shared/protocol.ts";
import { Core, type Ports, type Source } from "./core/core.ts";
import type { Command } from "../shared/protocol.ts";
import { startRemoteServer, type RemoteServer } from "./remote/server.ts";

export interface CouchApp {
  core: Core;
  remote: RemoteServer;
  /** The Screen's keyboard sends the same commands as a phone. */
  screenCommand(command: Command): void;
  reportGrid(viewKey: string, items: GridItem[]): void;
  /** What the Screen renderer would draw right now. */
  screen(): ScreenPayload;
  /** Saves playback state and stops the player; called on ⌘Q. */
  beforeQuit(): void;
  /** Subscribe to what the renderer should draw. */
  onScreen(listener: (payload: ScreenPayload) => void): () => void;
  stop(): Promise<void>;
}

export interface AppOptions extends Ports {
  /** 0 picks a random port (tests). */
  port: number;
  host?: string;
}

/** Wires the core and the Remote server to the given ports. Tests and Electron both start it. */
export async function startApp(options: AppOptions): Promise<CouchApp> {
  const core = new Core(options);
  const remote = await startRemoteServer(core, options);
  const screenSource: Source = "screen";
  return {
    core,
    remote,
    screenCommand: (command) => core.handle(command, screenSource),
    reportGrid: (viewKey, items) => core.reportGrid(viewKey, items),
    screen: () => core.screen(),
    beforeQuit: () => core.beforeQuit(),
    onScreen(listener) {
      return core.onChange(() => listener(core.screen()));
    },
    async stop() {
      await remote.close();
      core.dispose();
    },
  };
}
