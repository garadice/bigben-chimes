#!/usr/bin/env python3
"""Build the v1.4.0 ZVONKY bell assets from the licensed Lurie Carillon samples.

Dev-only: /usr/bin/python3 + numpy/scipy + ffmpeg. No runtime dependencies.
Usage: tools/make_bells.py /path/to/Lurie_Carillon_samples_CC/

Source (license-gated): Ann & Robert H. Lurie Carillon individual bell
samples, University of Michigan, CC BY 4.0 — bells cast by Royal Eijsbouts,
recorded October 2016 by Isaac Levine et al.
https://gobluebells.wordpress.com/2016/09/21/lurie-carillon-samples/
The Great Bell is NOT re-sourced: it reuses audio/bong.* (the genuine 1945
PD recording already shipped for the hour strikes).

Convention identical to cut_audio.py: peak-normalized to -3 dBFS, 8 ms
de-click fade-in, 80 ms fade-out, trimmed to the natural useful decay,
dual-encoded AAC 160 kbps .m4a + Vorbis q6 .ogg. No pitch shifting: the
carillon is chromatic and ET-tuned, so each target note uses the bell whose
measured nominal pitch is nearest (<=3 cents, measured 2026-11-21, see
docs/DEV.md).
"""
import argparse
import hashlib
import subprocess
import sys
from pathlib import Path

# Dev-only scientific packages live in /usr/bin/python3 (same as cut_audio.py).
# pyright: reportMissingImports=false
import numpy as np

SR = 44100
TARGET_DBFS = -3.0
FADE_IN_S, FADE_OUT_S = 0.008, 0.080
DECAY_FLOOR_DB = -30.0     # the trim point: level fell this far below its peak
MIN_S, MAX_S = 2.5, 5.0    # natural useful decay window per repo convention

# note id -> (Lurie sample stem, measured nominal Hz, cents vs equal
# temperament). The nominals were measured from the attack on 2026-11-21
# (strongest strike peak near the expected ET pitch; where that partial is
# weak in the attack window the same role one octave up/down identifies it):
#   b3 -2.2 · cs4 -3.8 · ds4 -5.1 · e4 -1.3 · fs4 +6.8 · gs4 -3.3
#   a4 -1.0 · b4 +0.1 · cs5 +1.4 · ds5 -2.3 · e5 +1.4  (all within 7 cents)
# No retuning: every target note uses the chromatically exact bell.
BELLS = {
    'b3':  ('LT_10_10_03', 246.6),
    'cs4': ('LT_10_10_05', 276.6),
    'ds4': ('LT_10_10_07', 310.2),
    'e4':  ('LT_10_10_08', 329.4),
    'fs4': ('LT_10_10_10', 371.4),
    'gs4': ('LT_10_10_12', 414.5),
    'a4':  ('LT_10_10_13', 439.7),
    'b4':  ('LT_10_10_15', 493.9),
    'cs5': ('LT_10_10_17', 554.8),
    'ds5': ('LT_10_10_19', 621.4),
    'e5':  ('LT_10_10_20', 659.8),
}


def decode(path):
    out = subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-i', str(path),
                          '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype='<f4').astype(np.float64).copy()


def natural_decay_seconds(x):
    """Where the ring drops below the -30 dB floor of its own peak RMS."""
    win = int(0.05 * SR)
    n = len(x) // win
    if n == 0:
        return len(x) / SR
    rms = np.sqrt(np.mean(x[:n * win].reshape(n, win) ** 2, axis=1))
    peak = float(rms.max())
    if peak <= 0:
        return MIN_S
    floor = peak * 10 ** (DECAY_FLOOR_DB / 20)
    above = np.nonzero(rms > floor)[0]
    last = int(above[-1]) if len(above) else 0
    seconds = last * win / SR + 0.15
    return min(MAX_S, max(MIN_S, seconds))


def finalize(buf):
    buf = buf.copy()
    gain = (10 ** (TARGET_DBFS / 20)) / float(np.abs(buf).max())
    buf *= gain
    nf_in, nf_out = int(FADE_IN_S * SR), int(FADE_OUT_S * SR)
    buf[:nf_in] *= np.linspace(0, 1, nf_in)
    buf[-nf_out:] *= np.linspace(1, 0, nf_out)
    return buf


def encode(wav_path, out_base):
    for ext, codec in [('m4a', ['-c:a', 'aac', '-b:a', '160k']),
                       ('ogg', ['-c:a', 'libvorbis', '-q:a', '6'])]:
        subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-y', '-i', str(wav_path)]
                       + codec + [str(out_base.with_suffix('.' + ext))], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('samples', type=Path, help='extracted Lurie_Carillon_samples_CC dir')
    args = parser.parse_args()
    if not (args.samples / 'readme.txt').exists():
        sys.exit('Not the Lurie sample directory (readme.txt missing)')
    out = Path(__file__).resolve().parents[1] / 'audio'

    for note, (stem, nominal) in BELLS.items():
        src = args.samples / (stem + '.wav')
        if not src.exists():
            sys.exit(f'missing sample {src}')
        x = decode(src)
        seconds = natural_decay_seconds(x)
        cut = finalize(x[:int(seconds * SR)])
        wav = out / (f'bell-{note}.wav')
        subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-y',
                        '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-',
                        str(wav)], input=cut.astype(np.float32).tobytes(), check=True)
        encode(wav, out / f'bell-{note}')
        wav.unlink()
        rows = []
        for ext in ('m4a', 'ogg'):
            data = (out / f'bell-{note}.{ext}').read_bytes()
            rows.append(f'{ext}={len(data)}B sha256={hashlib.sha256(data).hexdigest()[:12]}')
        print(f'bell-{note}: {stem} nominal {nominal:.1f}Hz '
              f'({seconds:.2f}s trim, peak {TARGET_DBFS:.0f} dBFS), ' + ' '.join(rows))


if __name__ == '__main__':
    main()
