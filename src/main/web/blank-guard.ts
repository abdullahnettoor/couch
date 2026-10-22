export interface GuardedContents {
  getURL(): string;
  isLoading(): boolean;
  executeJavaScript(script: string): Promise<unknown>;
}

/** Page script expression: true when the document has no body, or one with neither text nor media. */
export const EMPTY_PAGE_SCRIPT = `(function () {
  var b = document.body;
  if (!b) return true;
  return String(b.innerText || '').trim() === '' && !document.querySelector('video,canvas,img');
})()`;

/**
 * Keeps a web App's view from staying blank: a page that is blank (no address, `about:blank`, no
 * content) or whose renderer crashed is loaded again, on show and when it navigates to blank.
 */
export class BlankGuard {
  #contents: GuardedContents;
  #reload: () => void;
  #crashed = false;
  #loaded = false;

  constructor(contents: GuardedContents, reload: () => void) {
    this.#contents = contents;
    this.#reload = reload;
  }

  /** A real page has finished loading: from now on a blank address is not "not loaded yet". */
  loaded(): void {
    this.#loaded = true;
  }

  crashed(): void {
    this.#crashed = true;
  }

  reset(): void {
    this.#loaded = false;
    this.#crashed = false;
  }

  /** The main frame went to `url`: a blank one after a page had loaded means the page was lost. */
  navigated(url: string): void {
    if (this.#loaded && !url.startsWith("https:")) this.#recover();
  }

  /** The view is being shown: reload its home when what it holds is blank. */
  async onShow(): Promise<void> {
    if (this.#crashed) return this.#recover();
    if (this.#contents.isLoading()) return;
    const url = this.#contents.getURL();
    if (url === "" || url === "about:blank") return this.#recover();
    const empty = await this.#contents.executeJavaScript(EMPTY_PAGE_SCRIPT).catch(() => false);
    if (empty === true && !this.#contents.isLoading()) this.#recover();
  }

  #recover(): void {
    this.#crashed = false;
    this.#loaded = false;
    this.#reload();
  }
}

/** Whether history back from the active entry lands on a page (the entry before is not the view's starting blank). */
export function backIsSafe(entries: Array<{ url: string }>, active: number): boolean {
  return entries[active - 1]?.url.startsWith("https:") ?? false;
}
