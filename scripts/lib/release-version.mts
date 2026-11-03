// Version rules for `pnpm release` (scripts/release.mjs): SemVer, tagged v<version>.
import { compareVersions, parseVersion } from "../../src/shared/semver.ts";

export { compareVersions, parseVersion };

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
