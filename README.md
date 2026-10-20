# Couch

Turns a Mac connected to a TV into a couch-friendly media centre, controlled from phones. See `.issues/001-couch-v1-spec.md` for the spec and `GLOSSARY.md` for the words we use.

## Commands

Tooling is [Vite+](https://viteplus.dev) (`vp`), run through pnpm.

| Command          | What it does                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm install`   | Install dependencies (Electron's download is allowed in `pnpm-workspace.yaml`)                  |
| `vp check`       | Format, lint and type-check (use `vp check --fix` to auto-fix)                                  |
| `vp test run`    | Run the Vitest tests once                                                                       |
| `vp run build`   | Build renderer (`vp build`) and main + preload (`vp pack`) into `dist/`                         |
| `vp run start`   | Build, then start Couch in Electron                                                             |
| `vp run package` | Build an unsigned `out/Couch-darwin-<arch>/Couch.app` (name, icon, bundle id `local.couch.app`) |
| `vp run sample`  | Generate `.dev/sample.mkv` (needs ffmpeg) used by the temporary play key                        |

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

## Setting up Couch (for the household)

You need a Mac with Homebrew, an Android phone with Chrome, and a TV or monitor on the Mac.

1. **Install mpv.** Open Terminal and run `brew install mpv`.
2. **Build Couch.** In the Couch folder run `pnpm install`, then `pnpm exec vp run package`. This makes `out/Couch-darwin-arm64/Couch.app` (the folder name says `x64` on an Intel Mac).
3. **Install it.** Drag `Couch.app` into Applications. Open Applications, then drag Couch to the Dock to keep it there.
4. **First launch.** Couch isn't signed, so double-clicking is blocked. Right-click Couch, choose **Open**, then **Open** again. After that it opens normally, including from the Dock. Couch fills the TV; if no TV is connected it uses the Mac's screen.
5. **Pair a phone.** Join the phone to the same Wi-Fi as the Mac. Open Couch's Settings and scan the QR code with the phone. In Chrome, tap ⋮ then **Add to Home screen**. The Remote is now an icon on the phone.
6. **Sign in to YouTube.** Open YouTube in Couch. It shows a code; on the phone go to youtube.com/activate, enter the code and pick your account. You only do this once.
7. **Add Library folders.** In Settings, choose Library folders and pick the folders that hold your videos. They appear under Library.
8. **Closed-lid use.** To use the Mac with the lid shut, plug in the charger and an external monitor (the TV), and plug in or pair a keyboard/mouse if macOS asks. Without both connected, the Mac sleeps when the lid closes.
9. **"Can't reach Couch" on the phone.** Check that Couch is open on the Mac, that the Mac is awake, and that the phone is on the same Wi-Fi as the Mac (not mobile data or a guest network). Then reopen the Remote. If the Mac's network changed, open Settings on the Mac and scan the QR code again.

If Couch says it needs mpv, mpv isn't installed. Run `brew install mpv`. Couch looks for it in Homebrew's folders first, then your `PATH`, so Dock launches work.

### Where Couch keeps its data

Settings, the pairing key, watch history, YouTube sign-in and thumbnails live in `~/Library/Application Support/Couch`. Rebuilding or replacing `Couch.app` keeps all of it. Delete that folder to start from scratch.
