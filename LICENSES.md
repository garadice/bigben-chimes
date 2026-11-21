# Asset licenses

Every non-code asset in this app, with its source, author, and license.
Rule for this repo: **only separately-licensed open material** — nothing is
taken from any app store product. Public-domain (PD) material needs no
attribution legally, but we credit it anyway; CC BY material requires the
attribution shown here and in the app footer.

All audio assets derive from ONE public-domain source recording (details
below). Contiguous cuts have AAC 160 kbps `.m4a` + Vorbis q6 `.ogg`
encodings and short de-click fades. All shipped assets — including the
quarter assets (`q15`, `q45`) since v1.3.0 — are pure contiguous cuts of
the same recording, built offline at natural levels.
All assets, including the hour strike, target −3 dBFS before encoding.

## Source recording (all `audio/*` files)

- **What:** Big Ben broadcasting live at midnight GMT on 1 January 1945
  (Radio Oranje New Year broadcast): the Westminster Quarters chime and the
  12 midnight strikes of the Great Bell.
- **Source file:** Wikimedia Commons —
  <https://commons.wikimedia.org/wiki/File:Westminster_chimes_(1_January_1945).wav>
- **Author / uploader:** recording: Radio Oranje (1945); Commons file by
  User:Great Brightstar (2024), split from the Netherlands Institute for
  Sound and Vision broadcast recording.
- **License:** Public domain (`{{PD-EU-audio}}` — sound recording, copyright
  expired in the EU).

## The shipped assets — `audio/*`

| file | content | origin |
|---|---|---|
| `melody.*` | **complete recorded 16-note hour chime**, changes 2+3+4+5 and tonic ring-out, 20.80 s | source 0.25–21.05 s |
| `q30.*` | recorded changes 2+3, 8 notes, 7.23 s | source 0.25–7.48 s |
| `q15.*` | **recorded change 4 (G#4 E4 F#4 B3)** — one contiguous source cut, 300 ms quiet natural room-tone lead-in, 4 genuine notes, 3.582 s before codec padding. The canonical change 1 exists nowhere as contiguous PD audio | source 7.598–10.88 s + room tone at ~19.95 s |
| `q45.*` | **recorded changes 4+5** — one contiguous source cut, 8 genuine notes, 6.97 s before codec padding. The canonical 12-note third quarter needs change 1 and is abandoned, not assembled | source 7.50–14.47 s |
| `bong.*` | ONE hour strike + natural decay, 3.43 s | source 41.47–44.90 s |

The broadcast does not contain change 1, so the canonical quarter-past
phrase cannot be cut contiguously from it, and v1.2.0–v1.2.2 assembled
the missing material offline (`tools/cut_audio.py`, numpy/scipy) instead
of stitching per-note slices at runtime: sample-accurate measured rhythm,
tails ringing under the next attack, natural note levels, no per-slice
normalization. v1.2.1 copied :45's ending into :15 under an approval that
Martin later retracted; v1.2.2 replaced the old opening G# slice (it
carried a loud E decay) with the cleaner G# recorded at 7.61 s. Both
assembled quarters were still rejected by ear (round 4, 2026-11-20), so
v1.3.0 abandoned ALL assembled change-1 material and ships only genuine
contiguous cuts: quarter-past = change 4, quarter-to = changes 4+5.
No note synthesis, pitch-shifting, time-stretching or other audio
source is used. `docs/DEV.md` documents the independent score check,
source provenance, decoded spectra, rhythm and measurements.
Those checks do not establish an audible phone-listen approval; Martin's
ear remains the final acceptance. The former runtime note assets (`n-*`)
and `q45a` chunk were removed in v1.2.0.

## Photo — `photo/bigben.jpg`

- **What:** Elizabeth Tower ("Big Ben"), Palace of Westminster, London —
  portrait photo, resized to 1600 px wide, JPEG quality 4 (ffmpeg).
- **Source:** Wikimedia Commons —
  <https://commons.wikimedia.org/wiki/File:Clock_Tower_-_Palace_of_Westminster,_London_-_May_2007.jpg>
- **Author:** Diliff (own work).
- **License:** Creative Commons Attribution 2.5
  (<https://creativecommons.org/licenses/by/2.5/>) — attribution given in this
  file, in `README.md`, and on-screen in the app footer.
- **License note:** Wikimedia Commons' GFDL licensing update later added
  CC BY-SA 3.0 + GFDL to this file's page (the infobox's suggested attribution
  names CC BY-SA 3.0); the original CC BY 2.5 grant persists via that
  migration — the file still carries the `CC-BY-2.5` category and remains
  multi-licensed ("you may select the license of your choice"), so this
  app's CC BY 2.5 use stands.

## Play-screen bells (v1.4.0) — `audio/bell-*.m4a`, `audio/bell-*.ogg`

- **What:** eleven individual bell strikes, B3 C#4 D#4 E4 F#4 G#4 A4 B4
  C#5 D#5 E5 — the ZVONKY play screen's keyboard notes and the four real
  Westminster quarter-bell pitches for the big-bells mode.
- **Source:** individual samples of the Ann & Robert H. Lurie Carillon,
  University of Michigan, Ann Arbor —
  <https://gobluebells.wordpress.com/2016/09/21/lurie-carillon-samples/>
  (60-bell set, chromatic file names `LT_10_10_00`–`59`).
- **Bells cast by:** Royal Eijsbouts (Asten, the Netherlands).
- **Recorded / edited:** October 2016 by Isaac Levine with the assistance of
  Ashton Baker, Rowena Ng, Rachael Park, and Anjana Rajagopal — see the
  sample set's own readme; recorded with the support of the University of
  Michigan Bicentennial grant.
- **License:** Creative Commons Attribution 4.0 International
  (<https://creativecommons.org/licenses/by/4.0/>) — attribution given in this
  file, in `README.md`, and on-screen in the app footer credit block.
- **Processing (this project):** each target note uses the chromatically
  exact bell of the ET-tuned set (measured nominals all within ±7 cents of
  equal temperament, see `docs/DEV.md`); trimmed to the natural useful decay
  (≤5 s), normalized to −3 dBFS peak, 8 ms de-click fade-in and 80 ms
  fade-out, dual-encoded AAC 160 kbps `.m4a` + Vorbis q6 `.ogg`. No pitch
  shifting, no synthesis. Rebuild with `tools/make_bells.py` (dev-only).
- **Great Bell:** NOT re-sourced — the big-bells mode's Great Bell button
  reuses `audio/bong.*` (the genuine 1945 public-domain Great Bell recording
  already shipped for the hour strikes), decoded through the same Web Audio
  engine.
- Attribution on screen: `🔔 Zvony na hranie: Lurie Carillon, Univ. of
  Michigan · CC BY 4.0` + license link, appended to the existing `.credit`
  block.

## Icons — `icons/icon-*.png`

- **What:** a drawn clock face (cream dial, gilt rim, ink hands) generated by
  `tools/gen_icons.py` (Pillow, build-time only).
- **Author / license:** made for this project; covered by the project's MIT
  license. Not third-party material.

## Considered and rejected

- `File:Westminster-and-one-o-clock.ogg` (Wikimedia Commons, tagged PD) —
  a Kieninger mantel-clock **rod gong**, not Big Ben, plus an uploader with
  no machine-readable author/source. Rejected.
- `File:Big Ben recorded in 1890.ogg` (Wikimedia Commons, PD) — genuine
  1890 Edison phonograph cylinder of Big Ben, re-checked on 2026-11-08
  with fresh measurements: ~11 dB usable dynamic range (surface noise
  p10 −19.7 dBFS vs p90 −8.3 dBFS), 94 spurious crackle onsets, unreliable
  pitch content. It cannot sit next to the clean 1945 audio without a
  jarring seam. Not shipped.
- 2026-11-08 Commons re-search for a contiguous change 1 recording
  (searches, category trees, Wikipedia article media lists): every other
  audio candidate is not Big Ben (`WestminsterMetrikx3.ogg` metric
  demonstration, Vierne organ composition, a Gdańsk museum tower clock,
  spoken audio description, MIDI files). This search found no usable new source.
- Synthesised bell tones for the missing phrases — rejected on principle:
  the product is REAL Big Ben. v1.2.0–v1.2.2 assembled the missing change
  from recorded bell material (also rejected by ear); v1.3.0 ships only
  genuine contiguous cuts of change 4 and changes 4+5 (see `docs/DEV.md`).
