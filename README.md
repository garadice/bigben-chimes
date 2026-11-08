# Big Ben Chimes 🔔

A tiny ad-free app for one specific 6-year-old: the whole Big Ben tower on
screen and a right-edge column of big emoji squares that make it really chime. The
sounds are genuine recordings of Big Ben from 1 January 1945 (public
domain), the photo is openly licensed.

## The buttons (right edge, nothing to read — clock faces show when it rings)

- 🕒 **quarter past** — the real 4-note quarter chime
- 🕕 **half past** — the 8-note half-hour chime
- 🕘 **quarter to** — the 12-note three-quarter chime
- 🕛 **full hour** — the complete 16-note change, melody only (no bongs)
- 🔔 **pick an hour** — big numbers 1–12: choose one, press the big play
  button, and Big Ben rings the whole melody followed by exactly that many
  bongs, spaced like the real bell (~4 seconds apart). The photo stays
  visible behind the picker, and a small badge shows the chosen hour while
  it rings
- 🛎️ **bongs only** — just the hour strikes for the current hour
- ⏰ **auto** — chimes by itself every quarter hour while the app is open,
  with the real behavior: quarter melodies at :15/:30/:45, and the melody
  plus the hour bongs on the hour (at 15:00 you hear 3 bongs, at midnight
  12). The dot turns green when it's on
- ✋ **stop** — one big red square that silences everything instantly

While the hour strikes, the tower sways with each bong, the phone buzzes,
and a huge number flashes on screen so a kid can count the bongs.

A small clock shows the time top-left (tap it to open the hour picker);
volume lives bottom-left; the whole photo stays visible.

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
  public domain. The quarter-past and quarter-to phrases are assembled from
  the same recording (the broadcast does not contain the first change),
  documented in [LICENSES.md](LICENSES.md) and [docs/DEV.md](docs/DEV.md).

Code: MIT — © 2026 Martin Mogis. No ads, no tracking, no network calls.
