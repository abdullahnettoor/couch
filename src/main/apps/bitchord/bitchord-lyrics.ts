/*
 * The lyric host list and the Apple and Musixmatch request headers below are copied from BitChord
 * (https://github.com/kushagrasinghx/BitChord, web/extension/lib/lyricHosts.ts and web/extension/lib/lyricsFetch.ts).
 *
 * Copyright (C) kushagrasinghx and the BitChord contributors
 *
 * BitChord is free software under the GNU General Public License, version 3 (GPL-3.0): you can redistribute it and/or
 * modify it under the terms of that licence, as published by the Free Software Foundation. It is distributed in the hope
 * that it will be useful, but WITHOUT ANY WARRANTY, without even the implied warranty of MERCHANTABILITY or FITNESS FOR
 * A PARTICULAR PURPOSE. The licence text: https://www.gnu.org/licenses/gpl-3.0.html and
 * https://github.com/kushagrasinghx/BitChord/blob/21356206de5594ca0bdaf4680ca2db68a2287729/LICENSE
 * Couch ships with the corresponding source, as GPL sources ship with its releases.
 */

/**
 * The lyric hosts BitChord's browser extension lists as optional host permissions.
 * Source: kushagrasinghx/BitChord, web/extension/lib/lyricHosts.ts (LYRIC_ORIGINS),
 * commit 4d029801a9ae94a44da46824902f67ecf78e868d,
 * https://github.com/kushagrasinghx/BitChord/blob/4d029801a9ae94a44da46824902f67ecf78e868d/web/extension/lib/lyricHosts.ts
 * The Apple and Musixmatch request headers come from web/extension/lib/lyricsFetch.ts (same commit's era).
 */
export const LYRIC_ORIGINS: readonly string[] = [
  "https://lrc.red",
  "https://lyrics-api.binimum.org",
  "https://lyrics-api.boidu.dev",
  "https://unison.boidu.dev",
  "https://lyrics.paxsenix.org",
  "https://api.paxsenix.org",
  "https://lyricsplus.prjktla.my.id",
  "https://lyricsplus.atomix.one",
  "https://lyricsplus.binimum.org",
  "https://lyricsplus.prjktla.workers.dev",
  "https://lyricsplus-seven.vercel.app",
  "https://lyrics-plus-backend.vercel.app",
  "https://lrclib.net",
  "https://mobileservice.kugou.com",
  "https://lyrics.kugou.com",
  "https://apic.musixmatch.com",
  "https://www.musixmatch.com",
  "https://genius.com",
  "https://music.apple.com",
  "https://amp-api.music.apple.com",
];

/** The parsed `url` when it is https, has no userinfo and is on a listed lyric origin. */
export function lyricUrl(url: unknown): URL | undefined {
  if (typeof url !== "string") return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return undefined;
    return LYRIC_ORIGINS.includes(parsed.origin) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** The listed origin of `url`, or undefined when it isn't a listed lyric host. */
export function lyricOrigin(url: unknown): string | undefined {
  return lyricUrl(url)?.origin;
}

/** Headers some lyric hosts need that a page's fetch may not set, as the extension's own rules add them. */
export function lyricHeaders(
  origin: string,
  given: Record<string, string>,
): Record<string, string> {
  const headers = { ...given };
  if (origin === "https://amp-api.music.apple.com") {
    for (const k of Object.keys(headers)) if (/^(origin|referer)$/i.test(k)) delete headers[k];
    headers.Origin = "https://music.apple.com";
    headers.Referer = "https://music.apple.com/";
  } else if (origin === "https://apic.musixmatch.com" || origin === "https://www.musixmatch.com") {
    headers.Cookie = "mxm_bab=AB";
  }
  return headers;
}
