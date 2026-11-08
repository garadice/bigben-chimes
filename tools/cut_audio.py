#!/usr/bin/env python3
"""Reproduce the licensed audio cuts. Dev-only: Python stdlib + ffmpeg.
Usage: python3 tools/cut_audio.py /path/to/source-1945.wav
The original must match the declared Commons source hash. No downloading.
"""
import hashlib
from pathlib import Path
import re
import subprocess
import sys

SOURCE_SHA256 = '9e6163c1a485b17829eb69cb58b0f187d4d9e690be26a224d7e6568b24d29e70'
CUTS = {
    'melody': (0.25, 21.05),  # all 16 attacks, before the hour strike
    'q30': (0.25, 7.48),     # changes 2+3; next G# attack is at 7.61
    'q45a': (7.50, 14.05),   # changes 4+5; complete tonic minim
    'n-e4': (0.25, 1.31),    # E4 attack ~0.35, not its G# overtone
    'n-gs4': (1.31, 2.18),   # G#4 attack ~1.41
    'n-fs4': (2.17, 2.87),   # F#4 attack ~2.27, before B3 ~2.96
    'n-b3': (2.86, 4.36),    # B3 attack ~2.96, before E4 ~4.41
}

def main():
    source = Path(sys.argv[1])
    if hashlib.sha256(source.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise SystemExit('Refusing an unknown source recording')
    out = Path(__file__).resolve().parents[1] / 'audio'
    for name, (start, end) in CUTS.items():
        duration = round(end-start, 2)
        base = ['ffmpeg', '-hide_banner', '-nostdin', '-ss', str(start), '-t', str(duration), '-i', str(source)]
        probe = subprocess.run(base + ['-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True, check=True)
        match = re.search(r'max_volume:\s*(-?[\d.]+) dB', probe.stderr)
        if match is None:
            raise RuntimeError('ffmpeg did not report a finite source peak')
        peak = float(match[1])
        gain = round(-3.0-peak, 2)  # retain codec/reconstruction headroom
        fades = f'volume={gain}dB,afade=t=in:st=0:d=0.008,afade=t=out:st={duration-0.08:.3f}:d=0.08'
        for extension, codec in [('m4a', ['-c:a','aac','-b:a','160k']), ('ogg',['-c:a','libvorbis','-q:a','6'])]:
            subprocess.run(base + ['-af',fades] + codec + ['-y', str(out / (name+'.'+extension))], capture_output=True, check=True)
        print(f'{name}: {start:.2f}-{end:.2f}s, {duration:.2f}s, gain {gain:+.2f}dB')

if __name__ == '__main__':
    main()
