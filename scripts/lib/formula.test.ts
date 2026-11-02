import { describe, expect, it } from "vite-plus/test";
import { parseFormula } from "./formula.mts";

const tarball = `class Zimg < Formula
  desc "Scaling"
  url "https://github.com/sekrit-twc/zimg/archive/refs/tags/release-3.0.6.tar.gz"
  sha256 "be89390f13a5c9b2388ce0f44a5e89364a20c1c57ce46d382b1fcc3967057577"
  license "WTFPL"
  head "https://github.com/sekrit-twc/zimg.git", branch: "master"

  bottle do
    sha256 cellar: :any, arm64_tahoe: "aaaa"
  end

  test do
    resource "homebrew-test" do
      url "https://example.com/test.ivf"
      sha256 "bbbb"
    end
  end
end
`;
const git = `class X264 < Formula
  # the latest commit on the stable branch
  url "https://code.videolan.org/videolan/x264.git",
      revision: "b35605ace3ddf7c1a5d67a2eb553f034aef41d55"
  version "r3222"
  head "https://code.videolan.org/videolan/x264.git", branch: "master"

  livecheck do
    url "https://artifacts.videolan.org/x264/release-macos-arm64/"
  end
end
`;
const patched = `class Mpv < Formula
  head "https://github.com/mpv-player/mpv.git", branch: "master"

  stable do
    url "https://github.com/mpv-player/mpv/archive/refs/tags/v0.41.0.tar.gz"
    sha256 "ee21"

    # Backport of fixes
    patch do
      url "https://github.com/mpv-player/mpv/commit/75b2.patch?full_index=1"
      sha256 "3906"
    end

    patch do
      url "https://github.com/mpv-player/mpv/commit/c5d3.patch?full_index=1"
      sha256 "769b"
    end
  end

  on_linux do
    patch do
      url "https://example.com/linux-only.patch"
    end
  end
end
`;
const inline = `class Libvpx < Formula
  url "https://github.com/webmproject/libvpx/archive/refs/tags/v1.17.0.tar.gz"
  sha256 "1020"
  patch :DATA
end
`;
const pinnedResources = `class Shaderc < Formula
  stable do
    url "https://github.com/google/shaderc/archive/refs/tags/v2026.4.tar.gz"
    sha256 "f06c"

    resource "glslang" do
      # from DEPS
      url "https://github.com/KhronosGroup/glslang.git",
          revision: "e1b562a8bed273a02f30b59b66a5d499793cede5"
    end
  end
end
`;
const fileAndStage = `class Glib < Formula
  url "https://example.com/glib.tar.xz"
  resource "gobject-introspection" do
    url "https://example.com/gi.tar.xz"
    sha256 "920d"
  end

  patch do
    file "Patches/glib/hardcoded-paths.diff"
  end

  def install
    resource("gobject-introspection").stage do
      system "true"
    end
  end
end
`;
const tagged = `class Foo < Formula
  url "https://github.com/foo/foo.git",
      tag:      "v1.2",
      revision: "abc123"
end
`;

describe("parseFormula", () => {
  it("takes the stable url and its checksum, ignoring head, bottles, tests and livecheck", () => {
    expect(parseFormula(tarball)).toEqual({
      url: "https://github.com/sekrit-twc/zimg/archive/refs/tags/release-3.0.6.tar.gz",
      sha256: "be89390f13a5c9b2388ce0f44a5e89364a20c1c57ce46d382b1fcc3967057577",
      patches: [],
      resources: [],
    });
  });
  it("keeps the revision a git source is pinned to", () => {
    expect(parseFormula(git)).toMatchObject({
      url: "https://code.videolan.org/videolan/x264.git",
      revision: "b35605ace3ddf7c1a5d67a2eb553f034aef41d55",
    });
    expect(parseFormula(git)?.sha256).toBeUndefined();
  });
  it("keeps tag and revision when a git url has both", () => {
    expect(parseFormula(tagged)).toMatchObject({ tag: "v1.2", revision: "abc123" });
  });
  it("lists the patches Homebrew applies, not the head-only or linux-only ones", () => {
    expect(parseFormula(patched)).toMatchObject({
      url: "https://github.com/mpv-player/mpv/archive/refs/tags/v0.41.0.tar.gz",
      sha256: "ee21",
      patches: [
        "https://github.com/mpv-player/mpv/commit/75b2.patch?full_index=1",
        "https://github.com/mpv-player/mpv/commit/c5d3.patch?full_index=1",
      ],
    });
  });
  it("notes a patch carried inside the formula itself", () => {
    expect(parseFormula(inline)?.patches).toEqual(["inline patch in the formula (patch :DATA)"]);
  });
  it("lists extra sources the formula builds in, with their pins", () => {
    expect(parseFormula(pinnedResources)?.resources).toEqual([
      {
        name: "glslang",
        url: "https://github.com/KhronosGroup/glslang.git",
        revision: "e1b562a8bed273a02f30b59b66a5d499793cede5",
      },
    ]);
  });
  it("notes a patch kept in Homebrew's formula repository, and lists each resource once", () => {
    const parsed = parseFormula(fileAndStage);
    expect(parsed?.patches).toEqual([
      "patch file in Homebrew's formula repository: Patches/glib/hardcoded-paths.diff",
    ]);
    expect(parsed?.resources).toEqual([
      { name: "gobject-introspection", url: "https://example.com/gi.tar.xz", sha256: "920d" },
    ]);
  });
  it("is undefined when there is no source url at all", () => {
    expect(parseFormula("class Empty < Formula\nend\n")).toBeUndefined();
  });
});
