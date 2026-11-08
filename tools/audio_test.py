#!/usr/bin/env python3
"""Development audio regression: numpy/scipy + ffmpeg, no app dependencies.
Run: python3 tools/audio_test.py /path/to/source-1945.wav
Tests the ACTUAL decoded samples against independently documented cut ranges.
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

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv.pop()) if len(sys.argv)>1 else None
EXPECTED = {'melody':(.25,21.05),'q30':(.25,7.48),'q45a':(7.50,14.05),
            'n-e4':(.25,1.31),'n-gs4':(1.31,2.18),'n-fs4':(2.17,2.87),'n-b3':(2.86,4.36), 'bong':(41.47,44.90)}

def decode(path):
    result = subprocess.run(['ffmpeg','-v','error','-nostdin','-i',str(path),'-f','f32le','-'],capture_output=True,check=True)
    return np.frombuffer(result.stdout,dtype='<f4').reshape(-1,2)

class AudioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if SOURCE is None:
            raise RuntimeError('Supply the original source WAV; see docs/DEV.md')
        if hashlib.sha256(SOURCE.read_bytes()).hexdigest() != '9e6163c1a485b17829eb69cb58b0f187d4d9e690be26a224d7e6568b24d29e70':
            raise RuntimeError('Source hash mismatch')
        cls.sr, raw = wavfile.read(SOURCE)
        cls.source = raw.astype(float).mean(1)/32768

    def check_asset(self, name, ext):
        data = decode(ROOT/'audio'/f'{name}.{ext}')
        self.assertTrue(np.isfinite(data).all())
        self.assertLess(float(np.abs(data).max()),.96,'decoded stereo must have safe headroom')
        start,end=EXPECTED[name]
        self.assertLess(abs(len(data)/self.sr-(end-start)),.04,'duration must match the licensed cut')
        # Ignore de-click fades; compare waveform AND alignment, not dominant pitch.
        actual=data.mean(1)[int(.1*self.sr):int((end-start-.12)*self.sr)]
        reference=self.source[int((start+.1)*self.sr):int((end-.12)*self.sr)]
        size=min(len(actual),len(reference)); actual=actual[:size]; reference=reference[:size]
        corr=float(np.dot(actual,reference)/np.linalg.norm(actual)/np.linalg.norm(reference))
        self.assertGreater(corr,.96,f'{name}.{ext}: actual waveform correlation {corr:.4f}; wrong onset/cut')
        self.assertLess(float(np.max(np.abs(data[-120:]))),.04,'end must fade out rather than click')

    def test_source_strike_interval(self):
        x=signal.resample_poly(self.source,1,6)
        _,t,z=signal.stft(x,fs=8000,nperseg=1024,noverlap=944)
        flux=np.maximum(0,np.diff(abs(z),axis=1)).sum(0)
        ix,_=signal.find_peaks(flux,distance=300,prominence=.015)
        onsets=[float(t[i+1]) for i in ix if 20<t[i+1]<69]
        self.assertEqual(len(onsets),12)
        self.assertAlmostEqual(float(np.mean(np.diff(onsets))),4.015,delta=.001)
        print('independent strike onsets:',[round(t,2) for t in onsets])

for name in EXPECTED:
    for ext in ['m4a','ogg']:
        def case(self,name=name,ext=ext):
            self.check_asset(name,ext)
        setattr(AudioTests,'test_'+name.replace('-','_')+'_'+ext,case)

if __name__ == '__main__':
    unittest.main(verbosity=2)
