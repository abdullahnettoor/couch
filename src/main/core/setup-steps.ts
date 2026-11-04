import type { SetupTip } from "../../shared/protocol.ts";
import type { SetupControls } from "./setup.ts";

export interface SetupButton {
  label: string;
  run(c: SetupControls): void;
}

/** What a step can read about the household while it shows. */
export interface SetupContext {
  /** Phones connected right now. */
  phones: number;
  /** A phone has paired with this Mac at some point. */
  phonePaired: boolean;
  /** A phone has just connected on this step, which is about to move on. */
  justConnected: boolean;
  /** "Add another phone" was pressed on the pairing step. */
  addingPhone: boolean;
  /** Home's Apps: the same setting as Settings → Apps. */
  apps: {
    rows(): Array<{ id: string; label: string; icon: string; shown: boolean }>;
    setShown(id: string, shown: boolean): void;
  };
  /** The Library folders already added. */
  folders: string[];
}

export interface SetupPage {
  title: string;
  body?: string;
  /** A small line under the step's main content (the same-Wi-Fi note, the background-item note). */
  note?: string;
  /** An instruction in words, never a button ("No phone nearby? Use the arrow keys and Return."). */
  hint?: string;
  /** The quiet last line of the panel ("You can change all of this later in Settings."). */
  footnote?: string;
  tips?: SetupTip[];
  list?: string[];
  /** Draw the pairing QR code. */
  qr?: boolean;
  /** A phone has just connected: the Screen shows a glowing ✓. */
  connected?: boolean;
  /** The step's answers: at most two, and one of them is always the way past the step. */
  buttons: SetupButton[];
  /** On/off tiles ahead of the buttons, each an App with its logo; arrows move in their grid, OK flips one. */
  tiles?: SetupTile[];
}

export interface SetupTile {
  id: string;
  label: string;
  icon: string;
  on: boolean;
  toggle(): void;
}

/**
 * One Setup step: what it shows, and whether its choice is already made. A step that changes a setting
 * reads and writes the same one Settings does, so `done` reads that setting. The order of the list is the
 * order Setup shows them in; a new step is one more entry in the right place.
 */
export interface SetupStep {
  id: string;
  page(ctx: SetupContext, c: SetupControls): SetupPage;
  /** The choice behind this step has been made (a phone paired, a folder added), so Setup resumes past it. */
  done(ctx: SetupContext, c: SetupControls): boolean;
  /** A phone connecting while this step shows moves Setup on (after saying so). */
  advanceOnPhone?: true;
  /** The last step: its button closes Setup. */
  final?: true;
}

const next = (c: SetupControls) => c.next();
const NOT_NOW = { label: "Not now", run: next };

export const SETUP_STEPS: SetupStep[] = [
  {
    id: "pair",
    advanceOnPhone: true,
    done: ({ phonePaired }) => phonePaired,
    page: ({ phones, justConnected, addingPhone }) => {
      const footnote = "You can change all of this later in Settings.";
      if (justConnected)
        return {
          title: "Phone connected",
          body: "Your phone is the Remote now.",
          connected: true,
          buttons: [{ label: "Continue", run: next }],
        };
      if (phones > 0 && !addingPhone)
        return {
          title: phones === 1 ? "1 phone connected" : `${phones} phones connected`,
          body: phones === 1 ? "Your phone is the Remote." : "Each one is a Remote.",
          footnote,
          buttons: [
            { label: "Continue", run: next },
            { label: "Add another phone", run: (c) => c.addPhone() },
          ],
        };
      return {
        title: "Welcome to Couch",
        body: "Scan with your phone's camera. Your phone becomes the Remote, with no app to install.",
        qr: true,
        note: "Your phone needs to be on the same Wi-Fi as this Mac.",
        hint: "No phone nearby? Use the arrow keys and Return.",
        footnote,
        buttons: [NOT_NOW],
      };
    },
  },
  {
    id: "listener",
    done: (_ctx, c) => c.listenerOn(),
    page: (_ctx, c) =>
      c.listenerOn()
        ? {
            title: "Couch starts from your phone",
            body: "The Power button on your phone can open Couch even after it's been closed.",
            buttons: [{ label: "Continue", run: next }],
          }
        : {
            title: "Start Couch from your phone",
            body: "With this on, the Power button on your phone can open Couch even after it's been closed. A tiny helper starts when you log in to this Mac and waits for the button. It uses almost no power.",
            note: "macOS will say a background item was added. That's this helper.",
            buttons: [
              {
                label: "Turn on",
                run: (c) => {
                  c.turnListenerOn();
                  c.next();
                },
              },
              NOT_NOW,
            ],
          },
  },
  {
    id: "apps",
    done: () => false,
    page: ({ apps }) => ({
      title: "Pick your Apps",
      body: "The ones you pick show on Home.",
      tiles: apps.rows().map((row) => ({
        id: row.id,
        label: row.label,
        icon: row.icon,
        on: row.shown,
        toggle: () => apps.setShown(row.id, !row.shown),
      })),
      buttons: [{ label: "Continue", run: next }],
    }),
  },
  {
    id: "videos",
    done: ({ folders }) => folders.length > 0,
    page: ({ folders }) => {
      const body =
        "Choose the folders your films and shows are in. Couch adds them to the Library.";
      if (folders.length === 0)
        return {
          title: "Add your videos",
          body,
          buttons: [{ label: "Add a folder", run: (c) => c.addFolder() }, NOT_NOW],
        };
      return {
        title: "Add your videos",
        body,
        list: folders,
        buttons: [
          { label: "Continue", run: next },
          { label: "Add more", run: (c) => c.addFolder() },
        ],
      };
    },
  },
  {
    id: "done",
    final: true,
    done: () => false,
    page: () => ({
      title: "You're set",
      tips: [
        { key: "OK", text: "opens" },
        { key: "Back", text: "steps out" },
        { key: "Home", text: "always goes Home" },
      ],
      footnote: "Change any of this later in Settings.",
      buttons: [{ label: "Go to Home", run: (c) => c.close() }],
    }),
  },
];
