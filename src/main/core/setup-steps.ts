import type { SetupControls } from "./setup.ts";

export interface SetupButton {
  label: string;
  run(c: SetupControls): void;
}

export interface SetupPage {
  title: string;
  body?: string;
  tips?: string[];
  list?: string[];
  /** The step's own answers, before the Skip and Set up later every step ends with. */
  buttons: SetupButton[];
}

/**
 * One Setup step: what it shows, and whether its choice is already made. A step that changes a setting
 * reads and writes the same one Settings does, so `done` reads that setting. The order of the list is the
 * order Setup shows them in; a new step is one more entry in the right place.
 */
export interface SetupStep {
  id: string;
  page(c: SetupControls): SetupPage;
  /** The choice behind this step has been made (a phone paired, a folder added), so Setup resumes past it. */
  done(c: SetupControls): boolean;
  /** The label of Skip, when it isn't just "Skip". */
  skip?(c: SetupControls): string;
  /** The last step: it closes Setup itself, with no Skip or Set up later beside it. */
  final?: true;
}

const next = (c: SetupControls) => c.next();

export const SETUP_STEPS: SetupStep[] = [
  {
    id: "welcome",
    done: () => false,
    page: () => ({
      title: "Welcome to Couch",
      body: "Your Mac, made into a TV. Your phone is the remote.",
      buttons: [{ label: "Use the Mac's keyboard or mouse for now", run: next }],
    }),
  },
  {
    id: "videos",
    done: (c) => c.folders().length > 0,
    skip: (c) => (c.anyAppOn() ? "Skip, I only use the Apps" : "Skip for now"),
    page: (c) => {
      const added = c.folders().length > 0;
      return {
        title: "Add your videos",
        body: "Pick the folders your videos are in. Couch finds them for the Library.",
        list: c.folders(),
        buttons: [
          { label: added ? "Add more" : "Add a folder", run: (c) => c.addFolder() },
          ...(added ? [{ label: "Continue", run: next }] : []),
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
      tips: ["OK opens", "Back steps out", "Home always goes Home"],
      buttons: [{ label: "Go to Home", run: (c) => c.close() }],
    }),
  },
];
