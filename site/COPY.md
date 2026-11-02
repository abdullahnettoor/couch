# Couch — landing page copy

Ticket 137 · 2 November 2026 · picked copy applied on `ticket/137`.

## Direction and implementation boundaries

For someone on the sofa, not someone shopping for a computer. Lead with the evening and the phone already in their pocket; explain the Screen, Apps and Library as they appear. Warm, calm and confident. Short sentences, British spelling, no hype or exclamation marks. Product terms follow Couch's `GLOSSARY.md`: Screen, Remote, Home, Apps, Library, Continue watching, Now Playing, Settings and Quick settings.

This is a copy pass, not a redesign. Keep the existing section order, IDs, classes, screenshot slots, mocks and motion. The Windows card uses existing classes only. No changes to the copied `src/couch-ui/` files. No future look-picker claim: it is not available today.

**Publication gates still apply.** The app README says Couch is not distributed yet. The page's Gumroad, Releases and source links are the planned distribution routes, not evidence that a public release exists. The Gumroad URL remains a placeholder. Do not publish until the README's existing release, source, Gumroad and first-open checks are complete.

**Windows is copy and markup only.** A plain `button[data-demand="windows"]` is in the download section. It has no click handler, endpoint, storage or counting. The visible stub notice tells the truth. The confirmation is present but hidden; show it only after a real count succeeds in a later ticket. Do not fake a successful count. The anonymous-count wording is a requirement for that future implementation, including its access logs, not a claim that a counting backend has been audited here.

## 1. Navigation and shared controls

| Location | Picked string |
| --- | --- |
| Skip link | Skip to content |
| Brand | Couch |
| Brand accessible name | Couch, back to top |
| Main navigation accessible name | Main |
| Navigation, desktop and mobile | How it works / Apps / Library / Privacy / FAQ |
| Source link, desktop and mobile | Source |
| Navigation CTA | Get Couch |
| Compact menu accessible name | Menu |
| Scroll progress | Decorative; no spoken label |

## 2. Hero (`#top`)

### Headline options

1. **PICK — Settle in with Couch.** Leads with the feeling, names the brand and leaves platform detail to the meta line.
2. **Your evening, on the big screen.** Puts the living-room moment first, with less emphasis on the brand.
3. **A calmer way to watch.** Says what changes about the evening without promising new content.

### Picked copy

- Badge: **Early release · Free and open source**
- Headline: **Settle in with Couch.**
- Body: A calm home screen for your TV, with YouTube, Netflix and your own videos. Your phone is the Remote.
- Primary button: **Get Couch, pay what you want**
- Secondary link: **or download free from GitHub**
- Meta strip: **Mac today · macOS 14+** / **Apple silicon** / **GPL-3.0-or-later** / **No Couch account**
- Meta strip accessible name: **Requirements**
- Decorative icon alt: empty.
- Product picture alts: see §12.

The Mac requirement is visible here, but is not the headline or the proposition.

## 3. The Remote (`#how`)

### Headline options

1. **PICK — The Remote is already in your pocket.** Turns the everyday phone into the benefit before explaining pairing.
2. **Your phone. Your place on the sofa.** Leads with comfort, but needs the body to explain the Remote.
3. **Choose what to watch. Stay where you are.** Leads with the action rather than the hardware.

### Picked copy

- Eyebrow: **The Remote**
- Headline: **The Remote is already in your pocket.**
- Body: Scan the QR code on the Screen to pair your phone. Move the highlight, choose what to watch and turn the volume down without leaving the sofa. Guests can pair a phone too.
- Sequence accessible name: **How pairing works**
- Sequence buttons (numbers remain 1–4):
  1. The Screen shows a QR code
  2. Scan it to pair your phone
  3. Press right on the phone's D-pad
  4. The highlight moves on the Screen
- Sequence replay: **Replay**
- Bullets:
  - The Remote opens in your phone's browser. No phone app to install.
  - Now Playing puts playback controls on your phone.
  - At the Mac, the keyboard and trackpad work too.
- QR-only caption: **Pairing illustration. This QR code will not connect.**
- Camera overlay in the illustration: **Point the camera at the code on the Screen** (unchanged).

The QR caption remains conditional on the sequence showing its QR state. Avoid “every press moves the highlight”: volume and playback presses do not.

## 4. Apps (`#apps`)

### Headline options

1. **PICK — Familiar Apps. Room to relax.** Pairs recognition with the feeling of watching from the sofa.
2. **The Apps you know, together on Home.** Explains the launcher without suggesting Couch supplies content.
3. **YouTube. Netflix. Feet up.** The shortest, most relaxed version; less descriptive of Home.

### Picked copy

- Eyebrow: **Apps**
- Headline: **Familiar Apps. Room to relax.**
- Body: Open YouTube or Netflix from Home, then choose something with the Remote. These are the services' own websites, with your own accounts. Couch does not include subscriptions or unlock extra content.
- Bullets:
  - YouTube has its familiar TV layout. To sign in, enter the code from the Screen at youtube.com/activate on your phone.
  - Netflix opens its own website on the Screen. Sign in there, then use the Remote to move the focus ring and choose what to watch.
  - Continue watching on Home brings unfinished titles back within reach. Netflix manages its own resume position.
- Caption: **App marks belong to their owners. Couch is not affiliated with or endorsed by Netflix or YouTube.**

Do not call this “YouTube TV” (the separate paid service). Do not promise Netflix quality, resolution, access or a Couch-managed Netflix resume position.

## 5. The Library (`#library`)

### Headline options

1. **PICK — Your videos. A shelf of their own.** Makes the folder-to-shelf benefit tangible without promising posters for every video.
2. **A little more home for your videos.** Warm and brand-led, but less specific about browsing.
3. **Back to the video you left halfway.** Leads with resuming rather than the Library's shape.

### Picked copy

- Eyebrow: **The Library**
- Headline: **Your videos. A shelf of their own.**
- Body: Add your video folders to the Library. Browse a shelf of pictures and readable titles, then settle back into a video where you left it.
- Bullets:
  - The built-in player handles your videos, with subtitles and volume on the Remote.
  - Continue watching on Home keeps unfinished videos close by.
  - Optional film and show details come from TMDB. Without online details, Couch uses frames from your videos, or a colour while they load.
- Screenshot and shelf illustration accessible descriptions: see §12.

No “plays every format”, codec guarantee or promise that the household's videos leave the Mac for processing.

## 6. Privacy (`#privacy`)

### Headline options

1. **PICK — No Couch account. No Couch tracking.** Deliberately scopes both promises to Couch, not the services it opens.
2. **One household. No Couch account.** Leads with sharing, rather than a blanket privacy claim.
3. **Your Library stays close to home.** Emphasises local storage; the connection list still explains online details.

### Picked copy

- Eyebrow: **Privacy**
- Headline: **No Couch account. No Couch tracking.**
- Facts:
  - **One household, one Screen** — No Couch sign-up and no Couch profiles. Pair a phone and join in.
  - **Kept on your Mac** — Your Library, Couch's saved viewing positions and your settings stay on the Mac. There is no Couch cloud.
  - **No Couch analytics** — This site uses no cookies or analytics. Services opened in Couch have their own sign-ins, cookies and privacy policies.
  - **Open to a closer look** — Couch is free and open source under GPL-3.0-or-later. Read the code or build it yourself.

### Connection-list headline options

1. **PICK — What Couch connects to** — Plain and specific, making the limits of the privacy promise easy to find.
2. **The connections behind your evening** — Warmer, but less direct for someone checking privacy.
3. **When Couch goes online** — Short, though the list also includes the local phone connection.

- Subheading: **What Couch connects to**
- Connections:
  - **The services you open.** YouTube and Netflix load their own websites. Couch also downloads their pictures for Continue watching and keeps a local copy.
  - **Google's Widevine component.** Couch's Chromium engine downloads this at run time for DRM-protected video. Couch does not bundle it.
  - **TMDB, for optional online details.** Couch searches video titles and fetches posters and stills. Online details are on when a TMDB key is set. A release build can include a key, or you can add your own. Turn Online details off in Settings if you prefer.
  - **Your phone, over home Wi-Fi.** The Remote page is served by your Mac on the local network, not by an internet service.
- Closing line: Couch does not check for updates or send data to a Couch server.
- Windows privacy line: The Windows button is not connected yet. When enabled, it will record only an anonymous count: no email, no cookies and no IP stored.

Do not shorten this to “nothing leaves your Mac”, “fully offline” or “no cookies” for the whole app. Services can track and keep cookies. Library title searches and online artwork make requests. The Windows count is a website feature, not an app connection.

## 7. Setup (`#setup`)

### Section headline options

1. **PICK — Set up in a few minutes.** Retains the reviewed, unhurried expectation without a two-minute guarantee.
2. **Three steps to the sofa.** A friendly summary of this sequence, not a claim about all sign-in and security steps.
3. **Start with a Screen and a phone.** Introduces the two surfaces plainly.

- Eyebrow: **Setup**
- Headline: **Set up in a few minutes.**
- Step numbers: **1**, **2**, **3**.

### Step 1 headline options

1. **PICK — Put Couch on your Mac** — Says where the install happens, without making the hero platform-led.
2. **Install Couch** — Short and conventional.
3. **Start with the Screen** — Uses the glossary but is less explicit about installing.

- Heading: **Put Couch on your Mac**
- Body: Download Couch and move it to Applications. Connect the Mac to your TV or monitor, then open Couch.
- App icon alt: empty.

### Step 2 headline options

1. **PICK — Scan the QR code** — Names the next physical action.
2. **Pair your phone** — Names the outcome rather than the gesture.
3. **Meet your Remote** — Warmer, but less instructional.

- Heading: **Scan the QR code**
- Body: Put your phone on the same Wi-Fi as the Mac. In Couch's Settings, choose Add a phone and scan the code.

### Step 3 headline options

1. **PICK — Open an App** — Uses Couch's own term and matches the Remote's action.
2. **Choose something to watch** — Leads with the visitor's goal.
3. **Make yourself comfortable** — Ends on the feeling, but needs a more practical body.

- Heading: **Open an App**
- Body: Use the Remote to choose YouTube, Netflix or the Library. Press OK. Make yourself comfortable.

Do not name an installer format. Requirements and first-open security steps remain in the download card; service sign-ins remain in Apps and FAQ.

## 8. Download (`#download`)

### Headline options

1. **PICK — Bring Couch home.** A short, brand-led invitation after the visitor understands the product.
2. **Make room for Couch.** Relaxed and brand-led, with a gentler call to action.
3. **Get Couch. Choose your price.** Most direct about the transaction and optional payment.

- Headline: **Bring Couch home.**
- Body: For Mac today. Free and open source. Choose a price on Gumroad, including $0, or download free from GitHub.
- Primary button: **Get Couch, pay what you want**
- Secondary link: **or download free from GitHub**
- Requirements:
  - **Mac** — macOS 14 or later, Apple silicon
  - **Screen** — A TV or monitor connected to the Mac
  - **Remote** — A phone on the same Wi-Fi
- Early-release note: **An early release, not yet notarised by Apple.**
- First-open instructions: Try opening Couch once. If macOS says it cannot check the app, and you trust your download, go to System Settings → Privacy & Security → Open Anyway, then confirm Open. On macOS 15 and later, right-click → Open is not enough.
- Decorative icon alt: empty.

### Windows card headline options

1. **PICK — Couch for Windows** — Names the platform being considered without implying availability.
2. **Would you use Couch on Windows?** — Leads with the demand question.
3. **Windows, perhaps next.** — Signals uncertainty, but is less useful as a card label.

- Card heading: **Couch for Windows**
- Body: **Not yet. Would you use it? Help us decide what to build next.**
- Button: **I'd use Couch for Windows**
- Current stub notice: **Demand counting is not connected yet.**
- Short privacy line: **Anonymous count when enabled. No email, no cookies, no IP stored.**
- Confirmation, hidden and reserved for a real successful count: **Counted. Thank you.**
- Markup contract: `type="button" data-demand="windows"`; described by the stub notice and privacy line. Confirmation: `role="status" data-demand-confirmation hidden`.

**When counting is implemented:** remove the stub notice and the “when enabled” qualification together, update the privacy paragraph and FAQ, and show the confirmation only after success. Recommended enabled body: **Not yet. Tap if you'd use it, so we know what to build next.** Recommended enabled privacy line: **An anonymous count. No email, no cookies, no IP stored.** These enabled-state strings are hand-off copy, not applied as current facts. No email waitlist, promise of a Windows release or false success message.

## 9. FAQ (`#faq`)

### Headline options

1. **PICK — Before you settle in.** Keeps the evening thread and introduces practical reassurance.
2. **A few things worth knowing.** Calm and useful without sounding like a support database.
3. **Questions about Couch.** The most literal, scannable alternative.

- Eyebrow: **FAQ**
- Headline: **Before you settle in.**

**Is Couch free?**

Yes. Choose what to pay on Gumroad, including $0, or download free from GitHub Releases. Couch is open source either way.

**Do I need an account?**

Not for Couch. There are no Couch accounts or profiles. Use your own service accounts: for YouTube, enter the code from the Screen at youtube.com/activate on your phone. For Netflix, sign in on Netflix's own page on the Screen.

**How does Netflix work?**

Couch opens Netflix's own website inside the Screen. Sign in with your Netflix account and use the Remote to browse. Your subscription and Netflix's website determine what you can watch and how it plays on a Mac.

**Why does macOS warn me?**

Couch is an early release and is not yet notarised by Apple. Try opening Couch once. If macOS says it cannot check the app, and you trust your download, go to System Settings → Privacy & Security → Open Anyway, then confirm Open. On macOS 15 and later, right-click → Open is not enough. macOS then remembers the exception.

**Can I read the source?**

Yes. Couch is licensed under GPL-3.0-or-later. Read the code on GitHub, change it or build it yourself.

- Inline link text: **GitHub**.

**Will Couch come to Windows?**

Windows is being considered, not promised. The Couch for Windows button above is a place to register interest once counting is connected. Linux is not supported. Today, Couch needs Apple silicon and macOS 14 or later. The Remote runs in a phone browser; Android with Chrome is what we test.

## 10. Footer

- Brand: **Couch**
- Navigation accessible name: **Footer**
- Links: **GitHub** / **Releases** / **GPL-3.0-or-later** / **Third-party licences**
- Trademark note: Netflix and YouTube are trademarks of their owners. Couch is not affiliated with or endorsed by them.
- Copyright and site privacy: © **2026** Abdullah Nettoor. No cookies. No analytics.
- The year remains dynamic, with 2026 as the HTML fallback.
- Brand icon alt: empty.

No TMDB artwork is shown on this site; the existing mock and screenshot assets remain. Do not silently add online posters without revisiting attribution.

## 11. Metadata and social card

| Field | Picked string |
| --- | --- |
| HTML title | Couch · A calm home screen for your TV |
| Description | A calm home screen for your TV, with YouTube, Netflix and your own videos. Your phone is the Remote. Free and open source. For Mac today. |
| OG site name | Couch |
| OG and Twitter title | Settle in with Couch |
| OG and Twitter description | Your TV. Your evening. Your phone as the Remote. A calm home for YouTube, Netflix and your own videos. For Mac today. |
| OG image alt | Settle in with Couch. Your phone is the Remote. A TV and phone illustration. |
| Social image brand | Couch |
| Social image headline | Settle in with Couch. |
| Social image supporting line | Your phone is the Remote. |
| Social illustration text, unchanged | Phone connected / Good evening |

The 1200×630 social image is regenerated from `scripts/og.html` into `public/og.png`. Only the words change; the existing illustration is not redesigned. Its illustration is illustrative, not a screenshot. Canonical and social URLs still come from `src/config.ts`.

## 12. Image alternatives and mock text

Source of truth for slot alts: `src/slots.ts`. These descriptions also name the corresponding mock images accessibly. Recheck them when the staged shoot replaces the pictures.

| Slot | Picked alt |
| --- | --- |
| `hero-screen` | Couch Home on the Screen, with a clock and the YouTube, Netflix and Library Apps |
| `hero-remote` | The Remote on a phone, with Apps, a D-pad and volume controls |
| `remote-screen` | Couch Home during phone pairing, with a QR code or a connected phone and a highlighted App |
| `remote-phone` | A phone pairing with Couch, then showing the Remote and its D-pad |
| `apps-screen` | Couch Home with the YouTube, Netflix and Library Apps and unfinished videos |
| `library-screen` | The Library on the Screen, with a highlighted test video and its picture |
| `privacy-screen` | Couch Settings, with Remotes and Devices, Library, Sound output, Apps and Home |
| `setup-remotes` | Remotes and Devices in Settings, with Add a phone highlighted |
| `setup-player` | A test video playing in the Library, with playback, subtitle and volume controls |
| Library shelf mock (`src/mocks.ts`), unchanged | A folder named Movies becomes a shelf of videos: Summer Trip and Cooking Show part-watched, Home Videos watched |

Decorative brand/app icons have empty alt text. Decorative SVGs, highlights and device frames do not need prose. Product mocks are image-like and inert, not working controls.

### Product mock inventory (preserved, not marketing headlines)

The app's words are part of the faithful UI illustration, not opportunities for a marketing rewrite. Copied strings are not edited; `pnpm sync:couch --check` must keep passing.

- Screen: **8:42**, **PM**, **Good evening · Monday 2 November**, **YouTube**, **Netflix**, **Library**, **No phone connected**, **1 phone connected**, **Scan to use your phone as a remote**.
- Continue illustration: **Summer Trip**, **Holidays**, **1h 12m left**, **Cooking Show**, **Shows**, **38m left**, **Resume**, **From start**.
- Shelf illustration: **Movies**, **4 items**, **Summer Trip**, **1h 12m left · Holidays**, **Cooking Show**, **38m left · Shows**, **Home Videos**, **Watched**.
- Phone camera overlay: **Point the camera at the code on the Screen**.
- Copied Remote: **On the Screen**, **Home**, **Connected**, **· 1 phone**, **YouTube**, **Netflix**, **Library**, **OK**, **35**.
- Copied Remote accessible labels, unchanged and inside the inert illustration: **Power**, **Home**, **Mute**, **Quick settings**, **Settings**, **Apps**, **Open YouTube**, **Open Netflix**, **Open Library**, **Up**, **Down**, **Left**, **Right**, **Volume down**, **Volume**, **Volume up**.
- Existing screenshot pixels are not rewritten. Library shows **Test Movie**, **FILM · 2020**, **All**, **Films**, **No phone connected**, **2:03 AM**. Settings shows **Remotes and Devices**, **Library**, **Sound output**, **System default**, **Apps**, **Home**, **Quit Couch**. Remotes and Devices shows **Add a phone**, **Show the QR code**, **Forget all phones**, **1 connected**, **Start Couch Listener at login**, **Off**, **Listener off**. Player shows the test **Clip**, its timeline and playback controls. These are test content and UI, not claims about the visitor's Library.

## 13. Not-found page (`public/404.html`)

### Headline options

1. **PICK — This page is not here.** Says what happened plainly without borrowing the forbidden “channel” metaphor.
2. **We could not find this page.** Conventional and direct.
3. **A quiet corner. No page here.** More playful, but less clear at first glance.

- Browser title: **Page not found · Couch**
- Heading: **This page is not here.**
- Recovery link: **Back to Couch**
- No extra body copy or decorative image.

## 14. Licences page (`public/licenses/index.html`)

### Headline options

1. **PICK — Third-party licences** — Matches the footer and describes exactly what this page contains.
2. **Fonts, icons and their licences** — More descriptive but narrower than a reusable notices page.
3. **The licences behind this site** — Warmer, though it could be mistaken for the site's own licence alone.

- Browser title: **Third-party licences · Couch**
- Heading: **Third-party licences**
- Body: Couch's website uses these fonts and icons. Each has its own licence. Follow the links for the full texts.
- First item: **Geist and Geist Mono** fonts: SIL Open Font License 1.1, Copyright (c) 2023 Vercel, in collaboration with basement.studio.
- Second item: **Phosphor Icons**: MIT, Copyright (c) 2023 Phosphor Icons.
- Closing: The site itself is GPL-3.0-or-later, like Couch. Netflix and YouTube are trademarks of their owners; Couch is not affiliated with or endorsed by them.
- Recovery link: **Back to Couch**

Font, icon and licence proper names retain their legal spelling. Copyright notices and the full linked licence texts are unchanged.

## 15. Factual evidence and hand-off cautions

All app paths below are in the read-only `/Users/abdullahnettoor/Projects/couch` repo.

| Claim or risk | Evidence / limit |
| --- | --- |
| What Couch is; household sharing; QR Remote; no phone app | `README.md` introduction and Requirements; `PRODUCT.md` Users, Operating Context and capabilities; `GLOSSARY.md` Screen, Remote and Household. |
| Current platform and requirements | `README.md` Requirements; `SHIPPING.md` Architecture (arm64 only) and Other platforms; `native/mpv-embed/webkit_host.mm` macOS 14 availability checks. Do not infer Intel, Windows or Linux support from Electron. |
| Android testing vs any-phone promise | `README.md` Setting up Couch: Android with Chrome is tested; other phones may work. FAQ uses that limitation, not universal compatibility. |
| YouTube sign-in vs Netflix sign-in | `README.md` setup step 6 gives youtube.com/activate; `GLOSSARY.md` YouTube and Netflix: TV experience vs Netflix's own website and on-Screen sign-in. No Netflix sign-in attempted. |
| Content/subscriptions and Netflix limitations | `README.md` early-project note; `SHIPPING.md` Accounts and content; `GLOSSARY.md` Netflix and Engine. No resolution, DRM success or access guarantee. |
| Continue watching and Netflix resume | `GLOSSARY.md` Continue watching: mixed App/Library titles, App addresses, locally kept art, Netflix controls its own resume position. |
| Library, frames, resume, built-in playback and controls | `PRODUCT.md` capabilities; `README.md` Requirements and mpv hand-off; `GLOSSARY.md` Library and Now Playing. Frames can fall back to a colour; no format guarantee. |
| TMDB optional, key-dependent, titles and images go online | `README.md` TMDB details; `src/main/ports/tmdb-metadata.ts` API, search and image requests; `src/main/core/details-page.ts` Online details toggle; `src/main/core/metadata-service.ts` key/enabled handling. |
| App art is downloaded and stored locally | `src/main/core/continue-art.ts` `downloadArt` and `ContinueArt`: own artwork hosts, request without cookies, local hash-named file. Not “nothing leaves your Mac”. |
| Widevine not bundled | `README.md` Third-party: downloaded at run time by castLabs. Copy avoids promising a single download that can never update. |
| Local data and local Remote | `README.md` Where Couch keeps its data; `src/main/core/core.ts` local pairing URL; `src/main/remote/server.ts` serves the Remote. Services retain their own sign-ins/cookies. |
| No Couch analytics, crash reporting or automatic update checks | No matches for `analytics`, `telemetry`, `sentry`, `crashReporter` or `autoUpdater` in app `src`; `SHIPPING.md` Updates says an updater is still needed. This is a source review, not a guarantee about third-party services. |
| Not yet notarised | `SHIPPING.md` Signing and notarisation; `scripts/package.mjs` ad-hoc default. Existing README first-open advice is older; preserve ticket 135's macOS 15+ correction. Apple's current “Open apps safely” instructions at https://support.apple.com/en-gb/102445 support try opening → Privacy & Security → Open Anyway → confirm Open. Verify again on the release build before publishing. |
| Free/open source vs planned downloads | App `LICENSE` and `README.md` Licence: GPL-3.0-or-later. Gumroad/$0 and GitHub Releases are ticket 135 distribution decisions. `SHIPPING.md` and the site README make clear that publishing is still gated. |
| Windows interest, not a delivery promise | Ticket 137 permits demand markup only. `SHIPPING.md` Other platforms explains native work and a separate Netflix trial would be needed. No counter exists in this change, so the copy says when counting will apply. |
| Site cookies/analytics and licence notices | Local site source and request/storage check; self-hosted fonts; `public/licenses/` full legal notices; `LICENSE` and `package.json`. Future counting must honour no-IP-storage at the hosting/logging layer as well as in code. |

### Checks for this pass

Run the build, drift check and existing tests; inspect picked copy against this deck and the built HTML; check local renders at the existing desktop/phone widths and 200% zoom, no overflow, reduced motion and keyboard access. Confirm the Windows button makes no requests, changes no storage and does not reveal the success message. No deployment, no remote, no live Couch, no service sign-in.
