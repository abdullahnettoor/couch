import type { SignInResult } from "./app.ts";

/** The toast for a copy from Couch's Chromium engine; a cancelled one (a sign out came first) is quiet. */
export function copyFromCouchToast(label: string, result: SignInResult): string | undefined {
  if (result.ok)
    return `Copied ${result.count} ${label} ${result.count === 1 ? "cookie" : "cookies"}`;
  if (result.reason === "cancelled") return undefined;
  return result.reason === "none"
    ? `No ${label} sign-in found in Couch`
    : "Couldn't copy the sign-in from Couch";
}
