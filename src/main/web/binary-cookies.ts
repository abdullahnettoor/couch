/**
 * One cookie from Safari's file. `expires` is Unix milliseconds; absent for a session cookie.
 *
 * There is no `sameSite`: as far as the public format write-ups (libyal/dtformats, "Safari cookies file format")
 * and the probe's parser know, the record has only the Secure (0x1) and HttpOnly (0x4) flag bits, plus unknown
 * words at offsets 4 and 12. So an imported cookie gets WebKit's default SameSite handling, deliberately.
 */
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
  if (!Number.isInteger(at) || at < 0 || at + n > d.length)
    throw new Error("Cookie file is cut short");
}
const u32le = (d: Buffer, at: number) => (need(d, at, 4), d.readUInt32LE(at));
const u32be = (d: Buffer, at: number) => (need(d, at, 4), d.readUInt32BE(at));
function cstr(d: Buffer, at: number): string {
  need(d, at, 1);
  const end = d.indexOf(0, at);
  if (end < 0) throw new Error("Cookie file is cut short");
  return d.toString("utf8", at, end);
}

/** A cookie record's fixed part: size, flags, four string offsets, expiry, creation. */
const RECORD_HEADER = 56;
const bad = () => new Error("Cookie file is damaged");

/** One cookie, read only from inside its own record: nothing it declares can reach another record. */
function parseRecord(record: Buffer): SafariCookie {
  const flags = u32le(record, 8);
  const exp = (need(record, 40, 8), record.readDoubleLE(40));
  const str = (field: number) => {
    const at = u32le(record, field);
    if (at < RECORD_HEADER) throw bad();
    return cstr(record, at);
  };
  return {
    domain: str(16),
    name: str(20),
    path: str(24),
    value: str(28),
    secure: (flags & 1) !== 0,
    httpOnly: (flags & 4) !== 0,
    ...(exp > 0 ? { expires: (exp + MAC_EPOCH) * 1000 } : {}),
  };
}

function parsePage(page: Buffer): SafariCookie[] {
  const count = u32le(page, 4);
  const tableEnd = 8 + 4 * count;
  need(page, 8, 4 * count + 4);
  if (page.readUInt32LE(tableEnd) !== 0) throw bad();
  const first = tableEnd + 4;
  const starts: number[] = [];
  for (let i = 0; i < count; i++) starts.push(page.readUInt32LE(8 + 4 * i));
  const order = starts.map((start, i) => ({ start, i })).sort((x, y) => x.start - y.start);
  const out: SafariCookie[] = Array.from({ length: count }) as SafariCookie[];
  let floor = first;
  for (const { start, i } of order) {
    if (start < floor) throw bad();
    const size = u32le(page, start);
    if (size < RECORD_HEADER) throw bad();
    need(page, start, size);
    out[i] = parseRecord(page.subarray(start, start + size));
    floor = start + size;
  }
  return out;
}

/** Parses Safari's `Cookies.binarycookies`. Throws on a wrong header, damaged or cut-short data; never a partial result. */
export function parseBinaryCookies(data: Buffer): SafariCookie[] {
  if (data.length < 8 || data.toString("latin1", 0, 4) !== "cook")
    throw new Error("Not a Safari cookie file");
  const pages = u32be(data, 4);
  need(data, 8, 4 * pages);
  const sizes: number[] = [];
  for (let i = 0; i < pages; i++) sizes.push(u32be(data, 8 + 4 * i));
  let pos = 8 + 4 * pages;
  const out: SafariCookie[] = [];
  for (const size of sizes) {
    need(data, pos, size);
    out.push(...parsePage(data.subarray(pos, pos + size)));
    pos += size;
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
