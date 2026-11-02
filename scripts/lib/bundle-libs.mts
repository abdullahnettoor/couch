// Collects libmpv and its non-system dylibs into one folder, with install names that only point at each other.
// The walk and the rewrite plan are pure over an injected `inspect` (otool), so they are tested with a fake.
import { basename, dirname, join } from "node:path";

export type LibInfo = { deps: string[]; rpaths: string[] };
export type LibFs = {
  inspect: (file: string) => LibInfo;
  exists: (file: string) => boolean;
  realpath: (file: string) => string;
};
export type BundledLib = {
  realPath: string;
  name: string;
  info: LibInfo;
  /** Every reference this library makes to a non-system dylib, keyed by the text in its load command. */
  refs: Map<string, string>;
};

export const isSystemRef = (ref: string) =>
  ref.startsWith("/usr/lib/") || ref.startsWith("/System/");

export function resolveRef(
  ref: string,
  loaderDir: string,
  rpaths: string[],
  exists: (file: string) => boolean,
): string {
  const expand = (p: string) => p.replace(/^@loader_path/, loaderDir);
  if (ref.startsWith("@loader_path/")) return join(loaderDir, ref.slice("@loader_path/".length));
  if (ref.startsWith("@rpath/")) {
    const rest = ref.slice("@rpath/".length);
    for (const rpath of rpaths) {
      const candidate = join(expand(rpath), rest);
      if (exists(candidate)) return candidate;
    }
    throw new Error(`can't resolve ${ref} (rpaths: ${rpaths.join(", ") || "none"})`);
  }
  if (ref.startsWith("@")) throw new Error(`unsupported reference ${ref}`);
  return ref;
}

/** The root keeps the name it was given (libmpv.2.dylib); dependencies are named by their real file. */
export function collectLibs(root: string, fs: LibFs): BundledLib[] {
  const libs = new Map<string, BundledLib>();
  const byName = new Map<string, string>();
  const visit = (path: string, name: string) => {
    const realPath = fs.realpath(path);
    if (libs.has(realPath)) return;
    const taken = byName.get(name);
    if (taken && taken !== realPath)
      throw new Error(`two libraries are both called ${name}: ${taken} and ${realPath}`);
    byName.set(name, realPath);
    const info = fs.inspect(realPath);
    const lib: BundledLib = { realPath, name, info, refs: new Map() };
    libs.set(realPath, lib);
    for (const ref of info.deps) {
      if (isSystemRef(ref) || ref === realPath) continue;
      const dep = fs.realpath(resolveRef(ref, dirname(realPath), info.rpaths, fs.exists));
      if (dep === realPath) continue;
      lib.refs.set(ref, dep);
      visit(dep, basename(dep));
    }
  };
  visit(root, basename(root));
  return [...libs.values()];
}

export type RewriteStep = {
  name: string;
  id: string;
  changes: [from: string, to: string][];
  deleteRpaths: string[];
};

export function rewritePlan(libs: BundledLib[]): RewriteStep[] {
  const nameOf = new Map(libs.map((l) => [l.realPath, l.name]));
  return libs.map((lib) => ({
    name: lib.name,
    id: `@loader_path/${lib.name}`,
    changes: [...lib.refs].map(([ref, dep]) => [ref, `@loader_path/${nameOf.get(dep)}`]),
    deleteRpaths: lib.info.rpaths,
  }));
}
