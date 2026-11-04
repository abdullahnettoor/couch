# Couch

A home TV experience on a MacBook driving an external monitor, controlled from an Android phone. Covers YouTube, Netflix, local video folders and other Apps.

## Language

**Screen**:
The full-screen TV app running on the MacBook and shown on the monitor.
_Avoid_: TV app, player, desktop app

**Remote**:
The control surface on a phone, used from the couch to drive the Screen.
_Avoid_: controller, phone app, mobile app

**Home**:
The first page the Screen shows: a simple launcher with a clock and the Apps.
_Avoid_: launcher, dashboard, main menu

**Page**:
One of Couch's own full-screen places on the Screen: Home, the Library, a folder, a show, Settings and its pages, About, Now Playing's controls, the App error page, and the view an App sits in (its Back and its leaving, though not the website drawn inside it). It is not a Web App's website, and not an overlay (Quick settings, Setup, a question, Picture off). In code, `View` is the id of a Page.
_Avoid_: screen (that is the whole app), view (in prose), menu

**Wallpaper**:
The calm background Home draws behind the clock and tiles; the household picks one in Settings → Home (six built-in ones, Couch by default, or a picture from the Mac: its desktop picture, one from a chosen folder, or one of Apple's wallpapers).

**App**:
A full-screen experience launched from Home, such as YouTube or the Library. It should feel like an app on a smart TV.
_Avoid_: tile, channel, section

**Web App**:
An App that is a website shown in Couch's web view (YouTube and Netflix now; later others). Couch's core talks to it only through the App interface.
_Avoid_: channel, site

**Add-on**:
An optional change to one Web App's page, such as an ad blocker, turned on or off in Settings. Shipped with Couch; never downloaded.
_Avoid_: extension (clashes with file extensions in the Library), plugin (in UI copy)

**Netflix**:
The App that shows Netflix's own website inside the Screen, driven from the Remote with a visible focus ring; sign-in and profile choice happen on the Screen.

**Engine**:
What a Web App's page runs on: WebKit (FairPlay) or Chromium (Widevine); the household chooses it per App in Settings → Apps → Playback.

**Welcome**:
The one question Couch asks, only of someone who already has a Netflix sign-in in Couch's Chromium, the first time Netflix opens on WebKit and before its page loads: copy the sign-in from Couch, sign in on Netflix, or keep using Chromium; Back means sign in on Netflix, and it is never asked again. A new user gets no welcome: Netflix opens straight to its own sign-in page.

**Setup**:
The short first-run flow on the Screen: a short intro, then one centred glass panel over Home's wallpaper that walks a new household through what makes Couch feel like a TV, starting with pairing a phone (the Mac's keyboard and mouse work too), mirrored on a paired phone. Each step has at most two buttons and one way past it (Not now or Continue); Home closes it for good. Not the **Welcome** question, and not Settings.
_Avoid_: onboarding, wizard, tour (in UI copy)

**Setup step**:
One screen of Setup (Welcome to Couch, which pairs a phone; Start Couch from your phone; You're set…). It shows its words and buttons, changes the same setting Settings does, and knows whether that choice is already made, so a restart resumes at the first step that isn't.

**YouTube**:
The App that presents YouTube's TV experience inside the Screen, looking and behaving like the YouTube app on a smart TV.
_Avoid_: YouTube TV (the paid live-TV product), Leanback

**Library**:
The user's local video folders as presented by the Screen. Every folder is treated the same; there is no movie vs TV-show distinction.
_Avoid_: media, collection, files

**Continue watching**:
Home's row (and the Remote's card for the newest) of unfinished titles, newest first: a mix of Library videos and App titles (Netflix, YouTube) that played for about 30 seconds. Home shows the newest unfinished title from each App and the newest Library video, as many as fit beside the App tiles; an older title shows when the newer one is finished or removed. A Library entry resumes from Couch's saved position; an App entry reopens the App at the title's own address, with the App's badge, and finishes (95% or more) or is removed like any other. For YouTube Couch's own position goes in the address; for Netflix the resume position is controlled by Netflix (for the active profile), so Netflix has Resume only, no From start. App entries keep their picture as a small file Couch saved itself, never the App's address. Menu or a long press on a tile on the Screen, or holding the card on the phone, offers "Remove from Continue watching".
_Avoid_: recents, history, up next

**Now Playing**:
The Remote's playback screen, shown while a video plays in the Library or in a web App (design A, spec 081): Back, Home and **Mute** on top; the artwork (the App's logo on its colour when there is none), which also takes taps and swipes (tap = play/pause, ←/→ = 10 s, ↑/↓ = volume); title, seek bar, play/pause with −10/+10; one row of Subtitles, Audio, Speed and D-pad (the Library lists mpv's tracks, subtitles with Off; each button shows only when the App offers it); a compact volume pill; and a **Prompt** button above the controls when the App offers one. There is no D-pad while playing; the D-pad button opens a full-screen D-pad with a way back. For a web App the position comes from the page's video; seeking and the pickers appear only where that App has a playback adapter, otherwise the bar is read-only.
_Avoid_: player controls, transport

**Mute**:
Couch's own volume set to silence. It remembers the level, silences mpv and every web App, and unmuting restores the level; changing the volume while muted unmutes. It is kept across restarts like the volume. The phone's Mute button sits next to Back and Home.
_Avoid_: silence, volume off

**Interface sounds**:
The soft clicks the Screen plays as you move around Couch's own pages (Home, the Library, Settings, Quick settings, questions): a tick when focus moves, a fuller click on OK, a falling note on Back and a muted bump when a move can't go further. Never while a video plays or a web App is in front, and not while muted; they play at Couch's volume on the chosen Sound output. On by default; turned off on Settings → Sound output. The phone makes no sounds.
_Avoid_: navigation clicks, UI sounds, beeps

**Picture off**:
A black cover over the whole Screen, with a small dim Couch mark, while playback and sound carry on underneath; the phone's Picture off button on Now Playing turns it on, any navigation key turns it off (playback controls like play/pause, volume and seek work without turning it off), and it also ends when playback stops, on Home or when the App changes.
_Avoid_: screen off, blank, sleep

**Quick settings**:
A drawer that slides in from the right of the Screen, over Home, the Library and any App without pausing it, for what you change mid-watch: Sound output, volume and mute, Picture off (only while something plays) and All settings; opened from the phone's Quick settings button or by resting the mouse at the Screen's right edge, closed by Back, Right, the button again, a click outside or 10 s without input.
_Avoid_: side menu, control centre

**Speed**:
How fast the video plays (0.5× to 2× in the Library, the App's own choices in a web App), shown on the phone's Speed button and picked from a list. Every new video starts at 1×; the choice holds for that video even if the page resets it. Netflix's speed is set through its own menu.
_Avoid_: playback rate, tempo

**Prompt**:
A button the App itself offers over the video, shown by the phone above the Now Playing controls only while it is up: **Skip Intro**, **Skip Recap** or **Next Episode** (Netflix today). Pressing it presses the App's own button.
_Avoid_: skip button, overlay button

**Settings**:
The one page for setup chores, opened from the gear on Home: adding phones, Library folders, restarting YouTube, and quitting.
_Avoid_: preferences, options, admin

**About**:
The Settings page, just above Quit Couch, with Couch's version (and build number), **Check for updates**, **Restart to update** (only once an update has downloaded; it asks first, then Couch closes and opens again on the new version) and **Beta updates**. A downloaded update otherwise installs when Couch quits; nothing restarts Couch by itself.
_Avoid_: info, version page

**Beta updates**:
The On/Off row on Settings → About: On, Couch also updates to beta versions (the beta feed); Off, only to released ones. Off is the default. Turning it Off on a beta version never goes back to an older version: Couch waits for a release newer than the beta it runs.
_Avoid_: beta channel, insider, preview (in UI copy)

**Update icon**:
The round arrow-up icon beside the gear on Home (and on the phone's Home), shown only while a downloaded update is ready. It opens Settings → About on Restart to update.
_Avoid_: badge, notification

**Household**:
The people who share one Screen. There are no profiles or logins; any household phone can act as a Remote.
_Avoid_: user, account, profile

**Look**:
Couch's visual style (colours, type, corner shapes, glass, motion and how focus is shown), shared by the Screen, the phone, Quick settings and a Web App's on-screen controls. **Glass** is Couch's Look today; later the household may choose another. It lives in `src/shared/look.ts`. A layout change, such as a Google TV style Home, is not a Look; that is the later Skin work.
_Avoid_: theme, skin
