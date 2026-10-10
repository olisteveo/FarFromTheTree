"""A small sample player for the orchestral score (tools/music/compose.py).

Plays notes from the VSCO 2 Community Edition library (CC0, github.com/sgossner/VSCO-2-CE), kept
out of git in C:/Dev/FarFromTheTree/samples/VSCO-2-CE (see tools/music/README.md). For each note it
takes the nearest recorded pitch and velocity layer, resamples it to the note, shapes it with an
envelope and mixes it into a stereo bus. Loops are rendered circularly: tails wrap to the start.
"""
import glob
import math
import os
import re

import numpy as np
from scipy.io import wavfile

SR = 44100
LIB = os.environ.get("VSCO", r"C:\Dev\FarFromTheTree\samples\VSCO-2-CE")
NOTE = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}


def midi(name):
    """'D4' -> 62, 'Bb3' -> 58"""
    m = re.fullmatch(r"([A-G][#b]?)(-?\d)", name)
    return NOTE[m.group(1)] + 12 * (int(m.group(2)) + 1)


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


# instrument -> (folder glob, gain, default attack s, release s)
INSTRUMENTS = {
    "cello":      ("Strings/Cello Section/susvib/*.wav", 1.0, 0.18, 0.9),
    "cello_spic": ("Strings/Cello Section/spic/*.wav", 0.9, 0.003, 0.15),
    "cello_trem": ("Strings/Cello Section/trem/*.wav", 0.8, 0.12, 0.6),
    "viola":      ("Strings/Viola Section/susvib/*.wav", 0.8, 0.3, 1.0),
    "viola_spic": ("Strings/Viola Section/spic/*.wav", 0.7, 0.003, 0.15),
    "violins":    ("Strings/Violin Section/susVib/*.wav", 0.85, 0.3, 1.1),
    "vln_trem":   ("Strings/Violin Section/Trem/*.wav", 0.6, 0.2, 0.8),
    "vln_pizz":   ("Strings/Violin Section/Pizz/*.wav", 0.8, 0.002, 0.4),
    "solo_vln":   ("Strings/Solo Violin/Arco Vib/*.wav", 0.75, 0.15, 1.0),
    "bass":       ("Strings/Solo Contrabass/SusVib/*.wav", 1.1, 0.25, 0.9),
    "bass_spic":  ("Strings/Solo Contrabass/Spic/*.wav", 1.0, 0.003, 0.2),
    "harp":       ("Strings/Harp/*.wav", 0.7, 0.002, 2.5),
    "horn":       ("Brass/F Horn/sus/*.wav", 0.7, 0.25, 1.0),
    "glock":      ("Percussion/Glock/*.wav", 0.35, 0.002, 2.5),
}

_VEL = {"pp": 0.15, "p": 0.3, "mp": 0.45, "mf": 0.6, "f": 0.8, "ff": 0.95}


def _vel_of(fn):
    m = re.search(r"_v(\d)", fn)
    if m:
        return int(m.group(1)) / 4.0
    m = re.search(r"_(pp|p|mp|mf|f|ff)[_.]", fn)
    return _VEL[m.group(1)] if m else 0.6


def _load(path):
    r, d = wavfile.read(path)
    scale = {"int16": 2.0 ** 15, "int32": 2.0 ** 31, "uint8": 128.0}.get(str(d.dtype), 1.0)
    d = d.astype(np.float64) / scale
    if str(d.dtype) == "uint8":
        d -= 1.0
    d = d.T if d.ndim == 2 else np.vstack([d, d])
    if r != SR:
        n = int(d.shape[1] * SR / r)
        t = np.linspace(0, d.shape[1] - 1, n)
        d = np.vstack([np.interp(t, np.arange(d.shape[1]), c) for c in d])
    # trim the silence before the note starts (tight timing)
    env = np.abs(d).max(axis=0)
    thr = env.max() * 0.02
    i = int(np.argmax(env > thr))
    return d[:, max(0, i - 64):]


class Inst:
    def __init__(self, name):
        pattern, self.gain, self.attack, self.release = INSTRUMENTS[name]
        self.name = name
        self.samples = []  # (midi, vel, path, rr)
        for p in sorted(glob.glob(os.path.join(LIB, pattern))):
            fn = os.path.basename(p)
            m = re.search(r"_([A-G][#b]?)(-?\d)(?=[_.])", fn)
            if not m:
                continue
            self.samples.append((midi(m.group(1) + m.group(2)), _vel_of(fn), p))
        if not self.samples:
            raise RuntimeError(f"no samples for {name} in {LIB}/{pattern}")
        self.cache = {}
        self.rr = 0

    def pick(self, m, vel):
        # nearest pitch (prefer shifting up a little over down a lot), then nearest velocity, round robin
        best = min(self.samples, key=lambda s: (abs(s[0] - m) + (0.4 if s[0] > m else 0), abs(s[1] - vel)))
        same = [s for s in self.samples if s[0] == best[0] and abs(s[1] - best[1]) < 1e-6]
        self.rr += 1
        s = same[self.rr % len(same)]
        if s[2] not in self.cache:
            self.cache[s[2]] = _load(s[2])
        return s[0], self.cache[s[2]]


class Bus:
    """A stereo mix of length n samples (a loop: notes running past the end wrap to the start)."""

    def __init__(self, seconds, loop=True):
        self.n = int(seconds * SR)
        self.loop = loop
        self.x = np.zeros((2, self.n + (0 if loop else SR * 8)))
        self.insts = {}

    def inst(self, name):
        if name not in self.insts:
            self.insts[name] = Inst(name)
        return self.insts[name]

    def note(self, name, pitch, t, dur, vel=0.6, pan=0.0, attack=None, release=None, swell=False):
        """pitch: 'D4' or a midi number; t, dur in seconds; vel 0..1; pan -1..1; swell: crescendo in"""
        ins = self.inst(name)
        m = midi(pitch) if isinstance(pitch, str) else pitch
        sm, d = ins.pick(m, vel)
        ratio = 2 ** ((m - sm) / 12)
        att = ins.attack if attack is None else attack
        rel = ins.release if release is None else release
        n = int((dur + rel) * SR)
        src = np.arange(n) * ratio
        L = d.shape[1] - 1
        if src[-1] > L:  # shorter than the note: hold the last part (strings sustain samples are long)
            n = int(L / ratio)
            src = src[:n]
        y = np.vstack([np.interp(src, np.arange(L + 1), c) for c in d])
        k = np.arange(n) / SR
        env = np.minimum(1, k / max(att, 1e-3))
        if swell:
            env = (k / max(dur, 1e-3)).clip(0, 1) ** 1.5 * 0.85 + 0.15 * env
        env *= np.where(k < dur, 1.0, np.exp(-(k - dur) / max(rel / 3, 1e-3)))
        y *= env * ins.gain * (0.35 + 0.65 * vel)
        a = (pan + 1) * math.pi / 4
        y[0] *= math.cos(a) * math.sqrt(2)
        y[1] *= math.sin(a) * math.sqrt(2)
        i0 = int(t * SR)
        if self.loop:
            idx = (i0 + np.arange(y.shape[1])) % self.n
            np.add.at(self.x[0], idx, y[0])
            np.add.at(self.x[1], idx, y[1])
        else:
            e = min(self.x.shape[1], i0 + y.shape[1])
            self.x[:, i0:e] += y[:, : e - i0]

    def hit(self, path, t, gain=1.0, pitch_ratio=1.0, pan=0.0):
        """a one-shot sample file (timpani)"""
        d = _load(path)
        if pitch_ratio != 1.0:
            src = np.arange(int((d.shape[1] - 1) / pitch_ratio)) * pitch_ratio
            d = np.vstack([np.interp(src, np.arange(d.shape[1]), c) for c in d])
        a = (pan + 1) * math.pi / 4
        d = d * gain
        d[0] *= math.cos(a) * math.sqrt(2)
        d[1] *= math.sin(a) * math.sqrt(2)
        i0 = int(t * SR)
        idx = (i0 + np.arange(d.shape[1])) % self.x.shape[1]
        np.add.at(self.x[0], idx, d[0])
        np.add.at(self.x[1], idx, d[1])


def fundamental(path):
    """rough pitch (Hz) of a drum sample: the strongest peak 40..250 Hz"""
    d = _load(path).mean(axis=0)[: SR]
    f = np.abs(np.fft.rfft(d * np.hanning(len(d))))
    fr = np.fft.rfftfreq(len(d), 1 / SR)
    band = (fr > 40) & (fr < 250)
    return fr[band][np.argmax(f[band])]
