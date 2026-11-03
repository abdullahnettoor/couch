// Writes the beta update feed: `beta-darwin-<arch>.json` on the `beta-feed` GitHub release, naming the newest
// published release (beta or stable). Couch on the beta channel reads it (src/main/ports/updates.ts).
// Runs in GitHub Actions with GH_TOKEN; `gh` must be installed.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { betaFeedFile, pickBetaFeed } from "./lib/beta-feed.mts";

const FEED_TAG = "beta-feed";
const ARCHES = ["arm64"];
const gh = (args) =>
  execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

const releases = JSON.parse(gh(["api", "repos/{owner}/{repo}/releases?per_page=100"]));
const dir = mkdtempSync(join(tmpdir(), "couch-beta-feed-"));
const files = [];
for (const arch of ARCHES) {
  const feed = pickBetaFeed(releases, arch);
  if (!feed) {
    console.warn(`No published release has a darwin-${arch} zip yet; no ${betaFeedFile(arch)}.`);
    continue;
  }
  const file = join(dir, betaFeedFile(arch));
  writeFileSync(file, `${JSON.stringify(feed, null, 2)}\n`);
  files.push(file);
  console.log(`${betaFeedFile(arch)} → ${feed.version}`);
}
if (!files.length) process.exit(0);

// A pre-release with a non-SemVer tag: update.electronjs.org and GitHub's "Latest" both pass it by.
if (!releases.some((r) => r.tag_name === FEED_TAG))
  gh([
    "release",
    "create",
    FEED_TAG,
    "--prerelease",
    "--latest=false",
    "--target",
    "main",
    "--title",
    "Beta update feed",
    "--notes",
    "Not a release: the file Couch's beta channel reads to find its next update. See SHIPPING.md.",
  ]);
gh(["release", "upload", FEED_TAG, ...files, "--clobber"]);
