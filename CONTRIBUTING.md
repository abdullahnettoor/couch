# Contributing to Couch

Couch is a Mac media centre for a TV, controlled from phones. Read `GLOSSARY.md` first: every word the household sees (Screen, Remote, Home, App, Settings…) is defined there, and UI text must use those words.

## Set up

```sh
pnpm install            # Electron's download is allowed in pnpm-workspace.yaml
pnpm run build:native   # builds the embedded mpv player (needs mpv/libmpv installed, e.g. brew install mpv)
vp check                # format, lint, type-check; must show 0 errors (vp check --fix auto-fixes)
vp test run             # Vitest, once
vp run start            # build and run Couch
```

If `vp` isn't installed globally, run it as `pnpm exec vp …`. If `ELECTRON_RUN_AS_NODE` is set in your shell, unset it before `vp run start`.

## How work is tracked

Work lives in `.issues/` as markdown files (see `.issues/README.md`): a spec (`NNN-slug.md`) and the tickets cut from it (`parent:` points at the spec). A ticket has `status`, `assignee`, `blocked_by` and acceptance criteria as checkboxes. To find work an agent or person can pick up, run the ready query from `.issues/README.md`, then check each ticket's `blocked_by`. Claim a ticket by setting `assignee` before you start, tick the criteria as you meet them, and set `status: closed` when done.

Build test-first: write a failing test for the behaviour, make it pass, repeat. Besides unit tests, do a real check (run the thing) and record it in the ticket. Never touch a running household Couch or its real partitions: copy the partition to a temp folder and run your own Electron instance on it.

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
   - never point it at the household's real user data. Say in the ticket what you checked; if you couldn't, say so.

6. **Attribution:** if you adapted code from another project, keep its copyright and licence text in a header comment of the file and link the source (see the head of `4k.ts`). Only adapt code whose licence allows it.

## Add a web App

A web App is a site Couch shows on the Screen and drives with the Remote. Its description is data; the host (`ElectronWebApp`) holds no site knowledge.

1. **The description:** `src/main/apps/<id>/<id>-web.ts` exports a `WebAppDescription` (`src/main/web/web-app.ts`): `id`, `url`, `partition` (`persist:<id>`), the `identity` it presents, `keyCodes` for the six Remote keys, `isOwnOrigin`, search (`isSearchUrl`, `searchUrlFor`, `searchPlaceholder`), `route` signals, `skip` keys, `preloads` and its `addons`. `youtube-web.ts` is the model.
2. **The App:** wrap the host in an `App` (`src/main/apps/app.ts`) like `YouTubeApp`, and pass it in `Ports.apps` in `src/main/index.ts` after constructing `new ElectronWebApp(description, win)`.
3. **The App list entry:** add an `AppEntry` to `APP_ENTRIES` in `src/main/apps/index.ts` (`id`, `label`, `icon`, `action: "app:open:<id>"`, `web: true`). Home, Settings' "Restart <label>" and the error screen follow the list.
4. **The icon:** an SVG string (see `src/main/apps/youtube/icon.ts`); it must read on the dark Home tile.
5. **A seam test:** drive a `FakeWebApp("<id>", "<Label>", {...})` (`src/main/ports/fakes.ts`) through `startHarness(undefined, { apps: [{ entry, app }] })` the way `src/main/apps.test.ts` does: it appears on Home, OK opens it, Back leaves it, a failure shows the error screen.
6. **A real check:** run the App in your own Electron instance on a temp user-data folder (as for add-ons), and confirm it loads, takes the Remote's keys and sound goes to the chosen output. Record what you saw in the ticket.

## Rules

- No network calls beyond the App's own site and, for an add-on, its one documented service. Say in the add-on's description if it needs one.
- Never read or send account data (cookies, tokens, watch history, profile info).
- An add-on or hook must not throw into the page: guard with checks and return `undefined` when unsure. (A throwing modifier is skipped and warned about once, but don't rely on that.)
- UI words follow `GLOSSARY.md`. Settings strings are short, plain and in the household's words.
- Keep changes small and in the surrounding style; `vp check` must show 0 errors and `vp test run` must pass.
