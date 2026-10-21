/*
 * The page function below is adapted from VacuumTube
 * (https://github.com/shy1132/VacuumTube, src/preload/modules/adblock.js).
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

import type { Addon } from "../../../web/addon.ts";

const PAGE = `function () {
  var isAdItem = function (item) {
    return !!item && typeof item === 'object' && !Array.isArray(item) &&
      (item.adSlotRenderer || item.promoShelfRenderer ||
        (item.shelfRenderer && item.shelfRenderer.tvhtml5Metadata && item.shelfRenderer.tvhtml5Metadata.hideLogo));
  };
  var strip = function (node) {
    if (Array.isArray(node)) {
      for (var i = node.length - 1; i >= 0; i--) {
        if (isAdItem(node[i])) node.splice(i, 1);
        else strip(node[i]);
      }
    } else if (node && typeof node === 'object') {
      for (var key in node) strip(node[key]);
    }
  };
  var feed = function (text) {
    if (text.indexOf('adSlotRenderer') < 0 && text.indexOf('promoShelfRenderer') < 0 && text.indexOf('hideLogo') < 0) return undefined;
    var json = JSON.parse(text);
    strip(json);
    return JSON.stringify(json);
  };
  couchHooks.onJson(function (json) {
    if (!json || typeof json !== 'object') return undefined;
    if (json.adPlacements) json.adPlacements = [];
    if (json.adSlots) json.adSlots = [];
    if (json.playerAds) json.playerAds = [];
    if (Array.isArray(json.entries)) {
      json.entries = json.entries.filter(function (e) {
        return !(e && e.command && e.command.reelWatchEndpoint && e.command.reelWatchEndpoint.adClientParams &&
          e.command.reelWatchEndpoint.adClientParams.isAd);
      });
    }
    return undefined;
  });
  couchHooks.onResponse('/youtubei/v1/browse', feed);
  couchHooks.onResponse('/youtubei/v1/search', feed);
  couchHooks.onResponse('https://www.youtube.com/youtubei/v1/browse', feed);
  couchHooks.onResponse('https://www.youtube.com/youtubei/v1/search', feed);
}`;

export const ADBLOCK: Addon = {
  id: "adblock",
  label: "Ad blocker",
  description: "Hides video ads, ad Shorts and ad shelves on YouTube.",
  app: "youtube",
  defaultOn: false,
  page: PAGE,
};
