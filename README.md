# Big Ben Chimes 🔔

A tiny ad-free app for one specific 6-year-old: the whole Big Ben tower on
screen and a right-edge column of big emoji squares that make it really chime. The
sounds are genuine recordings of Big Ben from 1 January 1945 (public
domain), the photo is openly licensed.

## The buttons (right edge, nothing to read — clock faces show when it rings)

- 🕒 **quarter past** — the real 4-note quarter chime
- 🕕 **half past** — the 8-note half-hour chime
- 🕘 **quarter to** — the 8-note three-quarter chime
- 🕛 **full hour** — the complete 16-note change, melody only (no bongs)
- 🔔 **pick an hour** — big numbers 1–12: choose one, press the big play
  button, and Big Ben rings the whole melody followed by exactly that many
  bongs, spaced like the real bell (~4 seconds apart). The photo stays
  visible behind the picker, and a small badge shows the chosen hour while
  it rings
- 🛎️ **bongs only** — just the hour strikes for the current hour
- 🎹 **ZVONKY play screen** — a fullscreen play room with two modes: five huge
  bells (the real quarter bells B3, E4, F#, G# plus one giant Great Bell,
  multi-touch so two thumbs make chords) and a bell keyboard of 11 diatonic
  bells (numbers 1–11, B3…E5 in E major so everything he plays fits the
  chime world). Rotate the phone to landscape and the keyboard becomes one
  long row of tall keys. Real recorded carillon samples (Lurie Carillon,
  CC BY 4.0); the Great Bell is the genuine 1945 recording. Nothing to
  read: icons, colors and numbers only
- ⏰ **auto** — chimes by itself every quarter hour while the app is open,
  with the real behavior: quarter melodies at :15/:30/:45, and the melody
  plus the hour bongs on the hour (at 15:00 you hear 3 bongs, at midnight
  12). The dot turns green when it's on
- ✋ **stop** — one big red square that silences everything instantly

While the hour strikes, the tower sways with each bong, the phone buzzes,
and a huge number flashes on screen so a kid can count the bongs.

A small clock shows the time top-left (tap it to open the hour picker);
volume lives bottom-left; the whole photo stays visible.

A tiny badge beside the photo credit shows the exact release (e.g. v1.4.0), and when a
new version has been installed in the background a big 🔔 NOVÁ VERZIA banner
appears once nothing is ringing — tap it to load the update (or leave the app
quiet for a minute); ringing is never interrupted.

## Install on Android (Chrome)

1. Open the site URL in Chrome.
2. Menu (⋮) → **Pridať na domovskú obrazovku / Add to Home screen**.
3. Launch it from the home screen — it runs full-screen and works offline
   after the first load (all sounds and the photo are cached on the device).

First tap unlocks audio (Android rule). After restarting the browser, tap
once again to allow automatic sound; the saved auto setting still re-arms
without a surprise chime on launch. Keep the app in the foreground: Android
may pause background tabs or locked-screen apps, so this is not an alarm clock.

## Credits

- Photo: [Diliff / Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Clock_Tower_-_Palace_of_Westminster,_London_-_May_2007.jpg), CC BY 2.5.
- Sounds: Big Ben via the Radio Oranje New Year broadcast, 1 Jan 1945
  ([Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Westminster_chimes_(1_January_1945).wav)),
  public domain. Quarter-past is one contiguous cut of the recording's
  fourth change and quarter-to of its fourth and fifth changes (the
  broadcast does not contain the first change), documented in
  [LICENSES.md](LICENSES.md) and [docs/DEV.md](docs/DEV.md).
- ZVONKY play-screen bells: [Lurie Carillon individual samples](https://gobluebells.wordpress.com/2016/09/21/lurie-carillon-samples/),
  Ann & Robert H. Lurie Carillon, University of Michigan (bells cast by
  Royal Eijsbouts, recorded October 2016 by Isaac Levine et al.), CC BY 4.0.

Code: MIT — © 2026 Martin Mogis. No ads, no tracking, no network calls.
