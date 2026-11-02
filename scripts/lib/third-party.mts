// What `vp run package` writes beside the bundled libraries: which Homebrew formula each came from, its licence
// and where its source is, as GPL requires for libraries we redistribute.

import type { Pin } from "./formula.mts";

export type Keg = { formula: string; version: string; dir: string };
export type ThirdParty = {
  formula: string;
  version: string;
  license: string | undefined;
  /** Source url from the formula (or the keg's SBOM when the formula file is missing). */
  source: string;
  /** What the formula pins it to: "revision …", "tag …", "sha256 …". */
  pins: string[];
  /** Patches Homebrew applies when building it. */
  patches: string[];
  /** Extra sources the formula builds in, as one line each. */
  extraSources: string[];
  libraries: string[];
  licenceFiles: string[];
};

export const describePin = (p: Pin) =>
  [
    p.tag && `tag ${p.tag}`,
    p.revision && `revision ${p.revision}`,
    p.sha256 && `sha256 ${p.sha256}`,
  ].filter((x): x is string => !!x);

export function kegOf(realPath: string): Keg | undefined {
  const m = /^(.*\/Cellar\/([^/]+)\/([^/]+))\//.exec(realPath);
  return m ? { formula: m[2], version: m[3], dir: m[1] } : undefined;
}

// LICENSE/COPYING files, and SPDX-named texts such as glib's LGPL-2.1-or-later.txt.
export const isLicenceFile = (name: string) =>
  /^(LICEN[CS]E|COPYING|COPYRIGHT|NOTICE|UNLICENSE)/i.test(name) ||
  /^(A?L?GPL|MPL|Apache|BSD|MIT|ISC|Zlib|CC0)[\w.+-]*\.txt$/i.test(name);

export function renderManifest(entries: ThirdParty[]): string {
  const rows = entries.map(
    (e) =>
      `| ${e.formula} | ${e.version} | ${e.license ?? "unknown"} | ${e.source || "unknown"} | ${e.pins.join("; ") || "-"} | ${e.libraries.join(", ")} |`,
  );
  const texts = entries
    .filter((e) => e.licenceFiles.length)
    .map(
      (e) =>
        `- ${e.formula}: ${e.licenceFiles.map((f) => `licenses/${e.formula}/${f}`).join(", ")}`,
    );
  const patched = entries
    .filter((e) => e.patches.length)
    .map((e) => `- ${e.formula}:\n${e.patches.map((p) => `  - ${p}`).join("\n")}`);
  const extras = entries
    .filter((e) => e.extraSources.length)
    .map((e) => `- ${e.formula}:\n${e.extraSources.map((x) => `  - ${x}`).join("\n")}`);
  return `# Third-party libraries bundled in Couch

Couch plays the Library with libmpv, and ships it with the libraries it needs, taken from Homebrew when this app was packaged. They are free software under the licences below; Couch itself is GPL-3.0-or-later. The licence texts are in the \`licenses\` folder next to this file.

| Library (Homebrew formula) | Version | Licence | Source | Pinned to | Files |
| --- | --- | --- | --- | --- | --- |
${rows.join("\n")}

## Licence texts

${texts.join("\n")}

## Patches Homebrew applies

Homebrew builds each formula from the source above plus these patches (none for formulae not listed).

${patched.join("\n") || "None."}

## Other sources built in

Extra sources a formula fetches when building (some are build tools only).

${extras.join("\n") || "None."}
`;
}
