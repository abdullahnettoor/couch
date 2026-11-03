// Pure helpers for the GPL source bundle that ships beside each release (scripts/release-assets.mjs).

/** The formula and installed version of each row in THIRD-PARTY-LIBRARIES.md's table. */
export function manifestFormulae(manifest: string): { formula: string; version: string }[] {
  const rows: { formula: string; version: string }[] = [];
  for (const line of manifest.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 4 || cells[0] !== "") continue;
    const [, formula, version] = cells;
    if (!formula || formula.startsWith("Library") || /^-+$/.test(formula)) continue;
    rows.push({ formula, version });
  }
  return rows;
}

/** The keg folder name Homebrew would install now for a formula (`brew info --json=v2`): "1.2.3" or "1.2.3_1". */
export const currentKegVersion = (f: { versions: { stable: string }; revision: number }) =>
  f.revision ? `${f.versions.stable}_${f.revision}` : f.versions.stable;

/** Homebrew names cached downloads "<sha256>--<name>"; drop the hash. */
export const cachedName = (file: string) => file.replace(/^[0-9a-f]{64}--/, "");

/** Cached downloads that are bottles (built binaries), not source. */
export const isBottle = (file: string) =>
  /\.bottle(\.\d+)?\.tar\.gz$|bottle_manifest\.json$/.test(file);
