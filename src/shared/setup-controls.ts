/**
 * Setup's one control list: the tiles first, then the buttons. An index into it is what `focus`,
 * `focusAt` and `confirmAt`/`confirmAnswer` all mean, on the Screen, the renderer and a paired phone.
 * Self-contained: the Remote page embeds it as source.
 */
export function setupControls(s: {
  tiles?: Array<{ label: string; on: boolean; icon?: string }>;
  buttons: string[];
}): Array<{ label: string; on?: boolean; icon?: string }> {
  const all: Array<{ label: string; on?: boolean; icon?: string }> = [];
  for (const x of s.tiles || []) all.push({ label: x.label, on: x.on, icon: x.icon });
  for (const label of s.buttons) all.push({ label });
  return all;
}

/** Setup's App tiles on the Screen: at most this many to a row. */
export const SETUP_TILE_COLUMNS = 4;

/** A plain check mark (Phosphor's "check" is a ticked box): the ✓ on an App that's on, and a phone just connected. */
export const CHECK_SVG =
  '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.6 4.6L19 7.6" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
