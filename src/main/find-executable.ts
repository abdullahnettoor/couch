import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

const HOMEBREW_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];

export type IsExecutable = (path: string) => boolean;

const defaultIsExecutable: IsExecutable = (path) => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** Homebrew paths first (Finder-launched apps lack the shell PATH), then PATH. */
export function findExecutable(
  name: string,
  env: { PATH?: string } = process.env,
  isExecutable: IsExecutable = defaultIsExecutable,
): string | undefined {
  const dirs = [...HOMEBREW_DIRS, ...(env.PATH ?? "").split(delimiter).filter(Boolean)];
  for (const dir of dirs) {
    const candidate = join(dir, name);
    if (isExecutable(candidate)) return candidate;
  }
  return undefined;
}
