import { chromeIdentity } from "../../web/chrome-identity.ts";
import { urlRoute } from "../../web/url-route.ts";
import type { WebAppDescription } from "../../web/web-app.ts";
import { BitChordBridge, type BridgeNetwork } from "./bitchord-bridge.ts";
import { BITCHORD_ARTWORK_HOSTS, BITCHORD_PLAYBACK } from "./bitchord-playback.ts";
import { BITCHORD_RELAY } from "./bitchord-relay.ts";
import { bitchordRequestHeaders, bitchordResponseHeaders } from "./bitchord-rules.ts";
import { bitchordOrigins, bitchordSite, isBitchordHome } from "./bitchord-route.ts";

export const BITCHORD_PARTITION = "persist:bitchord";

/**
 * BitChord as a web App: its own hosted web player, signed out, as plain Chrome. Couch stands in for BitChord's browser
 * extension: the page relay and bridge answers, and the extension's header rules on this partition only.
 */
export function bitchordDescription(
  version: string | undefined,
  net: BridgeNetwork,
  env: Record<string, string | undefined> = {},
): WebAppDescription {
  const site = bitchordSite(env);
  const origins = bitchordOrigins(site);
  const bridge = new BitChordBridge(net);
  return {
    id: "bitchord",
    url: `${site}/home`,
    partition: BITCHORD_PARTITION,
    identity: chromeIdentity(version),
    keyCodes: {
      up: "Up",
      down: "Down",
      left: "Left",
      right: "Right",
      ok: "Return",
      back: "Escape",
    },
    backByHistory: true,
    isOwnOrigin: (origin) => origins.includes(origin),
    route: urlRoute(isBitchordHome),
    preloads: [BITCHORD_RELAY],
    artworkHosts: BITCHORD_ARTWORK_HOSTS,
    playback: BITCHORD_PLAYBACK,
    requests: {
      onBeforeSendHeaders: bitchordRequestHeaders,
      onHeadersReceived: bitchordResponseHeaders,
    },
    bridge: (request) => bridge.answer(request),
    addons: [],
    enabledAddons: [],
  };
}
