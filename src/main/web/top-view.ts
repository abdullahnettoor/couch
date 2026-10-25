type Input = { type: string; key: string; meta?: boolean; control?: boolean; alt?: boolean };

/** What a top view needs of an Electron `WebContentsView`. */
export interface TopViewLike {
  webContents: {
    loadURL(url: string): Promise<void>;
    on(
      event: "before-input-event",
      handler: (event: { preventDefault(): void }, input: Input) => void,
    ): void;
  };
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void;
}

export interface TopHost<V extends TopViewLike = TopViewLike> {
  contentView: {
    readonly children?: readonly unknown[];
    addChildView(view: V): void;
    removeChildView(view: V): void;
  };
  getContentBounds(): { width: number; height: number };
}

export interface TopViewOptions<V extends TopViewLike> {
  create: () => V;
  /** The page the view loads once, when first shown. */
  page: () => string;
  /** Every key the view's own page receives. */
  onInput: (event: { preventDefault(): void }, input: Input) => void;
  /** Runs once on the new view, before its page loads. */
  setup?: (view: V) => void;
}

/**
 * A view laid over the whole Screen window, above every other view: created lazily, loaded once,
 * fitted to the window and lifted back on top whenever it is shown again. It never touches the
 * views beneath it, so web Apps are not hidden, resized or throttled. What it draws and when it
 * leaves are the caller's.
 */
export class TopView<V extends TopViewLike = TopViewLike> {
  #view?: V;
  #shown = false;
  readonly #host: TopHost<V>;
  readonly #o: TopViewOptions<V>;

  constructor(host: TopHost<V>, options: TopViewOptions<V>) {
    this.#host = host;
    this.#o = options;
  }

  get view(): V | undefined {
    return this.#view;
  }

  get shown(): boolean {
    return this.#shown;
  }

  /** Put it on top; safe to call on every update. */
  show(): void {
    if (!this.#view) {
      const view = (this.#view = this.#o.create());
      this.#o.setup?.(view);
      view.webContents.on("before-input-event", (event, input) => this.#o.onInput(event, input));
      void view.webContents
        .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(this.#o.page())}`)
        .catch(() => {});
    }
    this.#shown = true;
    this.fit();
    const { children } = this.#host.contentView;
    if (children?.at(-1) !== this.#view) this.#host.contentView.addChildView(this.#view);
  }

  hide(): void {
    if (this.#shown && this.#view) this.#host.contentView.removeChildView(this.#view);
    this.#shown = false;
  }

  fit(): void {
    if (!this.#shown || !this.#view) return;
    const { width, height } = this.#host.getContentBounds();
    this.#view.setBounds({ x: 0, y: 0, width, height });
  }
}
