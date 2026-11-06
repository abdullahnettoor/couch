# Couch website (`site/`)

The landing page for [Couch](https://github.com/abdullahnettoor/couch), planned for `couch.abdullahnettoor.com`. A fully static site: plain HTML, CSS and TypeScript built with Vite into `dist/`, served by Cloudflare Workers static assets with no Worker script. No framework, no server code, no analytics, no cookies, no third-party requests (Geist and Geist Mono are self-hosted, SIL OFL); the only exception is the launch video's YouTube player, once there is a video and only after the visitor presses play (see "The launch video").

## Run it

The site lives in `site/` of the Couch app repo and is its own pnpm project (own `package.json`, lockfile and `pnpm-workspace.yaml`); the app's `vp check` and `vp test run` leave it out. Run everything from this folder:

```sh
cd site
pnpm install
pnpm dev          # http://localhost:5173
pnpm build        # type-check, then build to dist/
pnpm preview      # serve dist/ at http://localhost:4173
pnpm test         # CSS-scope fixtures, unit tests, and the browser tests (intro, page, launch video)
pnpm launch:thumb # save the launch video's thumbnail (pnpm build runs it too; does nothing while LAUNCH_VIDEO.id is empty)
```

## Settings in one place

`src/config.ts` holds `GUMROAD_URL` (a **placeholder** until the Gumroad product exists), `GITHUB_URL`, `RELEASES_URL`, `DOWNLOAD_URL` (the "or download free from GitHub" links: always `https://github.com/abdullahnettoor/couch/releases/latest/download/Couch-arm64.dmg`, see "Publishing"), `WINDOWS_ISSUE_URL` and `SITE_URL`. They are filled into `index.html` at build time (`{{GUMROAD_URL}}` and so on), so every link works without JavaScript. `SOCIAL` (ticket 143) is the footer's list of social links, shown as icons only: the footer shows exactly the entries there (GitHub, X, LinkedIn and YouTube) and no list when it is empty. Each entry is `{ label, href, icon }`; `label` is the link's accessible name and tooltip, and `icon` picks a Phosphor brand mark from `SOCIAL_ICONS` in `vite.config.ts` (inline SVG, no requests; Phosphor is MIT, `public/licenses/`). An entry without an icon is shown as its label.

Section spacing (ticket 143) is four tokens in `src/style.css` `:root`, used by every section: `--section-pad` (section top and bottom), `--eyebrow-gap` (eyebrow → headline: 20px, 16px on phones), `--head-gap` (headline → body: 24px, 20px on phones) and `--intro-gap` (a centred heading → its content: 56px, 40px on phones).

## Copy

`COPY.md` is the copy deck (tickets 137 and 138): every page string, headline alternatives, picks and factual evidence. Keep it in step with text changes, including screenshot alternatives and social-card text.

## Couch for Windows

Not a waitlist and not a counter. The Couch for Windows card in the download section (`#windows`; the hero's "On Windows? Tell us you'd use it" links to it) says Windows is being considered, not promised, and its button is a plain link to GitHub issue #34, "Couch for Windows: add a 👍 if you'd use it" (`WINDOWS_ISSUE_URL`). Interest is the issue's 👍 count, on GitHub; the site sends nothing, stores nothing and needs no script for it. `scripts/page.test.mjs` checks the link and that following the card makes no request of its own.

## Screenshot slots

Every product picture is a **slot**, declared once in `src/slots.ts` (a typed manifest: slot name → interim file, alt text, width and height, `loading` priority). `vite.config.ts` reads it at build time and writes the `<img>` into `index.html` (`{{slot:name}}`), or into the place a mock stands in (`<!--mock:name-->…<!--/mock-->`). The build fails if `index.html` uses a slot the manifest lacks, or the manifest has a slot `index.html` never uses.

To replace a picture, drop a file named `src/shots/slot-<name>.png` (or `.jpg`, `.webp`) and rebuild. It wins over the manifest's `file` and over any CSS mock. The slot keeps its alt text, `width`/`height` and `loading` (`eager` for the first viewport, `lazy` for the rest) from the manifest, so edit those in `src/slots.ts` if the new picture differs (and write real alt text for what it shows). Crop shots so no UI is cut through: a Screen frame holding a picture takes the picture's own shape from its `width`/`height` (16:9 such as 1920×1080, or the Mac display's 16:10 such as 1920×1200; CSS mocks stay 16:9; setup steps are 16:9), about 9:19 for the Remote (1080×2280), each under about 150 KB. A dropped-in file has no `srcset`; the manifest's own pictures do (below).

| Slot name | Where | Today | Source (ticket 140 shoot) |
| --- | --- | --- | --- |
| `hero-screen` | First look, under the hero | `home.webp` (16:10): Home with Big Buck Bunny under Continue watching (the launch video's sequence plays over it, ticket 145) | `hero-home-continue-focus.png` |
| `remote-screen` | "Your phone is the remote" TV | Couch UI mock: Home with the pairing QR card | (mock kept: the pairing sequence) |
| `remote-phone` | Same section, phone | Couch UI mock: the Remote, and a phone camera view | (mock kept: the pairing sequence) |
| `apps-screen` | "The Apps you already use" TV | Couch UI mock: Home with the Continue row and App tiles | (mock kept: the focus pass across the Apps) |
| `library-screen` | "Your Library" TV | `library.webp` (16:10): the Films shelf (Big Buck Bunny, Sintel, Tears of Steel) | `library-first-page.png` |
| `privacy-screen` | Privacy panel TV | `settings.webp`: Settings | `settings.png` |
| `setup-install` | Setup step 1 (desktop and tablet; phones keep the small icon) | Drawn (`install()` in `src/mocks.ts`): the Couch icon lifted over its empty place in an Applications row | (no screenshot) |
| `setup-qr` | Setup step 2 | `home-qr.webp` (16:9 detail, 1280/640): Home's QR card and "No phone connected" | `home-qr.png` |
| `setup-app` | Setup step 3 | `home-youtube.webp` (16:9 detail, 1280/640): Home's App row with YouTube highlighted | `hero-home-youtube-focus.png` |

**The screenshots (ticket 142)** are the real Couch from the ticket 140 shoot (`.notes/shots/140/` in the app repo, git-ignored): a temporary profile, no household data, YouTube and Netflix only as App tiles, each picture privacy-checked there and again here. `pnpm shots [dir]` (`scripts/shots.mjs`, needs `cwebp`) crops each window capture without cutting through its UI (Home and the Library whole at the display's 16:10; Settings to 16:9 by trimming empty black; the setup cards' two 16:9 details of Home, ticket 143, cut only through empty background) and writes WebP at 1920 (`<name>.webp`), 1280 and 640 px (`<name>-1280.webp`, `<name>-640.webp`; the setup details at 1280 and 640 only); `vite.config.ts` writes them as a `srcset` with the slot's `sizes`. The films are Blender's open films *Big Buck Bunny*, *Sintel* and *Tears of Steel* (© Blender Foundation, CC BY 3.0) and the posters, backdrops and synopses come from TMDB, so the footer's "Credits" block and the Credits section of `/licenses/` credit both: the films with the CC BY changes note ("Film imagery shown within Couch screenshots; cropped and resized for this site."), and TMDB with its approved logo (`public/tmdb.svg`, "Primary short (blue)" from TMDB's Logos & Attribution page, self-hosted and unaltered, linking to themoviedb.org, smaller than Couch's own mark) beside its notice ("This product uses the TMDB API but is not endorsed or certified by TMDB"). Keep those credits whenever a picture shows a film. The two Remote-section slots (`remote-screen`, `remote-phone`) carry the finite pairing sequence (QR, pair, D-pad press, highlight moves); replacing either with a still turns that part into a plain picture, so replace both or neither. The sequence's end state is the connected state, which is also what visitors with reduced motion or no JavaScript see.

**Next shoot: shoot in the evening.** The ticket 140 shoot was taken in the afternoon, so the real screenshots show 3:36 PM while the mocks (`src/mocks.ts`) show 8:42 PM and "Good evening". Left as is for now; the next shoot should happen in the evening so the clock and the greeting match the mocks.

The hero's light is `src/shots/couch-glow.webp` (and `-480`): Couch's own icon art, `build/icon.png` in the Couch repo, cropped to the sofa and its tile darkened so it can be added to the page as light (`mix-blend-mode: screen`). Regenerate:

```sh
ffmpeg -i ../build/icon.png -vf "crop=832:688:96:115,curves=all='0/0 0.25/0.05 0.6/0.6 1/1'" /tmp/glow.png
cwebp -q 80 /tmp/glow.png -o src/shots/couch-glow.webp
cwebp -q 80 -resize 480 397 /tmp/glow.png -o src/shots/couch-glow-480.webp
```

Other assets: `public/icon.png`, `favicon.png` and `apple-touch-icon.png` come from `build/icon.png` in the Couch repo. `public/og.png` (the social card) is generated by `node scripts/og.mjs` from `scripts/og.html`; edit that file and rerun to change it.

## The wordmark (ticket 142)

COUCH as SVG paths, in the icon's orange with a soft vertical gradient (#ffc681 → #f28a3a → #c9601f). It replaced ticket 139's hand-drawn wordmark. **No font ships**: the site carries only the letters, as paths.

- **Where the letters live.** `src/brand/letters.ts` holds them in em units (cap height 100, baseline 0, the U centred on x = 0). To change the wordmark, edit that file, or redraw it from `src/brand/wordmark.svg` (the standalone copy) in a vector editor and copy the new paths back: C, C and H as path data; U and O as corner lists (below), so the intro can still morph them. Then `pnpm wordmark` rewrites `src/brand/wordmark.svg`.
- **No font files are committed.** `.gitignore` ignores `*.ttf` and `*.otf`, and a unit test fails if any font other than the Geist web fonts is tracked.
- **C, C and H** are plain SVG paths.
- **U and O** are rounded polygons, so they can morph: each corner is `[x, y, radius]`, with radius 0 for a square corner. The corners are in the logo's order (`src/brand/logo.ts`): the U has the sofa's eight (arm, arm, the cradle's two, arm, arm, the base's two), the O the Screen frame's four outside and four inside, so its slot becomes the Screen. The logo's corners are measured from `build/icon.png`, in the coordinates of the hero picture (`couch-glow.webp`, the icon's 832 × 688 crop), so the vector logo lands on the picture.
- **One size.** The letters' counters are wide open (the C's slot is 38% of the cap), so the nav uses the same outlines at 20 px tall; ticket 139's separate small optical size is gone.
- **Files.** `src/brand/wordmark.svg` is the standalone wordmark (`role="img"`, titled "Couch"), also used on the social card; `pnpm test` fails if it is out of date. The nav's copy is inlined at build time (`{{wordmark:nav}}` in `index.html`) inside the brand link, whose accessible name is "Couch, back to top". The icon stays as the favicon, the app mark in Setup and Download, and the footer mark.

### The hero intro

On the first visit in a browser session, COUCH turns into the logo, then the hero copy arrives. Ticket 143 made it slower and cinematic (the user's review: "make it a little slow so we can feel it"): the logo is whole at about 3.2 s, and the copy starts arriving over the morph's last 0.6 s so the page is readable as the logo completes.

| Time | What happens |
| --- | --- |
| 0–0.76s | The five letters rise in, 40ms apart (0.6s each, Couch's `--ease`) |
| 0.76–1.25s | COUCH holds, still: a beat before anything moves |
| 1.25–2.25s | The C, C and H dissolve, outward from the U along a soft, noisy front (the H a little later); each bit leaves as a mote of warm dust |
| 1.25–2.9s | The dust drifts, slower and softer, into the Screen: about 220 small motes at 1440 px (about 120 on a phone), lifting and swaying like dust in a light beam before they gather |
| 1.35–2.6s | The O glides to the Screen's place on a gentle ease-in-out, dipping behind the U's arm; from 1.6s it becomes the frame, and from 1.9s it darkens to the frame's colour |
| 1.4–2.6s | The U widens into the sofa on the same gentle ease-in-out: its arms round into armrests, its base becomes the seat |
| 2.05–2.85s | The sofa's back rises behind the Screen |
| 2.3–3.35s | The Screen comes up like a slow exposure (no flicker) as the dust arrives, and its warm bloom swells a little past full and settles; the room's light comes up from 2.3s over 2s |
| 2.6–3.8s | The badge, "Settle in.", lead, buttons and meta arrive (opacity and a 14px rise, 0.9s each) |
| 2.8–3.55s | The icon's own glowing picture fades in over the vector logo, which fades out from 3s, so the existing hero mark (and its slow film flicker, from 3.8s) takes over in place |

**Two modes**, one constant: `INTRO_MODE` in `src/config.ts`, built in at build time (`COUCH_INTRO_MODE=logo-only` overrides it for one build).
- `"sequence"` (the default) is the table above: the logo first, then the words.
- `"logo-only"`: the badge, headline, lead, buttons and meta are there from the first paint (no 2.6s row); the morph plays only in the logo area and the glowing picture still fades in as the morph ends (2.8s). The head script adds `html.intro-logo`.

How it is built:
- **Before the first paint**, a small inline script in `<head>` (`introHead` in `src/brand/wordmark.ts`) decides whether to play. It plays only once per session (`sessionStorage`, `couch:intro`), never with `prefers-reduced-motion`, and never when the URL has a `#section`. If it plays, it adds `html.intro` (and `html.intro-logo` in the logo-only mode) and sets `--wm-s`, which sizes the wordmark to `min(720px, 88vw)` wide.
- **CSS keeps the timeline** (`style.css`, "Hero intro"): the letters' rise, the frame's colour, the back, the Screen, the glow, the picture and the copy, with transform and opacity only.
- **`src/intro.ts` does the rest on the same clock** (the CSS animation's start time on `document.timeline`; its `TIMES` match the CSS). The U and O are interpolated corner by corner and their rounded paths rebuilt each frame, so every in-between shape is clean; the O's position follows a shallow curve. The dust is a **small canvas** over the mark, added when the intro starts and removed when the dust has arrived (or the intro ends): the C, C and H are drawn into it once, each covered pixel gets a dissolve threshold (the letter, how far along it from the U, and value noise), worked out a few rows per frame while COUCH rises in so nothing stalls; each frame then clears what the front has passed and draws the motes as two soft pre-rendered sprites (additive). The dust is seeded, so every visit and every frame capture is the same. One `requestAnimationFrame` loop runs for about 2.9s. There is no library, only a small `cubic-bezier` solver. CSS `d: path()` interpolation is not used, because Safari does not animate `d`.
- **Skipping.** Any scroll, wheel, tap, click or key ends it at once: the copy and mark appear within 0.3s. So does a click or focus that comes without a pointer or key (assistive tech, `element.click()`, `focus()`), so no hero control is ever used while transparent; and a resize or rotation, because the wordmark was sized for the first viewport. Switching to reduced motion does the same. Coming back from the back/forward cache shows the end state at once, with no fade (`html.intro-now`). The intro's listeners and the dust canvas are removed when it ends.
- **Reduced motion** never starts the intro: the finished hero, no dust, no running animation.
- **Tests.** `scripts/intro.test.mjs` (part of `pnpm test`, needs Google Chrome) builds both modes, serves them and checks in headless Chrome that a pointerless click, a focus, a resize and a back/forward-cache return each end the intro with the copy, buttons and picture fully visible, the dust canvas gone and no intro listener left; that the dust canvas is there while the intro plays; that the ticket 143 timeline holds (COUCH still at 0.8–1.15s with no dissolve, the U widening and the dust out by 1.9s, no copy and no picture before 2.45s in sequence, the headline and the picture arriving at 3.05s while the morph is still on screen, the copy always visible in logo-only); and that reduced motion shows the finished hero with no dust and no running animation. `scripts/page.test.mjs` (also in `pnpm test`) builds once and checks the headline's turn (the order, about 2.6s each, the rest on "Settle in.", the h1's text and accessible name, an unchanged h1 box and no layout shift, the hover pause, nothing under reduced motion) and the Remote stage (the head and stage pinned together below the nav, steps 1–4 at 15/42/70/92% of the track and back again, the pacing (step 2 from 30%, 3 from 55%, 4 from 84%), the headline below the nav and the phone on screen at 1440 × 900 and 1024 × 768, unpinned with Replay at 1440 × 700, the track measured again after a layout change above it and no writes far from it, the rail filling and emptying, a step's button scrolling to its step, no wheel or touchmove listener, unpinned with Replay on a 390 px phone (waiting until the devices and the first step are in view) and under reduced motion, the Screen's share of the width and the phone in front of its corner). Since the ticket 143 review it also checks that a switch to reduced motion mid-turn or during the last return puts "Settle in." back at once, that a resize to 320 px while "Lights down." shows fits it at once, and the font: whole-navigation CLS 0 under reduced motion at 1440 and 390 (the font's swap included; the headline test keeps its own CLS from the font being in), Geist preloaded from its built URL, and CLS < 0.001 with Geist held back 1.2 s.
- **No JavaScript.** If the module script never runs, the CSS timeline still ends on the finished hero; the C, C and H simply fade where they stand, and the U and O do not change shape.
- **Layout.** The hero's text and buttons are in the HTML from the start, and the intro only changes opacity and transforms (and draws in its own canvas), so nothing shifts (CLS 0). The intro SVG and canvas are `aria-hidden`.
- **Frames and video.** `node scripts/morph-frames.mjs <dir>` writes frames at fixed intro times (1440 and 390), the settled hero, a reduced-motion shot and `morph.webm` / `morph.mp4`, from `pnpm preview`. It slows the page clock with DevTools.

### Film grain

A fine, static film grain lies over the hero (`.hero::after`): `src/shots/grain.png`, a 128 × 128 tile of seeded grey noise (16 KB, `pnpm grain` rewrites it), shown at 64 CSS px with an overlay blend at 15%. Overlay leaves the blacks nearly untouched and shows the grain in the light, so it smooths the glow's gradients and lets the drawn logo sit in the same picture as the glowing icon. It never moves, and it stays with reduced motion.

## The mocks use Couch's real UI

Every drawn (non-screenshot) mock is Couch's own UI, not a re-drawing. `scripts/sync-couch-ui.mjs` (`pnpm sync:couch`) reads the app repo this site lives in (the parent folder, or `COUCH_REPO=`; read only) and writes `src/couch-ui/`, which is committed so the site builds without the Couch repo:

| File | Copied from (Couch repo) | What it is |
| --- | --- | --- |
| `src/couch-ui/screen.css` | `src/renderer/glass.css`, `src/renderer/home.css`, `src/shared/glass-tokens.ts` | The Screen's CSS verbatim (tiles, focus lift and sheen, pills, top strip, Home layout, Library cards), every selector scoped under `.cu`; the glass tokens (colours, radii, `--ease`) injected as Couch's `main.ts` does |
| `src/couch-ui/remote.css` | `src/main/remote/page.ts` (its `<style>`, with the glass tokens at `1px`) | The Remote page's CSS verbatim, scoped under `.cr`; `:active` also matches `.is-active` so the sequence can press a key |
| `src/couch-ui/remote.html` | `src/main/remote/page.ts` (its markup, `src/shared/icons.ts`) | The Remote's idle (Home) view as the page builds it, with Phosphor icons filled in |
| `src/couch-ui/data.json` | `src/shared/icons.ts`, `src/main/apps/index.ts` (the YouTube, Netflix and Library App tiles' art), `src/shared/wallpapers.ts`, `glass.css` and `page.ts` (motion) | Icons, App marks, the Couch wallpaper, the motion values with their sources, and a hash of every source file |

`src/mocks.ts` writes the markup (Home, the Library shelf, the Remote's App row) the way `src/renderer/views/home.ts`, `glass.ts`, `library.ts` and `page.ts` build theirs, with made-up content (a clock, "Summer Trip", "Cooking Show", hue-coloured frames instead of film art; no real posters, no sign-in pages). `src/style.css` ("couch ui" section) holds everything the site adds: it scales the Screen with `--u = frame width / 1920` (Couch's own unit, via container query units) and the Remote by drawing it at 390 px and scaling to the frame, and it drives the pairing sequence. The copied files are never edited by hand. `pnpm sync:couch --check` regenerates every output in memory (`screen.css`, `remote.css`, `remote.html`, `data.json`) and exits 1 if any committed file differs or is missing (only the recorded Couch commit hash is ignored); run `pnpm sync:couch` and look at the mocks again. The copied CSS is isolated: selectors sit under `.cu` / `.cr`, and every `@keyframes` (and `@font-face` family) is prefixed `cu-` / `cr-` with its references rewritten; `@import` and non-`data:` `url()` make the script fail rather than copy something unscoped. `pnpm test` runs a small fixture check of this.

### Motion

The mocks move with Couch's own CSS, so these are Couch's values, not look-alikes (the full list with sources is `motion` in `src/couch-ui/data.json`):

| What | Value | Source in Couch |
| --- | --- | --- |
| Easing, everywhere | `cubic-bezier(0.16, 1, 0.3, 1)` (`--ease`) | `src/shared/glass-tokens.ts` |
| Focus move on a tile (lift, scale 1.09, shadow) | `transform` and `box-shadow` 0.38s `--ease` | `glass.css` `.g-tile`, `.focused > .g-tile` |
| Caption under the focused tile | `transform` 0.38s `--ease`, `color` 0.3s | `glass.css` `.g-cap` |
| Pills (Resume, From start) | `transform` 0.3s `--ease`, `background` and `color` 0.25s | `glass.css` `.g-pill` |
| Home hero and clock fade | `opacity` 0.7s `--ease` | `home.css` `.h-hero`, `.h-clock` |
| Shelf and chip scrolling | `transform` 0.45s `--ease`; Library body scroll is `smooth` | `views/library.ts` |
| Wallpaper drift on Home | 90s, ease-in-out, alternate | `home.css` `.h-drift`, `shared/wallpapers.ts` |
| Remote key press | `transform` .12s, `:active` scale(.95) | `page.ts` `.k`, `.bar button` |
| Remote D-pad press | `:active` background `rgba(255,255,255,.12)` (no transition) | `page.ts` `.dir` |

Home has no focus ring: Couch's focus is the lift-and-sheen above (and solid white for pills and the gear). The site's pairing sequence and focus passes only toggle the classes Couch itself toggles (`.focused`, `.is-active`); the time between steps (2.2s, 1.9s, a 0.7s held press, 1.4s per tile on the Apps pass) is the site's own pacing. The QR card fades out with Couch's 0.7s hero fade (Couch removes it without a fade).

## The site's own motion (ticket 138)

Everything uses Couch's `--ease` and its durations (0.38s for moves and lifts, .12s and scale(.95) for presses, 0.7s for fades). Movement (lifts, presses, parallax, reveals, the sheen, the nav light, rolling digits, the cursor and card lights) is done with `transform` and `opacity` only, and no shadow ever animates: buttons and cards keep one static shadow and lift with a transform. The only other properties that change over time are paint-only: short colour and background fades on hover (≤ .25s). The hero light is blended once, not animated. (Couch's copied CSS keeps its own tile motion, `transform` and `box-shadow` on focus; see "Motion" above.) `prefers-reduced-motion: reduce` turns all of it off at any time (the hero intro never starts, or ends at once if the setting changes mid-way) (no transitions, no animations, no parallax, no pointer light, no hover lift or press scale on buttons, cards and step numbers; a digit already rolling is cancelled and shows its new value); the content and every end state are complete without it.

| Where | What | How |
| --- | --- | --- |
| Hero | The Screen in the Couch mark switches on (0.7s), the room's light comes up (1.6s), then a slow colour flicker plays on the Screen and in the room (12s loop, paused when the hero is off screen or the tab is hidden) | `.lamp-on`, `.lamp-film`, `.room-glow`; `main.ts` toggles `.playing` / `.paused` |
| Hero, first visit in a session (tickets 139 and 142) | COUCH dissolves into dust and morphs into the logo, then the copy arrives (about 2s, skippable; see "The hero intro"). It replaces the Screen's switch-on above; the room light and film follow the intro | `html.intro`, `.wm-intro`, `.wm-dust`, `src/intro.ts` |
| Hero | A soft light follows the pointer, eased each frame; on scroll the room's light moves slower than the page (parallax). The mark scrolls with the headline it lights, so the two never part or overlap | `[data-cursor-glow]`, `scrollScene()` |
| Badge | The dot sends out three rings, then rests; the arrow nudges on hover | `.pill .dot::after` |
| Buttons and links | Hover lift with a warm sheen across primary buttons; press is Couch's Remote press (.12s, scale .95). Shadows stay static | `.btn`, `.btn-primary::after` |
| Nav | A small light slides under the link you point at and rests under the section you are reading | `.nav-ind`, IntersectionObserver |
| First look (under the hero) | Couch's Home (the real screenshot, ticket 142): it tilts up and settles as it scrolls in. Then, once, the launch video's sequence (ticket 145, see "The launch video"): the highlight moves to YouTube, it opens and fills the Screen, and the TV ends on the video or its poster. (Over the ticket 138 mock the clock ticked once, 8:42 → 8:43; the code still does that if a mock stands in again, but never on the launch video's live Home) | `[data-stage-scroll]`, `[data-launch]`, `src/launch.ts` |
| Remote section | The finite pairing sequence (QR, pair, D-pad press, the highlight moves); step numbers pop when current | `[data-seq]`, `.seq-steps` |
| Hero headline (ticket 143) | After the intro, "Settle in." turns once: Sit back. → Press play. → Lights down. → Settle in., about 2.6s each, a soft blur and fade in the headline's gradient. The phrases are `data-rotate` on the h1; the h1's only text stays "Settle in." (the others are `aria-hidden` spans drawn with `content: attr(data-text)`, laid over it absolutely, so nothing moves and they are not page text). It waits on hover, focus in the hero, off screen and a hidden tab; reduced motion and no script keep "Settle in." | `src/headline.ts`, `.h1-alt` |
| Remote stage (ticket 143) | From 900 px wide and 740 px tall, with motion and script (`pinQuery`, the same media query in `style.css` and `main.ts`), `.how-pin` (the head and the stage) is sticky at `--pin-top` (the nav's `--nav-h` + 12 px) inside `.how-track` (340vh), so the headline is never under the nav; the devices are sized to the height left (`.how-stage` is a size container). The track's scroll progress picks the step (`STEP_AT` 0 / .30 / .55 / .84: QR, pair, press, highlight; the end holds briefly), forward and back, fills the rail between the step numbers and brings the phone forward a little; a step's button scrolls to the middle of its stretch. The track's geometry is cached and measured again only on layout changes (ResizeObserver on the body, track and pin); scroll frames do nothing away from the track or when the progress has not changed. Native scroll only, no wheel or touch listener, no Replay. Narrower or shorter windows and reduced motion: unpinned, the sequence plays once the devices (60%) and the first step are in view below the nav, with Replay (reduced motion: the end state). The Screen is about two thirds of the content width with the phone (`--ph`) in front of its lower-right corner, on phones too | `[data-how-track]`, `stageScroll()`, `.seq-devices` |
| Cards | A light under the pointer (a transformed layer) and a lift on the setup cards | `.spot::before`, `.step:hover` |
| FAQ | Answers settle in on open and fade out before the row closes | `details p`, `details.closing` |

## The launch video (ticket 145)

The first look's TV ends on Couch's launch video, from YouTube (the channel is `YOUTUBE_CHANNEL`). Built at build time by `src/launch-markup.ts` (with the live Home row from `launchHome()` in `src/mocks.ts`), played by `src/launch.ts`, styled in `src/style.css` ("The launch video").

**The sequence** plays once, when the TV is at least 60% in view (or fills 60% of a window it doesn't fit in) and the hero intro is done. It runs on the document's animation clock (`LAUNCH_TIMES`, ms from the start):

| Time | What happens |
| --- | --- |
| 0 | Couch's live Home row takes over from the screenshot's, drawn in the same place (a .25s fade; the Continue tile's picture is the shoot's own, `src/shots/launch-continue.webp`). The sequence waits for that picture first, at most 1.2s. |
| 800 | Home holds for a moment, then Left: the highlight leaves Big Buck Bunny for Library. The hero gives way one type at a time: the screenshot's hero copy (title, blurb, meta, Resume and From start) goes first under its own soft-edged mask (.3s), the picture dissolves to the wallpaper over Couch's .7s, and the clock and greeting come in only once the copy has gone (.6s from 1100). The screenshot's captions fade out under it as the live ones come in. |
| 1320 / 1840 | Left, Left: Netflix, then YouTube (520 ms apart, Couch's .38s lift each). |
| 2540–2680 | YouTube is pressed: the Remote's key press (.12s, scale .95) on the lifted tile. Couch has no press on Home tiles. |
| 2720–3620 | YouTube opens: its tile's face grows from the tile's box to the Screen (a `clip-path` inset, 0.9s), the mark riding from the tile's centre to the Screen's. |
| 3520–4220 | The end comes up over it (0.7s fade, the text rising 1s): the poster, or the thumbnail and play button. |

All on Couch's ease, `cubic-bezier(0.16, 1, 0.3, 1)`. The overlay's pictures load only after the page's own (idle after the load event and the intro, or when the TV starts to come into view), so they never compete with the hero. No layout shift: everything is inside the TV's box, and the links under it are in the HTML from the start. Reduced motion: the end state at once, with no transitions, before the TV is even seen; a switch to reduced motion mid-sequence ends it at once. Without script: the Home screenshot, and the links.

**Two modes**, from `LAUNCH_VIDEO` in `src/config.ts`:
- **Placeholder** (`id: ""`, today): the TV ends on a Couch-made poster (the icon's light in a dark, warm room, with "Launch video" and "Coming soon to YouTube") with no play button, and under the TV one link, "Subscribe on YouTube". Nothing on the page points at YouTube's servers, and the build fetches nothing.
- **Video** (`id` set): the TV ends on the video's thumbnail with its title and a play button. The thumbnail is a local file, so the page makes no request to YouTube before the click. Pressing play (click, Enter or Space) creates the player: an iframe of `https://www.youtube-nocookie.com/embed/<id>?autoplay=1&rel=0&playsinline=1` that fills the Screen, titled "<title> (YouTube video)", with `allow` for autoplay, encrypted media, picture-in-picture and the rest, `allowfullscreen`, and the focus. Under the TV: "Watch on YouTube" (the video's page) and "Subscribe" (the channel), both `rel="noopener"`, and the line "The launch video plays from YouTube and loads only when you press play." The privacy fact "No Couch analytics" becomes "Couch adds no analytics or cookies. YouTube loads only when you press play and may use cookies or browser storage under Google's privacy policy." and the footer's line "No cookies or analytics from Couch." (in placeholder mode both keep their old wording).

**To publish the real video:**
1. In `src/config.ts`, set `LAUNCH_VIDEO = { id: "<the 11 characters after watch?v=>", title: "<the video's title, as on YouTube>" }`.
2. Run `pnpm launch:thumb` (or just `pnpm build`, which runs it first). `scripts/launch-thumb.mjs` fetches `https://i.ytimg.com/vi/<id>/maxresdefault.jpg` (falling back to `sddefault`, then `hqdefault`, with their letterbox cropped to 16:9) and writes `src/shots/launch/<id>.webp` (1280 wide) and `<id>-640.webp` with `cwebp`. Once saved, it is kept (builds work offline); `--refresh` fetches it again if YouTube's thumbnail changes. Commit the two files. The build fails with a hint if the thumbnail is missing.
3. `pnpm build`, `pnpm test`, and look at the first look (the tests build their own placeholder and fake-id copies, so they never need YouTube).

**Tests** (`scripts/launch.test.mjs`, in `pnpm test`): two builds, the placeholder and a fake id (`COUCH_LAUNCH_ID=TESTvideo01`) with a local fixture thumbnail (`COUCH_LAUNCH_THUMB=scripts/fixtures/launch-thumb.webp`, a frame of *Big Buck Bunny*, © Blender Foundation, CC BY 3.0). YouTube's and Google's hosts are unreachable in the test browser, and every request that leaves the local server is recorded. They check the order (Continue → Library → Netflix → YouTube, pressed, row → open → end), that it plays once, waits for 60% in view and for the intro, with CLS 0; the poster's text and the single Subscribe link; the facade (a local thumbnail, Watch and Subscribe, the privacy lines, no request before play, the iframe and its attributes only after a click, Enter or Space, and then a request to youtube-nocookie only); the end out of reach (hidden and inert) until it shows; reduced motion at load and mid-sequence. `scripts/launch-thumb.test.mjs` (also in `pnpm test`) unit-tests the thumbnail script with a mocked fetch and converter: no fetch in placeholder mode, with a local picture or when both files are saved; maxres → sd → hq (YouTube's 120 × 90 stand-in skipped, 4:3 cropped to 16:9); both files written; `--refresh` fetches again. `node scripts/launch-frames.mjs <dir> [url]` writes frames and a video of the sequence at 1440 × 900 and 390 × 844 from a preview, with YouTube's hosts refused.

## Licence

The site is licensed **GPL-3.0-or-later**, the same as Couch (`LICENSE`, `package.json`). It copies Couch's own UI code (the files above; same author) and GPL-3.0-or-later code should not sit inside a more permissive site. Other things in the repo keep their own terms: Geist and Geist Mono are SIL OFL 1.1 (full text with copyright: `public/licenses/geist-OFL-1.1.txt`); the icons in `data.json` and `remote.html` are Phosphor Icons (MIT, Copyright (c) 2023 Phosphor Icons, via `src/shared/icons.ts` in Couch; full text: `public/licenses/phosphor-icons-MIT.txt`); the YouTube and Netflix marks are the ones Couch ships on its App tiles, trademarks of their owners, shown only as App tiles. The screenshots show Blender's open films (*Big Buck Bunny*, *Sintel*, *Tears of Steel*: © Blender Foundation, CC BY 3.0) with posters and backdrops from TMDB; the footer and the licences page credit them and carry TMDB's notice. The licence texts live in `public/licenses/`, ship with every build at `/licenses/` and are linked from the footer ("Third-party licences").

## Checks

`node scripts/shoot.mjs <dir>` writes, at 1440, 1024, 768 and 390 px from `pnpm preview`, a full-page shot, the hero viewport and the Remote sequence's end state (needs Google Chrome). Lighthouse on the local build after the ticket 138 review: mobile performance 98 (LCP 2.3s simulated, the hero light image; CLS 0.009) and desktop 100; accessibility, best practices and SEO 100 on both. After ticket 139 (with the intro playing, as on a first visit): desktop 100 in all four, mobile performance 99 (LCP 2.2s simulated, CLS 0, TBT 0) and 100 for the rest. Lighthouse simulates LCP from network and CPU work; the LCP it observed without throttling is about 2.1–2.4s, which is the intro itself: the hero picture is the LCP element and it fades in at 1.5s. Later visits in the session, and visitors with reduced motion, get the hero at once. After the ticket 139 review (both intro modes, see "The hero intro"): sequence mobile 99 and 98 (LCP 2.2s simulated, 2.05s observed unthrottled), desktop 100; logo-only mobile 99 twice (LCP 2.2s simulated, 2.05s observed), desktop 100 (LCP 0.29s simulated, 0.12s observed); 100 for the other three everywhere. After ticket 142 (the wordmark intro with dust, grain, the screenshots; Lighthouse 13, local `vite preview`, intro playing): sequence mobile 98, 97, 98, 98 (LCP 2.4s simulated, 2.07s observed; TBT 0–70ms; CLS 0), desktop 100 twice (LCP 0.5s simulated, 2.4s observed); logo-only mobile 98 (CLS 0.006), desktop 100. Accessibility, best practices and SEO 100 in every run. With "Settle in." smaller than the old "Couch.", the glowing picture is the LCP element on desktop too, so logo-only no longer lowers desktop's observed LCP (about 2.1s in both modes). After the ticket 142 review fixes (16:10 Home and Library frames, the clean player frame, the Credits block with TMDB's logo): sequence mobile 98 twice (LCP 2.4s simulated, CLS 0, TBT 0–20ms), desktop 100 twice (LCP 0.5s, CLS 0); 100 for the other three everywhere. After ticket 143 (the 3.2s cinematic intro, the setup pictures, the two-column footer; Lighthouse 13, local `vite preview`, intro playing). Lighthouse's default run ends before the glowing picture fades in (2.8s), so it measures the nav button as LCP (mobile 100, LCP 0.9–1.1s simulated; desktop 100); the honest numbers come from runs that wait 4.5s after load so the trace covers the whole intro: sequence mobile 98 and 97 (LCP 2.4s simulated, 3.63–3.66s observed, the glowing picture as its fade ends; TBT 0–80ms; CLS 0), desktop 100 twice (LCP 0.5s simulated, 3.67s observed); logo-only mobile 97 (CLS 0.006), desktop 100 (CLS 0.003); 100 for the other three everywhere. Mobile performance ≥ 90 was the accepted floor for the cinematic intro. After ticket 143's second part (the headline's turn, the pinned Remote stage, icon-only social links; same 4.5s wait): mobile 98 twice (LCP 2.4s simulated, about 3.63s observed, TBT 10ms, CLS 0), desktop 100 twice (LCP 0.5s simulated, 3.63–3.68s observed, CLS 0); accessibility, best practices and SEO 100. Lighthouse 13.6 also shows an experimental "Agentic browsing" category (50: no llms.txt and no ARD manifest), not part of these targets. After the ticket 143 review fixes (the letter, the stage pinned with its head, Geist preloaded with a metric-matched Arial fallback; Lighthouse 13.6, local `vite preview`, 4.5s wait, the intro played: mobile runs use a 412 × 823 window at 1.75× rather than Lighthouse's screen emulation, whose resize at load skips the intro): mobile 97 in four runs and 94 in one (LCP 2.6s simulated, 3.61–3.77s observed, TBT 10ms, 180ms in the 94 run, CLS 0; the same harness gives the part-2 build 98 with LCP 2.5s, so the preload costs about 0.1s of simulated LCP), desktop 100 three times (LCP 0.5s simulated, 3.67–3.70s observed, CLS 0); accessibility, best practices and SEO 100. Whole-navigation CLS under reduced motion is now 0 (it was about 0.003 from the font swap). After ticket 145 (the launch video; same harness, 4.5s wait, the sequence not yet in view at load): placeholder mobile 95, 97, 97, 98, 97, 97 (LCP 2.5–2.6s simulated, TBT 10–160ms, CLS 0), desktop 100 four times (LCP 0.5–0.6s, CLS 0); a fake-id video build mobile 97, 97, 98, desktop 100; main on the same machine at the same time: mobile 96, 97, 98, 98, 97 (LCP 2.4–2.5s), desktop 100. Accessibility, best practices and SEO 100 in every run, and every request went to the local server. After the ticket 145 review fixes (same harness, 4.5s wait): placeholder mobile 94, 96, 96, 96, 96 (LCP 2.6s simulated, TBT 100–210ms, CLS 0), desktop 100 twice (LCP 0.5s, CLS 0); fake-id video build mobile 96, 97, 96, desktop 100; ticket/145 (aa3ad08) on the same machine at the same time: mobile 96 three times (LCP 2.6s). Accessibility, best practices and SEO 100 in every run, and every request went to the local server.

## Before publishing

The site goes live only when all of these are true. The page links to the GitHub repo and its Releases, and sells on Gumroad, so none of them can be missing.

- [ ] The Couch GitHub repo is public.
- [ ] A first release exists on GitHub Releases.
- [ ] The Gumroad product exists, and `GUMROAD_URL` in `src/config.ts` points at it (it is a placeholder today).
- [ ] The first-open steps on the page (open once, then System Settings → Privacy & Security → Open Anyway) are verified on the release build.

- [ ] The page's privacy wording still matches the hosting: "This site itself keeps nothing about your visit. Cloudflare, which hosts it, processes request data under its own policies." The site has no Worker script, no logging and no storage of its own, and no Logpush job or Tail Worker is added. Cloudflare keeps some request data on its own regardless, and the site cannot switch that off: for example, Security Analytics shows sampled request logs (IP, user agent, path) for every zone, and Security Events keeps the requests its rules act on ([Security Analytics](https://developers.cloudflare.com/waf/analytics/security-analytics/), [Security Events](https://developers.cloudflare.com/waf/analytics/security-events/), [Cloudflare privacy policy](https://www.cloudflare.com/privacypolicy/)). Do not reword the page into a "no IP stored" promise.
- [ ] The custom domain can be attached: the `abdullahnettoor.com` zone is added and **active** in the same Cloudflare account that deploys the site (`wrangler whoami` shows that account), and any existing DNS record for `couch.abdullahnettoor.com` (a CNAME, A/AAAA, or an old Pages/Workers custom domain) is removed first: Cloudflare refuses a Custom Domain on a hostname that already has a CNAME record, and any other record left for the name would conflict with the one the Custom Domain creates ([Cloudflare: Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)).
- [ ] After the first deploy: the live page loads over HTTPS on `couch.abdullahnettoor.com`, an unknown path shows the 404 page, "or download free from GitHub" downloads `Couch-arm64.dmg`, and the Couch for Windows button opens issue #34.

Also re-read the "What Couch connects to" list on the page against the release build (the TMDB key, Widevine, and any updater added since).

## Deploy (not done yet)

`wrangler.jsonc` serves `dist/` with Workers static assets on the custom domain `couch.abdullahnettoor.com`: `assets.directory` and `not_found_handling: "404-page"` (`public/404.html`), and nothing else. There is no `main`, so no Worker script runs: every request is a file from `dist/` or the 404 page ([Cloudflare: Static Assets](https://developers.cloudflare.com/workers/static-assets/)). `pnpm deploy` builds and runs `wrangler deploy`, which creates the subdomain and its certificate. Do not run it until every item in "Before publishing" is ticked and the screenshots are in.

Two ways to deploy, both from `site/`:

- **From this Mac:** `cd site && pnpm deploy` (needs `wrangler login` with the account that owns the `abdullahnettoor.com` zone).
- **From GitHub (Workers Builds),** if the repo is connected in the Cloudflare dashboard (Workers & Pages → the `couch-site` Worker → Settings → Build):

  | Setting | Value |
  | --- | --- |
  | Root directory | `site` |
  | Build command | `pnpm install --frozen-lockfile && pnpm build` |
  | Deploy command | `npx wrangler deploy` |
  | Output | `dist/` (set by `assets.directory` in `wrangler.jsonc`; not a separate setting) |
  | Production branch | `main` |
  | Non-production branches | Builds on, so other branches (`dev` among them) get preview URLs |
  | Build watch paths | `site/**` (so app-only commits don't rebuild the site) |

  `pnpm build` also runs `tsc` and `scripts/launch-thumb.mjs` (which fetches nothing while `LAUNCH_VIDEO.id` is empty, and uses the committed thumbnail once it isn't).

Nothing has been deployed and no Cloudflare setting has been changed yet.

## Publishing

`main` is the live site: Workers Builds deploys it on every push that touches `site/**`. `dev` acts as staging: its builds get a preview URL, not the live domain.

- **Site-only changes** (copy, design, fixes that don't wait on the app): branch from `main`, merge into `main`, then merge `main` into `dev` so `dev` keeps them.
- **Site changes tied to an unreleased app feature** go through `dev` like app work, and reach the live site with the stable release (the `dev` → `main` merge).
- **The download link** ("or download free from GitHub", `DOWNLOAD_URL`) always points at `https://github.com/abdullahnettoor/couch/releases/latest/download/Couch-arm64.dmg`. The release assets keep that file name with no version in it, so the link always gets the newest stable release and never needs changing for a release.
