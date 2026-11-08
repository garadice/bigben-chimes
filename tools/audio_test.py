#!/usr/bin/env python3
"""Development audio regression: numpy/scipy + ffmpeg, no app dependencies.
Run: python3 tools/audio_test.py /path/to/source-1945.wav
Tests the ACTUAL decoded samples against independently documented cut ranges
and the assembled-quarter recipe in tools/cut_audio.py (single source of truth).
"""
import hashlib
from pathlib import Path
import subprocess
import sys
import unittest
# Dev-only scientific packages are in the /usr/bin/python3 environment.
# pyright: reportMissingImports=false
import numpy as np
from scipy import signal
from scipy.io import wavfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cut_audio as recipe  # same constants the asset pipeline uses

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv.pop()) if len(sys.argv) > 1 else None
EXPECTED = {'melody': (.25, 21.05), 'q30': (.25, 7.48), 'bong': (41.47, 44.90)}

# Note positions inside the assembled assets (asset seconds, from cut_audio).
Q15_ATTACKS = {'G#': 0.012, 'F#': recipe.STEPS[0],
               'E': recipe.STEPS[0] + recipe.STEPS[1],
               'B': recipe.STEPS[0] + recipe.STEPS[1] + recipe.STEPS[2]}
Q15_DUR = 3.442   # assembled length; re-derived from the recipe below too
Q45_JOIN = recipe.ATTACKS['E'][4] - recipe.Q45_BASE[0] + recipe.CHANGE_GAP

def decode(path):
    result = subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-i', str(path),
                             '-f', 'f32le', '-'], capture_output=True, check=True)
    return np.frombuffer(result.stdout, dtype='<f4').reshape(-1, 2)

def corr(a, b):
    n = min(len(a), len(b))
    a, b = a[:n], b[:n]
    return float(np.dot(a, b) / np.linalg.norm(a) / np.linalg.norm(b))

def env_db(x, sr, w=0.02):
    n = len(x) // int(w * sr)
    e = np.sqrt(np.mean(x[: n * int(w * sr)].reshape(n, int(w * sr)) ** 2, axis=1))
    return 20 * np.log10(np.maximum(e, 1e-12))

def band_flux_new_energy(x, sr, at, bands, pre=0.10, post=0.30):
    """Which fingerprint band gains most energy across a note attack."""
    f, t, Z = signal.stft(x, fs=sr, nperseg=2048, noverlap=1536)
    mag = np.abs(Z)
    out = {}
    for name, center in bands.items():
        band = (f >= center - 60) & (f <= center + 60)
        after = (t >= at + 0.04) & (t <= at + post)
        before = (t >= max(at - pre, 0.0)) & (t < max(at, 0.001))
        out[name] = float(mag[np.ix_(band, after)].mean() - mag[np.ix_(band, before)].mean())
    return out

FING = {'E': 1051, 'G#': 900, 'F#': 1197, 'B': 1393}

class AudioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if SOURCE is None:
            raise RuntimeError('Supply the original source WAV; see docs/DEV.md')
        if hashlib.sha256(SOURCE.read_bytes()).hexdigest() != recipe.SOURCE_SHA256:
            raise RuntimeError('Source hash mismatch')
        cls.sr, raw = wavfile.read(SOURCE)
        cls.source = raw.astype(float).mean(1) / 32768

    # ---- contiguous cuts (v1.1.0 contracts, unchanged) ----
    def check_asset(self, name, ext):
        data = decode(ROOT / 'audio' / f'{name}.{ext}')
        self.assertTrue(np.isfinite(data).all())
        self.assertLess(float(np.abs(data).max()), .96, 'decoded stereo must have safe headroom')
        start, end = EXPECTED[name]
        self.assertLess(abs(len(data) / self.sr - (end - start)), .04,
                        'duration must match the licensed cut')
        actual = data.mean(1)[int(.1 * self.sr):int((end - start - .12) * self.sr)]
        reference = self.source[int((start + .1) * self.sr):int((end - .12) * self.sr)]
        size = min(len(actual), len(reference)); actual = actual[:size]; reference = reference[:size]
        c = corr(actual, reference)
        self.assertGreater(c, .96, f'{name}.{ext}: waveform correlation {c:.4f}; wrong onset/cut')
        self.assertLess(float(np.max(np.abs(data[-120:]))), .04, 'end must fade out rather than click')

    # ---- assembled q15: change 1 (G# F# E B), offline overlap-add ----
    def check_q15(self, ext):
        data = decode(ROOT / 'audio' / f'q15.{ext}')
        mono = data.mean(1)
        self.assertTrue(np.isfinite(data).all())
        self.assertLess(float(np.abs(data).max()), .96, 'decoded stereo must have safe headroom')
        self.assertLess(abs(len(mono) / self.sr - Q15_DUR), .05, 'duration must match the recipe')
        self.assertLess(float(np.max(np.abs(data[-120:]))), .04, 'end must fade out rather than click')

        # provenance: every sample traces to the documented source windows
        rec = np.zeros(len(mono))
        for (start, end, pre), pos in zip(recipe.Q15_SLICES, recipe_positions()):
            a = int(start * self.sr); b = int(end * self.sr)
            i = int(max(pos - pre, 0.0) * self.sr)  # slice-start; slice 0 starts at 0.0
            seg = self.source[a:b]
            rec[i:i + len(seg)] += seg
        c = corr(mono[int(.10 * self.sr):int(3.30 * self.sr)] / np.abs(mono).max(),
                 rec[int(.10 * self.sr):int(3.30 * self.sr)] / np.abs(rec).max())
        self.assertGreater(c, .96, f'q15.{ext}: assembled asset does not match its recipe ({c:.4f})')

        # pitch class per note: fingerprint band new energy (DEV.md method)
        for note, at in list(Q15_ATTACKS.items())[1:]:
            flux = band_flux_new_energy(mono, self.sr, at, FING)
            winner = max(flux, key=flux.get)
            self.assertEqual(winner, note,
                             f'q15 note at {at:.2f}s does not fingerprint as {note}')
        # phrase-initial note: its slice origin in the source must fingerprint G#
        src_flux = band_flux_new_energy(self.source, self.sr, recipe.ATTACKS['G#'][0], FING)
        self.assertEqual(max(src_flux, key=src_flux.get), 'G#',
                         'source region 1.41 (phrase-initial G# origin) lost its fingerprint')

    # ---- assembled q45: recorded changes 4+5 + change 1 at the measured gap ----
    def check_q45(self, ext):
        data = decode(ROOT / 'audio' / f'q45.{ext}')
        mono = data.mean(1)
        self.assertTrue(np.isfinite(data).all())
        self.assertLess(float(np.abs(data).max()), .96)
        self.assertLess(abs(len(mono) / self.sr - (Q45_JOIN + Q15_DUR + 0.05)), .12,
                        'duration must match base + joined phrase')
        self.assertLess(float(np.max(np.abs(data[-120:]))), .04)

        # base = recorded changes 4+5, verbatim from the source
        c = corr(mono[int(.10 * self.sr):int(6.4 * self.sr)] / np.abs(mono).max(),
                 self.source[int(7.60 * self.sr):int(13.90 * self.sr)] /
                 float(np.abs(self.source[int(7.60 * self.sr):int(13.90 * self.sr)]).max()))
        self.assertGreater(c, .96, f'q45.{ext}: base segment is not the recorded changes 4+5 ({c:.4f})')

        # joined phrase fingerprints as change 1 (G# F# E B)
        for note, at in [('G#', Q45_JOIN), ('F#', Q45_JOIN + recipe.STEPS[0]),
                         ('E', Q45_JOIN + recipe.STEPS[0] + recipe.STEPS[1]),
                         ('B', Q45_JOIN + recipe.STEPS[0] + recipe.STEPS[1] + recipe.STEPS[2])]:
            flux = band_flux_new_energy(mono, self.sr, at, FING)
            winner = max(flux, key=flux.get)
            self.assertEqual(winner, note,
                             f'q45 joined note at {at:.2f}s does not fingerprint as {note}')

        # the join must not cliff: envelope step at the seam stays small
        e = env_db(mono, self.sr)
        pre_join = float(np.mean(e[int(6.30 / .02):int(6.44 / .02)]))
        at_join = float(np.mean(e[int(6.46 / .02):int(6.52 / .02)]))
        self.assertLess(abs(at_join - pre_join), 3.0,
                        f'q45 seam envelope step {abs(at_join - pre_join):.1f} dB is audible')

    def test_inter_attack_envelope_is_as_smooth_as_the_q30_reference(self):
        """A/B contract: between attacks, q15 decays as smoothly as contiguous q30."""
        def worst(x, attacks):
            e = env_db(x, self.sr)
            w = 0.0
            for a, b in zip(attacks, attacks[1:]):
                lo = int((a + .20) / .02); hi = int((b - .05) / .02)
                w = max(w, float(np.abs(np.diff(e[lo:hi])).max()))
            return w
        q30 = decode(ROOT / 'audio' / 'q30.m4a').mean(1)
        q15 = decode(ROOT / 'audio' / 'q15.m4a').mean(1)
        worst30 = worst(q30, [.10, 1.16, 2.02, 2.71, 4.16, 4.85, 5.50, 6.08])
        worst15 = worst(q15, list(Q15_ATTACKS.values()))
        self.assertLessEqual(worst15, worst30 + 1.5,
                             f'q15 envelope cliffs ({worst15:.1f} dB/20ms) exceed the q30 '
                             f'reference ({worst30:.1f} dB/20ms) — stitching is audible again')

    def test_source_strike_interval(self):
        x = signal.resample_poly(self.source, 1, 6)
        _, t, z = signal.stft(x, fs=8000, nperseg=1024, noverlap=944)
        flux = np.maximum(0, np.diff(abs(z), axis=1)).sum(0)
        ix, _ = signal.find_peaks(flux, distance=300, prominence=.015)
        onsets = [float(t[i + 1]) for i in ix if 20 < t[i + 1] < 69]
        self.assertEqual(len(onsets), 12)
        self.assertAlmostEqual(float(np.mean(np.diff(onsets))), 4.015, delta=.001)
        print('independent strike onsets:', [round(t, 2) for t in onsets])

def recipe_positions():
    return (0.0, recipe.STEPS[0], recipe.STEPS[0] + recipe.STEPS[1],
            recipe.STEPS[0] + recipe.STEPS[1] + recipe.STEPS[2])

for name in EXPECTED:
    for ext in ['m4a', 'ogg']:
        def case(self, name=name, ext=ext):
            self.check_asset(name, ext)
        setattr(AudioTests, 'test_' + name.replace('-', '_') + '_' + ext, case)

for name, fn in [('q15', 'check_q15'), ('q45', 'check_q45')]:
    for ext in ['m4a', 'ogg']:
        def case(self, fn=fn, ext=ext):
            getattr(self, fn)(ext)
        setattr(AudioTests, 'test_' + name + '_' + ext, case)

if __name__ == '__main__':
    unittest.main(verbosity=2)
