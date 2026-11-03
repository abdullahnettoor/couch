/** Matching a CoreAudio output name to a page's audio output id: the web Apps' media and the Screen's Interface sounds. */

export interface PageOutput {
  deviceId: string;
  label: string;
}

/** Chromium labels outputs "<name> (<Transport>)" ("Default - " first for the default entry). */
function chromiumName(label: string): string {
  return label.replace(/\s*\([^()]*\)$/, "");
}

export type PickResult = { id: string } | { error: "none" | "ambiguous" };

/**
 * The page's output id for a CoreAudio device name. Chromium hashes its ids per profile, so the
 * label is the only link to the CoreAudio UID. A whole name wins; otherwise a prefix may match
 * (Chromium says "Microsoft Teams Audio Device" where CoreAudio says "Microsoft Teams Audio").
 * Two outputs with the same match are ambiguous, never guessed.
 */
export function pickOutputId(name: string, outputs: PageOutput[]): PickResult {
  const candidates = outputs.filter(
    (o) => o.deviceId !== "default" && o.deviceId !== "" && !o.label.startsWith("Default - "),
  );
  const exact = candidates.filter((o) => chromiumName(o.label) === name);
  const found = exact.length
    ? exact
    : candidates.filter((o) => chromiumName(o.label).startsWith(name));
  if (found.length === 1) return { id: found[0]!.deviceId };
  return { error: found.length ? "ambiguous" : "none" };
}
