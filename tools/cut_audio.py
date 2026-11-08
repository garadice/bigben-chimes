#!/usr/bin/env python3
"""Reproduce the licensed audio cuts and the assembled quarter phrases.
Dev-only: Python stdlib + numpy/scipy + ffmpeg. No Python is needed to run
the app itself.
Usage: python3 tools/cut_audio.py /path/to/source-1945.wav
The original must match the declared Commons source hash. No downloading.

v1.2.0 rebuild (card t_a03d86fe, path b — see docs/DEV.md for the evidence):
  q15 = change 1 (G#4 F#4 E4 B3) assembled OFFLINE from the recording's
        change 2 performance (all four bells in one short source span),
        tails ringing under the next attack at the performance's own measured
        rhythm, phrase-final tail dissolving into real room tone.
  q45 = recorded changes 4+5 (former q45a content) + that same change 1,
        joined at the measured change-to-change attack gap with the tonic
        minim ringing underneath, exactly like the real transitions.
The former per-note slices (audio/n-*) are no longer shipped: runtime
stitching by JS timers could not overlap tails or match levels, and the
v1.1.0 build audibly flattened note levels, clipped decays and used a
mechanical 0.7 s grid. A phone-listen comparison against the contiguous
q30 drove this rebuild (docs/DEV.md has the numbers).
"""
import hashlib
import re
import subprocess
import sys
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

# Change 1 rhythm: per-position mean steps of the steady changes 3-5
# (change 2's first step 1.06 s is the broadcast-start rubato outlier).
STEPS = (0.663, 0.647, 0.553)
# Change-to-change attack gaps 1.45 / 1.28 / 1.41 -> mean
CHANGE_GAP = 1.380

# Slice windows into the source, derived from the attack map:
#   pre-roll keeps room tone or the PREVIOUS note's tail (correct note);
#   the phrase-initial G# takes 12 ms only, so no foreign tail bleeds in.
Q15_SLICES = [
    # (source start, source end, pre-roll before its attack)
    (ATTACKS['G#'][0] - 0.012, ATTACKS['F#'][0] - 0.015, 0.012),  # G# rings until F#
    (ATTACKS['F#'][0] - 0.100, ATTACKS['B'][0] - 0.015, 0.100),   # F# rings until B
    (ATTACKS['E'][0] - 0.100, ATTACKS['G#'][0] - 0.015, 0.100),   # E ring-out is room tone
    (ATTACKS['B'][0] - 0.020, ATTACKS['E'][1] - 0.020, 0.020),    # B3 tail until change 3
]
# q45 base: recorded changes 4+5; runs 0.40 s past the joined attack so the
# tonic minim keeps ringing underneath change 1 (source 7.50 -> 14.47).
Q45_BASE = (7.50, ATTACKS['E'][4] + CHANGE_GAP + 0.40)

TARGET_DBFS = -3.0
FADE_IN_S, FADE_OUT_S = 0.008, 0.080
ROOM_DISSOLVE_S = 0.45


def decode_stereo(path):
    out = subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-i', str(path),
                          '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype='<f4').reshape(-1, 2).astype(np.float64).copy()


def zc_time(mono, want_t, span=0.012):
    """Nearest zero-crossing time of the channel-mean near want_t (de-click)."""
    want_idx = int(want_t * SR)
    lo = max(0, want_idx - int(span * SR))
    hi = min(len(mono) - 1, want_idx + int(span * SR))
    sgn = np.sign(mono[lo:hi])
    cross = np.where(np.diff(sgn) != 0)[0]
    if len(cross):
        return (lo + int(cross[np.argmin(np.abs(cross - (want_idx - lo)))])) / SR
    return want_t


def slice_seg(src, start, end, pre_fade_ms=3):
    a = int(start * SR); b = int(end * SR)
    seg = src[a:b].copy()
    nf = int(pre_fade_ms / 1000 * SR)
    seg[:nf] *= np.linspace(0, 1, nf)[:, None]
    # A channel-mean zero crossing need not be zero in EITHER channel.
    # End each outgoing layer smoothly while the next bell rings underneath.
    tail = min(len(seg), int(0.080 * SR))
    seg[-tail:] *= np.linspace(1, 0, tail)[:, None]
    return seg


def quietest_room_window(mono, lo_s=18.5, hi_s=21.0, win_s=1.0):
    """Quietest 1 s of the ring-out region (real room tone of the same hall)."""
    win = int(win_s * SR)
    best_a, best_lvl = int(lo_s * SR), float('inf')
    for a in range(int(lo_s * SR), int(hi_s * SR) - win, int(0.05 * SR)):
        lvl = float(np.sqrt(np.mean(mono[a:a + win] ** 2)))
        if lvl < best_lvl:
            best_a, best_lvl = a, lvl
    return best_a / SR


def build_q15(src, mono, normalize=True):
    """Change 1 (G# F# E B) at the measured rhythm, overlap-added."""
    g_at, f_at = ATTACKS['G#'][0], ATTACKS['F#'][0]
    e_at, b_at = ATTACKS['E'][0], ATTACKS['B'][0]
    cuts = [zc_time(mono, end) for _s, end, _p in Q15_SLICES]
    segs = [slice_seg(src, start, cut) for (start, _e, _p), cut in zip(Q15_SLICES, cuts)]
    positions = (0.0, STEPS[0], STEPS[0] + STEPS[1], STEPS[0] + STEPS[1] + STEPS[2])
    place_at = (positions[0],
                positions[1] - Q15_SLICES[1][2],
                positions[2] - Q15_SLICES[2][2],
                positions[3] - Q15_SLICES[3][2])
    total = int((positions[3] + max(len(s) for s in segs) / SR + 1.0) * SR)
    buf = np.zeros((total, 2))
    for seg, pos in zip(segs, place_at):
        i = int(pos * SR)
        buf[i:i + len(seg)] += seg
    # phrase-final B3 tail: dissolve into the hall's real room tone
    b_end_idx = int(place_at[3] * SR) + len(segs[3])
    room_a = int(quietest_room_window(mono) * SR)
    n = int(ROOM_DISSOLVE_S * SR)
    t = np.linspace(0, np.pi / 2, n)[:, None]
    room = src[room_a:room_a + n]
    buf[b_end_idx - n:b_end_idx] = buf[b_end_idx - n:b_end_idx] * np.cos(t) + room * np.sin(t)
    # Continue that SAME room window into the final fade, not a zero-filled
    # pad. Otherwise the 80 ms file-end fade operates on silence, leaving
    # an exposed -31 dBFS discontinuity at b_end_idx.
    room_tail = int(0.15 * SR)
    buf[b_end_idx:b_end_idx + room_tail] = src[room_a + n:room_a + n + room_tail]
    buf = buf[:b_end_idx + room_tail]
    # The raw version is also inserted into q45: taper before its own end,
    # rather than relying on q45's later file-end fade over extra padding.
    nf = int(FADE_OUT_S * SR)
    buf[-nf:] *= np.linspace(1, 0, nf)[:, None]
    # Keep the insert at source level until the WHOLE q45 phrase is mixed.
    return (finalize(buf) if normalize else buf), positions


def build_q45(src, mono, q15_buf):
    """Recorded changes 4+5 + assembled change 1 at the measured change gap."""
    last_attack_pos = ATTACKS['E'][4] - Q45_BASE[0]          # asset-time of the final E attack
    g_at45 = last_attack_pos + CHANGE_GAP                    # joined G# attack (measured gap)
    q15_lead = Q15_SLICES[0][2]                              # G# pre-roll inside q15
    q15_at = g_at45 - q15_lead
    total = int((q15_at + len(q15_buf) / SR + 0.05) * SR)
    buf = np.zeros((total, 2))
    base = slice_seg(src, Q45_BASE[0], Q45_BASE[1], pre_fade_ms=0)
    buf[:len(base)] += base
    i0 = int(q15_at * SR)
    buf[i0:i0 + len(q15_buf)] += q15_buf[:min(len(q15_buf), total - i0)]
    return finalize(buf), q15_at


def finalize(buf):
    buf = buf.copy()
    buf *= (10 ** (TARGET_DBFS / 20)) / float(np.abs(buf).max())
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
    source = Path(sys.argv[1])
    if hashlib.sha256(source.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise SystemExit('Refusing an unknown source recording')
    out = Path(__file__).resolve().parents[1] / 'audio'
    out.mkdir(exist_ok=True)

    for name, (start, end) in CUTS.items():
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
    q15_raw, positions = build_q15(src, mono, normalize=False)
    q45, q15_at = build_q45(src, mono, q15_raw)
    q15 = finalize(q15_raw)
    wavio.write(str(out / 'q15.wav'), SR, q15.astype(np.float32))
    wavio.write(str(out / 'q45.wav'), SR, q45.astype(np.float32))
    encode(out / 'q15.wav', out / 'q15')
    encode(out / 'q45.wav', out / 'q45')
    (out / 'q15.wav').unlink()
    (out / 'q45.wav').unlink()
    print(f'q15: {len(q15)/SR:.2f}s, attacks at {"/".join(f"{p:.2f}" for p in positions)}')
    print(f'q45: {len(q45)/SR:.2f}s, change 1 joined at {q15_at:.2f}s '
          f'(attack-to-attack {CHANGE_GAP:.2f}s)')
    print('Removed assets (delete from audio/ if still present): q45a.*, n-gs4.*, '
          'n-fs4.*, n-e4.*, n-b3.*')


if __name__ == '__main__':
    main()
