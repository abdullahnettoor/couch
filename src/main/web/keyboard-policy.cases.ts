import type { YouTubeEvent } from "../ports/youtube.ts";
import type { KeyInput } from "./keyboard-policy.ts";

/** One physical key and what a host must do with it, whichever engine it runs on (run by both adapters' tests). */
export interface KeyCase {
  name: string;
  input: KeyInput;
  state: { capturing?: boolean; fieldFocused?: boolean; gate?: boolean };
  /** What the host tells the core. */
  events: YouTubeEvent[];
  /** The key reaches the page (Couch did not take it). */
  page: boolean;
}

const down = (key: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  type: "keyDown",
  key,
  ...mods,
});
const up = (key: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  type: "keyUp",
  key,
  ...mods,
});
const INPUT: YouTubeEvent = { type: "input" };

export const KEY_CASES: KeyCase[] = [
  {
    name: "an arrow is Couch's",
    input: down("ArrowUp"),
    state: {},
    events: [{ type: "key", command: "up" }],
    page: false,
  },
  {
    name: "Enter is OK",
    input: down("Enter"),
    state: {},
    events: [{ type: "key", command: "ok" }],
    page: false,
  },
  {
    name: "the release of a Couch key is taken without a command",
    input: up("ArrowUp"),
    state: {},
    events: [],
    page: false,
  },
  {
    name: "h is Home",
    input: down("h"),
    state: {},
    events: [{ type: "key", command: "home" }],
    page: false,
  },
  {
    name: "another key is the page's and counts as input",
    input: down("z"),
    state: {},
    events: [INPUT],
    page: true,
  },
  {
    name: "its release is the page's and says nothing",
    input: up("z"),
    state: {},
    events: [],
    page: true,
  },
  {
    name: "Shift+> is the page's",
    input: down(">", { shift: true }),
    state: {},
    events: [INPUT],
    page: true,
  },
  {
    name: "a Couch key with Control is the page's",
    input: down("ArrowUp", { control: true }),
    state: {},
    events: [INPUT],
    page: true,
  },
  {
    name: "a Couch key with Option is the page's",
    input: down("h", { alt: true }),
    state: {},
    events: [INPUT],
    page: true,
  },
  {
    name: "a Couch key with Command is the page's",
    input: down("h", { meta: true }),
    state: {},
    events: [INPUT],
    page: true,
  },
  {
    name: "/ opens Couch's search bar",
    input: down("/"),
    state: {},
    events: [{ type: "find" }],
    page: false,
  },
  {
    name: "⌘F opens Couch's search bar",
    input: down("f", { meta: true }),
    state: {},
    events: [{ type: "find" }],
    page: false,
  },
  {
    name: "⌘⇧F too",
    input: down("F", { meta: true, shift: true }),
    state: {},
    events: [{ type: "find" }],
    page: false,
  },
  {
    name: "Control+/ is the page's",
    input: down("/", { control: true }),
    state: {},
    events: [INPUT],
    page: true,
  },
  {
    name: "⌘C is the page's",
    input: down("c", { meta: true }),
    state: {},
    events: [INPUT],
    page: true,
  },
  {
    name: "in a page field, h is typed",
    input: down("h"),
    state: { fieldFocused: true },
    events: [INPUT],
    page: true,
  },
  {
    name: "in a page field, Space is typed",
    input: down(" "),
    state: { fieldFocused: true },
    events: [INPUT],
    page: true,
  },
  {
    name: "in a page field, Enter submits",
    input: down("Enter"),
    state: { fieldFocused: true },
    events: [INPUT],
    page: true,
  },
  {
    name: "in a page field, / is typed",
    input: down("/"),
    state: { fieldFocused: true },
    events: [INPUT],
    page: true,
  },
  {
    name: "in a page field, Esc is still Couch's Back",
    input: down("Escape"),
    state: { fieldFocused: true },
    events: [{ type: "key", command: "back" }],
    page: false,
  },
  {
    name: "in a page field, ⌘F is still Couch's find",
    input: down("f", { meta: true }),
    state: { fieldFocused: true },
    events: [{ type: "find" }],
    page: false,
  },
  {
    name: "capturing: a letter is typed, never the page's",
    input: down("q"),
    state: { capturing: true },
    events: [{ type: "edit", edit: { insert: "q" } }],
    page: false,
  },
  {
    name: "capturing: its release is taken",
    input: up("q"),
    state: { capturing: true },
    events: [],
    page: false,
  },
  {
    name: "capturing: Backspace erases",
    input: down("Backspace"),
    state: { capturing: true },
    events: [{ type: "edit", edit: { erase: "char" } }],
    page: false,
  },
  {
    name: "capturing: ⌥Backspace erases a word",
    input: down("Backspace", { alt: true }),
    state: { capturing: true },
    events: [{ type: "edit", edit: { erase: "word" } }],
    page: false,
  },
  {
    name: "capturing: ⌘Backspace erases all",
    input: down("Backspace", { meta: true }),
    state: { capturing: true },
    events: [{ type: "edit", edit: { erase: "all" } }],
    page: false,
  },
  {
    name: "capturing: Enter submits",
    input: down("Enter"),
    state: { capturing: true },
    events: [{ type: "edit", edit: { done: "submit" } }],
    page: false,
  },
  {
    name: "capturing: Esc cancels",
    input: down("Escape"),
    state: { capturing: true },
    events: [{ type: "edit", edit: { done: "cancel" } }],
    page: false,
  },
  {
    name: "capturing: an arrow types nothing and does not reach the page",
    input: down("ArrowUp"),
    state: { capturing: true },
    events: [],
    page: false,
  },
  {
    name: "capturing: ⌘A types nothing",
    input: down("a", { meta: true }),
    state: { capturing: true },
    events: [],
    page: false,
  },
  {
    name: "capturing beats a focused page field",
    input: down("a"),
    state: { capturing: true, fieldFocused: true },
    events: [{ type: "edit", edit: { insert: "a" } }],
    page: false,
  },
  {
    name: "the gate takes a Couch key first",
    input: down("ArrowUp"),
    state: { gate: true },
    events: [],
    page: false,
  },
  {
    name: "the gate takes the page's key first",
    input: down("z"),
    state: { gate: true },
    events: [],
    page: false,
  },
  {
    name: "the gate goes before capturing",
    input: down("a"),
    state: { gate: true, capturing: true },
    events: [],
    page: false,
  },
];
