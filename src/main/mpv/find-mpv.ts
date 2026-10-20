import { findExecutable, type IsExecutable } from "../find-executable.ts";

export function findMpv(env?: { PATH?: string }, isExecutable?: IsExecutable): string | undefined {
  return findExecutable("mpv", env, isExecutable);
}
