"""Far From the Tree - the score. A melancholy theme in D minor for strings, harp, horn and
timpani, written here as code and played with real orchestral samples (sampler.py).

    python tools/music/compose.py              # render every layer + the previews
    python tools/music/compose.py --only subway

All layers share the tempo, the key and the 32-bar harmony, and loop seamlessly, so the game can
crossfade between them in time as you change layer (street / rooftops / subway):

  street   cello sings the theme over viola and bass, harp arpeggios underneath
  roof     the theme an octave up on a solo violin, harp and glockenspiel, no bass: open air
  subway   the same harmony driven hard: spiccato cellos and basses in 16ths, tremolo violins,
           the theme on the horn, timpani hits and rolls into every phrase
  title    the theme alone on the cello with a little harp: for the title screen

Writes WAVs to tools/music/out and Opus/MP3 to web/public/music (and mp3 previews to
tools/music/previews, including a street -> roof -> subway -> street walk-through).
"""
import argparse
import math
import os
import subprocess
import sys

import numpy as np
from scipy.io import wavfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "audio"))
import sampler as S  # noqa: E402
import dsp  # noqa: E402

BPM = 72
BEAT = 60 / BPM
BAR = 4 * BEAT
BARS = 32
LENGTH = BARS * BAR

# ---------------------------------------------------------------- the harmony (one chord a bar)
CHORDS = {
    "Dm": ["D", "F", "A"], "Bb": ["Bb", "D", "F"], "F": ["F", "A", "C"], "C": ["C", "E", "G"],
    "Gm": ["G", "Bb", "D"], "A": ["A", "C#", "E"], "Asus": ["A", "D", "E"], "Eb": ["Eb", "G", "Bb"],
}
PROG = (["Dm", "Bb", "F", "C", "Gm", "Dm", "Bb", "A"]
        + ["Dm", "Bb", "Gm", "A", "Dm", "F", "Gm", "A"]
        + ["Bb", "F", "Gm", "Dm", "Bb", "C", "Asus", "A"]
        + ["Dm", "Gm", "Bb", "A", "Dm", "Bb", "A", "Dm"])

# ---------------------------------------------------------------- the theme (note, beats) per bar
THEME = [
    # A: the last leaf on the branch
    [("A3", 2), ("D4", 1), ("E4", 1)], [("F4", 3), ("E4", .5), ("D4", .5)], [("C4", 2), ("A3", 2)],
    [("G3", 1), ("A3", 1), ("Bb3", 1), ("C4", 1)], [("D4", 3), ("Bb3", 1)], [("A3", 4)],
    [("G3", 1), ("A3", 1), ("Bb3", 1), ("D4", 1)], [("C#4", 3), ("E4", 1)],
    # B: it lets go
    [("F4", 2), ("E4", 1), ("D4", 1)], [("D4", 2), ("F4", 2)], [("G4", 3), ("F4", .5), ("E4", .5)],
    [("E4", 2), ("C#4", 2)], [("D4", 1), ("F4", 1), ("A4", 2)], [("A4", 2), ("G4", 1), ("F4", 1)],
    [("Bb4", 2), ("A4", 1), ("G4", 1)], [("A4", 4)],
    # C: high over the city (an octave up, violins)
    [("D5", 3), ("C5", 1)], [("C5", 2), ("A4", 2)], [("Bb4", 2), ("D5", 2)], [("A4", 4)],
    [("F5", 3), ("E5", .5), ("D5", .5)], [("E5", 2), ("C5", 2)], [("D5", 4)], [("C#5", 4)],
    # A': home, or nearly
    [("A3", 2), ("D4", 1), ("E4", 1)], [("D4", 3), ("Bb3", 1)], [("F4", 2), ("D4", 2)],
    [("E4", 2), ("C#4", 2)], [("F4", 2), ("E4", 1), ("D4", 1)], [("D4", 2), ("F4", 2)],
    [("E4", 3), ("C#4", 1)], [("D4", 4)],
]


def shift(name, semis):
    return S.midi(name) + semis


def tone(name, octave):
    return f"{name}{octave}"


def chord_notes(bar, octave, voicing=(0, 1, 2)):
    c = CHORDS[PROG[bar % BARS]]
    out = []
    prev = -1
    for i in voicing:
        m = S.midi(tone(c[i % 3], octave)) + 12 * (i // 3)
        while m <= prev:
            m += 12
        out.append(m)
        prev = m
    return out


def melody(bus, inst, bars, semis=0, vel=0.6, pan=0.0, legato=0.15, vel_shape=True):
    for b in bars:
        t = b * BAR
        line = THEME[b % BARS]
        for i, (n, beats) in enumerate(line):
            dur = beats * BEAT
            # phrase shape: louder toward the long notes, a breath at phrase ends
            v = vel * (1.0 + 0.15 * (beats >= 2)) if vel_shape else vel
            bus.note(inst, shift(n, semis), t, dur + legato, vel=min(1, v), pan=pan)
            t += dur


def harp_arps(bus, bars, octave=2, vel=0.5, pattern=(0, 1, 2, 3, 4, 3, 2, 1), pan=-0.3):
    for b in bars:
        notes = chord_notes(b, octave, voicing=(0, 2, 4, 5, 7))  # root, fifth, third up, root, fifth
        for k, idx in enumerate(pattern):
            m = notes[idx % len(notes)]
            bus.note("harp", m, b * BAR + k * BEAT / 2, BEAT * 1.5, vel=vel * (1.1 if k == 0 else 0.85), pan=pan + 0.08 * (k % 3))


def pads(bus, inst, bars, octave, vel, voicing=(1, 2), pan=0.0, swell=False):
    for b in bars:
        for m in chord_notes(b, octave, voicing):
            bus.note(inst, m, b * BAR, BAR + 0.25, vel=vel, pan=pan, swell=swell)


def bass_roots(bus, bars, octave=1, vel=0.55):
    for b in bars:
        root = CHORDS[PROG[b % BARS]][0]
        # the lowest one at or above E1 (the bottom of the double bass)
        bus.note("bass", tone(root, 2 if root in ("C", "C#", "D", "Eb") else octave), b * BAR, BAR + 0.2, vel=vel, pan=0.15)


def ostinato(bus, bars, vel=0.7):
    """the subway: 16ths in the low strings, root and fifth, accents on the beat"""
    for b in bars:
        c = CHORDS[PROG[b % BARS]]
        root = S.midi(tone(c[0], 2))
        if root > S.midi("E2"):
            root -= 12
        fifth = root + 7
        for k in range(16):
            t = b * BAR + k * BEAT / 4
            acc = 1.0 if k % 4 == 0 else 0.75
            m = [root, root, fifth, root][k % 4] + (12 if k in (6, 14) else 0)
            bus.note("cello_spic", m + 12, t, BEAT / 4, vel=vel * acc, pan=-0.25)
            if k % 2 == 0:
                bus.note("bass_spic", m, t, BEAT / 2, vel=vel * acc, pan=0.2)


def viola_offbeats(bus, bars, vel=0.5):
    for b in bars:
        third = chord_notes(b, 3, (1,))[0]
        for k in range(4):
            bus.note("viola_spic", third, b * BAR + (k + 0.5) * BEAT, BEAT / 2, vel=vel, pan=0.3)


def timpani(bus, bars):
    """hits on the bar, a roll building into each new phrase; drums tuned to the chord root"""
    lib = S.LIB
    hits = sorted(p for p in __import__("glob").glob(os.path.join(lib, "Percussion/Timpani/Timpani*_Hit_v3_rr1_Sum.wav")))
    rolls = sorted(p for p in __import__("glob").glob(os.path.join(lib, "Percussion/Timpani/Rolls/*_v5_*.wav")))
    tune = {p: S.fundamental(p) for p in hits + rolls}

    def nearest(paths, f):
        p = min(paths, key=lambda q: abs(math.log(tune[q] / f)))
        return p, f / tune[p]

    for b in bars:
        root = CHORDS[PROG[b % BARS]][0]
        f = S.hz(S.midi(tone(root, 2)))
        while f > 130:
            f /= 2
        while f < 65:
            f *= 2
        p, r = nearest(hits, f)
        bus.hit(p, b * BAR, gain=0.9 if b % 8 == 0 else 0.55, pitch_ratio=r, pan=0.1)
        if b % 2 == 1:
            bus.hit(p, b * BAR + 2.5 * BEAT, gain=0.4, pitch_ratio=r, pan=0.1)
        if b % 8 == 7:  # the roll into the next phrase
            p, r = nearest(rolls, S.hz(S.midi("A2")))
            bus.hit(p, b * BAR + 0.5 * BEAT, gain=0.7, pitch_ratio=r, pan=0.0)


# ---------------------------------------------------------------- the layers
ALL = range(BARS)


def layer_street(bus):
    melody(bus, "cello", [b for b in ALL if b // 8 != 2], vel=0.62, pan=-0.15)
    melody(bus, "violins", [b for b in ALL if b // 8 == 2], vel=0.8, pan=0.2)
    melody(bus, "solo_vln", [b for b in ALL if b // 8 == 2], vel=0.55, pan=-0.1)
    pads(bus, "viola", ALL, 3, 0.32, voicing=(1, 2), pan=0.25)
    pads(bus, "violins", [b for b in ALL if b // 8 in (1, 3)], 4, 0.22, voicing=(0, 2), pan=0.35)
    bass_roots(bus, ALL, vel=0.5)
    harp_arps(bus, ALL, octave=2, vel=0.42)


def layer_roof(bus):
    melody(bus, "solo_vln", [b for b in ALL if b // 8 != 2], semis=12, vel=0.5, pan=0.1)
    melody(bus, "violins", [b for b in ALL if b // 8 == 2], vel=0.5, pan=0.15)
    pads(bus, "violins", ALL, 4, 0.2, voicing=(0, 1, 2), pan=-0.2)
    harp_arps(bus, ALL, octave=3, vel=0.35, pattern=(0, 2, 4, 2, 3, 2, 4, 2), pan=-0.35)
    for b in range(0, BARS, 2):
        root = chord_notes(b, 5, (0,))[0]
        bus.note("glock", root, b * BAR, BEAT * 2, vel=0.4, pan=0.4)
        bus.note("glock", root + 7, b * BAR + 1.5 * BEAT, BEAT * 2, vel=0.3, pan=0.45)


def layer_subway(bus):
    ostinato(bus, ALL, vel=0.72)
    viola_offbeats(bus, ALL, vel=0.45)
    pads(bus, "vln_trem", ALL, 4, 0.45, voicing=(0, 1, 2), pan=0.25, swell=True)
    melody(bus, "horn", [b for b in ALL if b // 8 != 2], vel=0.62, pan=-0.1, legato=0.05)
    melody(bus, "violins", [b for b in ALL if b // 8 == 2], vel=0.7, pan=0.1)
    bass_roots(bus, ALL, vel=0.45)
    timpani(bus, ALL)


def layer_title(bus):
    melody(bus, "cello", range(16), vel=0.55, pan=0.0)
    harp_arps(bus, range(16), octave=2, vel=0.3, pattern=(0, 2, 4, 2, 0, 2, 4, 2))
    pads(bus, "viola", range(16), 3, 0.18, voicing=(1, 2), pan=0.3)
    bass_roots(bus, range(16), vel=0.35)


LAYERS = {"street": (layer_street, BARS), "roof": (layer_roof, BARS), "subway": (layer_subway, BARS), "title": (layer_title, 16)}

HALL = None


def hall():
    global HALL
    if HALL is None:
        early = [(0.018, 0.5, -0.6), (0.026, 0.45, 0.5), (0.037, 0.4, -0.2), (0.049, 0.35, 0.7),
                 (0.063, 0.3, -0.5), (0.081, 0.25, 0.3)]
        HALL = dsp.make_ir("music_hall", 3.2, (2.9, 2.4, 1.3), xover=(250, 4000), predelay=0.02, early=early,
                           er_lp=7000, onset=0.05)
    return HALL


def render(name):
    fn, bars = LAYERS[name]
    bus = S.Bus(bars * BAR, loop=True)
    fn(bus)
    x = dsp.reverb(bus.x, hall(), wet=0.32, dry=0.85, circular=True)
    # gentle master: lift to a common loudness, soft-limit peaks
    rms = math.sqrt(np.mean(x ** 2))
    x *= 0.12 / max(rms, 1e-9)
    x = np.tanh(x * 1.1) / 1.1
    return x


def write(name, x, outdir):
    os.makedirs(outdir, exist_ok=True)
    p = os.path.join(outdir, f"{name}.wav")
    wavfile.write(p, S.SR, (x.T * 32767).clip(-32768, 32767).astype(np.int16))
    return p


def encode(wav, out, fmt):
    args = ["ffmpeg", "-v", "error", "-y", "-threads", "1", "-i", wav]
    args += (["-c:a", "libopus", "-b:a", "96k"] if fmt == "opus" else ["-c:a", "libmp3lame", "-q:a", "3"])
    subprocess.run(args + [out], check=True, creationflags=0x00000040 if os.name == "nt" else 0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    names = [n for n in LAYERS if not a.only or n in a.only.split(",")]
    wavs = os.path.join(HERE, "out")
    prev = os.path.join(HERE, "previews")
    os.makedirs(prev, exist_ok=True)
    done = {}
    for n in names:
        print("rendering", n, flush=True)
        x = render(n)
        done[n] = x
        w = write(n, x, wavs)
        encode(w, os.path.join(prev, f"{n}.mp3"), "mp3")
    # the walk-through: street, up onto the roofs, down into the subway, back up to the street,
    # crossfading in time (the game does the same)
    if all(k in done for k in ("street", "roof", "subway")):
        L = done["street"].shape[1]
        seg = [("street", 0, 0.25), ("roof", 0.25, 0.5), ("subway", 0.5, 0.8), ("street", 0.8, 1.0)]
        out = np.zeros((2, L))
        fade = int(2.5 * S.SR)
        for nm, a0, a1 in seg:
            i0, i1 = int(a0 * L), int(a1 * L)
            w = np.zeros(L)
            w[i0:i1] = 1
            if i0 > 0:
                w[i0 - fade // 2:i0 + fade // 2] = np.linspace(0, 1, fade)
            if i1 < L:
                w[i1 - fade // 2:i1 + fade // 2] = np.linspace(1, 0, fade)
            out += done[nm] * w
        encode(write("walkthrough", out, wavs), os.path.join(prev, "walkthrough.mp3"), "mp3")
    print("done")


if __name__ == "__main__":
    try:
        import ctypes
        ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x00004000)  # below normal
    except Exception:
        pass
    main()
