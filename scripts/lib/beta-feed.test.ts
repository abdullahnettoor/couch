import { describe, expect, it } from "vite-plus/test";
import { betaFeedFile, pickBetaFeed, type GitHubRelease } from "./beta-feed.mts";

const release = (tag: string, extra: Partial<GitHubRelease> = {}): GitHubRelease => ({
  tag_name: tag,
  name: `Couch ${tag.slice(1)}`,
  body: `notes for ${tag}`,
  draft: false,
  assets: [
    { name: `Couch-${tag.slice(1)}-arm64.dmg`, browser_download_url: `https://x/${tag}/dmg` },
    {
      name: `Couch-darwin-arm64-${tag.slice(1)}.zip`,
      browser_download_url: `https://x/${tag}/zip`,
    },
  ],
  ...extra,
});

describe("pickBetaFeed", () => {
  it("names the newest beta when it is newer than stable", () => {
    expect(
      pickBetaFeed(
        [release("v0.1.1"), release("v0.2.0-beta.2"), release("v0.2.0-beta.1")],
        "arm64",
      ),
    ).toEqual({
      version: "0.2.0-beta.2",
      name: "Couch 0.2.0-beta.2",
      notes: "notes for v0.2.0-beta.2",
      url: "https://x/v0.2.0-beta.2/zip",
    });
  });
  it("moves on to the stable release that follows the beta", () => {
    expect(pickBetaFeed([release("v0.2.0-beta.2"), release("v0.2.0")], "arm64")?.version).toBe(
      "0.2.0",
    );
  });
  it("skips drafts, the feed's own release, other tags and releases without the arch's zip", () => {
    const releases = [
      release("v0.1.1"),
      release("v0.3.0", { draft: true }),
      release("beta-feed"),
      release("v9.9", {}),
      release("v0.2.0", { assets: [] }),
    ];
    expect(pickBetaFeed(releases, "arm64")?.version).toBe("0.1.1");
    expect(pickBetaFeed(releases, "x64")).toBeUndefined();
  });
  it("names the feed file by arch", () => {
    expect(betaFeedFile("arm64")).toBe("beta-darwin-arm64.json");
  });
});
