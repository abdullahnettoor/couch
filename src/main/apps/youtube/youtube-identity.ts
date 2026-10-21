/*
 * The Cobalt 27 identity below is adapted from VacuumTube
 * (https://github.com/shy1132/VacuumTube, src/ua.js).
 *
 * MIT License
 *
 * Copyright (c) 2025-2026 shy
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/**
 * Why Cobalt 19: YouTube TV serves DRM-protected (Widevine) streams to Cobalt builds newer than 19.
 * Electron has no Widevine CDM, so those videos fail with "This video format is not supported".
 */
const BRAND = "Couch";
const COBALT_VERSION = "19.lts.4.248512-gold";
const COBALT_MAJOR = COBALT_VERSION.split(".")[0]!;
const V8_VERSION = "7.7.299.8";
const STARBOARD_VERSION = 12;
const GOOGLE_HOSTS = [
  "youtube.com",
  "googlevideo.com",
  "ytimg.com",
  "ggpht.com",
  "google.com",
  "googleapis.com",
  "gstatic.com",
  "doubleclick.net",
  "googleusercontent.com",
  "youtube-nocookie.com",
];

function chipset(arch: string): string {
  if (arch === "x64") return "x8664";
  if (arch === "ia32") return "x86";
  return arch.replace(/[^a-zA-Z0-9]/g, "") || "Unknown";
}

export interface Identity {
  userAgent: string;
  genericUserAgent: string;
  metadata: Record<string, unknown>;
  hintHeaders: Record<string, string>;
}

export function buildIdentity(
  version: string,
  arch: string = process.arch,
  year: number = new Date().getFullYear(),
): Identity {
  const full = COBALT_VERSION.split("-")[0]!.split(".").slice(0, 3).join(".");
  const userAgent =
    `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Cobalt/${COBALT_VERSION} (unlike Gecko) ` +
    `v8/${V8_VERSION}-jit gles Starboard/${STARBOARD_VERSION}, ${BRAND}_DESKTOP_${chipset(arch)}_${year}/${version} ` +
    `(${BRAND}, macOS) com.couch.tv/${version}`;
  const metadata = {
    brands: [{ brand: BRAND, version: COBALT_MAJOR }],
    fullVersionList: [{ brand: BRAND, version: full }],
    fullVersion: full,
    platform: "Starboard",
    platformVersion: "",
    architecture: arch.startsWith("arm") ? "arm" : "x86",
    model: "",
    mobile: false,
    bitness: "64",
    wow64: false,
  };
  const hintHeaders: Record<string, string> = {
    "sec-ch-ua": `"${BRAND}";v="${COBALT_MAJOR}"`,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Starboard"',
    "sec-ch-ua-full-version-list": `"${BRAND}";v="${full}"`,
    "sec-ch-ua-full-version": `"${full}"`,
    "sec-ch-ua-platform-version": '""',
    "sec-ch-ua-arch": `"${metadata.architecture}"`,
    "sec-ch-ua-bitness": '"64"',
    "sec-ch-ua-model": '""',
    "sec-ch-ua-wow64": "?0",
  };
  return { userAgent, genericUserAgent: `${BRAND}/${version}`, metadata, hintHeaders };
}

export function isGoogleHost(host: string): boolean {
  return GOOGLE_HOSTS.some((h) => host === h || host.endsWith("." + h));
}

/** Rewrites outgoing request headers so every request carries the same identity. */
export function applyToRequestHeaders(
  id: Identity,
  url: URL,
  headers: Record<string, string>,
): Record<string, string> {
  const google = isGoogleHost(url.hostname);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === "user-agent") continue;
    if (lower.startsWith("sec-ch-ua")) continue;
    out[key] = value;
  }
  if (google) Object.assign(out, id.hintHeaders);
  out["User-Agent"] = google ? id.userAgent : id.genericUserAgent;
  return out;
}
