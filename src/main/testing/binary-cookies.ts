/** Builds synthetic Safari `Cookies.binarycookies` bytes for tests. Values are always fake. */
const le32 = (v: number) => [0, 8, 16, 24].map((s) => (v >>> s) & 0xff);
const be32 = (v: number) => [24, 16, 8, 0].map((s) => (v >>> s) & 0xff);

export function syntheticCookie(domain: string, name: string, value: string): number[] {
  const strs = [domain, name, "/", value].map((s) => [...Buffer.from(s), 0]);
  let off = 56;
  const offs = strs.map((s) => ((off += s.length), off - s.length));
  return [
    ...le32(off),
    ...le32(0),
    ...le32(5),
    ...le32(0),
    ...offs.flatMap(le32),
    ...Array.from({ length: 24 }, () => 0),
    ...strs.flat(),
  ];
}

export function syntheticCookieFile(cookies: number[][]): Buffer {
  let off = 8 + 4 * cookies.length + 4;
  const offsets = cookies.map((c) => ((off += c.length), off - c.length));
  const page = [
    0,
    0,
    1,
    0,
    ...le32(cookies.length),
    ...offsets.flatMap(le32),
    ...le32(0),
    ...cookies.flat(),
  ];
  return Buffer.from([...Buffer.from("cook"), ...be32(1), ...be32(page.length), ...page]);
}
