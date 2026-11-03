// Version rules for `pnpm release` (scripts/release.mjs): SemVer, tagged v<version>.

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?$/;

type Parsed = { core: [number, number, number]; pre: string[] };

export function parseVersion(version: string): Parsed | undefined {
  const m = SEMVER.exec(version);
  if (!m) return undefined;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split(".") : [] };
}

/** Negative, zero or positive, as SemVer orders versions (a pre-release comes before its release). */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) throw new Error(`not a SemVer version: ${x ? b : a}`);
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i]! - y.core[i]!;
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

/**
 * The version to release: `patch`, `minor` or `major` bump the current one (from a pre-release, its own
 * release); anything else must be a SemVer version newer than the current one.
 */
export function nextVersion(current: string, wanted: string): string {
  const now = parseVersion(current);
  if (!now) throw new Error(`package.json's version isn't SemVer: ${current}`);
  const [major, minor, patch] = now.core;
  const pre = now.pre.length > 0;
  const next =
    wanted === "patch"
      ? pre
        ? `${major}.${minor}.${patch}`
        : `${major}.${minor}.${patch + 1}`
      : wanted === "minor"
        ? pre && patch === 0
          ? `${major}.${minor}.0`
          : `${major}.${minor + 1}.0`
        : wanted === "major"
          ? pre && minor === 0 && patch === 0
            ? `${major}.0.0`
            : `${major + 1}.0.0`
          : wanted.replace(/^v/, "");
  if (!parseVersion(next))
    throw new Error(`"${wanted}" isn't patch, minor, major or a version such as 0.2.0`);
  if (compareVersions(next, current) <= 0)
    throw new Error(`${next} isn't newer than the current version ${current}`);
  return next;
}

/** package.json with only its "version" changed, keeping the file's own formatting. */
export function withVersion(packageJson: string, version: string): string {
  let replaced = 0;
  const out = packageJson.replace(
    /^((?: {2}|\t)"version":\s*")[^"]*(")/m,
    (_, a: string, b: string) => {
      replaced++;
      return `${a}${version}${b}`;
    },
  );
  if (replaced !== 1) throw new Error('package.json has no top-level "version"');
  return out;
}
