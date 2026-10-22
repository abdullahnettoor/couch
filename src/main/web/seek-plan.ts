import type { AppKey } from "../apps/app.ts";
import type { WebAppDescription } from "./web-app.ts";

/** What one skip sends to the page: keys, and whether OK commits them afterwards. */
export function seekPlan(
  desc: Pick<WebAppDescription, "skip" | "seekKeys">,
  seconds: number,
  controlsUp: boolean,
): { keys: AppKey[]; commit: boolean } {
  if (desc.skip) return { keys: desc.skip.keys(seconds, controlsUp), commit: true };
  if (desc.seekKeys)
    return { keys: [seconds < 0 ? desc.seekKeys.back : desc.seekKeys.forward], commit: false };
  return { keys: [], commit: false };
}
