# Big Ben Chimes — developer notes

Static HTML/CSS/JS; no build, dependencies, trackers, external fonts, or
runtime API calls. Serve the repository as-is. The service worker precaches
all local photo/audio/icon/shell files. Keep `CACHE` different from the last
**published** release; this unpublished release is `bigben-chimes-v1.2.0`.

## Files

- `chime.js`: pure timelines, quarter keys, hour counts and scheduler.
  v1.2 adds `melodyOnlyEvents()` (the :00 button) and `hourPickerEvents(n)`
  (the hour picker: melody + exactly N strikes).
- `app.js`: gesture unlock, playback pool, cancellation, state, clock,
  feedback, hour picker overlay and the armed badge.
- `styles.css` / `index.html`: phone-first photo, right-edge controls,
  translucent picker overlay.
- `manifest.json` / `sw.js`: installed shell and offline media byte ranges.
- `LICENSES.md`: source and license for every non-code asset.
- `tools/chime_test.js`: timeline/scheduler logic checks.
- `tools/app_test.js`: real app wiring with deterministic audio/DOM doubles.
- `tools/audio_contract_test.js`: recording/timeline regression contracts.
- `tools/cut_audio.py`: reproducible cuts AND the v1.2 offline phrase
  assembly; Python stdlib + numpy/scipy + ffmpeg, dev-only.
- `tools/audio_test.py`: decoded stereo/provenance/pitch fingerprint checks
  + strike measurement; dev-only numpy/scipy + ffmpeg. No Python is needed
  to run the app.

## v1.2.0 — why :15 and :45 were rebuilt, and how

Martin's phone listen on v1.1.0: :30 and :00 "sound right", :15 and :45
"don't". The v1.1.0 evidence explains it: :30 (`q30`) and :00 (`melody`) are
**contiguous chunks of the 1945 recording**, while :15 was four
individually-stitched note slices played by JS timers and :45 appended the
same stitching to a contiguous chunk. Measured defects of the v1.1.0 build:

1. **Per-slice normalization**: every slice peaked at −1.1 dBFS, flattening
   the performance's natural note-loudness relationships.
2. **Decay cliffs between notes**: −5…−10 dB envelope jumps per 20 ms at
   slice ends where the source has continuous tails.
3. **Mechanical grid**: notes at 0/0.7/1.4/2.1 s against the performance's
   own measured steps (0.66/0.65/0.55 s per position, see below).
4. **No tail overlap**: in the recording each tail rings ~0.7 s *under* the
   next attack; separate `<audio>` elements started by timers cannot
   reproduce that, and hard-started notes add timing jitter.

### Path (a) — new source search (2026-11-08, negative)

Re-searched Wikimedia Commons for a PD/CC0 Big Ben recording containing
change 1 (G#4 F#4 E4 B3) as a contiguous performance. Method: Commons search
API (`Big Ben chimes/quarter/bell sound/bong/strikes/audio/New Year/1934/
BBC broadcast/...`), the `Category:Big Ben` / `Westminster Quarters` /
`Westminster chimes` / `Clock Tower, Palace of Westminster` category trees
(no audio members, no subcategories), and the media lists of the English
Wikipedia articles *Big Ben* and *Westminster Quarters*. Every audio hit was
checked with license metadata:

- `Westminster chimes (1 January 1945).wav` — the current source; contains
  changes 2–5 only (0.35–12.76 s) then hour strikes. No change 1.
- `Big Ben recorded in 1890.ogg` (PD, Edison cylinder) — re-verified with
  fresh measurements: ~11 dB usable dynamic range (surface noise p10 −19.7
  vs p90 −8.3 dBFS), 94 spurious crackle onsets, pitch analysis collapses
  onto resonance/noise (219.7 Hz repeated). Cannot sit next to the clean
  1945 audio without a jarring seam. Rejected.
- `Westminster-and-one-o-clock.ogg` — a Kieninger mantel-clock **rod gong**,
  not Big Ben (and unchanged weak provenance). Rejected.
- `WestminsterMetrikx3.ogg` (CC BY-SA 3.0) — musicological metric
  demonstration, not a Big Ben performance. Rejected.
- `Carillon de Westminster Vierne MFlierl.ogg` — Vierne's organ composition.
  Not Big Ben. Rejected.
- `WWS GampFCopetowerclock.ogg` — a 1911 G&F Cope museum tower clock
  mechanism (Gdańsk), not Big Ben's bells. Rejected.
- `Gary O'Donoghue on the Elizabeth Tower.ogg` — spoken audio description.
  Rejected.
- MIDI files (`Westminster Quarters.mid`, `Westminster-chimes.mid`) —
  synthesized; rejected on principle (the product is REAL Big Ben).

**Verdict: no usable recording exists → path (b).**

### Path (b) — the offline rebuild (shipped)

`tools/cut_audio.py` now assembles the two missing-sounding quarters
OFFLINE at the sample level, all from the same 1945 recording:

- `q15` (3.44 s) = change 1 (G#4 F#4 E4 B3) assembled from the recording's
  **change 2 performance** (0.35 E, 1.41 G#, 2.27 F#, 2.96 B — the only
  G#/F#/E/B material the source contains; one 4-second span also means one
  speed-drift state, so pitches stay mutually consistent).
- `q45` (10.05 s) = the recorded changes 4+5 (former `q45a` window,
  7.50–14.05 s, extended so the tonic minim keeps ringing) + `q15` joined
  at the **measured change-to-change attack gap** (1.45/1.28/1.41 s →
  mean 1.38 s), i.e. the E minim rings underneath change 1's first attack
  exactly like the real transitions in the source.

Engineering decisions (all evidenced, documented in the code):

- **Rhythm**: per-position mean steps of the steady changes 3–5:
  0.663 / 0.647 / 0.553 s (change 2's 1.06 s first step is the
  broadcast-start rubato outlier). No mechanical grid.
- **Overlap-add**: each slice keeps its full natural decay so the tail
  rings under the next attack — the defining texture of the source.
- **Cuts at zero crossings** just before the next attack; interior cuts
  are masked by the following attack (temporal + spectral masking, the
  same effect that makes `q30` sound seamless).
- **Phrase-initial G# keeps only 12 ms of lead-in** (zero-crossing +
  3 ms fade): a longer lead-in would leak the E-bell tail (≈ −9 dB after
  phrase gain) into the start of :15.
- **Phrase-final B3** is the one exposed cut (its tail is still at
  −22.6 dBFS after 1.4 s — bells decay slowly). It dissolves into the
  hall's real room tone (quietest 1 s window of the ring-out region,
  19.95 s, −38.6 dBFS) via a 450 ms equal-power crossfade: the decay
  continues naturally into the noise floor instead of cliffing.
- **One phrase-level gain** to −3 dBFS peak; no per-slice normalization,
  so natural note-loudness relationships survive. Fades: 8 ms in,
  80 ms out (same convention as every shipped asset).

### Verification numbers (2026-11-08)

`tools/audio_test.py` (12 cases, all green) adds to the v1.1.0 contracts:

- Provenance: assembled assets correlate ≥ 0.98 with the recipe built from
  the hash-verified source (q15 0.9822 m4a; q45 base segment 0.9996).
- Pitch classes per note via the DEV.md fingerprint bands (E≈1051,
  G#≈900, F#≈1197, B≈1393 Hz NEW band energy): all 4 notes of the joined
  q45 phrase and 3 of 4 q15 notes fingerprint correctly in-asset; the
  phrase-initial G# is verified at source level (its in-asset reference
  window would be the asset start's near-silence) and tied to the asset by
  provenance. HPS interval chain F#→E→B measures −2.17/−5.08 st (nominal
  −2/−5). Absolute HPS pitch is NOT used: inharmonic partials make it
  unreliable (v1.1.0 already learned this lesson).
- Seam continuity: q45 join envelope step 0.5 dB (< 3 dB allowed).
- A/B vs the "sounds right" `q30`: worst inter-attack envelope move
  q15 2.5 dB/20 ms vs q30 3.0 dB/20 ms — the assembled phrase is at least
  as smooth as the contiguous reference (contract-tested).

The per-note slice assets (`n-*`) and the `q45a` chunk are retired; the
service worker no longer precaches them.

## Shipped cuts (same source for AAC and Vorbis)

| base name | source window | content |
|---|---|---|
| `melody` | 0.25–21.05 | intact 16-note hour chime and natural tonic decay, 20.80 s |
| `q30` | 0.25–7.48 | intact changes 2+3, 8 notes, 7.23 s |
| `q15` | assembled (see above) | change 1 at the measured rhythm, 3.44 s |
| `q45` | 7.50–14.47 + q15 | intact changes 4+5 with minim + joined change 1, 10.05 s |
| `bong` | 41.47–44.90 | one hour strike and decay, 3.43 s |

## Source recording and slicing map

The only audio source is the public-domain Radio Oranje New Year broadcast:
<https://commons.wikimedia.org/wiki/File:Westminster_chimes_(1_January_1945).wav>

Original WAV: 72.395521 s, 48 kHz stereo PCM; SHA-256:
`9e6163c1a485b17829eb69cb58b0f187d4d9e690be26a224d7e6568b24d29e70`.
The original is not shipped. `tools/cut_audio.py` refuses a different source.

The canonical pattern is documented at:
<https://en.wikipedia.org/wiki/Westminster_Quarters#Description>

```
1: G# F# E B        2: E G# F# B        3: E F# G# E
4: G# E F# B        5: B F# G# E
:15 = 1     :30 = 2+3     :45 = 4+5+1     :00 = 2+3+4+5
```

Independent source attack map (seconds, approximate 10–50 ms resolution;
cross-verified in the v1.1.0 review round — :30, built on these positions,
is Martin's "sounds right" reference):

```
change 2:  0.35 E   1.41 G#   2.27 F#   2.96 B
change 3:  4.41 E   5.10 F#   5.75 G#   6.33 E
change 4:  7.61 G#  8.21 E    8.90 F#   9.49 B
change 5: 10.90 B  11.60 F#  12.20 G#  12.69 E
```

The E / G# / F# / B timbres have distinctive new-energy bands near
1051 / 900 / 1197 / 1393 Hz respectively. These are fingerprints, not their
fundamental pitches. Broadband clicks and slow beating can create false
onset peaks; verify the accompanying fresh partials, not peak count alone.
Do NOT identify a bell from its loudest single spectral peak or from
harmonic-product spectra: the archive has inharmonic partials, reverberation
and speed fluctuation.

## v1.2.0 behavior changes

- **:00 button = melody ONLY.** The 🕛 square plays the 16-note recording
  and schedules zero strikes (`melodyOnlyEvents`). No hidden bong path.
- **Hour picker (new).** The 🔔 square (or a tap on the clock) opens a
  translucent overlay — the photo stays visible behind — with big numbers
  1–12. Pick a number, press the big ▶ button: the full 16-note melody
  plays, then the Great Bell strikes the CHOSEN number of times at the
  measured 4.015 s spacing. Nothing else in between. While playing, a
  badge next to the clock shows the chosen hour (`🔔 N`); it clears when
  the timeline ends, on STOP, or when any other button takes over.
- **Picker state decision**: the choice is CONSUMED on play and the
  overlay closes; the next open starts with nothing selected (a stale
  number must never strike unexpectedly). The choice is not persisted
  across sessions. Number buttons clamp to 1–12; nothing but the picker
  reads the chosen hour (BONGY and auto-chime always use the real clock).
- **Unchanged**: BONGY (current real hour, `(hour % 12) || 12`), KAŽDÚ
  ŠTVRŤ auto-chime (per-quarter sequences — now with the FIXED sounds —
  and melody + hour bongs on the real hour), boot re-arm persistence,
  no mid-mark blast, STOP kills everything instantly (including picker
  playback) and closes the overlay, first-tap unlock, mute/volume.

## Measured hour-strike spacing: 4.015 s

Independent reproducible measurement is `tools/audio_test.py`:
mono = average of the source channels; resample 48→8 kHz; STFT 1024-sample
Hann windows, 80-sample hop; sum positive spectral-magnitude differences;
find prominent peaks ≥3 seconds apart in the 20–69 s strike region.

```
onsets: 21.24 25.44 29.49 33.53 37.52 41.57 45.61 49.62 53.54 57.43 61.41 65.40
11 gaps: 4.20 4.05 4.04 3.99 4.05 4.04 4.01 3.92 3.89 3.98 3.99
mean: 4.014545454545455 s -> BONG_GAP = 4.015 s
```

`STRIKE_PAUSE = 0.6` is the explicit extra asset-end→strike delay, not an
asserted historical fact. `BONGY` uses the same measured spacing. Bong
count = `(hour % 12) || 12`, so midnight/noon both strike twelve times.

## Auto-quarter and browser limits

- Scheduler ticks every second, keying the actual local quarter mark.
- Grace is 90 s; older missed marks are consumed silently, never queued.
- Enabling during grace may sound the current mark; boot restoration uses
  `setEnabledQuiet` to consume the current mark without a relaunch blast.
- Saved ON state re-arms on boot; audio still needs a fresh real gesture
  after a browser restart. Browser autoplay policy cannot be persisted.
- Automatic marks before that first gesture are consumed quietly; enabling
  auto as the first interaction waits for priming before it schedules audio.
- Timers are not an alarm-clock guarantee: Android can suspend background
  tabs or locked-screen PWAs. Keep the app open/foreground for reliable use.
- STOP invalidates timers, pending unlock continuations and pending retries,
  pauses every player, removes count/sway/armed badge, and closes the
  picker overlay. It does not disable auto mode.
- A timeline event more than 1 s late cancels that old tune, so resuming a
  suspended tab cannot dump queued strikes/notes together. This is distinct
  from the scheduler's 90 s grace for starting a new quarter sequence.
- Mute/volume/auto persist in local storage; unavailable storage is
  non-fatal. The picker choice deliberately does NOT persist.
- Reduced motion disables tower animation; vibration is optional/unsupported
  on some devices. Neither unsupported vibration nor private storage breaks audio.

## Verification and deployment

```
node tools/chime_test.js
node --test tools/app_test.js tools/audio_contract_test.js tools/sw_test.js
/usr/bin/python3 tools/audio_test.py /path/to/source-1945.wav
python3 tools/cut_audio.py /path/to/source-1945.wav  # only to regenerate
```

Real-browser sweep: every button incl. the picker (open, pick, play, count,
STOP); three real touch slider drags; boot with saved auto ON, all four auto
marks, stale marks, STOP/races, mute persistence, portrait 390x844 and
375px, landscape and desktop; picker overlay translucent (photo visible)
and landscape-safe. Verify offline reload, real decoded audio currentTime
progression, cache upgrade v1.1.0 → v1.2.0 and no external requests. A
headless play spy is NOT an audible listening test — Martin's phone listen
is the final acceptance.

Main owns push/deploy after independent verifier approval. This review
makes local commits only. Re-verify the published app after any future deploy.
