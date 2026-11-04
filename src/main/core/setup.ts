import type { Command, SetupPayload, UiSound } from "../../shared/protocol.ts";
import { SETUP_TILE_COLUMNS } from "../../shared/setup-controls.ts";
import type { Store } from "../ports/store.ts";
import { SETUP_STEPS, type SetupContext, type SetupStep } from "./setup-steps.ts";

export interface SetupControls {
  next(): void;
  /** Show the pairing QR code again on the pairing step. */
  addPhone(): void;
  close(): void;
  /** Opens the Mac's folder picker and adds what it returns, as Settings → Library does. */
  addFolder(): void;
  /** The Start Couch Listener at login setting, the one Settings → Remotes and Devices shows. */
  listenerOn(): boolean;
  turnListenerOn(): void;
}

export interface SetupHost {
  store: Store;
  apps: SetupContext["apps"];
  /** Couch has been used before: a pairing from an earlier start, Library folders or watch history. */
  usedBefore(): boolean;
  listenerOn(): boolean;
  turnListenerOn(): void;
  /** Home is what the Screen shows now (not the player, an App or another page). */
  atHome(): boolean;
  /** Couch's version, for "New in Couch <version>". */
  version(): string;
  /** Phones connected right now. */
  phones(): number;
  /** A phone has paired with this Mac at some point (kept in the pairing record). */
  phonePaired(): boolean;
  /** The Library folders already added. */
  folders(): string[];
  /** Opens the Mac's folder picker and adds what it returns, as Settings → Library does. */
  addFolder(): void;
  /** A timer on the Clock port; returns its canceller. */
  later(fn: () => void, ms: number): () => void;
  cue(sound: UiSound): void;
  changed(): void;
}

interface Saved {
  finished: boolean;
  /** Steps already gone through, so a restart resumes at the first one that isn't. */
  seen: string[];
  /** How many starts the steps of an update were put off (Home); a second one marks them seen. */
  deferred?: number;
}

/** Commands Setup takes while it is open; Power, volume and the like keep their usual meaning. */
const TAKEN = [
  "up",
  "down",
  "left",
  "right",
  "ok",
  "back",
  "home",
  "focusAt",
  "confirmAt",
  "confirmAnswer",
  "menu",
  "find",
  "screenKey",
  "openApp",
  "resume",
  "forgetContinue",
  "openSettings",
  "openUpdate",
  "typeOpen",
];

/**
 * Setup: the first-run flow, a panel over Home that takes the keys first while it is open (like Quick
 * settings). It owns which step is showing and what is saved; each step's content is its own entry.
 */
export class Setup {
  #h: SetupHost;
  #steps: SetupStep[];
  #all: SetupStep[];
  #open = false;
  #index = 0;
  #focus = 0;
  /** The tile focus left for the buttons, so Up goes back to it. */
  #lastTile = 0;
  #seen: Set<string>;
  #control: SetupControls;
  /** Steps an update added to a household that had finished Setup: shown only while Home shows. */
  #whatsNew = false;
  #deferred = 0;
  #justConnected = false;
  #addingPhone = false;
  #cancelAdvance?: () => void;
  /** Settings → About → Run setup again: the full list, saving nothing; `#before` is what to put back. */
  #before?: {
    steps: SetupStep[];
    open: boolean;
    whatsNew: boolean;
    index: number;
    seen: Set<string>;
  };

  constructor(host: SetupHost, steps: SetupStep[] = SETUP_STEPS) {
    this.#h = host;
    this.#control = {
      next: () => this.#next(),
      addPhone: () => (this.#addingPhone = true),
      close: () => this.#finish(),
      listenerOn: () => host.listenerOn(),
      turnListenerOn: () => host.turnListenerOn(),
      addFolder: () => host.addFolder(),
    };
    this.#steps = steps;
    this.#all = steps;
    const saved = host.store.read<Partial<Saved> | undefined>("setup", undefined);
    if (saved === undefined) {
      this.#seen = new Set();
      if (host.usedBefore()) this.#finish();
      else {
        this.#save(false);
        this.#start();
      }
      return;
    }
    this.#seen = new Set(Array.isArray(saved.seen) ? saved.seen.map(String) : []);
    if (saved.finished !== true) this.#start();
    else this.#startNew(saved.deferred);
  }

  get isOpen(): boolean {
    return this.#open && (!this.#whatsNew || this.#h.atHome());
  }

  #startNew(deferred: unknown): void {
    const pending = this.#steps.filter((s) => !this.#seen.has(s.id));
    if (pending.length === 0) return;
    this.#deferred = typeof deferred === "number" ? deferred : 0;
    this.#steps = pending;
    this.#whatsNew = true;
    this.#open = true;
    this.#goTo(0);
  }

  #start(): void {
    const first = this.#steps.findIndex(
      (s) => !this.#seen.has(s.id) && !s.done(this.#ctx(), this.#control),
    );
    this.#open = true;
    this.#goTo(first < 0 ? this.#steps.length - 1 : first);
  }

  #goTo(index: number): void {
    this.#cancelAdvance?.();
    this.#cancelAdvance = undefined;
    this.#justConnected = false;
    this.#addingPhone = false;
    this.#index = index;
    this.#focus = 0;
    this.#lastTile = 0;
  }

  /** Opens the full Setup at Welcome. Steps already done show their Continue versions; nothing is saved. */
  rerun(): void {
    if (!this.#before)
      this.#before = {
        steps: this.#steps,
        open: this.#open,
        whatsNew: this.#whatsNew,
        index: this.#index,
        seen: new Set(this.#seen),
      };
    this.#steps = this.#all;
    this.#whatsNew = false;
    this.#open = true;
    this.#goTo(0);
    this.#h.changed();
  }

  /** A re-run is over: put back what was there before it, so the saved record is untouched. */
  #endRerun(): boolean {
    const b = this.#before;
    if (!b) return false;
    this.#before = undefined;
    this.#steps = b.steps;
    // The update's panel waits for the next start; finishing a re-run must not pop it open at once.
    this.#open = b.open && !b.whatsNew;
    this.#whatsNew = b.whatsNew;
    this.#seen = b.seen;
    this.#goTo(Math.min(b.index, b.steps.length - 1));
    return true;
  }

  #save(finished: boolean): void {
    if (this.#before) return;
    this.#h.store.write("setup", {
      finished,
      seen: [...this.#seen],
      ...(this.#deferred > 0 ? { deferred: this.#deferred } : {}),
    });
  }

  /** Setup ends: every step counts as seen. */
  #finish(): void {
    if (this.#endRerun()) return;
    for (const s of this.#steps) this.#seen.add(s.id);
    this.#deferred = 0;
    this.#open = false;
    this.#save(true);
  }

  /** Home: a fresh Setup is over (as "Set up later"); an update's steps ask once more next start, then count as seen. */
  #later(): void {
    if (this.#endRerun()) return;
    if (!this.#whatsNew) return this.#finish();
    this.#deferred++;
    if (this.#deferred >= 2) return this.#finish();
    this.#open = false;
    this.#save(true);
  }

  #ctx(): SetupContext {
    return {
      phones: this.#h.phones(),
      phonePaired: this.#h.phonePaired(),
      justConnected: this.#justConnected,
      addingPhone: this.#addingPhone,
      apps: this.#h.apps,
      folders: this.#h.folders(),
    };
  }

  /** A phone connected: on a step that waits for one, say so and move on about 1.5 s later. */
  phoneConnected(): void {
    if (!this.#open || !this.#steps[this.#index]!.advanceOnPhone || this.#justConnected) return;
    this.#justConnected = true;
    this.#cancelAdvance = this.#h.later(() => {
      this.#cancelAdvance = undefined;
      if (this.#open && this.#steps[this.#index]!.advanceOnPhone) this.#next();
      this.#h.changed();
    }, 1500);
    this.#h.changed();
  }

  /** The tiles, then the buttons: the one list that focus and every `index` (Screen or phone) count in. */
  #controls(): Array<{ label: string; run(): void }> {
    const page = this.#page();
    return [
      ...(page.tiles ?? []).map((t) => ({ label: t.label, run: () => t.toggle() })),
      ...page.buttons.map((b) => ({ label: b.label, run: () => b.run(this.#control) })),
    ];
  }

  #page() {
    return this.#steps[this.#index]!.page(this.#ctx(), this.#control);
  }

  #next(): void {
    const step = this.#steps[this.#index]!;
    this.#seen.add(step.id);
    this.#save(this.#whatsNew);
    if (this.#index + 1 >= this.#steps.length) this.#finish();
    else this.#goTo(this.#index + 1);
  }

  payload(): SetupPayload | undefined {
    if (!this.isOpen) return undefined;
    const step = this.#steps[this.#index]!;
    const page = this.#page();
    const tiles = page.tiles ?? [];
    const body = this.#whatsNew
      ? page.body
        ? `${page.title}. ${page.body}`
        : page.title
      : page.body;
    return {
      id: step.id,
      title: this.#whatsNew ? `New in Couch ${this.#h.version()}` : page.title,
      ...(body ? { body } : {}),
      ...(page.note ? { note: page.note } : {}),
      ...(page.hint ? { hint: page.hint } : {}),
      ...(page.footnote ? { footnote: page.footnote } : {}),
      ...(page.tips ? { tips: page.tips } : {}),
      ...(page.qr ? { qr: true } : {}),
      ...(page.connected ? { connected: true as const } : {}),
      ...(page.list?.length ? { list: page.list } : {}),
      step: this.#index,
      steps: this.#steps.length,
      ...(tiles.length
        ? {
            tiles: tiles.map((t) => ({ id: t.id, label: t.label, icon: t.icon, on: t.on })),
            columns: Math.min(tiles.length, SETUP_TILE_COLUMNS),
          }
        : {}),
      buttons: page.buttons.map((b) => b.label),
      focus: this.#focus,
      ...(this.#whatsNew || this.#before ? {} : { intro: true as const }),
      ...(step.final ? { final: true as const } : {}),
    };
  }

  /** Takes the command when Setup is open and it is one of Setup's; returns whether it did. */
  handle(command: Command): boolean {
    if (!this.isOpen || !TAKEN.includes(command.command)) return false;
    if (this.#whatsNew && command.command === "resume") return false;
    const controls = this.#controls();
    const index = command.args?.index;
    const valid =
      index !== undefined && Number.isInteger(index) && index >= 0 && index < controls.length;
    switch (command.command) {
      case "focusAt": {
        const c = command.args?.c;
        if (c !== undefined && Number.isInteger(c) && c >= 0 && c < controls.length)
          this.#focus = c;
        break;
      }
      case "confirmAt":
        if (valid) this.#press(controls, index);
        break;
      case "confirmAnswer":
        if (valid && command.args?.text === this.#steps[this.#index]!.id)
          this.#press(controls, index);
        break;
      case "left":
      case "right":
      case "up":
      case "down":
        this.#arrow(command.command);
        break;
      case "ok":
        this.#press(controls, this.#focus);
        break;
      case "back":
        if (this.#index === 0) this.#h.cue("blocked");
        else {
          this.#h.cue("back");
          this.#goTo(this.#index - 1);
        }
        break;
      case "home":
        this.#later();
        break;
    }
    this.#h.changed();
    return true;
  }

  #press(controls: Array<{ run(): void }>, index: number): void {
    this.#h.cue("select");
    controls[index]?.run();
  }

  /** Arrows move in the tiles' grid, then along the row of buttons under it. */
  #arrow(key: "left" | "right" | "up" | "down"): void {
    const page = this.#page();
    const n = page.tiles?.length ?? 0;
    const count = n + page.buttons.length;
    const f = this.#focus;
    let to = f;
    if (n === 0) to = f + (key === "left" || key === "up" ? -1 : 1);
    else if (f < n) {
      const cols = Math.min(n, SETUP_TILE_COLUMNS);
      const col = f % cols;
      if (key === "left" && col > 0) to = f - 1;
      else if (key === "right" && col < cols - 1 && f + 1 < n) to = f + 1;
      else if (key === "up" && f >= cols) to = f - cols;
      else if (key === "down")
        to =
          f + cols < n ? f + cols : Math.floor(f / cols) < Math.floor((n - 1) / cols) ? n - 1 : n;
    } else if (key === "left") to = f - 1;
    else if (key === "right") to = f + 1;
    else if (key === "up") to = Math.min(this.#lastTile, n - 1);
    to = Math.max(0, Math.min(count - 1, to));
    if (f < n) this.#lastTile = f;
    this.#h.cue(to === f ? "blocked" : "move");
    this.#focus = to;
  }
}
