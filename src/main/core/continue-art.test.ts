import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { ContinueArt, downloadArt, MAX_ART_BYTES, type ArtFetch } from "./continue-art.ts";

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const HOSTS = ["nflximg.net"];
const URL_OK = "https://occ-0-1.1.nflximg.net/dnm/api/v6/abc.jpg?token=secret&e=1";

const image = (bytes: Uint8Array = JPEG, type = "image/jpeg", extra: Record<string, string> = {}) =>
  new Response(bytes as BodyInit, { headers: { "content-type": type, ...extra } });

const seen: Array<{ url: string; init: Record<string, unknown> }> = [];
const fetcher =
  (answer: (url: string) => Response): ArtFetch =>
  async (url, init) => {
    seen.push({ url, init: init as Record<string, unknown> });
    return answer(url);
  };

describe("downloading an App's art", () => {
  test("fetches without cookies, from https on the App's own host, and returns the image", async () => {
    seen.length = 0;
    const got = await downloadArt(
      URL_OK,
      HOSTS,
      fetcher(() => image()),
    );
    expect(got).toEqual(JPEG);
    expect(seen[0]!.init).toMatchObject({ credentials: "omit", redirect: "manual" });
  });

  test("refuses http, other hosts, look-alikes and non-URLs without asking the network", async () => {
    seen.length = 0;
    for (const url of [
      "http://occ-0-1.nflximg.net/a.jpg",
      "https://evil.example/a.jpg",
      "https://nflximg.net.evil.example/a.jpg",
      "https://user:pw@occ.nflximg.net/a.jpg",
      "data:image/png;base64,AAAA",
      "not a url",
    ])
      expect(
        await downloadArt(
          url,
          HOSTS,
          fetcher(() => image()),
        ),
      ).toBeUndefined();
    expect(seen).toEqual([]);
  });

  test("accepts only image types: SVG, HTML and bytes that are not an image are refused", async () => {
    expect(
      await downloadArt(
        URL_OK,
        HOSTS,
        fetcher(() => image(JPEG, "image/svg+xml")),
      ),
    ).toBeUndefined();
    expect(
      await downloadArt(
        URL_OK,
        HOSTS,
        fetcher(() => image(JPEG, "text/html")),
      ),
    ).toBeUndefined();
    const html = new TextEncoder().encode("<html>not an image</html>");
    expect(
      await downloadArt(
        URL_OK,
        HOSTS,
        fetcher(() => image(html)),
      ),
    ).toBeUndefined();
  });

  test("caps the size at about 2 MB, by header and by what actually arrives", async () => {
    const big = new Uint8Array(MAX_ART_BYTES + 10);
    big.set(JPEG);
    expect(
      await downloadArt(
        URL_OK,
        HOSTS,
        fetcher(() => image(big)),
      ),
    ).toBeUndefined();
    const lying = image(JPEG, "image/jpeg", { "content-length": String(MAX_ART_BYTES + 1) });
    expect(
      await downloadArt(
        URL_OK,
        HOSTS,
        fetcher(() => lying),
      ),
    ).toBeUndefined();
  });

  test("a redirect is followed only to another own https address; anywhere else it is refused", async () => {
    const to = (location: string) => new Response(null, { status: 302, headers: { location } });
    const hop = fetcher((url) =>
      url.includes("/a.jpg") ? to("https://other.nflximg.net/b.jpg") : image(),
    );
    expect(await downloadArt(URL_OK, HOSTS, hop)).toEqual(JPEG);
    const away = fetcher(() => to("https://evil.example/b.jpg"));
    expect(await downloadArt(URL_OK, HOSTS, away)).toBeUndefined();
    const plain = fetcher(() => to("http://occ.nflximg.net/b.jpg"));
    expect(await downloadArt(URL_OK, HOSTS, plain)).toBeUndefined();
  });

  test("a failing or non-200 answer gives nothing", async () => {
    expect(
      await downloadArt(
        URL_OK,
        HOSTS,
        fetcher(() => new Response("", { status: 404 })),
      ),
    ).toBeUndefined();
    const boom: ArtFetch = async () => {
      throw new Error("offline");
    };
    expect(await downloadArt(URL_OK, HOSTS, boom)).toBeUndefined();
  });
});

describe("the art folder", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const make = (answer: (url: string) => Response = () => image()) => {
    const dir = join(mkdtempSync(join(tmpdir(), "couch-cart-")), "continue-art");
    dirs.push(join(dir, ".."));
    const art = new ContinueArt(dir, fetcher(answer));
    return { art, dir };
  };

  test("saves a download as <hash>.jpg named by a hash, never by the URL", async () => {
    const { art, dir } = make();
    const key = await art.get(URL_OK, HOSTS);
    expect(key).toMatch(/^[0-9a-f]{40}$/);
    expect(readdirSync(dir)).toEqual([`${key}.jpg`]);
    expect(readdirSync(dir).join("")).not.toContain("secret");
    expect(art.fileUrl(key!)).toBe(`file://${join(dir, `${key}.jpg`)}`);
  });

  test("downloads once: a second ask for the same picture uses the file", async () => {
    seen.length = 0;
    const { art } = make();
    await art.get(URL_OK, HOSTS);
    await art.get(URL_OK, HOSTS);
    expect(seen).toHaveLength(1);
  });

  test("remove and sweep delete files; only well-formed keys are touched", async () => {
    const { art, dir } = make();
    const key = (await art.get(URL_OK, HOSTS))!;
    const other = (await art.get(URL_OK.replace("abc", "def"), HOSTS))!;
    writeFileSync(join(dir, "notes.txt"), "keep");
    art.sweep(new Set([other]));
    expect(existsSync(join(dir, `${key}.jpg`))).toBe(false);
    expect(existsSync(join(dir, `${other}.jpg`))).toBe(true);
    art.remove(other);
    expect(readdirSync(dir)).toEqual(["notes.txt"]);
    art.remove("../../etc/passwd");
    expect(art.fileUrl("../x")).toBeUndefined();
  });
});
