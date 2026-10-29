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
The one question Couch asks the first time Netflix opens on WebKit, before its page loads: copy the sign-in from Couch, sign in on Netflix, or keep using Chromium; Back means sign in on Netflix, and it is never asked again.

**YouTube**:
The App that presents YouTube's TV experience inside the Screen, looking and behaving like the YouTube app on a smart TV.
_Avoid_: YouTube TV (the paid live-TV product), Leanback

**Library**:
The user's local video folders as presented by the Screen. Every folder is treated the same; there is no movie vs TV-show distinction.
_Avoid_: media, collection, files

**Continue watching**:
The single card on Home for the most recent unfinished Library video. Pressing it resumes from the saved position.
_Avoid_: recents, history, up next

**Now Playing**:
The Remote's playback screen, shown while a video plays in the Library or in a web App (design A, spec 081): Back, Home and **Mute** on top; the artwork (the App's logo on its colour when there is none), which also takes taps and swipes (tap = play/pause, ←/→ = 10 s, ↑/↓ = volume); title, seek bar, play/pause with −10/+10; one row of Subtitles, Audio, Speed and D-pad (the Library lists mpv's tracks, subtitles with Off; each button shows only when the App offers it); a compact volume pill; and a **Prompt** button above the controls when the App offers one. There is no D-pad while playing; the D-pad button opens a full-screen D-pad with a way back. For a web App the position comes from the page's video; seeking and the pickers appear only where that App has a playback adapter, otherwise the bar is read-only.
_Avoid_: player controls, transport

**Mute**:
Couch's own volume set to silence. It remembers the level, silences mpv and every web App, and unmuting restores the level; changing the volume while muted unmutes. It is kept across restarts like the volume. The phone's Mute button sits next to Back and Home.
_Avoid_: silence, volume off

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

**Household**:
The people who share one Screen. There are no profiles or logins; any household phone can act as a Remote.
_Avoid_: user, account, profile
