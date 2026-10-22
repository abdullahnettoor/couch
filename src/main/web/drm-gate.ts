import type { WebAppDescription } from "./web-app.ts";

export type DrmGate = { ok: true } | { ok: false; note: string; detail?: string };

/** Shown on the App's error screen, so plain words and no error text. */
export const NO_WIDEVINE = "Widevine isn't available on this Mac, so this App can't play video.";

/** Whether a `drm` App may load: the components (Widevine) must be ready. */
export async function drmGate(
  desc: Pick<WebAppDescription, "drm">,
  components: { whenReady(): Promise<unknown> } | undefined,
): Promise<DrmGate> {
  if (!desc.drm) return { ok: true };
  if (!components) return { ok: false, note: NO_WIDEVINE };
  try {
    await components.whenReady();
    return { ok: true };
  } catch (error) {
    return { ok: false, note: NO_WIDEVINE, detail: String(error) };
  }
}
