/** One cookie from Safari's file. `expires` is Unix milliseconds; absent for a session cookie. */
export interface SafariCookie {
  domain: string;
  name: string;
  path: string;
  value: string;
  secure: boolean;
  httpOnly: boolean;
  expires?: number;
}

/** Seconds between the Unix epoch and Mac absolute time (2001-01-01). */
const MAC_EPOCH = 978_307_200;

function need(d: Buffer, at: number, n: number): void {
  if (at < 0 || at + n > d.length) throw new Error("Cookie file is cut short");
}
const u32le = (d: Buffer, at: number) => (need(d, at, 4), d.readUInt32LE(at));
const u32be = (d: Buffer, at: number) => (need(d, at, 4), d.readUInt32BE(at));
function cstr(d: Buffer, at: number): string {
  need(d, at, 1);
  const end = d.indexOf(0, at);
  if (end < 0) throw new Error("Cookie file is cut short");
  return d.toString("utf8", at, end);
}

/** Parses Safari's `Cookies.binarycookies`. Throws on a wrong header or cut-short data. */
export function parseBinaryCookies(data: Buffer): SafariCookie[] {
  if (data.length < 8 || data.toString("latin1", 0, 4) !== "cook")
    throw new Error("Not a Safari cookie file");
  const pages = u32be(data, 4);
  const sizes: number[] = [];
  for (let i = 0; i < pages; i++) sizes.push(u32be(data, 8 + 4 * i));
  let pos = 8 + 4 * pages;
  const out: SafariCookie[] = [];
  for (const size of sizes) {
    need(data, pos, size);
    const page = data.subarray(pos, pos + size);
    pos += size;
    const count = u32le(page, 4);
    for (let i = 0; i < count; i++) {
      const c = u32le(page, 8 + 4 * i);
      const flags = u32le(page, c + 8);
      need(page, c + 40, 8);
      const exp = page.readDoubleLE(c + 40);
      out.push({
        domain: cstr(page, c + u32le(page, c + 16)),
        name: cstr(page, c + u32le(page, c + 20)),
        path: cstr(page, c + u32le(page, c + 24)),
        value: cstr(page, c + u32le(page, c + 28)),
        secure: (flags & 1) !== 0,
        httpOnly: (flags & 4) !== 0,
        ...(exp > 0 ? { expires: (exp + MAC_EPOCH) * 1000 } : {}),
      });
    }
  }
  return out;
}

export function isNetflixDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  return d === "netflix.com" || d.endsWith(".netflix.com");
}

export function netflixCookies(cookies: SafariCookie[]): SafariCookie[] {
  return cookies.filter((c) => isNetflixDomain(c.domain));
}
