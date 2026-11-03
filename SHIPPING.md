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

- **Updater (not built yet):** Electron's own `autoUpdater` through update.electronjs.org, which reads this repo's published GitHub Releases. It needs a public repo and the `Couch-darwin-arm64-<version>.zip` asset the workflow attaches.
- **To check before relying on it:** install one self-signed release, publish the next, and confirm it updates itself.

## Releasing

- **Versions:** SemVer, tagged `v<version>` (`v0.1.0`). `0.x` while Couch is early; `1.0.0` when it's ready for people outside the household. A bug-fix release bumps the last number, new features the middle one. The macOS build number (`CFBundleVersion`) is the workflow's run number.
- **Secrets** (repo → Settings → Secrets and variables → Actions): `COUCH_SIGNING_P12` and `COUCH_SIGNING_P12_PASSWORD` (from `pnpm release:cert`), `EVS_ACCOUNT_NAME` and `EVS_PASSWD` (castLabs EVS), and optionally `COUCH_TMDB_TOKEN`.
- **Steps:**
  1. Set `version` in `package.json`, commit, then `git tag v<version> && git push origin v<version>`.
  2. `.github/workflows/release.yml` builds on an Apple Silicon runner, VMP-signs, signs, and makes the zip, dmg, GPL source bundle and `SHA256SUMS.txt`. It fails if the tag and `package.json` disagree, or if EVS isn't signed in.
  3. It creates a **draft** GitHub Release. Download the dmg, check it opens and plays (including a DRM App), then publish the draft. The updater only sees published releases.
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
