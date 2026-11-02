# Contributing to Couch

Couch is a Mac media centre for a TV, controlled from phones. Read `GLOSSARY.md` first: every word the household sees (Screen, Remote, Home, App, Settings…) is defined there, and UI text must use those words.

## Set up

```sh
pnpm install            # installs castLabs' Electron (ECS, with Widevine); a postinstall step fetches its binary
pnpm run build:native   # builds the embedded mpv player (needs mpv/libmpv installed, e.g. brew install mpv)
vp check                # format, lint, type-check; must show 0 errors (vp check --fix auto-fixes)
vp test run             # Vitest, once
vp run start            # build and run Couch
```

Couch runs on castLabs' Electron for Content Security (ECS), pinned in `package.json` as `github:castlabs/electron-releases#v<x>+wvcus` (currently v44.5.1; castLabs trails upstream Electron, so check their [releases](https://github.com/castlabs/electron-releases/releases) when upgrading). It behaves like stock Electron plus Widevine. `pnpm drm-check` plays Widevine's test stream and prints a report (`pnpm drm-check -- --url <service>` opens a service on its own partition). `pnpm webkit-selftest` is the WebKit counterpart: headless, it reports whether FairPlay is available and whether `setSinkId` exists in a `WKWebView` (needs the native add-on built). Netflix runs on WebKit where FairPlay is available, and on Chromium otherwise or when the household chooses it (Settings → Apps → Netflix → Playback); `COUCH_NETFLIX_ENGINE=webkit|chromium` is a developer override of that choice for one run, honoured only by an unpackaged run (`pnpm dev`, and the real-check launcher, which runs the unpackaged app); the installed app ignores it, so the household's choice always wins. Start-up never waits for the FairPlay check: a cached answer (per Safari and macOS version) is used at once; with none, Netflix starts on Chromium and the check runs in the background, then switches to WebKit quietly (at once if Netflix is hidden, else the next time it is hidden; playback is never interrupted). A dev run with the override waits for the check, so it starts on the engine it names. `COUCH_WEBKIT_EPHEMERAL=1` (with the WebKit engine) gives Netflix a non-persistent WebKit store; every other run keeps its own store per userData folder. A real check runs through `node scripts/webkit-real-check.mjs`, which refuses default ports and any userData outside the temp directory; `--test-page` (`COUCH_WEBKIT_TEST_PAGE=1`) makes Netflix's WebKit host play a local synthetic clip instead of Netflix, to check Picture off and the other overlays over a playing page. `pnpm webkit-test-page-check` does that headless.

If `vp` isn't installed globally, run it as `pnpm exec vp …`. If `ELECTRON_RUN_AS_NODE` is set in your shell, unset it before `vp run start`.

## Signing for DRM work

Only needed when working on DRM Apps (Netflix, Prime Video, Disney+, Hotstar): they refuse the development VMP signature that ECS ships with. Everything else (YouTube, Library) needs none of this.

- One castLabs EVS account per person: `brew install pipx && pipx install castlabs-evs && pipx ensurepath` (macOS Homebrew Python refuses a plain `pip install`), then `evs-account signup` (or `evs-account reauth` on a new Mac). Credentials stay in castLabs' own cache; never commit them.
- `pnpm sign:dev` VMP-signs the dev Electron. Run it once per checkout and after each Electron upgrade. It does nothing (and exits 0) without EVS, and never re-signs a valid signature.
- `pnpm package` bundles Homebrew's libmpv and its libraries into `Contents/Frameworks/mpv` (so `brew install mpv` must be present when packaging), VMP-signs before Apple code signing when EVS is available, then verifies, then signs the bundled libraries with the same identity and finally the whole app; without EVS it builds a dev-signed app and warns that DRM services won't play. Set `COUCH_CODESIGN_IDENTITY` for a Developer ID signature (default is ad-hoc).
- For a Couch you install on your own Mac, don't use an ad-hoc signature. It changes with every build, so macOS treats each update as a new app: it asks again for WebKit's "Couch WebCrypto Master Key" keychain item, and forgets other permissions.
  - **Best: a free "Apple Development" certificate.** Add your Apple ID in Xcode → Settings → Accounts, then Manage Certificates → + → Apple Development. Package with `COUCH_CODESIGN_IDENTITY` set to its SHA-1 from `security find-identity -v -p codesigning`. It carries a team ID, so the keychain's partition check stays stable across builds and "Always Allow" sticks. The certificate lasts about a year.
  - **Fallback: a self-signed "Couch Local Signing" certificate.** It keeps app permissions, but the keychain still asks once per build, because code without a team ID is matched by its exact build fingerprint (`cdhash:`). To create it, run `openssl req -x509` with `extendedKeyUsage = codeSigning`, then `security import … -T /usr/bin/codesign`.
  - Neither can be notarised; they're only for your own installs.
- castLabs' rules of conduct: no extra accounts (reset the password instead), don't force a re-sign while the signature is valid.

## Identifiers

Couch's bundle id is `com.abdullahnettoor.couch` (`scripts/package.mjs`) and its Listener's LaunchAgent label is `com.abdullahnettoor.couch.listener` (`LISTENER_LABEL`). The first placeholder ids (under a `local` prefix) appear only in the one-time migration on start (`src/main/ports/listener-label-migration.ts`) and its tests. The userData folder is named from `app.setName("Couch")`, not the bundle id, so changing the id leaves data in place.

## How to contribute

Open an issue on GitHub to discuss a change, or send a pull request. Build test-first: write a failing test for the behaviour, make it pass, repeat. Run `vp check` and `vp test run` before you push. In the pull request, say what you checked by hand on a real screen, and what you couldn't check. Never touch a running Couch or its real partitions: copy the partition to a temp folder and run your own Electron instance on it.

## Add a YouTube add-on

An add-on is a small, switchable change to how YouTube behaves inside Couch. It shows up in Settings → YouTube add-ons by itself.

1. **One file** in `src/main/apps/youtube/addons/`, named for the add-on (`<id>.ts`), exporting an `Addon` (see `src/main/web/addon.ts`):

   ```ts
   import type { Addon } from "../../../web/addon.ts";

   export const EXAMPLE: Addon = {
     id: "example", // stable; it is the key of the household's choice in the Store
     label: "Example", // shown in Settings
     description: "One line saying what it does.", // shown in Settings
     app: "youtube",
     defaultOn: false, // new add-ons are Off unless they fix something broken
     page: `function () {
       couchHooks.onJson(function (value) {
         // edit `value` in place or return a replacement; return undefined to keep it
       });
     }`,
     // requests: { onBeforeRequest(details) { … }, onBeforeSendHeaders(details) { … } },
   };
   ```

   `page` is the _source text_ of a function that runs in the page's main world on every load: no imports, no closing over module variables. `requests` handlers run in the main process (they are shared with the host's `RequestHooks`).

2. **One line** in `src/main/apps/youtube/addons/index.ts`: import it and add it to `YOUTUBE_ADDONS`. The list order is the Settings order and the order page functions run. Nothing else changes: Settings, the Store, the reload and the "<n> on" count all follow the list.

3. **Use `couchHooks`** (defined on the page before any add-on runs; see `src/main/web/page-hooks.ts`):
   - `couchHooks.onJson(modifier)`: called with every `JSON.parse` result; edit it in place or return a replacement, `undefined` keeps it. Return fast for what you don't care about.
   - `couchHooks.onResponse(urlPrefix, modifier)`: `modifier(text, absoluteUrl)` returns replacement text or `undefined`, for `fetch` and `XMLHttpRequest` responses whose URL starts with the prefix.
   - **Never** patch `JSON.parse`, `fetch` or `XMLHttpRequest` yourself, and **never** call `session.webRequest`: the hooks keep one patch per API, keep the patched functions looking native, and one add-on's failure can't break another. To block or rewrite network requests, use `requests` on the add-on.

4. **A unit test** next to it (`<id>.test.ts`) with a recorded fixture: a small, trimmed real response or `JSON` blob, kept in the test (or a `fixtures/` file). Run the page function in `node:vm` like `src/main/web/page-hooks.test.ts`: build a `sandbox` object with `console`, `location`, `URL`, `Response`, a fresh fake `XMLHttpRequest` class and `fetch`, set `sandbox.window = sandbox` (add-ons read `couchHooks` as a global, so `window` must be the context's own global), then `vm.createContext(sandbox)` and run `(${PAGE_HOOKS_FUNCTION})()` then `(${addon.page})()`, and drive `JSON.parse(...)` or `fetch(...)`. Test request handlers by calling them directly with `{ url }`. `4k.ts`/`4k.test.ts` is a worked example. If you add an add-on, update the add-ons seam test (`src/main/addons.test.ts`), which pins the list and the "<n> on" count.

5. **A real check** on a temp copy of the YouTube partition, in your own Electron instance:
   - copy `~/Library/Application Support/Couch/Partitions/youtube` to `<temp>/Partitions/youtube`;
   - bundle a tiny main script (`vp pack /abs/path/check.ts --format cjs --platform node`, use an absolute entry outside dot-folders) that does `app.setPath("userData", <temp>)`, builds `new ElectronWebApp(youtubeDescription("0.0.0", {}, { "<id>": true }), win)`, calls `.start()` and inspects `win.contentView.children[0].webContents` (for example `executeJavaScript`);
   - show the add-on's effect with it On, and its absence with it Off (`yt.setAddons([...])` reloads in place);
   - never point it at the household's real user data. Say in the pull request what you checked; if you couldn't, say so.

6. **Attribution:** if you adapted code from another project, keep its copyright and licence text in a header comment of the file and link the source (see the head of `4k.ts`). Only adapt code whose licence allows it.

## Add a web App

A web App is a site Couch shows on the Screen and drives with the Remote. Its description is data; the host (`ElectronWebApp`) holds no site knowledge. A web App loads on its first show, so nothing autoplays unseen; only startup in `src/main/index.ts` loads one earlier (YouTube, when Home shows it). Netflix's billboard trailer is the reason this matters.

1. **The description:** `src/main/apps/<id>/<id>-web.ts` exports a `WebAppDescription` (`src/main/web/web-app.ts`): `id`, `url`, `partition` (`persist:<id>`), the `identity` it presents, `keyCodes` for the six Remote keys, `isOwnOrigin`, search (`isSearchUrl`, `searchUrlFor`, `searchPlaceholder`), `route` signals, `skip` keys, `preloads` and its `addons`. `youtube-web.ts` is the model.
2. **The App:** wrap the host in an `App` (`src/main/apps/app.ts`) like `YouTubeApp`, and pass it in `Ports.apps` in `src/main/index.ts` after constructing `new ElectronWebApp(description, win)`.
3. **The App list entry:** add an `AppEntry` to `APP_ENTRIES` in `src/main/apps/index.ts` (`id`, `label`, `icon`, `action: "app:open:<id>"`, `web: true`). Home, Settings → Apps (its menu's "Restart <label>") and the error screen all follow this one list; a test-injected App passes its entry to the harness (`options.apps`) and gets the same.
4. **The icon:** the App's official logo as an SVG string (see `src/main/apps/youtube/icon.ts`), taken from the owner's brand resources, or a faithful copy of the official mark when those need an account; record source and date in a comment; never fetched at runtime. It must read on the dark Home tile. Logos are trademarks of their owners, and Couch is not affiliated with them.
5. **A seam test:** drive a `FakeWebApp("<id>", "<Label>", {...})` (`src/main/ports/fakes.ts`) through `startHarness(undefined, { apps: [{ entry, app }] })` the way `src/main/apps.test.ts` does: it appears on Home, OK opens it, Back leaves it, a failure shows the error screen.
6. **A real check:** run the App in your own Electron instance on a temp user-data folder (as for add-ons), and confirm it loads, takes the Remote's keys and sound goes to the chosen output. Say in the pull request what you saw.

## Add a DRM web App

For a site that plays Widevine video (Netflix is the model: `src/main/apps/netflix/`). It is a web App as above, plus the items below. The maintainer does the real check with an account; contributors stop at the seam test.

1. **Sign the dev Electron:** `pnpm sign:dev` (see "Signing for DRM work"). Without it the service refuses to play.
2. **Probe the site first:** `pnpm drm-check -- --url https://<service>/` opens it on its own partition. Never sign in to any service while doing this.
3. **The route file:** `src/main/apps/<id>/<id>-route.ts` exports `is<Id>Home(url: URL)` (true only at the page Back should leave from), `is<Id>Origin(origin)` (https and the service's own hosts only; test look-alikes such as `www.<host>.evil.example`) and the search URL helpers. Test them from recorded URLs.
4. **The description:** `<id>-web.ts` returns a `WebAppDescription` with `identity: chromeIdentity(version)` (the site must see Chrome, not Electron), `partition: "persist:<id>"`, `drm: true`, `backByHistory: true`, `focus: { selectors }` (the site's own tiles, on top of the default controls), `seekKeys`, `artworkHosts` (the domains its Now Playing artwork may come from; any other is dropped), `search`, `route: urlRoute(is<Id>Home)`, `preloads: []`, `addons: []`, `enabledAddons: []`. Copy `netflix-web.ts`.
5. **The App:** `<id>-app.ts` implements `App` over the `YouTube` port type; copy `NetflixApp` (its own `typing`, Back that goes back in the page's history and leaves at home or when stuck for 800 ms).
6. **List entry, icon, wiring:** `icon.ts` (an SVG mark), an entry in `APP_ENTRIES` (`src/main/apps/index.ts`) after the previous App, and in `src/main/index.ts` `new ElectronWebApp(description, win)` plus the App in `apps: [...]`. A new entry moves Library one tile right: tests that go Home to Library press Right once more.
7. **Seam tests with a fake web App:** no account, no network. Use the harness's `options.apps` with a `FakeYouTube` behind your App class (`h.netflix` is that for Netflix: `startHarness` builds it). Import `FakeClock` and `FakeYouTube` from `src/main/ports/fakes.ts`; the harness puts your tile after the built-in ones, and Home's focus does not start on YouTube (the seam test needed three Right presses to reach the third App; count yours or use the `focus(id)` helper in `src/main/apps.test.ts`). Name the tests' hosts with a reserved domain (`demoflix.example`). Drive routes with `description.route.tracker().update(url, null)` and emit the result as `{ type: "route", ...route }` on the fake. Check: the tile is on Home, OK opens it, keys and play/pause reach it, Back inside goes back, Back at home asks "Leave <Label>?". See `src/main/netflix.test.ts`.
8. **Widevine unavailable:** the host emits `failed` with a `note`; core keeps it and `app-error.ts` shows it. No App code needed.
9. **The real check (maintainer only):** run your Electron with a temp `--user-data-dir`, sign in to the service yourself on the Screen, and confirm it plays with sound on the chosen output. Say in the pull request what you saw, never account details. Never commit cookies, tokens, user-data folders or screenshots showing an account.

## A web App on WebKit

Some DRM needs FairPlay, which only a Mac's own WebKit (a `WKWebView`) gets, with decryption in secure hardware and no 720p cap. Choose it for a service that streams better or only with FairPlay (Netflix is the model). Everything else stays a Chromium web App: it is the default, it has add-ons, and it can play to a chosen sound output.

**What the host supports.** `WebKitWebApp` (`src/main/web/webkit-web-app.ts`) takes the same `WebAppDescription` as `ElectronWebApp` and sits behind the same App port, so the App, its scripts and its tests are reused. It supports: the page scripts (see the worlds below); the Remote's keys, the Mac keyboard and the mouse (native input, so Couch's overlays keep working: Picture off, Quick settings, the volume pill, confirmations, the search bar); volume, mute and silence while hidden; idle unload; a data store of its own per App; cookies in (copied from Couch's own Chromium sign-in only) and sign out. It does not support: add-ons, and choosing a sound output (the page plays to the Mac's current output; Sound output says so).

**Which world a script runs in (WebKit).** A `WKWebView` has the page's own world and a `couch` world the page can't see. Put a script where it belongs; the same description serves both engines, and Chromium has one world.

- **Page world** (the site's own, injected at document start): the App's artwork preloads (`preloads`, e.g. Netflix's box-art recorder), the page hooks (`couchHooks`), and key claiming (the wrapper that tells Couch's focus ring a key was handled by the site). They must see or change what the site's own scripts see. Keep them few and small: the site can look at them.
- **Couch world:** the host's own scripts (the focus ring, the route reporter, the hide-scrollbars style), the sound guard (Couch's volume, the hidden-play guard), and the `couch` message handler with its `couchHost.send` bridge. Nothing the site does can read or break them, and they report through the one message handler. Their `sessionStorage`, DOM and `navigator.mediaSession` are shared with the page, so they can read what a page-world script leaves there.
- **Probes** (playback state, tracks, prompts, seek, play/pause, the search field check) are not injected: the host runs them through `evaluate`, which always runs once in the `couch` world and answers with a value.

**Two engines for one App.** Build the host through `SwitchableWebApp` (`src/main/web/switchable-web-app.ts`), as `index.ts` does for Netflix: a factory makes the `ElectronWebApp` or `WebKitWebApp` for an engine, and `switchTo` disposes the old host (view, listeners and timers) before the new one starts, keeping each host's data. The engine is chosen at startup by `chooseEngine` (`native-front.ts`) from the stored choice (`createPlayback`, `playback-choice.ts`, stored per App in the `apps-playback` document), the cached FairPlay check (`fairplay.ts`) and the developer override; hand `NetflixApp` the `playback` choice so Settings shows the Playback row, and give the sign-in rows only while the engine is WebKit.

**The native side.** `native/mpv-embed/webkit_host.mm` holds the `WKWebView` host (registered by `registerWebKit`, released by `disposeWebKits`); `mpv_embed.mm` holds the mpv player and the window's view order. They build into the one `mpv_embed.node` and meet only at `window_order.h` (add or remove an App view in the Keeper's order) and `napi_util.h`. `input_policy.h` stays engine-independent.

**Testing it with the fake bridge.** No window, no network. `WebKitWebApp` takes a `WebKitBridge` (`src/main/web/webkit-bridge.ts`); copy the `FakeView` and bridge in `webkit-web-app.test.ts`, drive the host, and assert on what the view was told (scripts, loads, routing, destroyed). `web-host-contract.ts` runs the same cases against both hosts. Headless, with the real add-on: `pnpm webkit-selftest` (FairPlay, keys, pointer, cookies) and `pnpm webkit-test-page-check` (the page scripts in a real `WKWebView`). On screen, with a temp userData and non-default ports: `node scripts/webkit-real-check.mjs`; never sign in, type into or play a real service while doing it.

## Rules

- No network calls beyond the App's own site and, for an add-on, its one documented service. Say in the add-on's description if it needs one.
- Never read or send account data (tokens, watch history, profile info), and never read cookies, with one narrow exception: copying a sign-in from Couch's own Chromium (Settings → Apps → Netflix → Copy sign-in from Couch, or the one-time welcome's copy; Couch never reads Safari or asks for any extra permission) happens only on the household's request, in the app. Tests never read real cookies (tests use fake sources), and a cookie's value is never logged, shown or saved anywhere outside the App's own WebKit store.
- An add-on or hook must not throw into the page: guard with checks and return `undefined` when unsure. (A throwing modifier is skipped and warned about once, but don't rely on that.)
- UI words follow `GLOSSARY.md`. Settings strings are short, plain and in the household's words.
- Keep changes small and in the surrounding style; `vp check` must show 0 errors and `vp test run` must pass.

## Remote home-screen app

The manifest never holds the pairing key: `start_url` is `/` and the page reads the key saved in localStorage. An Android home-screen app shares the browser's storage; an iPhone home-screen app has its own, so it may need one QR scan from inside it.
