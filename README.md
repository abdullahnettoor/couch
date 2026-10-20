# Couch

Turns a Mac connected to a TV into a couch-friendly media centre, controlled from phones. See `.issues/001-couch-v1-spec.md` for the spec and `GLOSSARY.md` for the words we use.

## Commands

Tooling is [Vite+](https://viteplus.dev) (`vp`), run through pnpm.

| Command         | What it does                                                                   |
| --------------- | ------------------------------------------------------------------------------ |
| `pnpm install`  | Install dependencies (Electron's download is allowed in `pnpm-workspace.yaml`) |
| `vp check`      | Format, lint and type-check (use `vp check --fix` to auto-fix)                 |
| `vp test run`   | Run the Vitest tests once                                                      |
| `vp run build`  | Build renderer (`vp build`) and main + preload (`vp pack`) into `dist/`        |
| `vp run start`  | Build, then start Couch in Electron                                            |
| `vp run sample` | Generate `.dev/sample.mkv` (needs ffmpeg) used by the temporary play key       |

Run `vp` as `pnpm exec vp …` if it isn't installed globally. If `ELECTRON_RUN_AS_NODE` is set in your shell, unset it before `vp run start`.

## Layout

```
src/
  shared/      Types shared by every process: Player port, IPC channel names
  main/        Electron main process: owns the core, ports, Remote server (later tickets)
    mpv/       Player port implementation: mpv child process + JSON IPC client
    display.ts Picks the external monitor, else the built-in screen
    index.ts   Wiring (window, ports, quit handling)
  preload/     contextBridge API exposed to the Screen renderer (built as CJS)
  renderer/    The Screen's UI (Vite root); draws state, forwards keys as commands
scripts/       Dev helpers
```

Planned homes: `src/main/core/` (state + commands), `src/main/ports/` (YouTube, Mac, Clock, Store, Thumbnails), `src/main/remote/` (server + phone page).

Build outputs: `dist/renderer` (Vite), `dist/main/index.mjs` (ESM), `dist/preload/index.cjs` (CJS, required for sandboxed preload). `vite.config.ts` holds all three configs: Vite (root `src/renderer`), `pack` (tsdown) for main and preload, and `test` (root forced to the repo).

## mpv hand-off

One long-lived mpv (`--idle=yes --no-config --no-native-fs --fs --fs-screen-name=<display> …`, no `--force-window`) starts with Couch and is controlled only through a Unix socket in a temp folder. The Screen uses Electron `setSimpleFullScreen`, so both share one Space. When mpv stops or reaches the end of the file its window disappears and the main process calls `show()`, `app.focus({steal:true})` and `focus()` on the Screen. Quitting waits for mpv to exit.

Temporary keys on the Screen (removed once the core exists): `P` play the sample, `Space` pause, `←/→` seek 10 s, `S`/`Esc` stop, `Q` quit.

Dev aids: `COUCH_SELFTEST=1` plays/stops five times and logs window focus; `COUCH_SELFTEST=quit-mid-play`; `COUCH_FORCE_NO_MPV=1` simulates mpv missing; `COUCH_SAMPLE=/path.mkv` overrides the sample.

## Manual checks (ticket 002)

Run `vp run sample` once, then `vp run start`.

1. **External monitor:** with a monitor connected, Couch fills it (no menu bar, no Dock). Press `P`: video plays full screen on the same monitor. Press `S`: video disappears, Couch is in front, and `P` works again without clicking.
2. **Built-in only:** unplug the monitor, repeat.
3. **Two plays in a row:** `P`, `S`, `P`, `S`. Watch for Spaces animation, Dock/menu bar flashes, or Couch hiding behind another window.
4. **End of file:** `P`, then `→` until the 20 s sample ends. Couch returns with focus.
5. **Quit mid-play:** `P`, then `Q` (or Cmd+Q). `pgrep -fl mpv` shows nothing.
6. **No mpv:** `COUCH_FORCE_NO_MPV=1 vp run start` shows "Couch needs mpv to play videos. Install it with: brew install mpv".
