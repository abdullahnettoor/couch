# Shipping Couch to other people

Couch is a personal app today: it runs on the household's Mac, built and installed from this repo. This page lists what has to change before anyone else can download and run it, and how a release is made.

## Signing and notarisation

- **Decision for now: no notarisation.** It needs Apple's Developer Program (US$99 a year). Releases are signed with a self-signed certificate, "Couch Release Signing", and the download page says Couch isn't notarised and how to open it the first time (macOS 15: System Settings → Privacy & Security → Open Anyway; macOS 14: Control-click → Open).
- **Why a stable certificate, not ad-hoc:** the signature's designated requirement is the certificate's own hash, so it stays the same from release to release. The updater only installs an update whose signature matches the installed app, so every release must be signed with this one certificate. Losing it means installed copies can't update. WebKit's "Couch WebCrypto Master Key" keychain item still asks once per build, since code without an Apple team ID is matched by its build fingerprint.
- **Making the certificate:** `pnpm release:cert` (once) writes it to `~/couch-release-signing` and prints how to add it to the repo's secrets. Back that folder up.
- **Later, with a Developer ID** (Apple Developer Program): set `COUCH_CODESIGN_IDENTITY` to it and add notarising (`notarytool submit --wait`, then `stapler staple`) after `scripts/package.mjs`. Moving from the self-signed certificate to a Developer ID changes the signature, so that release has to be installed by hand once.

## Bundled mpv and GPL source

- **What's in place:** `vp run package` copies libmpv and its Homebrew libraries (FFmpeg, libass, libplacebo and others) into `Contents/Frameworks/mpv`, with licence texts (`licenses/<formula>/`; where a Homebrew keg only has an overview, the full texts come from `scripts/licenses/`, and packaging fails if any bundled formula lacks one) and `THIRD-PARTY-LIBRARIES.md` in `Contents/Resources`. The manifest gives each formula's installed version, licence, source url and what it is pinned to (a checksum for archives, a revision or tag for git sources such as x264), the patches Homebrew applies, and extra sources a formula builds in.
- **Before a public download:** provide the corresponding source for the GPL parts (mpv, FFmpeg, x264, x265, rubberband, and others in the manifest). `pnpm release:assets` does this: it fetches each bundled formula's source, resources, patches and formula file from Homebrew into `Couch-<version>-gpl-sources.tar`, which the release workflow attaches to the GitHub Release beside the app (GPLv3 §6(d), so no written offer is needed). It refuses to run if Homebrew would now fetch a different version than the one bundled.
- **Architecture:** only arm64, the Homebrew on the packaging Mac. An x86_64 or universal build needs an Intel Homebrew (`/usr/local`) run of `vp run package`, or a separate build of each library, and `lipo` to merge them.

## DRM

- **Widevine (Chromium engine):** the castLabs ECS Electron build, VMP-signed through castLabs EVS.
  - A free EVS account is for development.
  - Check castLabs' terms for distribution and get any licence they require before shipping.
- **FairPlay (WebKit engine):** Apple's own WebKit, with no extra licence for a browser-style app. FairPlay is available whenever the Mac's WebKit offers it, which Couch checks at start.

## Distribution channel

- **Direct download (GitHub Releases, and Gumroad linking to them) is the realistic channel.**
- **Why not the Mac App Store:**
  - the App Store sandbox;
  - the castLabs runtime;
  - the Couch Listener's LaunchAgent;
  - the WebKit mouse fix, which uses WebKit's private `_simulateMouseMove:`. It's fine outside the App Store, and falls back if Apple removes it.

## Updates

- **Updater:** Electron's own `autoUpdater` through update.electronjs.org, which reads this repo's published GitHub Releases (`src/main/ports/updates.ts`). It needs a public repo and the `Couch-darwin-arm64-<version>.zip` asset the workflow attaches. A packaged Couch checks a minute after start and every six hours, and at once on Settings → About → Check for updates; a downloaded update installs when Couch quits, with one toast and Home's update icon, never a forced restart (Settings → About → Restart to update asks, then calls `quitAndInstall`). A Couch run from the repo checks nothing; About says updates only work in the installed app. On the first start of a new version Couch restarts the Listener's LaunchAgent, which would otherwise keep running the old binary.
- **Checked:** 0.1.0 updated itself to 0.1.1 (self-signed, installed on quit).
- **Beta channel:** a Mac with Settings → About → Beta updates On (kept in the Store's `updates` document) reads `beta-darwin-arm64.json` from the `beta-feed` GitHub release instead of update.electronjs.org. That file names the newest published release, beta or stable, so a beta Mac also moves on to the stable release after its beta. `scripts/beta-feed.mjs` writes it: `release.yml` runs it after publishing a beta, and `beta-feed.yml` when a release is published, unpublished, edited or deleted by hand (Actions → Beta feed → Run workflow rewrites it any time). Squirrel.Mac installs whatever a plain file names, so Couch compares the file's version itself (SemVer) and asks Squirrel only when it is newer: never a downgrade. The `beta-feed` release is a pre-release with a non-SemVer tag, so neither update.electronjs.org nor GitHub's "Latest" ever picks it. Switching Beta updates re-points Squirrel's feed and checks at once; while an update is downloading or ready it waits for the next start instead (a new feed is a new Squirrel updater, which knows nothing of the update the old one fetched), and About says so. Turning it Off on a beta version never downgrades: update.electronjs.org answers "no update" unless its newest release is newer than the version in the address, so the Mac waits for a stable release newer than its beta. The old hidden switch (`defaults write com.abdullahnettoor.couch updateChannel beta`) is read once, on the first start with no stored choice, and becomes Beta updates On; after that it is ignored.

## Branches

- **`dev`:** everyday work, and where betas are tagged. Pull requests target `dev`.
- **`main`:** the default branch, holding only what stable users run, so the README and the Download link never describe unfinished work.
- **A stable release:** merge `dev` into `main` (`git switch main && git merge dev`), then `pnpm release minor` (or `patch`/`major`) on `main`. From `0.2.0-beta.3` that gives `0.2.0`. `pnpm release` then moves `dev` up to the release when `dev` had nothing else, or tells you to merge `main` into `dev`.
- **A hotfix:** fix it on `main`, `pnpm release patch` there, then merge `main` into `dev` (`pnpm release` does it, or says how).
- **Rules the tools enforce:** `pnpm release` refuses a beta outside `dev` and a stable version outside `main`; `release.yml` fails a beta tag that isn't on `dev`, or a stable tag that isn't on `main`.
- **CI:** `.github/workflows/ci.yml` runs `vp check` and `vp test run` on every push and pull request to `dev` and `main`.
- **Version conflicts:** `dev` carries `-beta.N` versions and `main` plain ones, so a merge can conflict on `package.json`'s `version`. Keep the version of the branch you're merging into; `pnpm release` sets the next one.

## Releasing

- **Versions:** SemVer, tagged `v<version>` (`v0.1.0`). `0.x` while Couch is early; `1.0.0` when it's ready for people outside the household. A bug-fix release bumps the last number, new features the middle one. The macOS build number (`CFBundleVersion`) is the workflow's run number.
- **Secrets** (repo → Settings → Secrets and variables → Actions): `COUCH_SIGNING_P12` and `COUCH_SIGNING_P12_PASSWORD` (from `pnpm release:cert`), `EVS_ACCOUNT_NAME` and `EVS_PASSWD` (castLabs EVS), and optionally `COUCH_TMDB_TOKEN`.
- **Steps:**
  1. On a clean `dev` (a beta: `pnpm release 0.3.0-beta.1`, then `pnpm release 0.3.0-beta.2`…) or `main` (stable: `pnpm release patch`, `minor` or `major`), up to date with origin. It asks to confirm, runs `vp check` and the tests, sets `version` in `package.json`, commits it, and pushes the branch and the `v<version>` tag.
  2. The tag starts `.github/workflows/release.yml`: it builds on an Apple Silicon runner, VMP-signs, signs, and makes the zip, dmg, GPL source bundle and `SHA256SUMS.txt`. It fails if the tag and `package.json` disagree, if the tag is on the wrong branch, or if EVS isn't signed in.
  3. A stable version becomes a **draft** GitHub Release. Download the dmg, check it opens and plays (including a DRM App), then publish the draft. The updater only sees published releases.
- **Betas:** a version with a hyphen (`pnpm release 0.2.0-beta.1` on `dev`) is published at once as a GitHub pre-release, with no draft step, and the beta feed is updated, so Macs on the beta channel update to it; stable Macs don't (update.electronjs.org skips pre-releases). The release after it (`pnpm release patch` from `0.2.0-beta.1` gives `0.2.0`) starts as a draft as usual and, once published, reaches everyone, beta Macs included.
- **Gumroad:** publishing a stable release runs `.github/workflows/gumroad.yml`, which uploads its `Couch-arm64.dmg` to the Gumroad product (abdullahnettoor.gumroad.com/l/couch) as `Couch-<version>-arm64.dmg`, makes it the product's only file, and puts its download block at the top of the Content page (and points any `…/releases/latest` link there at the direct download). Betas are skipped. It needs the `GUMROAD_ACCESS_TOKEN` secret (Gumroad → Settings → Advanced → Applications → the "Couch" application → Generate access token). If it fails, the GitHub release is unaffected: re-run it, or Actions → Gumroad → Run workflow with the tag. Gumroad refuses to remove a file the Content page still shows, so the new file and the new Content page are sent in one request.
- **A failed build:** re-run it from Actions if the failure was passing (a download). If code had to change, move the unpublished tag: `git tag -f v<version> && git push -f origin v<version>`. Never move or reuse the tag of a published release; release the next version instead.
- **Trial build:** Actions → Release → Run workflow builds the same files without a release, kept as an artifact for a week.

## Accounts and content

- **How Couch shows services:** it shows each service's own website, like a browser, and users sign in with their own accounts on the service's own sign-in page. Couch never asks for Full Disk Access and never reads another app's data.
- **Copy sign-in from Couch:** it only moves a user's own existing sign-in from Couch's Chromium engine to its WebKit engine, inside Couch's own data.
- **What not to ship:** anything that looks like sharing accounts or getting around a service's rules.

## Before the repo goes public

- **Keys:** the TMDB key is injected at build time from `COUCH_TMDB_TOKEN` and isn't committed. Keep it out of public builds' logs, or use a per-user key.
- **Personal paths:** before publishing, check tracked files and history for personal paths, addresses and machine names; use neutral examples in new docs and tests (such as `~/…`, `192.168.1.20` or `<your Mac's IP>`).

## Other platforms

Mac only for now. See the discussion in the issues: the native edges and the Couch Listener would need rewriting for Windows, and Netflix on Windows would need its own trial (WebView2 and PlayReady).
