import type { SetupControls } from "./setup.ts";

export interface SetupButton {
  label: string;
  run(c: SetupControls): void;
}

/** What a step can read about the household while it shows. */
export interface SetupContext {
  /** Phones connected right now. */
  phones: number;
  /** A phone has just connected on this step, which is about to move on. */
  justConnected: boolean;
  /** "Add another phone" was pressed on the pairing step. */
  addingPhone: boolean;
  /** Home's Apps: the same setting as Settings → Apps. */
  apps: {
    rows(): Array<{ id: string; label: string; shown: boolean }>;
    setShown(id: string, shown: boolean): void;
  };
}

export interface SetupPage {
  title: string;
  body?: string;
  tips?: string[];
  /** Draw the pairing QR code and the same-Wi-Fi note. */
  qr?: boolean;
  /** The label of Skip on this step; "Skip" when absent. */
  skip?: string;
  /** The step's own answers, before the Skip and Set up later every step ends with. */
  buttons: SetupButton[];
  /** On/off rows ahead of the buttons; Up and Down move through them, OK flips one. */
  switches?: SetupSwitch[];
}

export interface SetupSwitch {
  label: string;
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
  done(c: SetupControls): boolean;
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
    id: "pair",
    done: () => false,
    page: ({ phones, justConnected, addingPhone }) => {
      if (justConnected)
        return { title: "Phone connected", buttons: [{ label: "Continue", run: next }] };
      if (phones > 0 && !addingPhone)
        return {
          title: phones === 1 ? "1 phone connected" : `${phones} phones connected`,
          skip: "Skip for now",
          buttons: [
            { label: "Continue", run: next },
            { label: "Add another phone", run: (c) => c.addPhone() },
          ],
        };
      return {
        title: "Pair your phone",
        body: "Scan this with your phone's camera. Your phone must be on the same Wi-Fi as this Mac.",
        qr: true,
        skip: "Skip for now",
        buttons: [],
      };
    },
  },
  {
    id: "listener",
    done: (c) => c.listenerOn(),
    page: (_ctx, c) =>
      c.listenerOn()
        ? {
            title: "Couch is on from your phone",
            body: "The phone's Power button can start Couch when it's closed.",
            buttons: [{ label: "Continue", run: next }],
          }
        : {
            title: "Turn Couch on from your phone?",
            body: "Then the phone's Power button can start Couch when it's closed.",
            buttons: [
              {
                label: "Yes",
                run: (c) => {
                  c.turnListenerOn();
                  c.next();
                },
              },
              { label: "No", run: next },
            ],
          },
  },
  {
    id: "apps",
    done: () => false,
    page: ({ apps }) => ({
      title: "Which Apps show on Home?",
      body: "Each one can be changed later in Settings.",
      switches: apps.rows().map((row) => ({
        label: row.label,
        on: row.shown,
        toggle: () => apps.setShown(row.id, !row.shown),
      })),
      buttons: [{ label: "Continue", run: next }],
    }),
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
