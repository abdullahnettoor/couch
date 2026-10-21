import { kill } from "node:process";
import { connect } from "node:net";
import type { Store } from "./ports/store.ts";

/** What the listener writes to `listener.json` (in Couch's app data folder). */
export interface ListenerStatus {
  pid: number;
  publicPort: number;
  appPort: number;
  token: string;
}

export interface ListenerProbe {
  pidExists(pid: number): boolean;
  portAnswers(port: number): Promise<boolean>;
}

export const systemProbe: ListenerProbe = {
  pidExists(pid) {
    try {
      kill(pid, 0);
      return true;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === "EPERM";
    }
  },
  portAnswers: (port) =>
    new Promise((resolve) => {
      const socket = connect({ host: "127.0.0.1", port });
      socket.setTimeout(1000);
      socket.once("connect", () => (socket.destroy(), resolve(true)));
      socket.once("error", () => resolve(false));
      socket.once("timeout", () => (socket.destroy(), resolve(false)));
    }),
};

const isPort = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0;

/** The status file, if its listener is alive (pid exists and its public port answers); a stale file counts as none. */
export async function liveListener(
  store: Store,
  probe: ListenerProbe = systemProbe,
): Promise<ListenerStatus | undefined> {
  const s = store.read<Partial<ListenerStatus> | null>("listener", null);
  if (!s || !Number.isInteger(s.pid) || !isPort(s.publicPort) || typeof s.token !== "string")
    return undefined;
  if (!s.token || !probe.pidExists(s.pid!) || !(await probe.portAnswers(s.publicPort)))
    return undefined;
  return {
    pid: s.pid!,
    publicPort: s.publicPort,
    appPort: isPort(s.appPort) ? s.appPort : Number(process.env.COUCH_APP_PORT ?? 4748),
    token: s.token,
  };
}

/** Behind a live listener Couch binds loopback only on the app port; otherwise all interfaces on the public one. */
export function chooseBinding(
  status: ListenerStatus | undefined,
  env: { COUCH_PORT?: string },
): { port: number; host?: string } {
  if (status) return { port: status.appPort, host: "127.0.0.1" };
  return { port: Number(env.COUCH_PORT ?? 4747) };
}
