/**
 * Whether Couch's own screen has something over a WebKit App that takes the pointer and the keys: Quick settings,
 * a confirmation, or Picture off. The toast and the volume level don't (they only draw), so they leave the page its mouse.
 */
export function couchOverlayOpen(
  state: { confirm?: unknown; pictureOff: boolean },
  quickOpen: boolean,
): boolean {
  return quickOpen || state.confirm !== undefined || state.pictureOff;
}
