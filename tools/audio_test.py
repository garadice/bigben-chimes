#!/usr/bin/env python3
"""Development audio regression: numpy/scipy + ffmpeg, no app dependencies.
Run: python3 tools/audio_test.py /path/to/source-1945.wav
Tests the ACTUAL decoded samples against independently documented cut ranges
and the contiguous-quarter recipe in tools/cut_audio.py (single source of truth).
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

# v1.3.0 contiguous quarters (asset seconds, from the recipe constants).
Q15_LEAD = recipe.LEAD_IN_S
CHANGE4 = (recipe.ATTACKS['G#'][2], recipe.ATTACKS['E'][3],
           recipe.ATTACKS['F#'][2], recipe.ATTACKS['B'][1])
CHANGE45 = CHANGE4 + recipe.CHANGE5
# (note, asset-time) lists: q45 legitimately repeats bells, so no dict.
Q15_ATTACKS = list(zip(('G#', 'E', 'F#', 'B'),
                       (Q15_LEAD + t - recipe.Q15_CUT[0] for t in CHANGE4)))
Q45_ATTACKS = list(zip(('G#', 'E', 'F#', 'B', 'B', 'F#', 'G#', 'E'),
                       (t - recipe.Q45_CUT[0] for t in CHANGE45)))
Q15_DUR = Q15_LEAD + recipe.Q15_CUT[1] - recipe.Q15_CUT[0]   # lead + change 4
Q45_DUR = recipe.Q45_CUT[1] - recipe.Q45_CUT[0]              # changes 4+5 window
# q15's note region sits inside q45 at this asset-time offset (one shared
# cut origin difference: 7.598 - 7.50); equality there proves one build.
Q15_IN_Q45 = recipe.Q15_CUT[0] - recipe.Q45_CUT[0]

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
        # the exact decode the build pipeline uses (room-window detection and
        # provenance comparisons must see the same samples cut_audio sees)
        cls.stereo = recipe.decode_stereo(SOURCE)
        cls.src_mono = cls.stereo.mean(1)

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

    # ---- q15 v1.3.0: contiguous change-4 cut + room-tone lead-in ----
    def check_q15(self, ext):
        data = decode(ROOT / 'audio' / f'q15.{ext}')
        mono = data.mean(1)
        self.assertTrue(np.isfinite(data).all())
        self.assertLess(float(np.abs(data).max()), .96, 'decoded stereo must have safe headroom')
        self.assertLess(abs(len(mono) / self.sr - Q15_DUR), .05, 'duration must match the recipe')
        self.assertLess(float(np.max(np.abs(data[-120:]))), .04, 'end must fade out rather than click')

        # whole note region IS the contiguous source segment, one gain
        a = mono[int((Q15_LEAD + .02) * self.sr):int((Q15_DUR - .12) * self.sr)]
        b = self.source[int((recipe.Q15_CUT[0] + .02) * self.sr):int((recipe.Q15_CUT[1] - .12) * self.sr)]
        n = min(len(a), len(b)); a, b = a[:n].astype(float), b[:n]
        gain = float(np.dot(a, b) / np.dot(b, b))
        self.assertGreater(corr(a, b * gain), .99,
                           f'q15.{ext}: note region is not the contiguous source cut')

        def rms_db(x):
            return 20 * np.log10(max(float(np.sqrt(np.mean(x ** 2))), 1e-12))

        # v1.2.1 lead-in: the track opens with the hall's real ambience, not
        # digital silence. Fade-in present, settled level = room tone, and no
        # 50 ms stretch of digital zero anywhere in the lead.
        lead_n = int(Q15_LEAD * self.sr)
        early = mono[int(.02 * self.sr):int(.10 * self.sr)]
        settled = mono[int(.60 * lead_n):lead_n - 160]
        self.assertLessEqual(rms_db(early), rms_db(settled) - 8.0,
                             'lead-in has no audible fade-in from quiet to full ambience')
        self.assertLess(rms_db(settled), -32, 'lead-in is too loud for room tone')
        self.assertGreater(rms_db(settled), -46, 'lead-in is digital silence, not ambience')
        window_peaks = [float(np.abs(mono[i:i + int(.05 * self.sr)]).max())
                        for i in range(0, lead_n, int(.05 * self.sr))]
        self.assertGreater(min(window_peaks), 1e-4,
                           'a 50 ms stretch of the lead-in is digital silence')

        # lead-in provenance: the SAME quiet hall window cut_audio dissolves
        # into, at the asset's own gain (the fade's tail absorbs ~x0.93).
        room_a = int(recipe.quietest_room_window(self.src_mono) * self.sr)
        a0 = int(.72 * lead_n)
        seg = mono[a0:lead_n - 96]
        ref = self.stereo[room_a + a0:room_a + lead_n - 96].mean(1)
        gain = float(np.dot(seg, ref) / np.dot(ref, ref))
        self.assertGreater(corr(seg, ref * gain), .90,
                           'lead-in is not the 1945 recording room tone')

        # A bounded rise into the first attack is expected, never a down-cliff.
        pre = mono[int((Q15_LEAD - .04) * self.sr):int((Q15_LEAD - .005) * self.sr)]
        post = mono[int(Q15_LEAD * self.sr):int((Q15_LEAD + .010) * self.sr)]
        step = rms_db(pre) - rms_db(post)
        self.assertLess(step, 8.0, f'lead-in cliffs {step:.1f} dB down at the cut join')
        self.assertGreater(step, -30.0, f'unexpected {abs(step):.1f} dB jump at the cut join')

        # Check EVERY ACTUAL ASSET NOTE against the recorded change 4.
        for note, at in Q15_ATTACKS:
            flux = band_flux_new_energy(mono, self.sr, at, FING)
            winner = max(flux, key=flux.get)
            self.assertEqual(winner, note,
                             f'q15 note at {at:.2f}s does not fingerprint as {note}')

    def check_q15_q45_prefix(self, ext):
        """v1.3.0 contiguity: :15's note region IS a region of :45.

        Both assets cut the same recording with one shared gain, so after
        the lead-in q15 must equal q45 at a constant offset (7.598-7.50).
        Sample identity at ONE offset is only possible when no material was
        pasted: an assembly would need per-note offsets.
        """
        q15 = decode(ROOT / 'audio' / f'q15.{ext}').mean(1)
        q45 = decode(ROOT / 'audio' / f'q45.{ext}').mean(1)
        self.assertLess(len(q15), len(q45) - int(3.0 * self.sr),
                        'q15 must not contain the padded q45 tail')
        n = int((Q15_DUR - Q15_LEAD - .12) * self.sr)
        a = q15[int((Q15_LEAD + .01) * self.sr):][:n]
        # q45 has no lead-in: its asset time is the cut offset directly.
        b = q45[int((Q15_IN_Q45 + .01) * self.sr):][:n]
        best_c, best_g = -2.0, 0.0
        for lag in range(-16, 17, 8):
            if lag >= 0:
                x, y = b[lag:], a[:len(b) - lag]
            else:
                x, y = b[:len(b) + lag], a[-lag:]
            m = min(len(x), len(y))
            x, y = x[:m].astype(float), y[:m]
            c = corr(x, y)
            if c > best_c:
                best_c = c
                best_g = 20 * np.log10(float(np.linalg.norm(y) / np.linalg.norm(x)))
        self.assertGreaterEqual(best_c, .995,
            f'{ext}: q15 note region correlates {best_c:.4f} with the same q45 region')
        self.assertLess(abs(best_g), .3,
            f'{ext}: q15 sits {best_g:+.2f} dB off the shared gain region of q45')

    # ---- q45 v1.3.0: one contiguous cut of recorded changes 4+5 ----
    def check_q45(self, ext):
        data = decode(ROOT / 'audio' / f'q45.{ext}')
        mono = data.mean(1)
        self.assertTrue(np.isfinite(data).all())
        self.assertLess(float(np.abs(data).max()), .96)
        self.assertLess(abs(len(mono) / self.sr - Q45_DUR), .12,
                        'duration must match the changes-4+5 window')
        self.assertLess(float(np.max(np.abs(data[-120:]))), .04)

        # the WHOLE asset is the recorded source window at one gain
        a = mono[int(.10 * self.sr):int((Q45_DUR - .12) * self.sr)].astype(float)
        b = self.source[int((recipe.Q45_CUT[0] + .10) * self.sr):int((recipe.Q45_CUT[1] - .12) * self.sr)]
        n = min(len(a), len(b)); a, b = a[:n], b[:n]
        gain = float(np.dot(a, b) / np.dot(b, b))
        c = corr(a, b * gain)
        self.assertGreater(c, .99,
            f'q45.{ext}: waveform correlation {c:.4f}; not the contiguous source window')

        # one gain throughout: no re-normalized insert anywhere inside
        def seg_gain(at, duration):
            x = mono[int(at * self.sr):int((at + duration) * self.sr)].astype(float)
            y = self.source[int((recipe.Q45_CUT[0] + at) * self.sr):
                            int((recipe.Q45_CUT[0] + at + duration) * self.sr)]
            m = min(len(x), len(y)); x, y = x[:m], y[:m]
            return float(np.dot(x, y) / np.dot(y, y))
        early, late = seg_gain(.2, 2.8), seg_gain(3.5, 3.2)
        mismatch = abs(20 * np.log10(late / early))
        self.assertLess(mismatch, .3,
            f'{ext}: q45 gain changes {mismatch:.2f} dB between changes 4 and 5')

        # Note identities are asserted BY the provenance above: the decoded
        # waveform IS the recorded window, so every bell is the genuine
        # recorded attack. A per-note fingerprint-band winner is NOT a valid
        # instrument here: measured on this build, change 5's B (asset 3.40s)
        # re-strikes the same bell 1.41 s after change 4's B, whose decay
        # saturates the B band, and the E band's wash variation outscores the
        # fresh B — the same honest-level limitation the v1.2.2 diagnosis
        # documented for the joined G#. Count, order, rhythm and the
        # masked-opening check are owned by tools/scheme_test.py (independent
        # full-spectrum detector) and check_q15 above.

    def test_inter_attack_envelope_is_as_smooth_as_the_q30_reference(self):
        """A/B contract: between attacks, q15 AND q45 decay as smoothly as contiguous q30."""
        def worst(x, attacks):
            e = env_db(x, self.sr)
            w = 0.0
            for a, b in zip(attacks, attacks[1:]):
                lo = int((a + .20) / .02); hi = int((b - .05) / .02)
                w = max(w, float(np.abs(np.diff(e[lo:hi])).max()))
            return w
        q30 = decode(ROOT / 'audio' / 'q30.m4a').mean(1)
        worst30 = worst(q30, [.10, 1.16, 2.02, 2.71, 4.16, 4.85, 5.50, 6.08])
        for name, attacks in [('q15', [at for _n, at in Q15_ATTACKS]),
                              ('q45', [at for _n, at in Q45_ATTACKS])]:
            x = decode(ROOT / 'audio' / f'{name}.m4a').mean(1)
            worst_x = worst(x, attacks)
            self.assertLessEqual(worst_x, worst30 + 1.5,
                f'{name} envelope cliffs ({worst_x:.1f} dB/20ms) exceed the q30 '
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

for name in EXPECTED:
    for ext in ['m4a', 'ogg']:
        def case(self, name=name, ext=ext):
            self.check_asset(name, ext)
        setattr(AudioTests, 'test_' + name.replace('-', '_') + '_' + ext, case)

for name, fn in [('q15', 'check_q15'), ('q45', 'check_q45'),
                 ('q15_q45_prefix', 'check_q15_q45_prefix')]:
    for ext in ['m4a', 'ogg']:
        def case(self, fn=fn, ext=ext):
            getattr(self, fn)(ext)
        setattr(AudioTests, 'test_' + name + '_' + ext, case)

if __name__ == '__main__':
    unittest.main(verbosity=2)
