// Which licence texts ship for a bundled Homebrew formula. A keg's own files are used where they hold the text;
// where a keg only has an overview that points elsewhere, the missing texts are vendored in scripts/licenses/.
// Packaging fails when a formula ends up with no text, or without a file listed here.
import { isLicenceFile } from "./third-party.mts";

/** Files that must be in `licenses/<formula>/` where the keg alone isn't enough (vendored) or has it under an unusual name. */
export const REQUIRED_LICENCE_FILES: Record<string, string[]> = {
  // keg's LICENSE.TXT says the terms are in docs/FTL.TXT, or the GPLv2 in docs/GPLv2.TXT
  freetype: ["FTL.TXT", "GPLv2.TXT"],
  // keg's LICENSE says lib/ is BSD 2-Clause without the text
  lz4: ["LICENSE-lib"],
  // keg's LICENSE.md points to README.ijg
  "jpeg-turbo": ["README.ijg"],
  // keg's COPYING is the GPL for the tools; libintl is LGPL-2.1-or-later
  gettext: ["COPYING.LIB"],
  // keg's COPYING points to LICENCE, which the keg ships as LICENCE.md
  pcre2: ["LICENCE.md"],
};

export type ShippedLicence = { name: string; from: "keg" | "vendored" };

export function planLicences(
  formula: string,
  kegFiles: string[],
  vendoredFiles: string[],
  required: Record<string, string[]> = REQUIRED_LICENCE_FILES,
): ShippedLicence[] {
  const plan: ShippedLicence[] = [
    ...kegFiles.filter(isLicenceFile).map((name): ShippedLicence => ({ name, from: "keg" })),
    ...vendoredFiles
      .filter((name) => !kegFiles.includes(name))
      .map((name): ShippedLicence => ({ name, from: "vendored" })),
  ];
  if (!plan.length) throw new Error(`${formula}: no licence text in its keg or scripts/licenses`);
  const missing = (required[formula] ?? []).filter((f) => !plan.some((p) => p.name === f));
  if (missing.length)
    throw new Error(
      `${formula}: required licence file(s) missing: ${missing.join(", ")} (add them to scripts/licenses/${formula})`,
    );
  return plan;
}
