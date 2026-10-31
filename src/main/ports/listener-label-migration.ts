import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "./store.ts";
import { createLoginItem, type Exec } from "./login-item.ts";

/** The placeholder label of Couch's first LaunchAgent, replaced by LISTENER_LABEL. */
export const LEGACY_LISTENER_LABEL = "local.couch.listener";

const MARKER = "migrations";

export interface ListenerLabelMigration {
  home: string;
  uid: number;
  program: string | undefined;
  launch: string;
  store: Store;
  exec?: Exec;
}

/**
 * One-time, idempotent: moves the household's listener from the legacy label to the current one. The old job is
 * booted out first (so it frees the public port), its plist removed, and the new label registered only if the old
 * one was on. Does nothing outside an installed Couch.app (the new item could not be registered there).
 */
export async function migrateListenerLabel(o: ListenerLabelMigration): Promise<void> {
  const done = o.store.read<{ listenerLabel?: boolean }>(MARKER, {});
  if (done.listenerLabel) return;
  const shared = { home: o.home, uid: o.uid, program: o.program, launch: o.launch, exec: o.exec };
  const next = createLoginItem(shared);
  if (!(await next.state()).available) return;
  const old = createLoginItem({ ...shared, label: LEGACY_LISTENER_LABEL });
  if (existsSync(join(o.home, "Library", "LaunchAgents", `${LEGACY_LISTENER_LABEL}.plist`))) {
    const wasOn = (await old.state()).on;
    await old.set(false);
    if (wasOn) await next.set(true);
  }
  o.store.write(MARKER, { ...done, listenerLabel: true });
}
