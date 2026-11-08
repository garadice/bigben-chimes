# Big Ben Chimes — developer notes

Static HTML/CSS/JS; no build, dependencies, trackers, external fonts, or
runtime API calls. Serve the repository as-is. The service worker precaches
all local photo/audio/icon/shell files. Keep `CACHE` different from the last
**published** release; this unpublished release remains `bigben-chimes-v1.1.0`.

## Files

- `chime.js`: pure timelines, quarter keys, hour counts and scheduler.
- `app.js`: gesture unlock, playback pool, cancellation, state, clock and feedback.
- `styles.css` / `index.html`: phone-first photo and right-edge controls.
- `manifest.json` / `sw.js`: installed shell and offline media byte ranges.
- `LICENSES.md`: source and license for every non-code asset.
- `tools/chime_test.js`: timeline/scheduler logic checks.
- `tools/app_test.js`: real app wiring with deterministic audio/DOM doubles.
- `tools/audio_contract_test.js`: recording/timeline regression contracts.
- `tools/cut_audio.py`: reproducible cuts, Python stdlib + ffmpeg, dev-only.
- `tools/audio_test.py`: decoded stereo/cut/provenance + strike measurement;
  dev-only numpy/scipy + ffmpeg. No Python is required to run the app.

## Source recording and independently corrected slicing map

The only audio source is the public-domain Radio Oranje New Year broadcast:
<https://commons.wikimedia.org/wiki/File:Westminster_chimes_(1_January_1945).wav>

Original WAV: 72.395521 s, 48 kHz stereo PCM; SHA-256:
`9e6163c1a485b17829eb69cb58b0f187d4d9e690be26a224d7e6568b24d29e70`.
The original is not shipped. `tools/cut_audio.py` refuses a different source.

**Review correction:** the source contains **all 16 notes**, not just changes
4+5. The initial v1.1 map mistook strong bell overtones and sustained tails
for new attacks. Its G# slice actually began after the final E attack; its
E slice was a fading tail; its F# slice also included the next B attack.
Matching filenames/dominant concert-pitch bins did not verify those assets.

The canonical pattern is documented at:
<https://en.wikipedia.org/wiki/Westminster_Quarters#Description>

```
1: G# F# E B        2: E G# F# B        3: E F# G# E
4: G# E F# B        5: B F# G# E
:15 = 1     :30 = 2+3     :45 = 4+5+1     :00 = 2+3+4+5
```

Nominal quarter bells: G#4/F#4/E4/B3; the archive has inharmonic partials,
reverberation and speed fluctuation. Do NOT identify a bell from its loudest
single spectral peak. For example the E bell has a strong ~417 Hz partial
alongside ~323 and ~1051 Hz; labelling it G# because of 417 Hz is wrong.
Track NEW band energy above the previous tail and compare the whole pattern.

Independent source attack map (seconds, approximate 10–50 ms resolution):

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

### Shipped cuts (same source for AAC and Vorbis)

| base name | source window | content |
|---|---|---|
| `melody` | 0.25–21.05 | intact 16-note hour chime and natural tonic decay, 20.80 s |
| `q30` | 0.25–7.48 | intact changes 2+3, 8 notes, 7.23 s |
| `q45a` | 7.50–14.05 | intact changes 4+5, 8 notes and complete tonic minim, 6.55 s |
| `n-e4` | 0.25–1.31 | first E attack + decay, 1.06 s |
| `n-gs4` | 1.31–2.18 | first G# attack + decay, 0.87 s |
| `n-fs4` | 2.17–2.87 | first F# attack, stops before B attack, 0.70 s |
| `n-b3` | 2.86–4.36 | first B attack + long minim, 1.50 s |
| `bong` | 41.47–44.90 | one hour strike and decay, 3.43 s; reviewed asset retained |

Cuts begin before the attack, not inside the ringing note. Encodings:
AAC 160 kbps `.m4a`, Vorbis q6 `.ogg`. New cuts target −3 dBFS before
encoding with 8 ms fade-in / 80 ms fade-out; retained bong targets −1.5 dBFS.
Decoded stereo peak/finite-sample checks and waveform correlation against
these exact source windows are in `tools/audio_test.py` (16 asset cases).
Do not use FFmpeg's default stereo-to-mono conversion to assess clipping:
its downmix gain can exceed either original channel; test native stereo.

`:15` assembles four genuine slices at 0 / 0.7 / 1.4 / 2.1 seconds. The
recording's ordinary hammer steps are roughly 0.6–0.8 s, with ~1.4 s minims,
not the initial map's 1.5/1.7 s. `:30` is one intact eight-note recording.
`:45` appends that same four-note change 1 at 6.55 s, after the recorded
change 5 minim. `:00` plays the complete original hour recording ONCE,
then the appropriate number of strikes. No added duplicate changes 2+3.

The assembled slices necessarily retain some historic room reverb/hiss;
this is not a clean modern multi-track recording or a synthesized bell.

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

This replaces the initial review input's 3.99 s mean: its first onset was
listed as 21.50 while the attack begins at about 21.24, and some other
onsets differed by 10 ms. The difference is small acoustically but the
constant must follow the documented, reproducible measurement, not a
claimed precision. Individual strikes vary; 4.015 is a chosen constant
average on this **1945 recording**, not a modern mechanism specification.

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
- Timers are not an alarm-clock guarantee: Android can suspend background
  tabs or locked-screen PWAs. Keep the app open/foreground for reliable use.
- STOP invalidates timers, pending unlock continuations and pending retries,
  pauses every player, and removes count/sway. It does not disable auto mode.
- A timeline event more than 1 s late cancels that old tune, so resuming a
  suspended tab cannot dump queued strikes/notes together. This is distinct
  from the scheduler's 90 s grace for starting a new quarter sequence.
- Mute/volume/auto persist in local storage; unavailable storage is non-fatal.
- Reduced motion disables tower animation; vibration is optional/unsupported
  on some devices. Neither unsupported vibration nor private storage breaks audio.

## Verification and deployment

```
node tools/chime_test.js
node --test tools/app_test.js tools/audio_contract_test.js
/usr/bin/python3 tools/audio_test.py /path/to/source-1945.wav
python3 tools/cut_audio.py /path/to/source-1945.wav  # only to regenerate
```

Real-browser sweep: every button; three real touch slider drags; boot with
saved auto ON, all four auto marks, stale marks, STOP/races, mute persistence,
portrait 390x844 and 375px, landscape and desktop. Verify offline reload,
real decoded audio currentTime progression, cache upgrade and no external
requests. A headless play spy is NOT an audible listening test.

Main owns push/deploy after independent verifier approval. This review
makes local commits only. Re-verify the published app after any future deploy.
