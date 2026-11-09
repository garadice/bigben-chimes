#!/usr/bin/env python3
"""Independent Westminster score/decoded-audio analysis (development only).

No import from cut_audio: the score and source-reference windows are an
independent oracle. Bells are inharmonic; identify fresh multi-partial
attacks rather than mistaking their loudest FFT bin for a fundamental.
Requires numpy/scipy + ffmpeg; matplotlib only for the report command.
"""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess

# Scientific packages are installed in /usr/bin/python3, not the LSP interpreter.
# pyright: reportMissingImports=false
import numpy as np
from scipy import ndimage, optimize, signal

ROOT = Path(__file__).resolve().parents[1]
SR = 8000
SOURCE_SHA256 = '9e6163c1a485b17829eb69cb58b0f187d4d9e690be26a224d7e6568b24d29e70'
# Wikipedia Description; independent Harrison (MTO 6.4, 2000), paragraph 16.
CHANGES = {
    1: ('G#', 'F#', 'E', 'B'),
    2: ('E', 'G#', 'F#', 'B'),
    3: ('E', 'F#', 'G#', 'E'),
    4: ('G#', 'E', 'F#', 'B'),
    5: ('B', 'F#', 'G#', 'E'),
}
QUARTERS = {'q15': (1,), 'q30': (2, 3), 'q45': (4, 5, 1), 'melody': (2, 3, 4, 5)}
NOTES = ('E', 'G#', 'F#', 'B')
CONCERT_HZ = {'G#': 415.30, 'F#': 369.99, 'E': 329.63, 'B': 246.94}
# Reference attacks picked from the intact source, not the assembly recipe.
REFERENCES = {'E': .35, 'G#': 7.61, 'F#': 2.27, 'B': 2.96}
SOURCE_ATTACKS = (.35, 1.44, 2.27, 2.96, 4.41, 5.10, 5.76, 6.33,
                  7.61, 8.21, 8.90, 9.49, 10.90, 11.60, 12.20, 12.69)


def expected_notes(asset):
    return [note for change in QUARTERS[asset] for note in CHANGES[change]]


def decode(path):
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-nostdin', '-i', str(path),
                                   '-ar', str(SR), '-ac', '1', '-f', 'f32le', '-'])
    return np.frombuffer(raw, dtype='<f4').astype(float)


def spectrum(samples):
    f, t, z = signal.stft(samples, fs=SR, nperseg=2048, noverlap=1984)
    return f, t, np.abs(z)


def source_templates(source):
    f, t, mag = spectrum(source[:15 * SR])
    use = (f > 270) & (f < 3000)
    columns = []
    for note in NOTES:
        at = REFERENCES[note]
        post = mag[:, (t > at + .06) & (t < at + .26)].mean(axis=1)
        pre = mag[:, (t > max(0, at - .25)) & (t < at - .05)].mean(axis=1)
        fresh = np.maximum(post - .8 * pre, 0)[use]
        columns.append(fresh / np.linalg.norm(fresh))
    return np.array(columns).T


def detect_notes(samples, templates):
    """Dominant fresh bell attacks, retaining order and measured time.

    Fit four full-spectrum source timbres simultaneously, then detect their
    96ms rises. Nonmaximum suppression groups coincident partials within
    320ms into ONE attack; the actual source's closest notes are ~490ms apart.
    Relative within-bell thresholds handle different bell recording levels.
    These are attack-centre estimates, not sample-exact hammer contact times.
    """
    f, t, mag = spectrum(samples)
    use = (f > 270) & (f < 3000)
    coefficients = np.array([optimize.nnls(templates, y)[0] for y in mag[use].T]).T
    coefficients = ndimage.gaussian_filter1d(coefficients, 3, axis=1)
    novelty = np.maximum(coefficients - np.roll(coefficients, 12, axis=1), 0)
    novelty[:, :12] = coefficients[:, :12]
    candidates = []
    for i, note in enumerate(NOTES):
        threshold = .25 * float(novelty[i].max())
        if threshold <= 1e-10:
            continue
        peaks, _ = signal.find_peaks(novelty[i], height=threshold,
                                    prominence=threshold, distance=55)
        for ix in peaks:
            candidates.append({'at': float(t[ix]), 'note': note,
                               'strength': float(novelty[i, ix])})
    kept = []
    for item in sorted(candidates, key=lambda row: row['strength'], reverse=True):
        if all(abs(item['at'] - other['at']) > .32 for other in kept):
            kept.append(item)
    return sorted(kept, key=lambda row: row['at'])


def fingerprint_db(samples, at, center, duration=.25):
    lo, hi = int((at + .04) * SR), int((at + .04 + duration) * SR)
    f, power = signal.periodogram(samples[lo:hi], SR, nfft=16384)
    return float(10 * np.log10(power[(f > center - 20) & (f < center + 20)].sum() + 1e-20))


def partial_peaks(samples, at):
    """Measured strong low partials, explicitly NOT concert-pitch estimates."""
    y = samples[int((at + .04) * SR):int((at + .29) * SR)]
    f, p = signal.periodogram(y, SR, nfft=32768)
    peaks, _ = signal.find_peaks(p, distance=40)
    peaks = [i for i in peaks if 280 < f[i] < 550]
    return [round(float(f[i]), 1) for i in sorted(peaks, key=lambda i: p[i], reverse=True)[:2]]


def report(source_path, out, label):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt

    if hashlib.sha256(source_path.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise ValueError('Unknown source recording')
    source = decode(source_path)
    templates = source_templates(source)
    out.mkdir(parents=True, exist_ok=True)
    rows = {}

    def draw(ax, samples, title, attacks, changes, limit):
        f, t, mag = spectrum(samples[:int(limit * SR)])
        ax.pcolormesh(t, f, 20 * np.log10(np.maximum(mag, 1e-9)),
                      shading='auto', cmap='magma', vmin=-72, vmax=-22)
        ax.set_ylim(180, 1500)
        ax.set_xlim(0, limit)
        ax.set_ylabel('measured partial frequency (Hz)')
        ax.set_title(title, fontsize=11)
        for j, row in enumerate(attacks):
            at, note = row['at'], row['note']
            peaks = partial_peaks(samples, max(0, at - .05))
            ax.axvline(at, color='lime', alpha=.6, lw=.7, ls=':')
            ax.text(at, 1460 - (j % 2) * 180, f'{j+1}: {note}\n{at:.2f}s\n{peaks} Hz',
                    color='white', fontsize=7, va='top', ha='left', rotation=0)
        for index, change in enumerate(changes):
            if 4 * index < len(attacks):
                at = max(0, attacks[4 * index]['at'] - .12)
                ax.axvline(at, color='cyan', lw=1.1)
                ax.text(at + .03, 220, f'change {change}', color='cyan', fontsize=9)
        ax.set_xlabel('seconds (green: detected attack; cyan: phrase boundary)')

    source_rows = detect_notes(source[:15 * SR], templates)
    fig, ax = plt.subplots(figsize=(19, 7))
    draw(ax, source, '1945 source — 16 measured attacks, changes 2 / 3 / 4 / 5',
         source_rows, (2, 3, 4, 5), 14.5)
    fig.text(.02, .005, 'Labels name canonical bells. Bracketed Hz values are measured low partials, NOT harmonic fundamentals. '
             'Nominal score G#4=415.3 / F#4=370.0 / E4=329.6 / B3=246.9 Hz; archival bells are inharmonic.', fontsize=9)
    fig.tight_layout(rect=(0, .035, 1, 1))
    fig.savefig(out / 'source-hour-annotated.png', dpi=150)
    plt.close(fig)
    rows['source'] = source_rows
    fig, axes = plt.subplots(1, 3, figsize=(21, 7), sharey=True)
    for ax, asset in zip(axes, ('q15', 'q45', 'q30')):
        samples = decode(ROOT / 'audio' / f'{asset}.m4a')
        attacks = detect_notes(samples, templates)
        rows[asset] = {'attacks': attacks, 'expected': expected_notes(asset),
                       'duration': len(samples) / SR,
                       'observed': [row['note'] for row in attacks]}
        draw(ax, samples, f'{label}: {asset} — {len(attacks)} dominant attacks',
             attacks, QUARTERS[asset], len(samples) / SR)
    fig.suptitle('Decoded AAC: source-derived multi-partial identities, not guessed fundamental bins')
    fig.tight_layout()
    fig.savefig(out / f'{label}-quarters-side-by-side.png', dpi=150)
    plt.close(fig)
    (out / f'{label}-measurements.json').write_text(json.dumps(rows, indent=2) + '\n')
    print(json.dumps({key: value['observed'] for key, value in rows.items() if key != 'source'}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--out', type=Path, default=ROOT / 'tools/analysis')
    parser.add_argument('--label', default='v1.2.2')
    args = parser.parse_args()
    report(args.source, args.out, args.label)
