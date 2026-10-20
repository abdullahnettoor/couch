/*
 * The page-side shims below are adapted from VacuumTube
 * (https://github.com/shy1132/VacuumTube, src/preload/modules/media-capabilities.js
 * and src/preload/modules/h5vcc/index.js).
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

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Runs in the page before YouTube's scripts. Makes MediaSource.isTypeSupported behave like
 * Cobalt's (it validates width/height/framerate/eotf...; Chromium accepts everything, so the
 * player assumes no HFR/HDR and caps at 720p30) and reports a large video container.
 * Wrapped in try/catch so a page-side problem can never break YouTube.
 */
export const COMPAT_FUNCTION = `function () {
  try {
    var hdr = function () { return window.matchMedia('(dynamic-range: high)').matches; };
    var num = function (v) { return Number(v); };
    var checks = {
      width: function (v) { return num(v) > 0 && num(v) <= 7680; },
      height: function (v) { return num(v) > 0 && num(v) <= 4320; },
      framerate: function (v) { return num(v) > 0 && num(v) <= 60; },
      bitrate: function (v) { return num(v) > 0 && num(v) <= 200000000; },
      eotf: function (v) { return v === 'bt709' || ((v === 'smpte2084' || v === 'arib-std-b67') && hdr()); },
      channels: function (v) { return num(v) > 0 && num(v) <= 8; },
      cryptoblockformat: function (v) { return v === 'subsample'; },
      'decode-to-texture': function (v) { return v === 'true' || v === 'false'; }
    };
    var isHdrCodec = function (codec) {
      var p = codec.split('.');
      var t = p[0] === 'vp09' ? p[6] : (p[0] === 'av01' ? p[7] : undefined);
      return t === '16' || t === '18';
    };
    if (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported) {
      var original = MediaSource.isTypeSupported.bind(MediaSource);
      MediaSource.isTypeSupported = function (type) {
        var parts = String(type).split(';').map(function (s) { return s.trim(); });
        var kept = [parts[0]];
        for (var i = 1; i < parts.length; i++) {
          var param = parts[i];
          var bits = param.split('=');
          var key = bits.shift().trim().toLowerCase();
          var value = bits.join('=').trim().replace(/^"|"$/g, '');
          if (key === 'codecs') {
            if (value.split(',').some(function (c) { return isHdrCodec(c.trim()); }) && !hdr()) return false;
            kept.push(param);
          } else if (checks[key]) {
            if (!checks[key](value)) return false;
          } else {
            kept.push(param);
          }
        }
        return original(kept.join('; '));
      };
    }
    if (!window.h5vcc) {
      window.h5vcc = { system: { getVideoContainerSizeOverride: function () { return '7680x4320'; } } };
    }
  } catch (e) {}
}`;

export const COMPAT_SCRIPT = `(${COMPAT_FUNCTION})();`;

/** Session preload: runs the shim in YouTube's main world before any page script, on every navigation. */
export const COMPAT_PRELOAD = `try { require('electron').contextBridge.executeInMainWorld({ func: ${COMPAT_FUNCTION} }); } catch (e) {}\n`;

export interface CompatSession {
  registerPreloadScript(script: { type: "frame"; filePath: string }): string;
}

/** Development switch: COUCH_YOUTUBE_PATCH=off keeps YouTube at its stock 720p behaviour. */
export function compatEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.COUCH_YOUTUBE_PATCH !== "off";
}

/**
 * Registers the compatibility shim as a session preload (written to `dir`). It is synchronous and
 * never throws: on any failure it logs and returns false, and YouTube loads unpatched (720p).
 */
export function applyCompatPatch(
  ses: CompatSession,
  dir: string,
  opts: { enabled?: boolean; log?: (message: string) => void } = {},
): boolean {
  const log = opts.log ?? ((m: string) => console.warn(m));
  if (!(opts.enabled ?? compatEnabled())) return false;
  try {
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, "youtube-compat-preload.cjs");
    writeFileSync(filePath, COMPAT_PRELOAD);
    ses.registerPreloadScript({ type: "frame", filePath });
    return true;
  } catch (error) {
    log(`[youtube] 4K compatibility patch failed, staying at 720p: ${String(error)}`);
    return false;
  }
}
