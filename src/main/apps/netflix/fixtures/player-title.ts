/**
 * The player's title header, HAND-BUILT from Netflix's known markup (a `video-title` element holding
 * a heading for the series and one span per season/episode and episode name; a film has only the
 * heading). It is NOT a recording: the real element has not been captured, so the household confirms
 * it in ticket 046 (the title shows on the Remote). Text is kept here because recorded snapshots
 * carry none.
 */
export interface FixtureNode {
  t: string;
  a?: Record<string, string>;
  x?: string;
  c?: FixtureNode[];
}

export const PLAYER_TITLE_SERIES: FixtureNode = {
  t: "div",
  a: { "data-uia": "video-title" },
  c: [
    { t: "h4", x: "Some Show" },
    { t: "span", x: "S1:E2" },
    { t: "span", x: "Second" },
  ],
};

export const PLAYER_TITLE_FILM: FixtureNode = {
  t: "div",
  a: { "data-uia": "video-title" },
  c: [{ t: "h4", x: "A Film" }],
};
