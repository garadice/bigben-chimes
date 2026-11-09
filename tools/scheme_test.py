#!/usr/bin/env python3
"""Independent score contract over shipped decoded notes, not recipe constants.
Run: /usr/bin/python3 tools/scheme_test.py /path/to/source-1945.wav
"""
from pathlib import Path
import hashlib
import sys
import unittest

# Development dependencies live in /usr/bin/python3, not the LSP interpreter.
# pyright: reportMissingImports=false
import numpy as np
import audio_scheme as scheme

SOURCE = Path(sys.argv.pop()) if len(sys.argv) > 1 else None
# Literal score oracle, independent of BOTH cut_audio and the detector's score.
EXPECTED = {
    'q15': ['G#', 'F#', 'E', 'B'],
    'q30': ['E', 'G#', 'F#', 'B', 'E', 'F#', 'G#', 'E'],
    'q45': ['G#', 'E', 'F#', 'B', 'B', 'F#', 'G#', 'E', 'G#', 'F#', 'E', 'B'],
    'melody': ['E', 'G#', 'F#', 'B', 'E', 'F#', 'G#', 'E',
               'G#', 'E', 'F#', 'B', 'B', 'F#', 'G#', 'E'],
}
# v1.2.1 baseline, intentionally frozen by this release's scope.
FROZEN = {
    'audio/bong.ogg': '8819a3f10236fd85683447031a4d72e5da3d8dedcd4e179036f34aea487c5467',
    'audio/bong.m4a': '84f40eac409ad5b50f4fb2fc44367136dfed624f8e0f47e80154a5e2742482b5',
    'audio/q30.ogg': '6fe23cb1981f4d533fe12c74a36e7f19723e954c20dc17f06c3c707efbbc081c',
    'audio/q30.m4a': '09886ffe13f503697f8462bd79946c1772f313726325b0dc05a6dd2a45ed8135',
    'audio/melody.ogg': '2af904fc365232aec7047b486df020bb03c3029ceb4358e854d1bec931192f6d',
    'audio/melody.m4a': '00d8dfc6862f66097493e93325a24ec11c851c6e2c18b1c273585b4dfcbec297',
    'app.js': 'aaa76bd1e0ce2094624923b435f0e8267a667925981f7d7fc3ba5aa463bb01d7',
    'chime.js': '832338b59f1f96aff9e30c3a7e9b7cb79a25d06e776fc0a8f26585c353a4a01a',
    'styles.css': 'db9da36a41b60853afa184217921806834e5e931738da4c2762f696e48e32d52',
    'index.html': '6e1f72849919e3274f4195d4bace60492013d85a8dc93edd61494463ca5a6b31',
    'manifest.json': 'c47bd1946a5ca15f436b7d3c9ae9ae762cb5a179700c1ef2db36c639e52e877f',
}


class SchemeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if SOURCE is None:
            raise RuntimeError('Supply the original source WAV')
        if hashlib.sha256(SOURCE.read_bytes()).hexdigest() != scheme.SOURCE_SHA256:
            raise RuntimeError('Source hash mismatch')
        cls.source = scheme.decode(SOURCE)
        cls.templates = scheme.source_templates(cls.source)

    def notes(self, samples):
        return [row['note'] for row in scheme.detect_notes(samples, self.templates)]

    def source_fixture(self, notes):
        # Real hash-verified source cuts with silence between notes. Only the
        # detector is tested here: never write these synthetic TIMELINES to audio/.
        cuts = {'G#': (7.58, 8.18), 'F#': (2.24, 2.90),
                'E': (.32, 1.01), 'B': (2.93, 4.33)}
        out = np.zeros(int((.3 + .9 * len(notes) + 1.4) * scheme.SR))
        for index, note in enumerate(notes):
            lo, hi = cuts[note]
            fragment = self.source[int(lo * scheme.SR):int(hi * scheme.SR)]
            at = int((.3 + .9 * index) * scheme.SR)
            out[at:at + len(fragment)] += fragment
        return out

    def check_quarter(self, name, ext):
        samples = scheme.decode(scheme.ROOT / 'audio' / f'{name}.{ext}')
        self.assertEqual(self.notes(samples), EXPECTED[name],
                         f'{name}.{ext}: dominant decoded attacks violate the score')

    def test_source_hour_has_all_sixteen_notes_in_the_correct_order(self):
        self.assertEqual(self.notes(self.source[:15 * scheme.SR]), EXPECTED['melody'])

    def test_score_definition_matches_the_independent_literal_oracle(self):
        for asset, notes in EXPECTED.items():
            self.assertEqual(scheme.expected_notes(asset), notes)
        self.assertEqual([len(EXPECTED[name]) for name in ('q15', 'q30', 'q45', 'melody')],
                         [4, 8, 12, 16])

    def test_no_bell_attacks_are_invented_from_digital_silence(self):
        self.assertEqual(self.notes(np.zeros(3 * scheme.SR)), [])

    def test_detector_catches_a_wrong_note_order(self):
        wrong = ['F#', 'G#', 'E', 'B']
        self.assertEqual(self.notes(self.source_fixture(wrong)), wrong)
        self.assertNotEqual(wrong, EXPECTED['q15'])

    def test_detector_catches_an_extra_note(self):
        extra = EXPECTED['q15'] + ['B']
        self.assertEqual(self.notes(self.source_fixture(extra)), extra)
        self.assertNotEqual(len(extra), 4)

    def test_detector_catches_a_missing_note(self):
        missing = ['G#', 'E', 'B']
        self.assertEqual(self.notes(self.source_fixture(missing)), missing)
        self.assertNotEqual(len(missing), 4)

    def test_assembled_onset_gaps_match_the_measured_source_rhythm(self):
        # Independent literal mean of source changes 3/4/5, not recipe.STEPS.
        for ext in ('m4a', 'ogg'):
            for name in ('q15', 'q45'):
                attacks = scheme.detect_notes(scheme.decode(scheme.ROOT / 'audio' / f'{name}.{ext}'),
                                               self.templates)
                at = [row['at'] for row in attacks[-4:]]
                np.testing.assert_allclose(np.diff(at), [.663, .647, .553], atol=.08,
                                           err_msg=f'{name}.{ext}: stitched rhythm changed')
                if name == 'q45':
                    self.assertAlmostEqual(attacks[8]['at'] - attacks[7]['at'], 1.38, delta=.12)

    def test_q15_first_bell_is_not_masked_by_a_restarted_E_decay(self):
        for ext in ('m4a', 'ogg'):
            samples = scheme.decode(scheme.ROOT / 'audio' / f'q15.{ext}')
            g = scheme.fingerprint_db(samples, .312, 900)
            e = scheme.fingerprint_db(samples, .312, 1050)
            self.assertGreater(g - e, 8.0,
                               f'{ext}: opening G# does not clear the stale E by 8dB ({g-e:.2f})')

    def test_approved_audio_and_application_behavior_are_byte_frozen(self):
        for relative, expected_hash in FROZEN.items():
            with self.subTest(path=relative):
                actual = hashlib.sha256((scheme.ROOT / relative).read_bytes()).hexdigest()
                self.assertEqual(actual, expected_hash)


for name in EXPECTED:
    for ext in ('m4a', 'ogg'):
        def case(self, name=name, ext=ext):
            self.check_quarter(name, ext)
        setattr(SchemeTests, f'test_decoded_{name}_{ext}_count_and_order', case)

if __name__ == '__main__':
    unittest.main(verbosity=2)
