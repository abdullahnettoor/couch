// Decisions about castLabs EVS / VMP signing, kept pure so they can be tested without EVS.
export type EvsState = {
  cliInstalled: boolean;
  loggedIn?: boolean;
  env: Record<string, string | undefined>;
};

export const SETUP_HELP = `VMP signing is only needed for DRM Apps (Netflix, Prime Video, Disney+, Hotstar).
To set it up (once per person):
  brew install pipx && pipx install castlabs-evs && pipx ensurepath
  evs-account signup        # or, on a new Mac: evs-account reauth
Then run \`pnpm sign:dev\` again. Credentials stay in castLabs' own cache; Couch never stores them.`;

export const DEV_SIGNED_WARNING =
  "Building dev-signed: DRM services won't play. Set up castLabs EVS (see CONTRIBUTING.md, 'Signing for DRM work') to VMP-sign release builds.";

export function evsAvailable({ cliInstalled, loggedIn, env }: EvsState): boolean {
  if (!cliInstalled) return false;
  return Boolean((env.EVS_ACCOUNT_NAME && env.EVS_PASSWD) || loggedIn);
}

export type SignDevPlan =
  | { action: "skip"; help: string }
  | { action: "up-to-date" }
  | { action: "sign"; targets: string[] };

export function signDevPlan(o: {
  evs: EvsState;
  targets: string[];
  validSignature: (target: string) => boolean;
}): SignDevPlan {
  if (!evsAvailable(o.evs)) return { action: "skip", help: SETUP_HELP };
  const todo = o.targets.filter((t) => !o.validSignature(t));
  return todo.length ? { action: "sign", targets: todo } : { action: "up-to-date" };
}

export function packagingPlan(evs: EvsState): {
  steps: ("vmp-sign" | "vmp-verify")[];
  warning?: string;
} {
  return evsAvailable(evs)
    ? { steps: ["vmp-sign", "vmp-verify"] }
    : { steps: [], warning: DEV_SIGNED_WARNING };
}
