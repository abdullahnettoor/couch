// Starts a release: `pnpm release <patch|minor|major|version>`, for example `pnpm release patch` or
// `pnpm release 0.2.0-beta.1`. It checks the repo is ready, runs the checks and tests, sets package.json's
// version, commits, and pushes the commit and the v<version> tag. The tag starts the release workflow, which
// makes a draft GitHub Release to test and publish by hand (SHIPPING.md, "Releasing").
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { nextVersion, withVersion } from "./lib/release-version.mts";

const run = (command, args) => execFileSync(command, args, { stdio: "inherit" });
const read = (command, args) =>
  execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const fail = (message) => {
  console.error(`\n${message}`);
  process.exit(1);
};

const wanted = process.argv[2];
if (!wanted) fail("Usage: pnpm release <patch|minor|major|version>, e.g. pnpm release patch");

const pkg = readFileSync("package.json", "utf8");
const current = JSON.parse(pkg).version;
let version;
try {
  version = nextVersion(current, wanted);
} catch (e) {
  fail(e.message);
}
const tag = `v${version}`;
const pre = version.includes("-");
// Betas come from dev, stable releases (and hotfixes) from main. See SHIPPING.md, "Branches".
const branch = pre ? "dev" : "main";

if (read("git", ["branch", "--show-current"]) !== branch)
  fail(
    pre
      ? "Release a beta from the dev branch: git switch dev"
      : "Release a stable version from main: merge dev into main first (git switch main && git merge dev).",
  );
if (read("git", ["status", "--porcelain"]))
  fail("The working tree has changes: commit or stash them first.");
run("git", ["fetch", "--quiet", "--tags", "origin"]);
const ancestor = (a, b) => {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", a, b], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
// Ahead of origin is fine (e.g. dev just merged into main): the push below sends it.
if (!ancestor(`origin/${branch}`, "HEAD"))
  fail(`${branch} is behind or has diverged from origin/${branch}: pull first.`);
if (read("git", ["tag", "--list", tag])) fail(`The tag ${tag} already exists.`);

console.log(
  `\nRelease ${current} → ${version} (tag ${tag} on ${branch})${pre ? ", a beta: published at once, and only Macs on the beta channel update to it" : ""}.`,
);
if (process.stdin.isTTY) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Continue? [y/N] ");
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) fail("Stopped; nothing changed.");
}

console.log("\nRunning the checks and tests…");
run("pnpm", ["exec", "vp", "check"]);
run("pnpm", ["exec", "vp", "test", "run"]);

writeFileSync("package.json", withVersion(pkg, version));
run("git", ["commit", "--quiet", "-m", version, "--", "package.json"]);
run("git", ["tag", tag]);
run("git", ["push", "--quiet", "origin", branch]);
run("git", ["push", "--quiet", "origin", tag]);

// A stable release (or hotfix) on main goes back into dev, so dev never loses it.
let devNote = "";
if (!pre) {
  const devExists = read("git", ["ls-remote", "--heads", "origin", "dev"]) !== "";
  if (!devExists) devNote = "\nThere's no dev branch on origin yet.";
  else if (ancestor("origin/dev", "HEAD")) {
    run("git", ["push", "--quiet", "origin", "HEAD:dev"]);
    try {
      execFileSync("git", ["fetch", "--quiet", "origin", "dev:dev"], { stdio: "ignore" });
    } catch {}
    devNote = "\ndev is moved up to this release (it had nothing main lacked).";
  } else
    devNote =
      "\ndev has commits main doesn't: merge this release into it now so dev keeps it:\n  git switch dev && git merge main && git push";
}

const repo = /github\.com[:/](.+?)(?:\.git)?$/.exec(
  read("git", ["remote", "get-url", "origin"]),
)?.[1];
console.log(`
Pushed ${tag}. The release workflow is building it (about 30–40 minutes):
  https://github.com/${repo}/actions/workflows/release.yml
${pre ? "It publishes the beta itself; Macs on the beta channel pick it up within six hours:" : "When it's done, test the draft and publish it:"}
  https://github.com/${repo}/releases${devNote}`);
