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
Q15_LEAD = recipe.LEAD_IN_S
Q15_FIRST = Q15_LEAD + .012
Q15_ATTACKS = {'G#': Q15_FIRST, 'F#': Q15_FIRST + recipe.STEPS[0],
               'E': Q15_FIRST + sum(recipe.STEPS[:2]),
               'B': Q15_FIRST + sum(recipe.STEPS)}
# the change-1 insert that lives INSIDE q45 (nominal recipe pieces; the
# zero-crossing cut jitters <= 13 ms, inside every duration tolerance here)
INSERT_DUR = (.012 + sum(recipe.STEPS) - .020) \
    + (recipe.ATTACKS['E'][1] - recipe.ATTACKS['B'][0]) + .15
Q15_DUR = Q15_LEAD + INSERT_DUR  # clean insert, no q45 base or final padding
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

    # ---- q15 v1.2.2: clean source-note insert + room-tone lead-in ----
    def check_q15(self, ext):
        data = decode(ROOT / 'audio' / f'q15.{ext}')
        mono = data.mean(1)
        self.assertTrue(np.isfinite(data).all())
        self.assertLess(float(np.abs(data).max()), .96, 'decoded stereo must have safe headroom')
        self.assertLess(abs(len(mono) / self.sr - Q15_DUR), .05, 'duration must match the recipe')
        self.assertLess(float(np.max(np.abs(data[-120:]))), .04, 'end must fade out rather than click')

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
        # The old copied q45 base E must NOT be reintroduced at this seam.
        pre = mono[int((Q15_LEAD - .04) * self.sr):int((Q15_LEAD - .005) * self.sr)]
        post = mono[int(Q15_LEAD * self.sr):int((Q15_LEAD + .010) * self.sr)]
        step = rms_db(pre) - rms_db(post)
        self.assertLess(step, 8.0, f'lead-in cliffs {step:.1f} dB down at the q45 tail join')
        self.assertGreater(step, -30.0, f'unexpected {abs(step):.1f} dB jump at the q45 tail join')

        # Check EVERY ACTUAL ASSET NOTE, including the formerly skipped G#.
        for note, at in Q15_ATTACKS.items():
            flux = band_flux_new_energy(mono, self.sr, at, FING)
            winner = max(flux, key=flux.get)
            self.assertEqual(winner, note,
                             f'q15 note at {at:.2f}s does not fingerprint as {note}')


    def check_q15_q45_shared_insert(self, ext):
        """Shared source notes, NOT a copy of the preceding q45 base E.

        F#/E/B match after the base's natural ring-out ends: correlation
        >=.99, gain delta <.5dB. Initial standalone G# independently matches
        the cleaner recorded instance at 7.61s.
        """
        q15 = decode(ROOT / 'audio' / f'q15.{ext}').mean(1)
        q45 = decode(ROOT / 'audio' / f'q45.{ext}').mean(1)
        tail_start = int((Q45_JOIN - .012) * self.sr)
        # q45 includes 50ms final padding; q15 does not copy that padding.
        self.assertLess(abs(len(q15) - (int(Q15_LEAD * self.sr) + len(q45) - tail_start
                                       - int(.05 * self.sr))),
                        int(.025 * self.sr),
                        'q15 must contain the clean insert, not the padded q45 tail')
        offset = (Q45_JOIN - .012) - Q15_LEAD
        n = int(.44 * self.sr)
        lag_max = int(.02 * self.sr)
        for note, at in list(Q15_ATTACKS.items())[1:]:
            a = q45[int((at + offset - .02) * self.sr):][:n]
            b = q15[int((at - .02) * self.sr):][:n]
            best_c, best_g = -2.0, 0.0
            for lag in range(-lag_max, lag_max + 1, 8):
                if lag >= 0:
                    x, y = a[lag:], b[:len(a) - lag]
                else:
                    x, y = a[:len(a) + lag], b[-lag:]
                m = min(len(x), len(y))
                x, y = x[:m], y[:m]
                c = corr(x, y)
                if c > best_c:
                    best_c = c
                    best_g = 20 * np.log10(float(np.linalg.norm(y) / np.linalg.norm(x)))
            self.assertGreaterEqual(best_c, .99,
                f'{ext}: {note} correlates {best_c:.4f} with the shared q45 insert')
            self.assertLess(abs(best_g), .5,
                f'{ext}: {note} sits {best_g:+.2f} dB off the shared q45 insert')
        at, origin = Q15_FIRST + .08, 7.61 + .08
        actual = q15[int(at * self.sr):int((at + .25) * self.sr)]
        source = self.source[int(origin * self.sr):int((origin + .25) * self.sr)]
        self.assertGreater(corr(actual, source), .98,
                           'standalone G# is not the cleaner source attack at 7.61s')

    # ---- assembled q45: recorded changes 4+5 + change 1 at the measured gap ----
    def check_q45(self, ext):
        data = decode(ROOT / 'audio' / f'q45.{ext}')
        mono = data.mean(1)
        self.assertTrue(np.isfinite(data).all())
        self.assertLess(float(np.abs(data).max()), .96)
        self.assertLess(abs(len(mono) / self.sr - (Q45_JOIN + INSERT_DUR + 0.05)), .12,
                        'duration must match base + joined phrase')
        self.assertLess(float(np.max(np.abs(data[-120:]))), .04)

        # base = recorded changes 4+5, verbatim from the source
        c = corr(mono[int(.10 * self.sr):int(6.4 * self.sr)] / np.abs(mono).max(),
                 self.source[int(7.60 * self.sr):int(13.90 * self.sr)] /
                 float(np.abs(self.source[int(7.60 * self.sr):int(13.90 * self.sr)]).max()))
        self.assertGreater(c, .96, f'q45.{ext}: base segment is not the recorded changes 4+5 ({c:.4f})')

        # G# starts under the recorded E decay: its inharmonic B-band partial
        # can beat the G# band at HONEST source levels. Verify the new G#
        # waveform after subtracting the known base, not the loudest band.
        a = mono[int(.2 * self.sr):int(6.0 * self.sr)]
        b = self.source[int(7.7 * self.sr):int(13.5 * self.sr)]
        gain = float(np.dot(a, b) / np.dot(b, b))
        joined_at = Q45_JOIN - .012
        lo, hi = int((joined_at + .1) * self.sr), int((joined_at + .3) * self.sr)
        base = self.source[int(7.50 * self.sr) + lo:int(7.50 * self.sr) + hi]
        isolated = mono[lo:hi] - base * gain
        reference = self.source[int(7.698 * self.sr):int(7.898 * self.sr)]
        self.assertGreater(corr(isolated, reference), .96, 'joined G# source attack must survive the mix')
        src_flux = band_flux_new_energy(self.source, self.sr, 7.61, FING)
        self.assertEqual(max(src_flux, key=lambda name: src_flux[name]), 'G#')
        # The remaining newly struck bells dominate their own fingerprint band.
        for note, at in [('F#', Q45_JOIN + recipe.STEPS[0]),
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

    def test_q45_uses_the_same_source_gain_for_base_and_joined_phrase(self):
        """Correlation alone cannot detect a normalized insert becoming 12 dB louder."""
        for ext in ['m4a', 'ogg']:
            asset = decode(ROOT / 'audio' / f'q45.{ext}').mean(1)
            def gain(asset_at, source_at, duration):
                a = asset[int(asset_at * self.sr):int((asset_at + duration) * self.sr)]
                b = self.source[int(source_at * self.sr):int((source_at + duration) * self.sr)]
                n = min(len(a), len(b)); a, b = a[:n], b[:n]
                return float(np.dot(a, b) / np.dot(b, b))
            base_gain = gain(.2, 7.7, 5.8)
            # E slice after the F# tail ends, before the B insert begins.
            joined_gain = gain(Q45_JOIN + sum(recipe.STEPS[:2]) + .07, .42, .30)
            mismatch = abs(20 * np.log10(joined_gain / base_gain))
            self.assertLess(mismatch, 1.0, f'{ext}: q45 gain changes {mismatch:.2f} dB at change 1')

    def test_room_tone_does_not_drop_into_silent_padding(self):
        # These are the actual end-of-dissolve seams, NOT the last 120 samples
        # (those samples were already zero and falsely passed the old check).
        # The insert-internal seam sits at 3.303854 s inside the change-1
        # phrase; q15 carries it after the lead-in, q45 after the join.
        seam = 3.303854
        for name, at in [('q15', Q15_LEAD + seam), ('q45', Q45_JOIN - .012 + seam)]:
            for ext in ['m4a', 'ogg']:
                x = decode(ROOT / 'audio' / f'{name}.{ext}').mean(1)
                i, w = int(at * self.sr), int(.02 * self.sr)
                pre = np.sqrt(np.mean(x[i-w:i] ** 2))
                post = np.sqrt(np.mean(x[i:i+w] ** 2))
                drop = 20 * np.log10(max(pre, 1e-12) / max(post, 1e-12))
                self.assertLess(drop, 8, f'{name}.{ext}: room-tone seam cliffs {drop:.1f} dB')

    def test_source_slice_ends_fade_both_channels_not_only_the_channel_mean(self):
        stereo = recipe.decode_stereo(SOURCE)
        for start, end, _ in recipe.Q15_SLICES:
            cut = recipe.zc_time(stereo.mean(1), end)
            segment = recipe.slice_seg(stereo, start, cut)
            self.assertLess(float(abs(segment[-1]).max()), 1e-8,
                            'a mono zero crossing is not a stereo de-click fade')

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
                 ('q15_q45_shared_insert', 'check_q15_q45_shared_insert')]:
    for ext in ['m4a', 'ogg']:
        def case(self, fn=fn, ext=ext):
            getattr(self, fn)(ext)
        setattr(AudioTests, 'test_' + name + '_' + ext, case)

if __name__ == '__main__':
    unittest.main(verbosity=2)
