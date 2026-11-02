// What a keg's `.brew/<formula>.rb` says about where the installed version's source came from: the url and the
// exact revision/tag/checksum it is pinned to, the patches Homebrew applies and the extra sources it builds in.
// A line-based reader of the few Ruby forms those files use, not a Ruby parser.

export type Pin = { revision?: string; tag?: string; sha256?: string };
export type Provenance = Pin & {
  url: string;
  patches: string[];
  resources: (Pin & { name: string; url: string })[];
};

// Blocks whose urls aren't part of the installed build.
const SKIPPED = new Set(["head", "livecheck", "test", "bottle", "on_linux"]);

export function parseFormula(text: string): Provenance | undefined {
  const lines = text.split("\n");
  const stack: { indent: number; kind: string; resource?: Pin & { name: string; url: string } }[] =
    [];
  const main: Partial<Provenance> = {};
  const patches: string[] = [];
  const resources: Provenance["resources"] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const end = /^(\s*)end\b/.exec(line);
    if (end) {
      if (stack.length && stack[stack.length - 1].indent === end[1].length) stack.pop();
      continue;
    }
    const open = /^(\s*)(\w+)\b(.*)\bdo\s*(\|.*\|)?\s*$/.exec(line);
    if (open) {
      const entry: (typeof stack)[number] = { indent: open[1].length, kind: open[2] };
      const name = open[2] === "resource" ? /^\s*"([^"]+)"\s*$/.exec(open[3])?.[1] : undefined;
      if (name && !stack.some((s) => SKIPPED.has(s.kind))) {
        entry.resource = { name, url: "" };
        resources.push(entry.resource);
      }
      stack.push(entry);
      continue;
    }
    if (stack.some((s) => SKIPPED.has(s.kind))) continue;
    const inPatch = stack.some((s) => s.kind === "patch");
    const resource = [...stack].reverse().find((s) => s.resource)?.resource;

    const inline = /^\s*patch\s+(:\w+)/.exec(line);
    if (inline) patches.push(`inline patch in the formula (patch ${inline[1]})`);

    const file = inPatch ? /^\s*file\s+"([^"]+)"/.exec(line)?.[1] : undefined;
    if (file) patches.push(`patch file in Homebrew's formula repository: ${file}`);

    const url = /^\s*url\s+"([^"]+)"(.*)$/.exec(line);
    if (url) {
      let statement = url[2];
      while (statement.trimEnd().endsWith(",") && i + 1 < lines.length) statement += lines[++i];
      const pins: Pin = {};
      const revision = /revision:\s*"([^"]+)"/.exec(statement)?.[1];
      const tag = /tag:\s*"([^"]+)"/.exec(statement)?.[1];
      if (revision) pins.revision = revision;
      if (tag) pins.tag = tag;
      if (inPatch) patches.push(url[1]);
      else if (resource) Object.assign(resource, { url: url[1] }, pins);
      else if (!main.url) Object.assign(main, { url: url[1] }, pins);
      continue;
    }
    const sha = /^\s*sha256\s+"([0-9a-f]+)"/.exec(line)?.[1];
    if (sha && !inPatch) {
      if (resource) resource.sha256 = sha;
      else if (main.url && !main.sha256) main.sha256 = sha;
    }
  }
  if (!main.url) return undefined;
  return { ...(main as Provenance), patches, resources };
}
