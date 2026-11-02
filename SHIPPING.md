# Shipping Couch to other people

Couch is a personal app today: it runs on the household's Mac, built and installed from this repo. This page lists what has to change before anyone else can download and run it. Nothing here is built yet.

## Signing and notarisation

- **What we have now:** local installs are signed with a self-signed certificate, "Couch Local Signing" (see CONTRIBUTING.md). It only works on the Mac that holds it.
- **What other Macs need:** a **Developer ID Application** certificate from the Apple Developer Program, which costs US$99 a year. Without it, Gatekeeper blocks a downloaded Couch.
- **Notarisation:** every release must be notarised, so Apple scans it before it opens normally.
- **What's already in place:**
  - `scripts/package.mjs` signs with `COUCH_CODESIGN_IDENTITY`, with the hardened runtime and `build/entitlements.plist`.
  - Notarising (`notarytool submit --wait`, then `stapler staple`) still has to be added after it.
- **What a stable signature fixes:** WebKit keeps a keychain item, "Couch WebCrypto Master Key". With any stable signature, users approve it at most once. Ad-hoc builds re-ask after every update.

## DRM

- **Widevine (Chromium engine):** the castLabs ECS Electron build, VMP-signed through castLabs EVS.
  - A free EVS account is for development.
  - Check castLabs' terms for distribution and get any licence they require before shipping.
- **FairPlay (WebKit engine):** Apple's own WebKit, with no extra licence for a browser-style app. FairPlay is available whenever the Mac's WebKit offers it, which Couch checks at start.

## Distribution channel

- **Direct download, signed and notarised, is the realistic channel.**
- **Why not the Mac App Store:**
  - the App Store sandbox;
  - the castLabs runtime;
  - the Couch Listener's LaunchAgent;
  - the WebKit mouse fix, which uses WebKit's private `_simulateMouseMove:`. It's fine outside the App Store, and falls back if Apple removes it.

## Updates

Couch needs an updater: Sparkle, or Electron's `autoUpdater` with a feed. It also needs a place to host releases. Both need signed, notarised builds.

## Accounts and content

- **How Couch shows services:** it shows each service's own website, like a browser, and users sign in with their own accounts on the service's own sign-in page. Couch never asks for Full Disk Access and never reads another app's data.
- **Copy sign-in from Couch:** it only moves a user's own existing sign-in from Couch's Chromium engine to its WebKit engine, inside Couch's own data.
- **What not to ship:** anything that looks like sharing accounts or getting around a service's rules.

## Before the repo goes public

- **Keys:** the TMDB key is injected at build time from `COUCH_TMDB_TOKEN` and isn't committed. Keep it out of public builds' logs, or use a per-user key.
- **Personal paths:** before publishing, check tracked files and history for personal paths, addresses and machine names; use neutral examples in new docs and tests (such as `~/…`, `192.168.1.20` or `<your Mac's IP>`).

## Other platforms

Mac only for now. See the discussion in the issues: the native edges and the Couch Listener would need rewriting for Windows, and Netflix on Windows would need its own trial (WebView2 and PlayReady).
