# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A household (no profiles, no logins) watching a monitor in the living room, driven by a MacBook. They sit on the couch about 2–3 m from the Screen and control it from an Android phone (the Remote). A laptop keyboard and the trackpad/mouse are used occasionally, at the Mac. Guests can pair a phone and join in.

## Product Purpose

Couch makes a MacBook plus monitor feel like the home screen of a modern smart TV, for exactly two things: YouTube (YouTube's own TV interface) and the household's own video folders (the Library). Success: "From the couch, using only my phone, I can open YouTube, search, and play a video. I can also open a Library folder, play a file, and resume it later from where I stopped."

## Positioning

A personal, TV-like shell for one household's YouTube and local files, controlled from any phone by scanning a QR code; no media-centre database or accounts. Kodi was tried and rejected as dated and technical.

## Operating Context

- The Screen is an Electron app, full screen on the external monitor (a normal macOS window when the user leaves full screen). Library videos play through mpv embedded inside Couch's window; YouTube is a web view inside the same window.
- Every action is a command from the phone's Remote, the Mac keyboard (arrows, Enter, Escape, H, Space) or the mouse (hover focuses, click activates, right-click goes back).
- Several phones can be Remotes at once and all show the same state.

## Capabilities and Constraints

- Surfaces: Home (clock, greeting, Apps row of YouTube and Library, one Continue watching card, Settings gear), Library (folders, subfolders, videos, Continue watching row), Player (title, progress, transport, subtitles, volume), Settings (Add a phone, Forget all phones, Library folders, Restart YouTube, Quit Couch), the phone Remote (D-pad, Back/Home/Play-Pause, Type, volume, YouTube skip buttons, Now Playing).
- Focus is grid-based and owned by the core; the Screen must always show clearly where focus is.
- Library tiles show a frame from the video (or a colour from the title until it's ready), a cleaned title, progress and "Watched".
- Show and film details come from TMDB (a built-in project key in release builds, or the household's own key); Couch works fully without them.
- The Player overlay is currently drawn by mpv's on-screen display (ASS); the renderer can only draw over the video if the embedded view allows it (open technical question).
- Terminology from GLOSSARY.md is binding in UI copy: Screen, Remote, Home, App, YouTube, Library, Continue watching, Now Playing, Settings.

## Brand Commitments

Name: Couch. Users explicitly asked for controls that feel like Apple TV's (tvOS) rather than the current stroked, hard-to-read controls. Earlier mockups chose Home variant "Row" and Remote variant "D-pad" (branch `prototype/home-and-remote`).

## Evidence on Hand

Real Library content exists on the household's Mac (e.g. "Elemental (2023)"); thumbnails are frames from the files. No logos or brand assets beyond the logo: a glowing TV set into the backrest of an amber sofa on a dark navy tile (`build/icon.png`, full-bleed `build/icon-touch.png`). It is the app icon, the Remote's tab and home-screen icon, and the art on Credits.

## Product Principles

1. Legible from the couch first; the mouse is a convenience, never a requirement.
2. One or two presses to anything the household does often.
3. Every Remote and the Screen always agree on where you are.
4. Calm when idle, out of the way while watching.

## Accessibility & Inclusion

Text and focus must read at 2–3 m on a 27" monitor; controls must not rely on thin strokes or low-contrast text over video.
