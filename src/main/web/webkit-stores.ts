import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WebKitBridge, WebKitStore } from "./webkit-bridge.ts";

export const WEBKIT_STORES_FILE = "webkit-stores.json";

interface StoreEnv {
  userDataDir: string;
  env: Record<string, string | undefined>;
}

/** Only the exact value `1`: a non-persistent store that leaves no sign-in behind (for checks). */
export function webkitEphemeral(env: Record<string, string | undefined>): boolean {
  return env.COUCH_WEBKIT_EPHEMERAL === "1";
}

/** A random UUID created once per userData root, so one root's stores never alias another's. */
function namespaceFor(userDataDir: string): string {
  const file = join(userDataDir, WEBKIT_STORES_FILE);
  try {
    const saved = (JSON.parse(readFileSync(file, "utf8")) as { namespace?: unknown }).namespace;
    if (typeof saved === "string" && /^[0-9a-f-]{36}$/.test(saved)) return saved;
  } catch {
    // missing or damaged: make a new one
  }
  const namespace = randomUUID();
  mkdirSync(userDataDir, { recursive: true });
  writeFileSync(file, JSON.stringify({ namespace }));
  return namespace;
}

/** A stable UUID (version 5 layout) from the userData namespace and the App id. */
export function webkitStoreId(namespace: string, appId: string): string {
  const h = createHash("sha1").update(`couch.webkit.${namespace}.${appId}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** The App's data store for this userData root: persistent and its own, or non-persistent under `COUCH_WEBKIT_EPHEMERAL=1`. */
export function resolveWebKitStore(appId: string, o: StoreEnv): WebKitStore {
  if (webkitEphemeral(o.env)) return { ephemeral: true };
  return { ephemeral: false, id: webkitStoreId(namespaceFor(o.userDataDir), appId) };
}

/** Removes the App's persistent store (ticket 115's sign out). Close its view first: WebKit refuses a store that is in use. */
export async function removeWebKitStore(
  appId: string,
  o: StoreEnv & { bridge: Pick<WebKitBridge, "removeStore"> },
): Promise<void> {
  const store = resolveWebKitStore(appId, o);
  if (!store.ephemeral) await o.bridge.removeStore(store.id);
}
