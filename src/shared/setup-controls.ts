/**
 * Setup's one control list: the switches first, then the buttons. An index into it is what `focus`,
 * `focusAt` and `confirmAt`/`confirmAnswer` all mean, on the Screen, the renderer and a paired phone.
 * Self-contained: the Remote page embeds it as source.
 */
export function setupControls(s: {
  switches?: Array<{ label: string; on: boolean }>;
  buttons: string[];
}): Array<{ label: string; on?: boolean }> {
  const all: Array<{ label: string; on?: boolean }> = [];
  for (const x of s.switches || []) all.push({ label: x.label, on: x.on });
  for (const label of s.buttons) all.push({ label });
  return all;
}
