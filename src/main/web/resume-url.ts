/** A resume address without its time: one title is one key however far it has played. */
export const titleKey = (url: string): string =>
  url
    .replace(/([?&#])t=\d+&?/, "$1")
    .replace(/[?&]$/, "")
    .replace(/&$/, "");
