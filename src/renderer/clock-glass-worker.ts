// The liquid clock's maps, built off the Screen's main thread (#37): one job per worker, then clock-glass.ts lets it go.
import { buildMaps, type MapJob } from "./clock-glass-maps.ts";

onmessage = (e: MessageEvent<MapJob>) => {
  // A failure is reported as the worker's own error, which reaches the page's `onerror`.
  buildMaps(e.data).then((maps) => postMessage(maps), reportError);
};
