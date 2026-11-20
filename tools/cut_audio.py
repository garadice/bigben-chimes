#!/usr/bin/env python3
"""Reproduce licensed source cuts and the contiguous quarter assets.

Dev-only: /usr/bin/python3 + numpy/scipy + ffmpeg. No runtime dependencies.
Usage: tools/cut_audio.py source-1945.wav [--assembled-only]
The source hash is mandatory. No downloading, synthesis or pitch shifting.

v1.3.0: four listen rounds proved every ASSEMBLED change-1 asset sounds
wrong to Martin's ear (:15 in every variant; :45's appended insert), while
every CONTIGUOUS cut sounds right (:30, :00). All assembled change-1
material is therefore abandoned — do not re-add it. q45 is now the
contiguous recorded changes 4+5 (source 7.50-14.47 s, 8 notes). q15 is the
contiguous change 4 (source 7.50-10.88 s, 4 notes: G# E F# B) with the
proven 300 ms room-tone lead-in, so :15 genuinely IS the first half of
:45. Canonical change 1 exists nowhere as contiguous PD audio (documented
negative Commons search, 2026-11-08); the canonical 12-note :45 needs that
missing material and is abandoned, not faked. See docs/DEV.md.
"""
import argparse
import hashlib
import re
import subprocess

from pathlib import Path

# Dev-only scientific packages live in /usr/bin/python3 (same as audio_test.py).
# pyright: reportMissingImports=false
import numpy as np
from scipy.io import wavfile as wavio

SOURCE_SHA256 = '9e6163c1a485b17829eb69cb58b0f187d4d9e690be26a224d7e6568b24d29e70'
SR = 48000

# Contiguous cuts (ffmpeg), unchanged from v1.1.0
CUTS = {
    'melody': (0.25, 21.05),  # all 16 attacks, before the hour strike
    'q30': (0.25, 7.48),      # changes 2+3; next G# attack is at 7.61
    'bong': (41.47, 44.90),   # one hour strike + natural decay
}

# Source attack map (docs/DEV.md; cross-verified in the v1.1.0 review round;
# :30, built on these positions, is the "sounds right" reference).
ATTACKS = {
    'E': [0.35, 4.41, 6.33, 8.21, 12.69],
    'G#': [1.41, 5.75, 7.61, 12.20],
    'F#': [2.27, 5.10, 8.90, 11.60],
    'B': [2.96, 9.49, 10.90],
}

# Recorded change 4: G# E F# B — the nearest genuine material to the
# canonical :15 (change 1), sharing its opening G# and closing B.
CHANGE4 = (ATTACKS['G#'][2], ATTACKS['E'][3], ATTACKS['F#'][2], ATTACKS['B'][1])
# Recorded changes 4+5: B F# G# E after change 4.
CHANGE5 = (ATTACKS['B'][2], ATTACKS['F#'][3], ATTACKS['G#'][3], ATTACKS['E'][4])

# v1.3.0 quarter cuts: pure contiguous source segments. Both end 0.02 s
# before the next recorded attack, the established final-tail discipline.
#   q45 = the task-mandated window 7.50-14.47 s: the final E (12.69) rings
#         1.78 s into genuine hall decay/room tone before the end fade.
#   q15 = change 4 ONLY, starting 12 ms before the first hammer (the
#         established slice pre-roll). It must NOT start at 7.50 like q45:
#         measured on the first build, joining the room-tone lead-in into
#         the middle of change 3's decaying tail is a sustained ~15 dB
#         ambience step that the independent detector transcribes as a
#         spurious E onset (strength ~= the real G#'s) and that suppresses
#         the G# via coincidence grouping — the exact "continuous background
#         becomes an abrupt onset" defect class the v1.2.2 diagnosis
#         removed. With the 12 ms pre-roll the residual rises from zero as
#         part of the attack complex, one onset, first bell G#.
Q15_CUT = (ATTACKS['G#'][2] - 0.012, ATTACKS['B'][2] - 0.02)
Q45_CUT = (7.50, 14.47)

TARGET_DBFS = -3.0
FADE_IN_S, FADE_OUT_S = 0.008, 0.080
# Natural room-tone lead-in for the standalone phrase, without q45's base.
LEAD_IN_S = 0.300


def decode_stereo(path):
    out = subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-i', str(path),
                          '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype='<f4').reshape(-1, 2).astype(np.float64).copy()


def quietest_room_window(mono, lo_s=18.5, hi_s=21.0, win_s=1.0):
    """Quietest 1 s of the ring-out region (real room tone of the same hall)."""
    win = int(win_s * SR)
    best_a, best_lvl = int(lo_s * SR), float('inf')
    for a in range(int(lo_s * SR), int(hi_s * SR) - win, int(0.05 * SR)):
        lvl = float(np.sqrt(np.mean(mono[a:a + win] ** 2)))
        if lvl < best_lvl:
            best_a, best_lvl = a, lvl
    return best_a / SR


def build_quarters(src, mono):
    """v1.3.0: pure contiguous cuts — no assembly, no overlap-add.

    One source-to-asset gain derived from the complete q45 window peak
    (both assets share it, so notes keep their natural recorded balance);
    the lead-in rides at the recording's own room level. Endings are the
    genuine recorded decays: q45's final E rings into real hall room tone,
    q15's final B fades 1.39 s after its attack, the proven q30 discipline.
    """
    a, b = int(Q45_CUT[0] * SR), int(Q45_CUT[1] * SR)
    q45_raw = src[a:b].copy()
    gain = (10 ** (TARGET_DBFS / 20)) / float(np.abs(q45_raw).max())
    q45 = finalize(q45_raw, gain=gain)

    lead_n = int(LEAD_IN_S * SR)
    room_a = int(quietest_room_window(mono) * SR)
    # sin^2 ramp: settles onto full ambience with zero slope at the join.
    ramp = np.sin(np.linspace(0.0, np.pi / 2, lead_n))[:, None] ** 2
    # Preserve the quiet, unity-gain room-tone lead-in (v1.2.1 discipline).
    lead = src[room_a:room_a + lead_n] * ramp / gain
    a15, b15 = int(Q15_CUT[0] * SR), int(Q15_CUT[1] * SR)
    cut = src[a15:b15].copy()
    # De-click the segment start: rise from zero over 3 ms (slice
    # discipline), so the join reads as the first note's own onset instead
    # of a background step (see the Q15_CUT comment for the measured proof).
    nf = int(0.003 * SR)
    cut[:nf] *= np.linspace(0, 1, nf)[:, None]
    q15 = finalize(np.concatenate([lead, cut]), gain=gain)
    return q15, q45, gain


def finalize(buf, gain=None):
    buf = buf.copy()
    if gain is None:
        gain = (10 ** (TARGET_DBFS / 20)) / float(np.abs(buf).max())
    buf *= gain
    nf_in, nf_out = int(FADE_IN_S * SR), int(FADE_OUT_S * SR)
    buf[:nf_in] *= np.linspace(0, 1, nf_in)[:, None]
    buf[-nf_out:] *= np.linspace(1, 0, nf_out)[:, None]
    return buf


def encode(wav_path, out_base):
    for ext, codec in [('m4a', ['-c:a', 'aac', '-b:a', '160k']),
                       ('ogg', ['-c:a', 'libvorbis', '-q:a', '6'])]:
        subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-y', '-i', str(wav_path)] + codec +
                       [str(out_base.with_suffix('.' + ext))], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--assembled-only', action='store_true',
                        help='Keep melody/q30/bong bytes frozen; rebuild the '
                             'contiguous q15/q45 only (name is historical)')
    args = parser.parse_args()
    source = args.source
    if hashlib.sha256(source.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise SystemExit('Refusing an unknown source recording')
    out = Path(__file__).resolve().parents[1] / 'audio'
    out.mkdir(exist_ok=True)

    for name, (start, end) in ({} if args.assembled_only else CUTS).items():
        duration = round(end - start, 2)
        base = ['ffmpeg', '-hide_banner', '-nostdin', '-ss', str(start), '-t', str(duration),
                '-i', str(source)]
        probe = subprocess.run(base + ['-af', 'volumedetect', '-f', 'null', '-'],
                               capture_output=True, text=True, check=True)
        match = re.search(r'max_volume:\s*(-?[\d.]+) dB', probe.stderr)
        if match is None:
            raise RuntimeError('ffmpeg did not report a finite source peak')
        peak = float(match[1])
        gain = round(TARGET_DBFS - peak, 2)
        fades = (f'volume={gain}dB,afade=t=in:st=0:d=0.008,'
                 f'afade=t=out:st={duration - 0.08:.3f}:d=0.08')
        for extension, codec in [('m4a', ['-c:a', 'aac', '-b:a', '160k']),
                                 ('ogg', ['-c:a', 'libvorbis', '-q:a', '6'])]:
            subprocess.run(base + ['-af', fades] + codec +
                           ['-y', str(out / (name + '.' + extension))],
                           capture_output=True, check=True)
        print(f'{name}: {start:.2f}-{end:.2f}s, {duration:.2f}s, gain {gain:+.2f}dB')

    src = decode_stereo(source)
    mono = src.mean(axis=1)
    q15, q45, gain = build_quarters(src, mono)
    wavio.write(str(out / 'q15.wav'), SR, q15.astype(np.float32))
    wavio.write(str(out / 'q45.wav'), SR, q45.astype(np.float32))
    encode(out / 'q15.wav', out / 'q15')
    encode(out / 'q45.wav', out / 'q45')
    (out / 'q15.wav').unlink()
    (out / 'q45.wav').unlink()
    db = 20 * float(np.log10(gain))
    print(f'q45: {len(q45)/SR:.2f}s = contiguous source {Q45_CUT[0]:.2f}-{Q45_CUT[1]:.2f}s '
          f'(changes 4+5, 8 notes), shared gain {db:+.4f} dB, peak {TARGET_DBFS:.0f} dBFS')
    print(f'q15: {len(q15)/SR:.2f}s = {LEAD_IN_S:.2f}s room-tone lead-in + contiguous source '
          f'{Q15_CUT[0]:.2f}-{Q15_CUT[1]:.2f}s (change 4, 4 notes)')
    print('asset attacks q15 (G#/E/F#/B): ' +
          '/'.join(f'{LEAD_IN_S + t - Q15_CUT[0]:.2f}' for t in CHANGE4) + ' s')
    print('asset attacks q45 (G#E F#B | BF#G#E): ' +
          '/'.join(f'{t - Q45_CUT[0]:.2f}' for t in CHANGE4 + CHANGE5) + ' s')
    print('Removed assets (delete from audio/ if still present): q45a.*, n-gs4.*, '
          'n-fs4.*, n-e4.*, n-b3.*')


if __name__ == '__main__':
    main()
