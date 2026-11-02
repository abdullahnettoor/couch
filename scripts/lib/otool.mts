// Reads `otool` output for one dylib: what it references, its own install name and its rpaths.
import type { LibInfo } from "./bundle-libs.mts";

export type OtoolOutput = {
  /** `otool -L <file>` */
  deps: string;
  /** `otool -D <file>` */
  id: string;
  /** `otool -l <file>` */
  loads: string;
};

export function parseOtool(out: OtoolOutput): LibInfo {
  const id = out.id.split("\n")[1]?.trim();
  const [, ...lines] = out.deps.split("\n");
  const deps = lines
    .map((l) => /^\s+(\S.*?) \(compatibility/.exec(l)?.[1])
    .filter((r): r is string => !!r && r !== id);
  const rpaths = [
    ...out.loads.matchAll(/cmd LC_RPATH\n\s+cmdsize \d+\n\s+path (.+) \(offset/g),
  ].map((m) => m[1]);
  return { deps, rpaths };
}
