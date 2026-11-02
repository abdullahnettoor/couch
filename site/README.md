# couch-site

The landing page for [Couch](https://github.com/abdullahnettoor/couch), planned for `couch.abdullahnettoor.com`. A static site: plain HTML, CSS and TypeScript built with Vite, plus one small Cloudflare Worker for the anonymous Couch for Windows count (`worker/`). No framework, no analytics, no cookies, no third-party requests (Geist and Geist Mono are self-hosted, SIL OFL).

## Run it

```sh
pnpm install
pnpm dev          # http://localhost:5173
pnpm build        # type-check, then build to dist/
pnpm preview      # serve dist/ at http://localhost:4173 (static only: the Windows button shows its error line here)
pnpm test         # CSS-scope fixtures and the Worker's unit tests (node --test)
pnpm dev:worker   # build, apply the D1 migration to a local database, then wrangler dev --local at http://127.0.0.1:8790
```

`pnpm dev:worker` runs everything locally (Miniflare): the site, `/api/*` and a local D1 file in `.wrangler/`. It never touches the Cloudflare account.

## Settings in one place

`src/config.ts` holds `GUMROAD_URL` (a **placeholder** until the Gumroad product exists), `GITHUB_URL`, `RELEASES_URL` and `SITE_URL`. They are filled into `index.html` at build time (`{{GUMROAD_URL}}` and so on), so every link works without JavaScript.

## Copy

`COPY.md` is the copy deck (tickets 137 and 138): every page string, headline alternatives, picks and factual evidence. Keep it in step with text changes, including screenshot alternatives and social-card text.

## The Couch for Windows count

A demand button, not a waitlist. `button[data-demand="windows"]` in the download section (`#windows`; the hero links to it) sends one `POST /api/demand/windows` with no body and `credentials: "omit"`. On success the card shows "Counted. Thank you." and `localStorage` (`couch:demand:windows`) remembers the tap, so the same browser counts once; on failure an error line shows and the button stays. No cookies.

The Worker (`worker/index.ts` is the entry and exports only its default handler, because workerd treats named exports as entrypoints; the logic is `worker/demand.ts`):

| Route | Does |
| --- | --- |
| `POST /api/demand/windows` | Adds one to the `windows` row in D1 (`migrations/0001_demand.sql`: `platform`, `count`, nothing else). 204. Refuses other methods (405), unknown platforms (404), requests whose `Origin` is not the site (or the request's own origin, for local dev and previews) or whose `Sec-Fetch-Site` is not `same-origin` (403). The Origin and Fetch-Metadata checks are sanity checks against other sites triggering the count, not anti-abuse: anyone can send those headers with curl. A burst cap (Workers rate limit `DEMAND_LIMIT`, 60 a minute, keyed by the platform name, never by the visitor) answers 429; it is approximate and counted separately in each Cloudflare location, so it smooths bursts rather than enforcing one worldwide limit ([Cloudflare: Rate Limiting, Locality and Accuracy](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/#locality)). If the rate limit binding fails, or the database does, the answer is 503 (`no-store`) and nothing is counted, never a false success. The body is never read. |
| `GET /api/demand` | The counts as JSON, e.g. `{"windows": 12}`, `no-store`. For the site owner; the numbers are not secret. |
| any other `/api/*` | 404 |
| everything else | Static assets, as before (`run_worker_first: ["/api/*"]`, so the Worker never sees page requests). |

The Worker stores nothing about the visitor: no IP, no user agent, no body, no cookie; the counter keeps only the platform and the total. Workers Logs and invocation logs are off in `wrangler.jsonc`. Cloudflare, which hosts the site, still processes request data under its own policies (see "Before publishing"). `pnpm test` covers all of this with a fake D1 and rate limit (`worker/demand.test.ts`).

## Screenshot slots

Every product picture is a **slot**, declared once in `src/slots.ts` (a typed manifest: slot name → interim file, alt text, width and height, `loading` priority). `vite.config.ts` reads it at build time and writes the `<img>` into `index.html` (`{{slot:name}}`), or into the place a mock stands in (`<!--mock:name-->…<!--/mock-->`). The build fails if `index.html` uses a slot the manifest lacks, or the manifest has a slot `index.html` never uses.

To replace a picture after the real shoot, drop a file named `src/shots/slot-<name>.png` (or `.jpg`, `.webp`) and rebuild. It wins over the manifest's `file` and over any CSS mock. The slot keeps its alt text, `width`/`height` and `loading` (`eager` for the first viewport, `lazy` for the rest) from the manifest, so edit those in `src/slots.ts` if the new picture differs (and write real alt text for what it shows). Crop shots to the frame: 16:9 for the Screen (for example 1920×1080), about 9:19 for the Remote (1080×2280), each under about 150 KB.

| Slot name | Where | Today | Wanted |
| --- | --- | --- | --- |
| `hero-screen` | First look, under the hero | Couch UI mock: Home (clock, Apps) | Home, with the Apps row |
| `remote-screen` | "Your phone is the remote" TV | Couch UI mock: Home with the pairing QR card | Home |
| `remote-phone` | Same section, phone | Couch UI mock: the Remote, and a phone camera view | The Remote |
| `apps-screen` | "The Apps you already use" TV | Couch UI mock: Home with the Continue row and App tiles | Apps row; YouTube shots should be the guest view. Never a signed-in Netflix page |
| `library-screen` | "Your Library" TV | `library.jpg` | A full Library shelf |
| `privacy-screen` | Privacy panel TV | `settings.jpg` | Settings |
| `setup-remotes` | Setup step 2 | `remotes.jpg` | Settings → Add a phone |
| `setup-player` | Setup step 3 | `player.jpg` | A Library video playing |

The four JPEGs are copies of `docs/screenshots/` in the Couch repo. The two Remote-section slots (`remote-screen`, `remote-phone`) carry the finite pairing sequence (QR, pair, D-pad press, highlight moves); replacing either with a still turns that part into a plain picture, so replace both or neither. The sequence's end state is the connected state, which is also what visitors with reduced motion or no JavaScript see.

The hero's light is `src/shots/couch-glow.webp` (and `-480`): Couch's own icon art, `build/icon.png` in the Couch repo, cropped to the sofa and its tile darkened so it can be added to the page as light (`mix-blend-mode: screen`). Regenerate:

```sh
ffmpeg -i ../couch/build/icon.png -vf "crop=832:688:96:115,curves=all='0/0 0.25/0.05 0.6/0.6 1/1'" /tmp/glow.png
cwebp -q 80 /tmp/glow.png -o src/shots/couch-glow.webp
cwebp -q 80 -resize 480 397 /tmp/glow.png -o src/shots/couch-glow-480.webp
```

Other assets: `public/icon.png`, `favicon.png` and `apple-touch-icon.png` come from `build/icon.png` in the Couch repo. `public/og.png` (the social card) is generated by `node scripts/og.mjs` from `scripts/og.html`; edit that file and rerun to change it.

## The mocks use Couch's real UI

Every drawn (non-screenshot) mock is Couch's own UI, not a re-drawing. `scripts/sync-couch-ui.mjs` (`pnpm sync:couch`) reads the Couch repo (`~/Projects/couch`, or `COUCH_REPO=`; read only) and writes `src/couch-ui/`, which is committed so the site builds without the Couch repo:

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

Everything uses Couch's `--ease` and its durations (0.38s for moves and lifts, .12s and scale(.95) for presses, 0.7s for fades). Movement (lifts, presses, parallax, reveals, the sheen, the nav light, rolling digits, the cursor and card lights) is done with `transform` and `opacity` only, and no shadow ever animates: buttons and cards keep one static shadow and lift with a transform. The only other properties that change over time are paint-only: short colour and background fades on hover (≤ .25s) and the stroke drawn in the Windows check. The hero light is blended once, not animated. (Couch's copied CSS keeps its own tile motion, `transform` and `box-shadow` on focus; see "Motion" above.) `prefers-reduced-motion: reduce` turns all of it off at any time (no transitions, no animations, no parallax, no pointer light, no hover lift or press scale on buttons, cards and step numbers; a digit already rolling is cancelled and shows its new value); the content and every end state are complete without it.

| Where | What | How |
| --- | --- | --- |
| Hero | The Screen in the Couch mark switches on (0.7s), the room's light comes up (1.6s), then a slow colour flicker plays on the Screen and in the room (12s loop, paused when the hero is off screen or the tab is hidden) | `.lamp-on`, `.lamp-film`, `.room-glow`; `main.ts` toggles `.playing` / `.paused` |
| Hero | A soft light follows the pointer, eased each frame; on scroll the room's light moves slower than the page (parallax). The mark scrolls with the headline it lights, so the two never part or overlap | `[data-cursor-glow]`, `scrollScene()` |
| Badge | The dot sends out three rings, then rests; the arrow nudges on hover | `.pill .dot::after` |
| Buttons and links | Hover lift with a warm sheen across primary buttons; press is Couch's Remote press (.12s, scale .95). Shadows stay static | `.btn`, `.btn-primary::after` |
| Nav | A small light slides under the link you point at and rests under the section you are reading | `.nav-ind`, IntersectionObserver |
| First look (under the hero) | Couch's Home alone, no phone: it tilts up and settles as it scrolls in, then the clock ticks once, 8:42 → 8:43 (digit roll). The Remote and the travelling highlight are left to the Remote section | `[data-stage-scroll]` |
| Remote section | The finite pairing sequence (QR, pair, D-pad press, the highlight moves); step numbers pop when current | `[data-seq]`, `.seq-steps` |
| Cards | A light under the pointer (a transformed layer) and a lift on the setup cards | `.spot::before`, `.step:hover` |
| FAQ | Answers settle in on open and fade out before the row closes | `details p`, `details.closing` |
| Couch for Windows | Confirmation scales in with a drawn check and a one-off warm glow | `.win-done`, `.win.counted::after` |

## Licence

The site is licensed **GPL-3.0-or-later**, the same as Couch (`LICENSE`, `package.json`). It copies Couch's own UI code (the files above; same author) and GPL-3.0-or-later code should not sit inside a more permissive site. Other things in the repo keep their own terms: Geist and Geist Mono are SIL OFL 1.1 (full text with copyright: `public/licenses/geist-OFL-1.1.txt`); the icons in `data.json` and `remote.html` are Phosphor Icons (MIT, Copyright (c) 2023 Phosphor Icons, via `src/shared/icons.ts` in Couch; full text: `public/licenses/phosphor-icons-MIT.txt`); the YouTube and Netflix marks are the ones Couch ships on its App tiles, trademarks of their owners, shown only as App tiles. The licence texts live in `public/licenses/`, ship with every build at `/licenses/` and are linked from the footer ("Third-party licences").

## Checks

`node scripts/shoot.mjs <dir>` writes, at 1440, 1024, 768 and 390 px from `pnpm preview`, a full-page shot, the hero viewport and the Remote sequence's end state (needs Google Chrome). Lighthouse on the local build after the ticket 138 review: mobile performance 98 (LCP 2.3s simulated, the hero light image; CLS 0.009) and desktop 100; accessibility, best practices and SEO 100 on both.

## Before publishing

The site goes live only when all of these are true. The page links to the GitHub repo and its Releases, and sells on Gumroad, so none of them can be missing.

- [ ] The Couch GitHub repo is public.
- [ ] A first release exists on GitHub Releases.
- [ ] The Gumroad product exists, and `GUMROAD_URL` in `src/config.ts` points at it (it is a placeholder today).
- [ ] The first-open steps on the page (open once, then System Settings → Privacy & Security → Open Anyway) are verified on the release build.

- [ ] The Windows count's database exists and is bound (once, from this folder, logged in to the right account):
  ```sh
  pnpm wrangler d1 create couch-site-demand        # paste the printed database_id into wrangler.jsonc (d1_databases[0].database_id)
  pnpm wrangler d1 migrations apply couch-site-demand --remote
  ```
  The rate limit (`ratelimits`, `namespace_id` 1138) needs no setup; pick another integer if 1138 is taken on the account. `SITE_ORIGIN` in `wrangler.jsonc` must be the public origin.
- [ ] The page's privacy wording still matches the hosting: "Our counter stores only the platform and the total. Cloudflare, which hosts this site, processes request data under its own policies." The site turns off what it controls: Workers Logs and invocation logs stay off (`observability` in `wrangler.jsonc`), and no Logpush job or Tail Worker is added for this Worker. Cloudflare keeps some request data on its own regardless, and the site cannot switch that off: for example, Security Analytics shows sampled request logs (IP, user agent, path) for every zone, kept up to 31 days on the Free plan, and Security Events keeps the requests its rules act on ([Security Analytics](https://developers.cloudflare.com/waf/analytics/security-analytics/), [Security Events](https://developers.cloudflare.com/waf/analytics/security-events/), [Cloudflare privacy policy](https://www.cloudflare.com/privacypolicy/)). Check those pages for the current periods before publishing, and do not reword the page into a "no IP stored" promise.
- [ ] The custom domain can be attached: the `abdullahnettoor.com` zone is added and **active** in the same Cloudflare account that deploys the Worker (`wrangler whoami` shows that account), and any existing DNS record for `couch.abdullahnettoor.com` (a CNAME, A/AAAA, or an old Pages/Workers custom domain) is removed first: Cloudflare refuses a Custom Domain on a hostname that already has a CNAME record, and any other record left for the name would conflict with the one the Custom Domain creates ([Cloudflare: Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)).
- [ ] After the first deploy: `curl -X POST https://couch.abdullahnettoor.com/api/demand/windows` answers 403 (no Origin), the button on the live page shows "Counted. Thank you.", and `curl https://couch.abdullahnettoor.com/api/demand` shows the count.

Also re-read the "What Couch connects to" list on the page against the release build (the TMDB key, Widevine, and any updater added since).

## Deploy (not done yet)

`wrangler.jsonc` serves `dist/` with Workers static assets on the custom domain `couch.abdullahnettoor.com`. `pnpm deploy` builds and runs `wrangler deploy`, which creates the subdomain and its certificate. Do not run it until every item in "Before publishing" is ticked and the screenshots are in.
