# Couch — landing page copy

Ticket 137 · 2 November 2026 · picked copy applied on `ticket/137`. Updated in ticket 138 (design upgrade): the two accepted copy-review edits, the hero's new layout, the Windows card's strings. Changes are marked “ticket 138”. Since the Windows counter was removed (November 2026), the Windows card links to a GitHub issue instead and the site stores nothing.

## Direction and implementation boundaries

For someone on the sofa, not someone shopping for a computer. Lead with the evening and the phone already in their pocket; explain the Screen, Apps and Library as they appear. Warm, calm and confident. Short sentences, British spelling, no hype or exclamation marks. Product terms follow Couch's `GLOSSARY.md`: Screen, Remote, Home, Apps, Library, Continue watching, Now Playing, Settings and Quick settings.

Ticket 137 was a copy pass, not a redesign; ticket 138 redesigned the page around this copy and kept its IDs, screenshot slots and mocks. No changes to the copied `src/couch-ui/` files. No future look-picker claim: it is not available today.

**Publication gates still apply.** The app README says Couch is not distributed yet. The page's Gumroad, Releases and source links are the planned distribution routes, not evidence that a public release exists. The Gumroad URL remains a placeholder. Do not publish until the README's existing release, source, Gumroad and first-open checks are complete.

**Windows interest (counter removed, November 2026).** The site no longer counts anything. The Couch for Windows button is a plain link to GitHub issue #34, “Couch for Windows: add a 👍 if you'd use it” (`WINDOWS_ISSUE_URL`); interest is that issue's 👍 count, and adding one needs a GitHub account. The site has no Worker script, no `/api/*`, no database and no `localStorage` key. Cloudflare, which hosts the site, still processes request data under its own policies, so the page says “This site itself keeps nothing about your visit” and never “no IP stored”. Before publishing, re-check Cloudflare's own retention against that wording (README, “Before publishing”). Ticket 138's counter (a `POST /api/demand/windows` to a Worker and a D1 total, the “Counted. Thank you.” confirmation and the error line) is retired.

## 1. Navigation and shared controls

| Location | Picked string |
| --- | --- |
| Skip link | Skip to content |
| Brand | Couch (ticket 142: the COUCH wordmark as SVG paths with no text; the link's accessible name below carries it) |
| Brand accessible name | Couch, back to top |
| Main navigation accessible name | Main |
| Navigation, desktop and mobile | How it works / Apps / Library / Privacy / FAQ |
| Source link, desktop and mobile | Source |
| Navigation CTA, all widths | Download (ticket 145 addendum: was "Get Couch", which repeated the COUCH wordmark beside it; same link, #download. The hero button stays "Get Couch, pay what you want") |
| Compact menu accessible name | Menu |
| Scroll progress | Decorative; no spoken label |

## 2. Hero (`#top`)

### Headline options

1. **PICK (ticket 142) — Settle in.** The nav's COUCH wordmark and the logo the intro draws already say Couch, so the headline only has to say how the evening feels. Approved by the user with the ticket 141 storyboard (2 Nov), over "Settle in / with Couch."
2. **Settle in with Couch.** The pick from tickets 137 to 141: leads with the feeling and names the brand.
3. **Your evening, on the big screen.** Puts the living-room moment first, with less emphasis on the brand.
4. **A calmer way to watch.** Says what changes about the evening without promising new content.

### Picked copy

- Badge: **Early release · Free and open source**
- Headline: **Settle in.** (ticket 142; one `h1`, set large in the warm white gradient. Until ticket 142 it was "Settle in with" above a large "Couch.")
- Headline loop (ticket 143, the user's pick; a loop since the hero tweaks): after the intro it turns, round and round, **Settle in.** → **Sit back.** → **Press play.** → **Lights down.** → **Settle in.** → …, about 3s each, with a thin four-segment line under it that fills with each phrase, so visitors can see it is meant to change. It holds while the pointer is on it or anything in the hero has focus. Short phrases only, so the box never changes. The h1's text and accessible name stay "Settle in."; reduced motion and no script show only "Settle in.", with no line.
- Body: A calm home screen for your TV, with YouTube, Netflix and your own videos. Your phone is the Remote.
- Primary button: **Get Couch, pay what you want**
- Secondary link: **or download free from GitHub** (`DOWNLOAD_URL`: the latest release's `Couch-arm64.dmg`, a direct download)
- Meta strip (ticket 143): **macOS 14+** / **Apple silicon** / **Open source** / **No account**, set in sentence case (no capitals or mono), so "macOS" reads as Apple writes it. Until ticket 143 it was "Mac today · macOS 14+ / Apple silicon / GPL-3.0-or-later / No Couch account"; the licence stays named in the footer, the FAQ and the README.
- Meta strip accessible name: **Requirements**
- Link under the meta strip (ticket 138), to the Windows card: **On Windows? Tell us you'd use it**
- First-look section under the hero (ticket 138), accessible name: **Couch Home on the Screen, and the launch video** (ticket 145; was "Couch Home on the Screen", and before the 138 review "Couch on the Screen, with the Remote")
- Decorative icon alt: empty.
- Product picture alts: see §12.

The Mac requirement is visible here, but is not the headline or the proposition.

### The first look's TV (ticket 145)

The TV pins under the hero and Couch's Home on it can be used. The Screen's own text is the shoot's: **3:36 PM**, **Good afternoon · Monday 2 November**, **1 phone connected**, **YouTube**, **Netflix**, **Library**, **Big Buck Bunny (2008)**, **7 min left** (decorative, hidden from screen readers; the tiles' buttons carry the names below).

- The TV's accessible name: **Couch on the Screen** (a group, described as **TV**); the row: **Couch Home** (a toolbar).
- The tiles' buttons: **Open YouTube: {title}** (placeholder: **Open YouTube**), **Open Netflix**, **Open the Library**, **Continue Big Buck Bunny (2008), 7 min left**.
- The overlay over the whole Screen, each time the TV comes into place until the visitor first uses it (hidden from screen readers; the hint says the same): the keys **←** **→**, **or**, a mouse glyph; **Use the arrow keys or your mouse**; smaller, **Enter or click opens a tile**. Touch screens: a tap glyph and **Tap a tile to open it**.
- The hint (a small pill over the Screen, until the visitor first uses the TV): **Use ← → or your mouse. Press Enter to open.** Touch screens: **Tap a tile.**
- The hint while the scroll has moved the highlight to YouTube: **Press Enter or click to watch the launch video.** Touch: **Tap YouTube to watch the launch video.** Placeholder: **Press Enter or click to open YouTube.** / **Tap YouTube to open it.**
- In an opened App: **‹ Home** (accessible name **Back to Home**). In the Library, the screenshot's own **‹ Home** is the button (accessible name **Home**), and there is no pill.
- Netflix: Netflix's signed-in home inside Couch (a screenshot), alt text and a caption pill on the Screen: **Netflix opens Netflix's own website, signed in with your account.** (The Apps section's wording: the services' own websites, with your own accounts. Was a card with the same line, before the screenshot.)
- Phones, the Remote under the TV: a group named **Remote**, buttons **Left**, **Right**, **OK** (visible: ◀, ▶, OK); no Back key (ticket 145 review: going back is the Screen's **‹ Home**). The caption under it says what OK does: **Big Buck Bunny · Tap OK to resume**, **Your own films · Tap OK to open**, **Netflix, with your own account · Tap OK**, **YouTube · Tap OK to watch the launch video** (placeholder: **YouTube · Tap OK to open**); in an opened App, **Tap ‹ Home on the TV to go back** (was "Tap Back to go Home", with a Back key). The overlay's phone text: **Use the Remote below, or tap a tile** (replaces "Tap a tile to open it" on the phone layout).
- While the TV is pinned: **Skip** with a down arrow (accessible name **Skip the TV demo**), scrolling on to the Remote section.
- Library: Couch's Library screenshot, alt **Couch's Library: the Films shelf with Big Buck Bunny, Sintel and Tears of Steel**. Continue: Couch's player, alt **Couch's player: Big Buck Bunny (2008) at 2:04, 7:52 left, with its controls**.

Placeholder mode (`LAUNCH_VIDEO.id` empty):
- YouTube opens a Couch-made poster (the icon's sofa-and-Screen light in a dark, warm room): **Launch video** / **Coming soon to YouTube**.
- The privacy fact keeps its old wording (below).

With a video (`LAUNCH_VIDEO.id` set; today Couch's launch video, **Movie night on your Mac. Your phone's the remote**, `0EyRAw2KQhE`):
- YouTube's own player, cued (not autoplaying), loads over the YouTube tile once the tile is highlighted (#46), so the visitor's click or tap on the tile is a press on YouTube's play: it starts the video with sound, counts as a YouTube view, and YouTube opens around it. The player's frame is titled **{title} (YouTube video)**. No new words on the page: the hint and the Remote's caption are unchanged.
- Nothing under the TV (ticket 145 review: the "Watch on YouTube" and "Subscribe on YouTube" pills and the line "The preview on the Screen comes from this site…" went with the self-hosted teaser; the channel stays in the footer's links).
- Privacy fact **No Couch analytics** becomes: Couch adds no analytics or cookies. YouTube loads only when you reach YouTube on the TV above, and may use cookies or browser storage under Google's privacy policy. Services opened in Couch have their own sign-ins, cookies and privacy policies. (#46: was "…YouTube loads only when you open YouTube on the TV above…", before the player loaded on the highlighted tile. 145 review: earlier "…YouTube loads only when you press play…" and, with the teaser, "…The launch video's preview comes from this site; YouTube loads only when you press Watch with sound or play…".)
- Footer line becomes: © **2026** Abdullah Nettoor. **No cookies or analytics from Couch.**

Rejected: "Launch video coming soon" as a kicker over a title (the page bans kickers over headings; the two lines read as one sentence); a Subscribe pill drawn inside the poster (it would look pressable on a picture that is not); stating the site's privacy change while there is no video (it would describe something that does not happen yet); a self-hosted muted teaser with "Watch with sound" (the maintainer preferred the real Home, used); links and a note under the TV. No FAQ answer said the site makes no third-party requests, so the FAQ is unchanged.

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
- Sequence replay: **Replay** (phones, short windows and reduced motion only; from 900 px the scroll moves the steps and there is no Replay, ticket 143)
- Bullets:
  - The Remote opens in your phone's browser. No phone app to install.
  - Now Playing puts playback controls on your phone.
  - At the Mac, the keyboard and trackpad work too.
- QR-only caption: **Pairing illustration. This QR code will not connect.**
- Camera overlay in the illustration: **Point the camera at the code on the Screen** (unchanged).

The QR caption remains conditional on the sequence showing its QR state. Avoid “every press moves the highlight”: volume and playback presses do not.

## 4. Apps (`#apps`)

### Headline options

1. **Familiar Apps. Room to relax.** Pairs recognition with the feeling of watching from the sofa.
2. **PICK (copy review, ticket 138) — The Apps you know, together on Home.** Explains the launcher without suggesting Couch supplies content.
3. **YouTube. Netflix. Feet up.** The shortest, most relaxed version; less descriptive of Home.

### Picked copy

- Eyebrow: **Apps**
- Headline: **The Apps you know, together on Home.**
- Body: Open YouTube or Netflix from Home, then choose something with the Remote. These are the services' own websites, with your own accounts. Couch does not include subscriptions or unlock extra content.
- Bullets:
  - YouTube has its familiar TV layout. To sign in, enter the code from the Screen at youtube.com/activate on your phone.
  - Netflix opens its own website on the Screen. Sign in there, then use the Remote to move the focus ring and choose what to watch.
  - Continue watching on Home brings unfinished titles back within reach. Netflix manages its own resume position.
- Caption: **App marks belong to their owners. Couch is not affiliated with or endorsed by Netflix or YouTube.**
- Closing line (ticket 143, Addendum 4): **More Apps are welcome. Add one →** ("Add one" links to the Couch repo's CONTRIBUTING.md, "Add a web App": `ADD_APP_URL` in `src/config.ts`; the arrow is a drawn icon).

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
  - Optional film and show details come from TMDB. Where no saved details are available, Couch uses frames from your videos, or a colour while they load.
- Screenshot and shelf illustration accessible descriptions: see §12.

No “plays every format”, codec guarantee or promise that the household's videos leave the Mac for processing.

## 6. Privacy (`#privacy`)

### Headline options

1. **PICK (ticket 143) — No account. No tracking.** The user's review (2 Nov): the old pick said "Couch" twice in one line. The section is about Couch, and the facts and "What Couch connects to" below still scope both promises to Couch, not the services it opens. "No tracking." carries the gradient.
2. **No Couch account. No Couch tracking.** The pick until ticket 143: deliberately scoped to Couch in the headline itself, but repetitive.
3. **One household. No Couch account.** Leads with sharing, rather than a blanket privacy claim.
4. **Your Library stays close to home.** Emphasises local storage; the connection list still explains online details.

### Picked copy

- Eyebrow: **Privacy**
- Headline: **No account. No tracking.** (gradient on "No tracking.")
- Facts:
  - **One household, one Screen** — No Couch sign-up and no Couch profiles. Pair a phone and join in.
  - **Kept on your Mac** — Your Library, Couch's saved viewing positions and your settings stay on the Mac. There is no Couch cloud.
  - **No Couch analytics** — This site uses no cookies or analytics. Services opened in Couch have their own sign-ins, cookies and privacy policies. (With a launch video, ticket 145 review: Couch adds no analytics or cookies. YouTube loads only when you reach YouTube on the TV above, and may use cookies or browser storage under Google's privacy policy. Services opened in Couch have their own sign-ins, cookies and privacy policies.)
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
  - **GitHub, for updates.** Every few hours Couch asks whether a newer version is out, through update.electronjs.org (a free service run by the Electron project that reads Couch's GitHub releases), or a file on GitHub when Beta updates is on. The request carries Couch's version and the Mac's type, nothing about you. Updates download from GitHub.
  - **Your phone, over home Wi-Fi.** The Remote page is served by your Mac on the local network, not by an internet service.
- Closing line: Couch does not send data to a Couch server. (Was "Couch does not check for updates or send data to a Couch server." until the app gained its updater in 0.1.1.)
- Site privacy line (counter removed, November 2026): This site itself keeps nothing about your visit. Cloudflare, which hosts it, processes request data under its own policies. (Ticket 138's line, retired with the counter: The Couch for Windows button adds one anonymous count on this site, with no email and no cookies. Our counter stores only the platform and the total. Cloudflare, which hosts this site, processes request data under its own policies. Your browser keeps a note of the tap, so the same browser counts once.)

Do not shorten this to “nothing leaves your Mac”, “fully offline” or “no cookies” for the whole app. Services can track and keep cookies. Library title searches and online artwork make requests. The site's own hosting is a website matter, not an app connection.

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

## 7b. Why I made Couch (`#why`)

The user's own words, approved as written (ticket 143, Addendum 4). Do not edit them; they are the one place the page says "I". Between Setup and Download, signed with the name and the social icons from `SOCIAL` (no photo).

- Heading (set as the section's small label): **Why I made Couch**
- Letter:
  - I bought a monitor for work. A TV as well didn't make sense, so my first thought was a streaming stick, so the family could watch on the monitor in the evenings.
  - Then I looked at my MacBook, sitting idle every evening. Why not let it be the TV, with our phones as the remote?
  - So I built Couch. It brings YouTube, Netflix and our own videos to one calm home screen.
  - I only have accounts for those, so I built Couch so that more Apps can be added. If your favourite service is missing, you're welcome to **add it** (link: CONTRIBUTING.md, "Add a web App", `ADD_APP_URL`).
- Signature: **— Abdullah**, then the social icons (list name "Abdullah elsewhere").
- Under the signature (ticket 39), one quiet line: **Enjoying Couch? Buy me a coffee →**. The link (`COFFEE_URL` in `src/config.ts`, https://buymeacoffee.com/abdullahnettoor) opens in a new tab with `rel="noopener noreferrer"`. A plain link: no widget, script, iframe or image. Gumroad stays the only way to pay for the download; Download, the FAQ and the footer do not change.

"the remote" and "home screen" stay lower-case here: it is the maker's story, not product UI.

## 8. Download (`#download`)

### Headline options

1. **PICK — Bring Couch home.** A short, brand-led invitation after the visitor understands the product.
2. **Make room for Couch.** Relaxed and brand-led, with a gentler call to action.
3. **Get Couch. Choose your price.** Most direct about the transaction and optional payment.

- Headline: **Bring Couch home.**
- Body: For Mac today. Free and open source. Choose a price on Gumroad, including $0, or download free from GitHub.
- Primary button: **Get Couch, pay what you want**
- Secondary link: **or download free from GitHub** (`DOWNLOAD_URL`: the latest release's `Couch-arm64.dmg`, a direct download)
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
- Body (counter removed, November 2026): **Not yet. Windows is being considered, not promised. If you'd use it, add a 👍 on GitHub.**
- Button, a link: **Couch for Windows on GitHub** → GitHub issue #34, “Couch for Windows: add a 👍 if you'd use it” (`WINDOWS_ISSUE_URL`, `rel="noopener"`, same tab, like the page's other external links)
- Short note, describes the button: **The 👍 goes on a GitHub issue, so you need a GitHub account.**
- Markup contract: `a.btn.btn-ghost.btn-lg` in `.win-act`, `aria-describedby="windows-note"`. No script, no request, no stored state.
- Retired with the counter (ticket 138): body “Not yet. Tap if you'd use it, so we know what to build next.”, button “I'd use Couch for Windows”, privacy line “An anonymous count, with no email and no cookies. Our counter stores only the platform and the total. Cloudflare, which hosts this site, processes request data under its own policies.”, confirmation “Counted. Thank you.” and error line “That did not go through. Please try again in a moment.”
- Before ticket 138 (stub, retired): body “Not yet. Would you use it? Help us decide what to build next.”, notice “Demand counting is not connected yet.”, privacy line “Anonymous count when enabled. No email, no cookies, no IP stored.”

No email waitlist, no promise of a Windows release.

## 8b. Roadmap (`#roadmap`, #48)

Between Download and the FAQ. Small and honest: no dates, no promises beyond the three headings. Not in the navigation (six links crowd the bar; the FAQ's NAS answer links here).

- Eyebrow: **Roadmap**
- Headline: **Now showing, and coming up.** (the evening/TV thread, like "Before you settle in.")

**Available now (0.2.0)**

- Home with Continue watching
- YouTube and Netflix
- Your own Library
- The phone Remote
- Quick settings

**Coming next**

- More Apps (kept general: no service names)
- Network folders (NAS)

**Being considered**

- Windows (add a 👍) (link text **add a 👍**, to GitHub issue #34, `WINDOWS_ISSUE_URL`)
- Intel Macs
- Choosing a Look

- One link under the columns: **See or suggest on GitHub** → the repo's Issues.
- When a release ships, update the version in "Available now" and move what shipped.

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

Windows is being considered, not promised. If you'd use it, add a 👍 to the Couch for Windows issue on GitHub (you need a GitHub account). Linux is not supported. Today, Couch needs Apple silicon and macOS 14 or later. The Remote runs in a phone browser; Android with Chrome is what we test.

**Can Couch play from my NAS?** (#48)

Yes, if the share is mounted in Finder. Better support is coming: see the roadmap.

- Inline link text: **roadmap**, to the Roadmap section (`#roadmap`). The work is GitHub issue #47 (not linked from the site).

## 10. Footer

- Layout (ticket 143): two columns from 900 px. Left: the brand, the links, the social links, the trademark note and the copyright line. Right: Credits. One column on phones, Credits last.
- Brand: the **COUCH** wordmark (20 px tall, accessible name **Couch**; until ticket 143 the icon and the word "Couch")
- Navigation accessible name: **Footer**
- Links: **GitHub** / **Releases** / **Licence (GPL-3.0)** / **Third-party licences** (ticket 145: the licence link was labelled "GPL-3.0-or-later"; it still opens LICENSE, and the exact "or later" wording stays in LICENSE, the README, package.json and the privacy facts)
- Social links (ticket 143), icons only, list name **Elsewhere**: one per entry in `SOCIAL` (`src/config.ts`), nothing when it is empty. Each link's accessible name (and tooltip): **Couch on GitHub**, **Abdullah Nettoor on X**, **Abdullah Nettoor on LinkedIn**, **Abdullah Nettoor on YouTube** (Phosphor's brand marks).
- Trademark note: Netflix and YouTube are trademarks of their owners. Couch is not affiliated with or endorsed by them.
- Credits (ticket 142; a small "Credits" heading in the footer): The films on the Screen are Blender's open films *Big Buck Bunny*, *Sintel* and *Tears of Steel*, © Blender Foundation, CC BY 3.0. Film imagery shown within Couch screenshots; cropped and resized for this site. Then TMDB's approved logo (`public/tmdb.svg`, "Primary short (blue)" from themoviedb.org/about/logos-attribution, self-hosted, 12 px tall, smaller and quieter than Couch's footer wordmark) beside: Posters and backdrops come from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB. (Each film links to its Blender project page, "CC BY 3.0" to the licence and the TMDB logo, alt "TMDB", to themoviedb.org. The TMDB sentence is TMDB's required notice, word for word. The changes note is the CC BY "indicate if changes were made" line.)
- Copyright and site privacy: © **2026** Abdullah Nettoor. No cookies. No analytics. With a launch video (ticket 145 review): © **2026** Abdullah Nettoor. **No cookies or analytics from Couch.** (Couch's own claim only: once loaded, the YouTube player may set cookies or use browser storage, and the privacy fact says so.)
- The year remains dynamic, with 2026 as the HTML fallback.

Since ticket 142 the screenshots show TMDB artwork (the Blender films' posters and backdrops, fetched by Couch's optional online details), so the footer and the licences page carry TMDB's notice and the films' CC BY credit. Keep both whenever a screenshot shows a film.

## 11. Metadata and social card

| Field | Picked string |
| --- | --- |
| HTML title | Couch · A calm home screen for your TV |
| Description | A calm home screen for your TV, with YouTube, Netflix and your own videos. Your phone is the Remote. Free and open source. For Mac today. |
| OG site name | Couch |
| OG and Twitter title | Couch · Settle in. (ticket 142; was "Settle in with Couch") |
| OG and Twitter description | Your TV. Your evening. Your phone as the Remote. A calm home for YouTube, Netflix and your own videos. For Mac today. |
| OG image alt | Couch. Settle in. Your phone is the Remote. A TV and phone illustration. |
| Social image brand | The COUCH wordmark (`src/brand/wordmark.svg`) |
| Social image headline | Settle in. |
| Social image supporting line | Your phone is the Remote. |
| Social illustration text, unchanged | Phone connected / Good evening |

The 1200×630 social image is regenerated from `scripts/og.html` into `public/og.png`. Only the words change; the existing illustration is not redesigned. Its illustration is illustrative, not a screenshot. Canonical and social URLs still come from `src/config.ts`.

## 12. Image alternatives and mock text

Source of truth for slot alts: `src/slots.ts`. These descriptions also name the corresponding mock images accessibly. Recheck them when the staged shoot replaces the pictures.

| Slot | Picked alt |
| --- | --- |
| `hero-screen` | Couch Home on the Screen: Big Buck Bunny under Continue watching, its picture filling the Screen with Resume and From start, and the YouTube, Netflix and Library Apps below (ticket 142 screenshot; was the Home mock) |
| `remote-screen` | Couch Home during phone pairing, with a QR code or a connected phone and a highlighted App |
| `remote-phone` | A phone pairing with Couch, then showing the Remote and its D-pad |
| `apps-screen` | Couch Home with the YouTube, Netflix and Library Apps and unfinished videos |
| `library-screen` | The Library on the Screen: a Films shelf with the posters of Big Buck Bunny, Sintel and Tears of Steel, and the highlighted film's details above |
| `privacy-screen` | Couch Settings: Remotes and Devices with one phone connected, Library, Sound output, Apps, Home and Quit Couch |
| `setup-install` (ticket 143, drawn) | The Couch app icon being dragged into the Applications folder, into the empty place marked Couch |
| `setup-qr` (ticket 143; was `setup-remotes`, Remotes and Devices) | Couch Home showing No phone connected and a QR code card: Scan to use your phone as a remote |
| `setup-app` (ticket 143; was `setup-player`, a playing film) | Couch Home with the YouTube App highlighted, next to Netflix and the Library |
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
- Existing screenshot pixels are not rewritten. Since ticket 142 they are the real Couch from the ticket 140 shoot (a temporary profile, privacy-checked): Home shows **Big Buck Bunny (2008)**, **Animation / Comedy / Family**, its TMDB synopsis, **films · 7 min left**, **Resume**, **From start**, **YouTube**, **Netflix**, **Library**, **1 phone connected**, **3:36 PM**. Library shows **FILM · 2008**, **Big Buck Bunny**, **All / Films / English / Animation**, **Films** with **Big Buck Bunny**, **Sintel**, **Tears of Steel**, **‹ Home**. Settings shows **Remotes and Devices** (**1 connected**), **Library**, **Sound output** (**System default**), **Apps**, **Home**, **Quit Couch**. Since ticket 143 the setup cards show two details of Home instead of Remotes and Devices and the film frame: step 2 the QR card (**No phone connected**, **Scan to use your phone as a remote**; the temporary profile's key, which no longer exists), step 3 the App row with **YouTube** highlighted beside **Netflix** and **Library**. Step 1 is a small drawing, not a screenshot: the Couch icon over an **Applications** row, its empty place marked **Couch** (no other app's marks or names, nothing copied from macOS). "films" is the shoot's folder name. These are Blender's open films and Couch's own UI, not claims about the visitor's Library.

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
- Section (ticket 142): **Credits**, with **Films in the screenshots**: The screenshots show Couch playing Blender's open films. They are shared under the Creative Commons Attribution 3.0 licence: *Big Buck Bunny* (2008), *Sintel* (2010) and *Tears of Steel* (2012), each © Blender Foundation, CC BY 3.0, each followed by "Film imagery shown within Couch screenshots; cropped and resized for this site." And **Posters, backdrops and film details**: TMDB's logo (16 px tall, linking to themoviedb.org), then: The posters, backdrops and film details come from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.
- Closing: The site itself is GPL-3.0-or-later, like Couch. Netflix and YouTube are trademarks of their owners; Couch is not affiliated with or endorsed by them.
- Recovery link: **Back to Couch**

Font, icon and licence proper names retain their legal spelling. Copyright notices and the full linked licence texts are unchanged.

## 15. Factual evidence and hand-off cautions

All app paths below are in the app repo (the folder above `site/`).

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
| Windows interest, not a delivery promise | Ticket 137 permits demand markup only. `SHIPPING.md` Other platforms explains native work and a separate Netflix trial would be needed. Interest is a 👍 on GitHub issue #34; the site's own counter (ticket 138) was removed in November 2026, so the site stores nothing. |
| Site cookies/analytics and licence notices | Local site source and request/storage check; self-hosted fonts; `public/licenses/` full legal notices; `LICENSE` and `package.json`. The site is static assets only: no Worker script, no storage, no logging of its own; Cloudflare's own processing is named, not denied. |

### Checks for this pass

Run the build, drift check and existing tests; inspect picked copy against this deck and the built HTML; check local renders at the existing desktop/phone widths and 200% zoom, no overflow, reduced motion and keyboard access. (Since the counter was removed: the Windows button is a link to GitHub issue #34, and the page makes no request and sets no storage for it.) No deployment, no remote, no live Couch, no service sign-in.
