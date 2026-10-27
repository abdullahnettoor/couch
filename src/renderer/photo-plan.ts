export interface Photo {
  url: string;
  dim: number;
}

/**
 * What Home does with the wallpaper choice it was just given. A picture that isn't converted and loaded
 * yet never replaces the one on screen: the current picture stays, and only once the next is loaded does
 * it crossfade. Only a built-in wallpaper clears the picture.
 */
export function planPhoto(
  shown: Photo | undefined,
  choice: "builtin" | "picture",
  ready: Photo | undefined,
): "clear" | "keep" | "load" | "same" {
  if (choice === "builtin") return "clear";
  if (!ready) return "keep";
  if (shown && shown.url === ready.url && shown.dim === ready.dim) return "same";
  return "load";
}
