/**
 * The short code the Remote's chips show for a track: the primary subtag of its BCP 47 tag
 * uppercased (`en-US` → EN), else the first two letters of its label. A plain On/Off switch has none.
 * Plain ES5 on purpose: the Remote page embeds this function's source.
 */
export function trackCode(track: { label: string; lang?: string }): string {
  var tag = track.lang ? String(track.lang).split(/[-_]/)[0] : "";
  if (tag && tag !== "und" && /^[a-z]{2,3}$/i.test(tag)) return tag.toUpperCase();
  var label = String(track.label || "");
  if (/^(on|off)$/i.test(label)) return "";
  var letters = label.replace(/[^\p{L}]/gu, "");
  return letters.length >= 2 ? letters.slice(0, 2).toUpperCase() : "";
}
