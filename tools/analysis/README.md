# v1.3.0 evidence guide

The local candidate replaces both assembled quarters with pure contiguous
cuts of the 1945 recording; independent review and Martin's phone listen
remain necessary (round 5 = final acceptance).

## DIAGNOSIS (round-4 listen verdict, 2026-11-20)

Martin's ear rejected every ASSEMBLED change-1 asset across four rounds
(every :15 variant, :45's appended insert), while every CONTIGUOUS cut
sounds right (:30, :00, :45's recorded base). v1.3.0 therefore abandons
ALL assembled change-1 material — permanently.

Actual pre-edit regression on the v1.2.2 candidate: `scheme_test.py`
rejected q15 and q45 in both codecs at change 1's first note; intact q30
and melody passed. Post-rebuild, all four quarters in both codecs match
their v1.3.0 expected dominant attack order (4/8/8/16).

First v1.3.0 build measurement (documented so it is not reintroduced):
cutting q15 from source 7.50 s (q45's window start) joins the room-tone
lead-in into the middle of change 3's decaying tail — a sustained ~15 dB
ambience step the independent detector transcribed as a spurious E onset
(strength 0.0580 ≈ the real G#'s 0.0578), suppressing the genuine G# via
coincidence grouping: detected [E, E, F#, B]. With the established
12 ms pre-roll (source 7.598 s) and the 3 ms rise-from-zero de-click, the
residual rises as part of the attack complex: [G#, E, F#, B], first-bell
strength 0.0642.

Per-note fingerprint-band identity is NOT used for q45's notes: measured
on this build, change 5's B (asset 3.40 s) re-strikes the same bell
1.41 s after change 4's B, whose decay saturates the B band — the honest-
level limitation the v1.2.2 diagnosis already documented. Note identity is
asserted by whole-asset source provenance at one gain plus the independent
full-spectrum detector in `scheme_test.py`.

## SHIPPED SCHEME (v1.3.0)

```
:15 = change 4 (cut)    G# E F# B            4 notes
:30 = changes 2+3       E G# F# B | E F# G# E   8 notes
:45 = changes 4+5 (cut) G# E F# B | B F# G# E   8 notes
:00 = changes 2–5       E G# F# B | E F# G# E | G# E F# B | B F# G# E   16 notes
```

The canonical score itself is unchanged (Wikipedia Description; Harrison,
MTO 6.4 2000 ¶16, 4/8/12/16 notes; UK Parliament bell names; Classic FM
score). What changed is what can be shipped: canonical :15 and the 12-note
:45 need change 1, which exists NOWHERE as contiguous PD audio (documented
negative Commons search, 2026-11-08, in LICENSES.md). Shipping change 4
(≈ change 1's opening G# and closing B) and changes 4+5 is a deliberate
deviation, not a bug.

## FIX APPLIED

- q45 = contiguous source **7.50–14.47 s** (changes 4+5, 8 notes); the
  appended change-1 insert is deleted.
- q15 = contiguous source **7.598–10.88 s** (change 4, 4 notes) + the
  proven 300 ms room-tone lead-in; ends 0.02 s before change 5's attack.
- One shared source-to-asset gain (**+9.8845 dB**, peak −3 dBFS from the
  q45 window); genuine recorded rhythm, no imposed grid.
- Rebuilt only q15/q45 in AAC and Vorbis; `--assembled-only` keeps the
  frozen recordings untouched (name is historical).
- Runtime cache bumped to v1.3.0. No application behavior or strike
  timing edits.

Frozen SHA-256 checks cover all six q30/melody/bong files and five app/UI
files. Contiguity proof: every measured onset in q15/q45 maps to a genuine
source attack at a single constant offset (q15 +7.296…7.320 s, q45
+7.496…7.504 s, jitter ≤ 24 ms); decoded q15's note region matches q45's
same region (r ≥ 0.995, gain Δ ≤ 0.08 dB) at the 0.098 s cut offset in
both codecs.

## TESTS

- `node tools/chime_test.js`: **151/151**.
- `node --test tools/app_test.js tools/audio_contract_test.js tools/sw_test.js`: **95/95**.
- `/usr/bin/python3 tools/audio_test.py SOURCE`: **14/14** (provenance,
  gain, prefix identity, lead-in, envelopes, strike interval).
- `/usr/bin/python3 tools/scheme_test.py SOURCE`: **17/17**, including
  decoded count/order (4/8/8/16), extra/missing/reordered-note traps,
  silence, first-note masking, genuine rhythm and frozen bytes.
- Real Chrome browser suite: **473/473**, zero errors. Six viewports,
  11 main controls and 15 picker controls per viewport, all operated.
  Native cold media, STOP, automatic chimes, complete chosen 12-strike
  playback, offline AAC/Vorbis and zero external app requests covered.
- Real v1.2.2→v1.3.0 upgrade: activation/controller change, previous app
  cache removal, unrelated cache retained, 21 release entries, exact new
  hashes for all four updated audio files, offline playback and byte ranges.
- Python compilation and `git diff --check`: clean.

## WHAT MARTIN SHOULD NOW HEAR (round 5)

:15 should be the real recorded change 4 — higher G# bell, E, F#, low B,
four notes, in the genuine recorded rhythm.
:45 should be eight real notes in two groups: G# E F# B | B F# G# E,
ending on the tonic E. :30, :00, picker, BONGY, auto and STOP remain
unchanged. If :15/:45 still sound wrong in round 5, the remaining suspect
is the material itself (the change-4-for-:15 substitution), not assembly
artifacts — there are none left to remove.

## CONFIDENCE AND OPEN RISKS

High confidence in contiguity (constant-offset onset mapping, prefix
identity, whole-asset provenance), frozen bytes and automated gates.
Two genuine risks remain unverifiable by machine: (1) whether Martin's
ear accepts the change-4 substitution for :15 and the 8-note :45 — the
point of the whole change; (2) q15's ending stops 1.39 s after its final
attack (the source's next event is change 5's B) — the same ending
discipline as q30, but shorter decay than v1.2.2's room-tone dissolve.
Headless playback and spectral analysis cannot prove phone-speaker quality.

## Renders actually inspected

- `source-hour-annotated.png`: four source phrase boundaries and 16 notes.
- `v1.2.1/1.2.2-quarters-side-by-side.png`: earlier assembled rounds.
- `v1.3.0-quarters-side-by-side.png`: v1.3.0 :15/:45/:30, 4/8/8 attacks.
- `zoom-source-first-Gs.png`, `zoom-q15-opening.png`: old mismatch crops.
- `v1.2.1/1.2.2/1.3.0-measurements.json`, `release-metrics.json`:
  machine-readable observations and exact hashes.

Reproduce current images: `/usr/bin/python3 tools/audio_scheme.py SOURCE --label v1.3.0`.
For full build history and source license, see `../../docs/DEV.md` and `../../LICENSES.md`.
