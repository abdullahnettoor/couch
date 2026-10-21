import {
  chooseBinding,
  liveListener,
  systemProbe,
  type ListenerProbe,
  type ListenerStatus,
} from "./listener.ts";
import type { Store } from "./ports/store.ts";

export interface Binding {
  port: number;
  host?: string;
}

export interface DetectOptions {
  store: Store;
  probe?: ListenerProbe;
  /** Whether the listener's LaunchAgent is loaded (so one is probably on its way up). */
  installed(): Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for an installed listener that isn't answering yet. */
  windowMs?: number;
  pollMs?: number;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The live listener, if there is one. When one is installed but still starting (no status file yet, port
 * not answering), keeps looking for a short window so Couch doesn't take the public port from under it.
 */
export async function detectListener(o: DetectOptions): Promise<ListenerStatus | undefined> {
  const now = await liveListener(o.store, o.probe ?? systemProbe);
  if (now || !(await o.installed().catch(() => false))) return now;
  const sleep = o.sleep ?? wait;
  const pollMs = o.pollMs ?? 250;
  for (let waited = 0; waited < (o.windowMs ?? 8000); waited += pollMs) {
    await sleep(pollMs);
    const found = await liveListener(o.store, o.probe ?? systemProbe);
    if (found) return found;
  }
  return undefined;
}

export interface FrontdoorOptions extends Omit<DetectOptions, "installed"> {
  env: { COUCH_PORT?: string };
  remote: {
    /** Stop serving (so the public port is free). */
    release(): Promise<void>;
    bind(binding: Binding, listener: ListenerStatus | undefined): Promise<void>;
  };
}

const isInUse = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "EADDRINUSE";

/** Moves Couch's Remote server between the public port and loopback as the listener comes and goes. */
export function createFrontdoor(o: FrontdoorOptions) {
  const sleep = o.sleep ?? wait;
  const pollMs = o.pollMs ?? 250;
  const windowMs = o.windowMs ?? 15000;

  const bindPublic = async () => {
    for (let waited = 0; ; waited += pollMs) {
      try {
        return await o.remote.bind(chooseBinding(undefined, o.env), undefined);
      } catch (e) {
        if (!isInUse(e) || waited >= windowMs) throw e;
        await sleep(pollMs);
      }
    }
  };

  return {
    /** Before the login item is turned on: free the public port for the listener. */
    beforeEnable: () => o.remote.release(),
    /** After the login item changed: sit behind the listener if it came up, otherwise take the public port. */
    async afterChange(on: boolean): Promise<void> {
      const status = on
        ? await detectListener({ ...o, installed: async () => true, windowMs })
        : undefined;
      if (status) return o.remote.bind(chooseBinding(status, o.env), status);
      await bindPublic();
    },
  };
}
