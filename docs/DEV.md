# Big Ben Chimes — developer notes

Static HTML/CSS/JS; no build, runtime dependencies, trackers, external fonts,
or runtime API calls. Serve the repository as-is. The service worker caches
all local photo/audio/icon/shell files. Keep `CACHE` different from the last
**published** release. This local candidate is `bigben-chimes-v1.2.2`;
push/deploy belongs to main after the independent verifier gate.

## v1.2.2 diagnosis: correct scheme, contaminated first note

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

## Current build: real source-note cuts, no synthesis

`tools/cut_audio.py` checks the original WAV hash, then builds one raw
G#/F#/E/B insert from individual recorded notes:

- G#: **7.598–8.195 s** nominal slice, attack 7.61 s — cleaner instance.
- F#: **2.170–2.945 s**, attack 2.27 s; its source predecessor is G#.
- E: **0.250–1.395 s**, attack 0.35 s — the clean initial source bell.
- B: **2.940–4.390 s**, attack 2.96 s — longest available final-B decay.

Cut ends move to nearby zero crossings; 80 ms outgoing fades act on BOTH
stereo channels. These are real recorded attacks with residual room sound,
not mathematically isolated tones. There is no note synthesis, looping,
pitch-shifting, stretching, or runtime note scheduling.

- Source-measured inter-onset gaps remain **0.663 / 0.647 / 0.553 s**,
  from per-position means of changes 3–5; the source opening is slower.
- Pre-roll is accounted for consistently: :15's nominal attacks are
  **0.312 / 0.975 / 1.622 / 2.175 s**, not a first note offset from the grid.
- `q15` = 300 ms natural room-tone lead-in + clean insert. It is **not**
  cut from q45. The lead-in retains v1.2.1's quiet unity-gain ambience;
  changing lead-in/gain is not the proposed musical cure.
- `q45` = contiguous recorded changes 4+5, source **7.50–14.47 s**, plus
  that same insert. The insert starts at **6.558 s** asset time, so its
  first attack is **1.380 s** after the preceding E attack.
- Notes in both assets share one source-to-asset gain (**+7.8742 dB**),
  derived from the complete q45 mix, target peak −3 dBFS. No per-note gain.
- Final B dissolves into the same real room-tone window over 450 ms, then
  the room window continues into a 150 ms ending with an 80 ms fade.
- :15 raw duration **3.753854 s**; :45 **10.061854 s**. Codec padding can
  add a small duration difference to the decode.

The recorded first two phrases of :45 remain sample-identical after decode
in their unmodified interior: old/new correlation **1.0**, gain delta
**0.0 dB**, both codecs, tested 0.2–6.3 s. Only its appended change is rebuilt.

### Frozen scope

SHA-256 contracts pin **all six** :30/:00/hour-strike encodings plus
`app.js`, `chime.js`, `styles.css`, `index.html`, `manifest.json` to v1.2.1.
No changes to picker, BONGY, auto-chime behavior, STOP, first-gesture unlock,
layout, or the **4.015 s** strike interval. Only `q15.*` / `q45.*` audio and
the service-worker release identity change at runtime.

Use `--assembled-only` to avoid re-encoding frozen assets (Vorbis container
serial numbers can otherwise change even with identical decoded samples):

```
/usr/bin/python3 tools/cut_audio.py /path/to/source-1945.wav --assembled-only
```

## Evidence and regression gates

Renders under `tools/analysis/` were actually viewed, including detailed
crops, not merely generated:

- `source-hour-annotated.png`: all 16 source attacks, four phrase boundaries,
  measured partials and canonical bell identities.
- `v1.2.1-quarters-side-by-side.png`: before :15/:45/:30.
- `v1.2.2-quarters-side-by-side.png`: after :15/:45/:30, 4/12/8 dominant
  attacks, correct G#/F#/E/B in both assembled change-1 passages.
- `zoom-source-first-Gs.png` / `zoom-q15-opening.png`: old cut/attack mismatch.
- `*-measurements.json` / `release-metrics.json`: onsets, order, rhythm,
  before/after energy, hashes and frozen-file comparisons.

Reproduce the annotated current renders:

```
/usr/bin/python3 tools/audio_scheme.py /path/to/source-1945.wav --label v1.2.2
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
- Decoded stereo/provenance/gain/tail/strike tests: **17 passed**. Obsolete
  :15=q45-tail identity is replaced by independent first-G# provenance and
  shared F#/E/B identity. Existing quality thresholds are retained.
- Independent scheme suite: **17 passed**, including all four quarters in
  both codecs, all 16 source notes, wrong-order/missing/extra-note detector
  fixtures, silence, actual first-note masking, source rhythm and frozen bytes.
- Real Chrome: **473/473 checks** (468 existing + five upgrade checks).
  Six viewports, 11 main controls + 15 picker controls each, every control
  operated; all 12 picker hours; full real 12-strike playback; STOP and cold
  unlock races; all five sound types offline in AAC and Vorbis.
- Real v1.2.1→v1.2.2 cache upgrade waits for controllerchange/activated,
  removes only old app caches, preserves an unrelated cache, checks all
  21 release entries and exact SHA-256 bodies of all four changed audio files,
  then exercises offline playback and cached byte ranges.

These gates run against the **local unpushed candidate**, as required by
the no-deploy instruction. They are not production v1.2.2 verification.
Headless media progress, spectral classification and smooth decays do NOT
prove phone-speaker sound quality. **Martin's phone listen after the verifier
and main's deployment remains the final acceptance.**

## Source recording and historical search

All audio derives from the public-domain Radio Oranje New Year broadcast:
<https://commons.wikimedia.org/wiki/File:Westminster_chimes_(1_January_1945).wav>

Original: 72.395521 s, 48 kHz stereo PCM. SHA-256:
`9e6163c1a485b17829eb69cb58b0f187d4d9e690be26a224d7e6568b24d29e70`.
Original WAV is not shipped; unknown source hashes are refused.

Contiguous assets remain:

- `melody.*`: source 0.25–21.05 s, 20.80 s, changes 2+3+4+5.
- `q30.*`: source 0.25–7.48 s, 7.23 s, changes 2+3.
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
copied its ending into :15. Both are superseded by the measured v1.2.2 fix.

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
