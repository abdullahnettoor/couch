import type { GridItem, LibraryEntry } from "../../shared/protocol.ts";

/**
 * Home's grid: gear, and the update icon while an update is ready (row 0); Resume / From start (row 1) only while a film card is focused or was
 * last focused; the App row (row 2) in the App list's order. With nothing in progress it is the plain base.
 */
export function homeGrid(
  base: GridItem[],
  videos: LibraryEntry[],
  film: LibraryEntry | undefined,
): GridItem[] {
  if (videos.length === 0) return base;
  const apps = base.filter((i) => i.r !== 0);
  return [
    ...base.filter((i) => i.r === 0),
    ...(film
      ? [
          {
            id: "resume",
            r: 1,
            c: 0,
            label: `Resume ${film.title}`,
            action: `library:play:${film.path}`,
          },
          // A title in an App whose own site decides where to resume (Netflix) has no From start.
          ...(film.app?.fromStart === false
            ? []
            : [
                {
                  id: "fromstart",
                  r: 1,
                  c: 1,
                  label: `${film.title} from start`,
                  action: `library:playstart:${film.path}`,
                },
              ]),
        ]
      : []),
    ...apps.map((i) => ({ ...i, r: 2 })),
    ...videos.map((v, i) => ({
      id: v.path,
      r: 2,
      c: apps.length + i,
      label: v.title,
      action: `library:play:${v.path}`,
    })),
  ];
}

/** The film Home should show: the focused card, or the remembered one while Resume / From start is focused. */
export function filmAfterFocus(
  focusedId: string | undefined,
  videos: LibraryEntry[],
  remembered: string | undefined,
): string | undefined {
  if (focusedId && videos.some((v) => v.path === focusedId)) return focusedId;
  if (focusedId === "resume" || focusedId === "fromstart") return remembered;
  return undefined;
}

export const AMBIENT_MS = 2 * 60_000;
