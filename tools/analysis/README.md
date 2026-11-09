# v1.2.2 evidence guide

The local candidate removes a masked opening note in both assembled chimes; independent review and a phone listen remain necessary.

## DIAGNOSIS

The old first G# slice copied a loud preceding E decay before the G# attack;
standalone :15 also copied the ringing E from :45's base. A G# was physically
present, but the dominant opening sounded E-like in the spectral model.
This is NOT the rejected "more lead-in fixes cold-start context" theory.
The final build retains the original quiet 300ms lead-in.

Actual pre-edit regression: `scheme_test.py` rejected q15 and q45 in both
codecs at change 1's first note; intact q30 and melody passed. Post-edit,
all four quarters in both codecs have the canonical dominant attack order.

AAC first-change G# versus E fingerprint-band energy:

- :15: **−1.30 → +10.64dB**.
- :45 appended phrase: **−1.32 → +4.25dB**; continuous preceding E is retained.

These numbers measure 900±20Hz / 1050±20Hz, not fundamental frequencies.
Bells are inharmonic; plots show measured partials rather than inventing
concert-pitch fundamentals. See [the bell-acoustics explanation](https://www.hibberts.co.uk/building-a-bell-sound/).
`audio_scheme.py` matches fresh full-spectrum source timbres, not just these
bands. It also correctly transcribes all 16 original source notes.

## SCHEME

The proposed eight-note :45 was disproved. Correct scheme:

```
:15 = change 1       G# F# E B
:30 = changes 2+3    E G# F# B | E F# G# E
:45 = changes 4+5+1  G# E F# B | B F# G# E | G# F# E B
:00 = changes 2–5    E G# F# B | E F# G# E | G# E F# B | B F# G# E
```

Sources checked live:

- [Wikipedia Description](https://en.wikipedia.org/wiki/Westminster_Quarters#Description).
- [Daniel Harrison, Society for Music Theory, paragraph 16](https://www.mtosmt.org/issues/mto.00.6.4/mto.00.6.4.harrison.html):
  independent 4/8/12/16-note transcription in C; transposition to E matches.
- [UK Parliament](https://www.parliament.uk/about/living-heritage/building/palace/big-ben/facts-figures/great-bell/): bell pitch names.
- [Classic FM's score](https://www.classicfm.com/discover-music/what-tune-does-big-ben-chime/): independently viewed three-phrase third quarter.

## FIX APPLIED

- Changed G# instance from old 1.398s cut to cleaner **7.598–8.195s** source cut.
- Retained actual recorded F#/E/B cuts, source-measured 0.663/0.647/0.553s
  inter-onset gaps and the legitimate third phrase at :45.
- Built :15 from the clean raw insert, not a q45 base+tail copy.
- Correctly included 12ms first-note pre-roll in every placement.
- Rebuilt only q15/q45 in AAC and Vorbis. New `--assembled-only` prevents
  incidental re-encoding of approved recordings.
- Runtime cache bumped to v1.2.2. No application behavior or strike timing edits.

Frozen SHA-256 checks cover all six q30/melody/bong files and five app/UI
files. Old/new decoded q45 recorded base (0.2–6.3s) is identical in both
codecs: correlation1.0, gain difference0.0dB.

## TESTS

- `node tools/chime_test.js`: **151/151**.
- `node --test tools/app_test.js tools/audio_contract_test.js tools/sw_test.js`: **95/95**.
- `/usr/bin/python3 tools/audio_test.py SOURCE`: **17/17**.
- `/usr/bin/python3 tools/scheme_test.py SOURCE`: **17/17** new, including
  actual decoded count/order, extra/missing/reordered-note traps, silence,
  first-note masking, source rhythm and frozen bytes.
- Real Chrome browser suite: **473/473**, zero errors. Six viewports,
  11 main controls and 15 picker controls per viewport, all operated.
  Native cold media, STOP, automatic chimes, complete chosen12-strike
  playback, offline AAC/Vorbis and zero external app requests covered.
- Real v1.2.1→v1.2.2 upgrade: activation/controller change, previous app
  cache removal, unrelated cache retained,21 release entries, exact new
  hashes for all four updated audio files, offline playback and byte ranges.
- Python compilation, focused Ruff checks and `git diff --check`: clean.
- Read-only production check still saw **v1.2.1**, with its old q15 AAC hash
  `a916829e3376165fd6e61aeb77321b4745b119cdacabdb486de1fa1080884a59`.
  This is proof of unchanged production, NOT a production v1.2.2 test.

## WHAT MARTIN SHOULD NOW HEAR

:15 should clearly start with the higher G# bell, then F#, E, low B.
:45 should still have twelve notes in three groups, with that corrected
G#/F#/E/B group at the end. :30, :00, picker, BONGY, auto and STOP remain
unchanged. Listen to both assembled quarters after the verifier approves
and main deploys; the extra four notes at :45 must NOT be removed.

## CONFIDENCE AND OPEN RISKS

High confidence in the canonical score, identified contamination, correct
source cuts, numerical improvement, frozen bytes and automated gates.
The assertion that this resolves **every part of Martin's subjective
complaint** is still unverified. Recordings retain real residual ringing;
no mathematical isolation or synthesized replacement was attempted.
Headless playback and spectral analysis cannot prove phone-speaker quality.

AGREE with the earlier narrow q15↔q45 waveform-identity finding; DISAGREE
with treating shared provenance as musical correctness. Both derived
assets can share the same defect. The former first-G# assertion checked
only the source, not the actual standalone first-note mix.

## Renders actually inspected

- `source-hour-annotated.png`: four source phrase boundaries and 16 notes.
- `v1.2.1-quarters-side-by-side.png`: before, q15/q45/q30.
- `v1.2.2-quarters-side-by-side.png`: after, same order, plus detailed crops viewed.
- `zoom-source-first-Gs.png`, `zoom-q15-opening.png`: old E-ringing/late-G# mismatch.
- `v1.2.1-measurements.json`, `v1.2.2-measurements.json`, `release-metrics.json`:
  machine-readable observations and exact hashes.

Reproduce current images: `/usr/bin/python3 tools/audio_scheme.py SOURCE --label v1.2.2`.
For full build history and source license, see `../../docs/DEV.md` and `../../LICENSES.md`.
