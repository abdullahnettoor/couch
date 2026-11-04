import type { Command, SetupPayload, UiSound } from "../../shared/protocol.ts";
import type { Store } from "../ports/store.ts";
import { SETUP_STEPS, type SetupStep } from "./setup-steps.ts";

export interface SetupControls {
  next(): void;
  close(): void;
  /** The Library folders already added. */
  folders(): string[];
  /** Opens the Mac's folder picker and adds what it returns, as Settings → Library does. */
  addFolder(): void;
  /** Whether any App is on for Home (the Library is not an App). */
  anyAppOn(): boolean;
}

export interface SetupHost {
  store: Store;
  /** Couch has been used before: a pairing from an earlier start, Library folders or watch history. */
  usedBefore(): boolean;
  folders(): string[];
  addFolder(): void;
  anyAppOn(): boolean;
  cue(sound: UiSound): void;
  changed(): void;
}

interface Saved {
  finished: boolean;
  /** Steps already gone through, so a restart resumes at the first one that isn't. */
  seen: string[];
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
  #open = false;
  #index = 0;
  #focus = 0;
  #seen: Set<string>;

  constructor(host: SetupHost, steps: SetupStep[] = SETUP_STEPS) {
    this.#h = host;
    this.#steps = steps;
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
  }

  get isOpen(): boolean {
    return this.#open;
  }

  #start(): void {
    const first = this.#steps.findIndex((s) => !this.#seen.has(s.id) && !s.done(this.#control()));
    this.#open = true;
    this.#goTo(first < 0 ? this.#steps.length - 1 : first);
  }

  #goTo(index: number): void {
    this.#index = index;
    this.#focus = 0;
  }

  #save(finished: boolean): void {
    this.#h.store.write("setup", { finished, seen: [...this.#seen] });
  }

  /** Setup ends, or is closed with "Set up later": every step counts as seen. */
  #finish(): void {
    for (const s of this.#steps) this.#seen.add(s.id);
    this.#open = false;
    this.#save(true);
  }

  #control(): SetupControls {
    const h = this.#h;
    return {
      next: () => this.#next(),
      close: () => this.#finish(),
      folders: () => h.folders(),
      addFolder: () => h.addFolder(),
      anyAppOn: () => h.anyAppOn(),
    };
  }

  #buttons(): Array<{ label: string; run(): void }> {
    const step = this.#steps[this.#index]!;
    const control = this.#control();
    const own = step
      .page(control)
      .buttons.map((b) => ({ label: b.label, run: () => b.run(control) }));
    if (step.final) return own;
    return [
      ...own,
      { label: step.skip?.(control) ?? "Skip", run: () => this.#next() },
      { label: "Set up later", run: () => this.#finish() },
    ];
  }

  #next(): void {
    const step = this.#steps[this.#index]!;
    this.#seen.add(step.id);
    this.#save(false);
    if (this.#index + 1 >= this.#steps.length) this.#finish();
    else this.#goTo(this.#index + 1);
  }

  payload(): SetupPayload | undefined {
    if (!this.#open) return undefined;
    const step = this.#steps[this.#index]!;
    const page = step.page(this.#control());
    return {
      id: step.id,
      title: page.title,
      ...(page.body ? { body: page.body } : {}),
      ...(page.tips ? { tips: page.tips } : {}),
      ...(page.list?.length ? { list: page.list } : {}),
      step: this.#index,
      steps: this.#steps.length,
      buttons: this.#buttons().map((b) => b.label),
      focus: this.#focus,
    };
  }

  /** Takes the command when Setup is open and it is one of Setup's; returns whether it did. */
  handle(command: Command): boolean {
    if (!this.#open || !TAKEN.includes(command.command)) return false;
    const buttons = this.#buttons();
    const index = command.args?.index;
    const valid =
      index !== undefined && Number.isInteger(index) && index >= 0 && index < buttons.length;
    switch (command.command) {
      case "focusAt": {
        const c = command.args?.c;
        if (c !== undefined && Number.isInteger(c) && c >= 0 && c < buttons.length) this.#focus = c;
        break;
      }
      case "confirmAt":
        if (valid) this.#press(buttons, index);
        break;
      case "confirmAnswer":
        if (valid && command.args?.text === this.#steps[this.#index]!.id)
          this.#press(buttons, index);
        break;
      case "left":
      case "up":
        this.#move(-1, buttons.length);
        break;
      case "right":
      case "down":
        this.#move(1, buttons.length);
        break;
      case "ok":
        this.#press(buttons, this.#focus);
        break;
      case "back":
        if (this.#index === 0) this.#h.cue("blocked");
        else {
          this.#h.cue("back");
          this.#goTo(this.#index - 1);
        }
        break;
      case "home":
        this.#finish();
        break;
    }
    this.#h.changed();
    return true;
  }

  #press(buttons: Array<{ run(): void }>, index: number): void {
    this.#h.cue("select");
    buttons[index]?.run();
  }

  #move(delta: number, count: number): void {
    const next = Math.max(0, Math.min(count - 1, this.#focus + delta));
    this.#h.cue(next === this.#focus ? "blocked" : "move");
    this.#focus = next;
  }
}
