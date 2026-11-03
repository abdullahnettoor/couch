// What the beta update feed names: the newest published release, beta or stable (scripts/beta-feed.mjs).
import { compareVersions, parseVersion } from "../../src/shared/semver.ts";

/** The fields of a GitHub release the feed needs (GET /repos/{owner}/{repo}/releases). */
export interface GitHubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  assets: { name: string; browser_download_url: string }[];
}

/** One beta feed file, which is also the update Squirrel.Mac downloads (`url`, `name`, `notes`). */
export interface BetaFeed {
  version: string;
  name: string;
  notes: string;
  url: string;
}

/** The feed file's name for an arch: `beta-darwin-arm64.json`. */
export const betaFeedFile = (arch: string) => `beta-darwin-${arch}.json`;

/**
 * The newest published release (pre-release or not) with an updater zip for this arch, so a beta Mac also
 * moves on to a stable release that is newer than its beta. Undefined when there is none.
 */
export function pickBetaFeed(releases: GitHubRelease[], arch: string): BetaFeed | undefined {
  const zip = new RegExp(`^Couch-darwin-${arch}-.+\\.zip$`);
  let best: BetaFeed | undefined;
  for (const r of releases) {
    const version = r.tag_name.replace(/^v/, "");
    if (r.draft || !r.tag_name.startsWith("v") || !parseVersion(version)) continue;
    const asset = r.assets.find((a) => zip.test(a.name));
    if (!asset) continue;
    if (best && compareVersions(version, best.version) <= 0) continue;
    best = {
      version,
      name: r.name || `Couch ${version}`,
      notes: r.body ?? "",
      url: asset.browser_download_url,
    };
  }
  return best;
}
