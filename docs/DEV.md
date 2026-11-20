# Big Ben Chimes — developer notes

Static HTML/CSS/JS; no build, runtime dependencies, trackers, external fonts,
or runtime API calls. Serve the repository as-is. The service worker caches
all local photo/audio/icon/shell files. Keep `CACHE` different from the last
**published** release. This local candidate is `bigben-chimes-v1.3.0`;
push/deploy belongs to main after the independent verifier gate.

## v1.3.0: round-4 verdict — every assembled asset sounds wrong, so :15/:45 are now pure contiguous cuts

After the v1.2.2 rebuild, Martin's round-4 listen verdict (2026-11-20, the
final acceptance test) was: **:15 and :45 STILL sound wrong; :30, :00,
BONGY and the hour picker are all right.** Four rounds of listening have now
produced one consistent pattern: every CONTIGUOUS cut of the 1945 source
sounds right (:30, :00, and the recorded base of :45), and every
ASSEMBLED/pasted asset sounds wrong (every :15 variant ever shipped, and
:45's appended insert). The assembled change-1 material is therefore
abandoned — all of it, permanently. Do not re-add it.

```
canonical (unreachable)         shipped v1.3.0
:15 = change 1        4 notes   :15 = recorded change 4, cut   4 notes, ends B
:30 = changes 2+3     8 notes   :30 = changes 2+3 (unchanged)  8 notes, ends E
:45 = changes 4+5+1  12 notes   :45 = recorded changes 4+5 cut 8 notes, ends E
:00 = changes 2+3+4+5 16 notes  :00 = changes 2+3+4+5 (unchn.) 16 notes, ends E
```

- `q45` = contiguous recorded changes 4+5 ONLY, source **7.50–14.47 s**,
  8 genuine notes. The appended assembled change-1 insert (asset time
  6.558 s in v1.2.2) is deleted. The canonical 12-note :45 is abandoned:
  its third phrase is change 1, which exists NOWHERE as contiguous PD
  audio (documented negative Commons search, 2026-11-08, in LICENSES.md).
  An 8-note :45 is a deliberate deviation, not a bug to fix.
- `q15` = contiguous recorded change 4 (G#4 E4 F#4 B3 — nearest genuine
  material to canonical change 1, sharing its opening G# and closing B),
  source **7.598–10.88 s**, plus the proven 300 ms room-tone lead-in.
  4 genuine notes. The change-1 score order (G# F# E B) is NOT what :15
  plays in v1.3.0; that material cannot be cut contiguously.
- `q15`'s cut must start at the first hammer's −12 ms pre-roll, NOT at
  7.50 s like `q45`. Measured on the first v1.3.0 build: joining the
  room-tone lead-in into the middle of change 3's decaying tail is a
  sustained ~15 dB ambience step; the independent detector transcribed it
  as a spurious E onset (strength 0.0580 ≈ the real G#'s 0.0578) and the
  coincidence grouping then suppressed the genuine G# — the exact
  "continuous background becomes an abrupt onset" defect class the v1.2.2
  diagnosis removed. With the 12 ms pre-roll and the 3 ms rise-from-zero
  de-click, the pre-attack residual rises as part of the attack complex:
  one onset, first bell G# (measured detector strength 0.0642 > E 0.0613).

## v1.2.2 diagnosis (superseded recipe, still-valid measurements)

Martin retracted the earlier approval of :45: **both :15 and :45 sound wrong**.
The v1.2.1 "cold-start context" explanation is superseded, not confirmed.
Neither provenance correlation nor a smooth waveform proved musical correctness.

### Canonical score — independently re-derived

Live sources checked during this diagnosis:

- [Wikipedia, Westminster Quarters — Description](https://en.wikipedia.org/wiki/Westminster_Quarters#Description)
  explicitly gives the five changes and their quarter-hour assignments.
- [Daniel Harrison, *Tolling Time*, Music Theory Online 6.4 (2000), paragraph 16](https://www.mtosmt.org/issues/mto.00.6.4/mto.00.6.4.harrison.html)
  independently transcribes **4 / 8 / 12 / 16 notes**. Harrison is a university
  carilloneur; his notation is transposed into C. Mapping C/E/D/G to
  E/G#/F#/B gives the same note orders below. This is a sequence check,
  not an absolute-pitch or performance-tempo reference.
- [Classic FM's reproduced score](https://www.classicfm.com/discover-music/what-tune-does-big-ben-chime/)
  was also visually inspected: the third quarter has three four-note phrases.
- [UK Parliament, The Great Bell and the quarter bells](https://www.parliament.uk/about/living-heritage/building/palace/big-ben/facts-figures/great-bell/)
  confirms the four bell names/pitches: G sharp, F sharp, E, B.

```
change 1: G#4 F#4 E4 B3
change 2: E4 G#4 F#4 B3
change 3: E4 F#4 G#4 E4
change 4: G#4 E4 F#4 B3
change 5: B3 F#4 G#4 E4

:15 = 1           = 4 notes, ends B
:30 = 2+3         = 8 notes, ends E
:45 = 4+5+1       = 12 notes, ends B
:00 = 2+3+4+5     = 16 notes, ends E
```

**The proposed eight-note :45 hypothesis is false.** Removing change 1 would
create a different bug. The existing documentation's scheme was correct;
the assembled sound, not the number of phrases, needed fixing.

### What the audio actually showed

`tools/audio_scheme.py` does not import the build recipe. It fits four
source-derived, multi-partial bell spectra to decoded audio, detects their
fresh rises, and groups coincident partials into dominant attacks. It
correctly transcribes the intact source hour and both frozen :30/:00 assets.
The new contract was run **before** the audio edit and failed only :15/:45
in both codecs: change 1's first dominant onset classified as **E**, not G#.
A real G# was present, but the pasted E ringing masked its identity; this is
not a claim that the original G# sample was the wrong physical bell.

Two independent, visible defects explain that result:

1. The old G# cut started at **1.398 s** in the source, while its new G#
   partials rise around **1.44 s**. The cut copied a substantial preceding
   E decay and re-started it as if it were part of a new note. Its E and G#
   fingerprint bands were almost equally strong. The cleaner G# instance
   at **7.61 s** has the E band about **10.8 dB below** G# instead.
2. v1.2.1 cut standalone :15 from the finished :45 tail. That copied a
   SECOND E decay — :45's naturally preceding recorded E — into the
   opening of :15, turning continuous background into an abrupt onset.

Decoded AAC, 40–290 ms after the nominal first change-1 attack:

- Before: :15 G# minus E fingerprint energy **−1.30 dB**; :45 **−1.32 dB**.
- After: :15 **+10.64 dB**; :45 **+4.25 dB**. The legitimate, continuous
  base E remains under :45; it is not supposed to be absent there.
- Vorbis independently gives :15 **−1.34 → +10.86 dB**, :45
  **−1.36 → +4.35 dB**.
- These are measurements at **900±20 / 1050±20 Hz**, NOT fundamentals.
  Full-spectrum onset classification and waveform-source checks accompany
  them; a band-energy ratio alone is not a listening verdict.

The old tests checked the **source** for the first G#, rather than the
first note actually heard in :15, and checked :15↔:45 agreement even though
both contained the same defect. Those contracts could pass a wrong-sounding
shared phrase. The first decoded note is now tested directly.

### Why the plots do not invent 415/370/330/247 Hz fundamentals

Those values are the score's equal-tempered G#4/F#4/E4/B3 reference pitches,
not guaranteed spectral fundamentals of these inharmonic archival bells.
For example, a source E attack has strong ~324 / 417 / 702 / 1051 Hz modes;
the G# has ~387 / 531 / 899 / 1340 Hz modes. Calling the loud ~417 Hz E
partial "G#" would misidentify the bell. No pitch-shifting was applied to
force the source onto a modern concert-pitch grid.

[Bill Hibbert's bell-acoustics explanation](https://www.hibberts.co.uk/building-a-bell-sound/)
distinguishes partials from perceived strike pitch; the latter need not
appear as one frequency in the spectrum. Therefore the PNGs mark nominal
bell identities plus **measured low partials**, not fabricated fundamental
estimates. The untouched source's complete melody anchors those identities.

## Current build: pure contiguous source cuts, no synthesis, no assembly

`tools/cut_audio.py` checks the original WAV hash, then builds the quarters
as plain contiguous source segments (plus the two unchanged ffmpeg cuts):

- `q45`: source **7.50–14.47 s** — recorded changes 4+5, 8 notes, nothing
  else. The final E (12.69 s) rings 1.78 s into genuine hall decay/room
  tone before the end fade.
- `q15`: source **7.598–10.88 s** — recorded change 4 (attacks 7.61 / 8.21 /
  8.90 / 9.49 s), ending 0.02 s before change 5's first attack, with a
  3 ms rise-from-zero de-click at the segment start.
- melody / q30 / bong: unchanged since v1.1.0 (see the hash contracts).

There is no note assembly, overlap-add, looping, pitch-shifting,
stretching, or runtime note scheduling. The assembled-insert machinery
(`Q15_SLICES`, `STEPS`, `CHANGE_GAP`, `build_change1_insert`) is deleted
from the recipe.

- Both quarters share ONE source-to-asset gain (**+9.8845 dB**, peak
  −3 dBFS derived from the complete q45 window), so notes keep their
  natural recorded balance across both assets. No per-note gain.
- `q15` opens with v1.2.1's quiet unity-gain room-tone lead-in (300 ms,
  sin² ramp, from the quietest 1 s ring-out window at ~19.95 s).
- The genuine recorded rhythm is shipped as-is: change 4's real inter-onset
  gaps (≈0.60 / 0.69 / 0.59 s) and the real 1.41 s change-4→5 gap — no
  measured-mean grid is imposed.
- Nominal asset attacks: q15 **0.312 / 0.912 / 1.602 / 2.192 s**;
  q45 **0.110 / 0.710 / 1.400 / 1.990 / 3.400 / 4.100 / 4.700 / 5.190 s**.
- Raw durations: q15 **3.582 s**; q45 **6.97 s**. Codec padding can add a
  small duration difference to the decode.
- Contiguity proof (independent detector, decoded AAC): every measured
  onset maps to a genuine source attack at a single constant offset —
  q15: +7.296…7.320 s (cut origin 7.598 minus the 0.300 lead), q45:
  +7.496…7.504 s (origin 7.50). A pasted insert would need per-note
  offsets; there are none.

### Frozen scope

SHA-256 contracts pin **all six** :30/:00/hour-strike encodings plus
`app.js`, `chime.js`, `styles.css`, `index.html`, `manifest.json` to v1.2.1.
No changes to picker, BONGY, auto-chime behavior, STOP, first-gesture
unlock, layout, or the **4.015 s** strike interval. Only `q15.*` / `q45.*`
audio and the service-worker release identity change at runtime.
Known comment rot, accepted under the freeze: `chime.js`'s header comments
still describe the v1.2.2 assembled recipe (its hash is pinned); the
runtime behavior — which file plays at which quarter — is unchanged.

Use `--assembled-only` (name is historical) to avoid re-encoding frozen
assets (Vorbis container serial numbers can otherwise change even with
identical decoded samples):

```
/usr/bin/python3 tools/cut_audio.py /path/to/source-1945.wav --assembled-only
```

## Evidence and regression gates

Renders under `tools/analysis/` were actually viewed, including detailed
crops, not merely generated:

- `source-hour-annotated.png`: all 16 source attacks, four phrase boundaries,
  measured partials and canonical bell identities.
- `v1.2.1-quarters-side-by-side.png` / `v1.2.2-quarters-side-by-side.png`:
  earlier rounds (assembled recipes, ear-rejected).
- `v1.3.0-quarters-side-by-side.png`: v1.3.0 :15/:45/:30 — 4/8/8 dominant
  attacks, genuine G# E F# B | B F# G# E in the two contiguous cuts.
- `zoom-source-first-Gs.png` / `zoom-q15-opening.png`: old cut/attack mismatch.
- `*-measurements.json` / `release-metrics.json`: onsets, order, rhythm,
  hashes and frozen-file comparisons.

Reproduce the annotated current renders:

```
/usr/bin/python3 tools/audio_scheme.py /path/to/source-1945.wav --label v1.3.0
```

Full gates (development dependencies only):

```
node tools/chime_test.js
node --test tools/app_test.js tools/audio_contract_test.js tools/sw_test.js
/usr/bin/python3 tools/audio_test.py /path/to/source-1945.wav
/usr/bin/python3 tools/scheme_test.py /path/to/source-1945.wav
PLAYWRIGHT_MODULE=/path/to/playwright BBC_EVIDENCE_DIR=/path/to/evidence node tools/browser_test.cjs
```

Verified results for this candidate:

- Timeline/scheduler: **151 passed**.
- App/timeline/cache contracts: **95 passed**.
- Decoded stereo/provenance/gain/tail/strike tests: **14 passed**. The
  assembled-insert contracts are replaced by whole-asset source provenance
  at one gain (q15 and q45), q15≡q45 prefix identity at a constant offset,
  and the q30-smoothness envelope A/B extended to both quarters.
- Independent scheme suite: **17 passed**, including all four quarters in
  both codecs (4/8/8/16 notes), all 16 source notes,
  wrong-order/missing/extra-note detector fixtures, silence, actual
  first-note masking, genuine recorded rhythm and frozen bytes.
- Real Chrome: **473/473 checks** (468 existing + five upgrade checks).
  Six viewports, 11 main controls + 15 picker controls each, every control
  operated; all 12 picker hours; full real 12-strike playback; STOP and cold
  unlock races; all five sound types offline in AAC and Vorbis.
- Real v1.2.2→v1.3.0 cache upgrade waits for controllerchange/activated,
  removes only old app caches, preserves an unrelated cache, checks all
  21 release entries and exact SHA-256 bodies of all four changed audio files,
  then exercises offline playback and cached byte ranges.

These gates run against the **local unpushed candidate**, as required by
the no-deploy instruction. They are not production v1.3.0 verification.
Headless media progress, spectral classification and smooth decays do NOT
prove phone-speaker sound quality. **Martin's phone listen after the verifier
and main's deployment remains the final acceptance.**

## Source recording and historical search

All audio derives from the public-domain Radio Oranje New Year broadcast:
<https://commons.wikimedia.org/wiki/File:Westminster_chimes_(1_January_1945).wav>

Original: 72.395521 s, 48 kHz stereo PCM. SHA-256:
`9e6163c1a485b17829eb69cb58b0f187d4d9e690be26a224d7e6568b24d29e70`.
Original WAV is not shipped; unknown source hashes are refused.

Contiguous assets (all four quarter/hour assets are pure cuts now):

- `melody.*`: source 0.25–21.05 s, 20.80 s, changes 2+3+4+5.
- `q30.*`: source 0.25–7.48 s, 7.23 s, changes 2+3.
- `q45.*`: source 7.50–14.47 s, 6.97 s, changes 4+5 (v1.3.0).
- `q15.*`: source 7.598–10.88 s + room-tone lead-in, 3.58 s, change 4 (v1.3.0).
- `bong.*`: source 41.47–44.90 s, 3.43 s, one hour strike and decay.

Source attack map (approximate hammer/partial onset, not detector peak centre):

```
change 2:  0.35 E   ~1.44 G#  2.27 F#   2.96 B
change 3:  4.41 E    5.10 F# ~5.75 G#   6.33 E
change 4:  7.61 G#   8.21 E   8.90 F#   9.49 B
change 5: 10.90 B   11.60 F# 12.20 G#  12.69 E
```

The earlier Commons search found no **usable contiguous change 1**: the
1945 recording contains changes 2–5 only; the 1890 cylinder was too noisy;
the remaining hits were other instruments, music, speech, or synthesized
MIDI. The detailed prior search ledger remains in `LICENSES.md`. This is a
negative search result, not proof that no recording exists anywhere.

Historical v1.1.0 defects included per-note normalization, hard slice ends,
a mechanical 0.7 s grid and runtime stitching. v1.2.0 fixed those but kept
the contaminated G# instance. v1.2.1 wrongly treated :45 as approved and
copied its ending into :15. v1.2.2 rebuilt the assembled insert with a
cleaner G#; Martin still rejected both assembled quarters (round 4), and
v1.3.0 removed the assembled material entirely.

## Application behavior — unchanged

- :00 button plays only the complete 16-note melody: no hour strikes.
- Picker: choose 1–12, then PLAY gives melody + exactly that many strikes;
  choice is consumed, badge lasts through final decay, STOP clears all.
- BONGY and automatic hour strikes always use `(hour % 12) || 12` from
  the real clock, never a picker choice. Midnight/noon strike twelve times.
- `BONG_GAP = 4.015 s` is the measured mean source strike spacing.
  `STRIKE_PAUSE = 0.6 s` is an explicit asset-end delay, not historical fact.
- Scheduler has 90 s start grace, consumes older missed marks silently,
  restores auto quietly, and never dumps stale events after suspension.
- STOP invalidates pending unlocks/retries and pauses every player;
  a normal cold manual tap preserves its own in-flight gesture priming.
- Auto needs a fresh gesture after browser restart. Android may suspend
  background/locked-screen tabs: foreground use is required for reliability.
- Mute/volume/auto persist when storage permits. Picker choice never persists.
- Service-worker caches are immutable per release; offline range requests
  use decoded body length, not a missing/stale Content-Length header.
