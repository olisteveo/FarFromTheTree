"""'The Last Leaf' - original solo piano score for the intro cutscene (F major, 3/4).

    <blender python> score.py            -> render piano, mix with the stems, write previews
    <blender python> score.py --apply    -> ALSO remux web/public/video/intro.mp4/.webm (video copied)

Needs numpy (Blender's bundled python has it) and ffmpeg. Runs at idle priority, <= 6 workers.
Big intermediates go to .tesseract-work/score (gitignored); previews to ../preview (gitignored).

Timing map (film seconds, from build.py / people.py):
  0.0 -  5.5  summer, people        bars 1-2   p, LH quarters/eighths, motif enters (pickup C5)
  5.5 - 15.0  time-lapse            bars 3-6   warmer: flowing LH, octave melody, lydian G/F -> C peak ~14s
 15.0 - 26.0  autumn gusts          bars 7-10  bittersweet: Dm, borrowed Bbm6 (Db), Gm11, Dbmaj7 -> Csus;
                                               falling-leaf flurries on gusts 16.2/18.4/22.5, last cluster 24.6
 26.0 - 35.8  the last leaf, snow   bars 11-13 pp, a few exposed notes, opening motif an octave up, unfinished
 35.8 - 44.0  title                 Bbmaj9 (IV, unresolved/hopeful) rolled on the title, lydian E6 at ~39.6
"""
import os, sys, math, json, subprocess, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import numpy as np
import piano as P

SR = P.SR
DUR = 44.0
ROOT = os.path.dirname(HERE)                       # tools/cutscene
WORK = P.WORK
PREVIEW = os.path.join(ROOT, "preview")
VIDEO = os.path.normpath(os.path.join(ROOT, "..", "..", "public", "video"))

NAMES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def n(s):
    """'F2', 'Bb1', 'C#5' -> midi"""
    k = NAMES[s[0]]
    i = 1
    while s[i] in "b#":
        k += -1 if s[i] == "b" else 1
        i += 1
    return 12 * (int(s[i:]) + 1) + k


def ns(txt):
    return [n(x) for x in txt.split()]


# ----------------------------------------------------------------------------- the piece
# bar: (start s, length s, LH voicing, LH pattern, LH vel, melody [(beat, beats, pitch(es), vel)], pedal changes (beats))
# beats are 1-based (1, 1.5, 2 ...) in 3/4.
BARS = [
    # --- summer: tender
    (0.30, 2.60, "F2 C3 A3 G3", "q", 0.30, [(3, 1, "C5", 0.40)], [1]),
    (2.90, 2.60, "F2 C3 A3 E4", "e6", 0.31, [(1, 1.5, "F5", 0.46), (2.5, 0.5, "E5", 0.38), (3, 1, "C5", 0.40)], [1]),
    # --- time-lapse: warmer, fuller
    (5.50, 2.45, "Bb1 F2 C3 D3", "flow", 0.36, [(1, 2, "D5 F4", 0.50), (3, 0.5, "C5", 0.42), (3.5, 0.5, "Bb4", 0.42)], [1]),
    (7.95, 2.35, "D2 A2 E3 F3", "flow", 0.40, [(1, 1, "A4 F4", 0.50), (2, 1, "C5 A4", 0.52), (3, 1, "F5 C5", 0.56)], [1]),
    (10.30, 2.30, "G1 D2 A2 Bb2", "wide", 0.45, [(1, 1.5, "G5 G4 D5", 0.62), (2.5, 0.5, "A5 A4", 0.55), (3, 0.5, "G5 G4", 0.55), (3.5, 0.5, "F5 F4", 0.54)], [1]),
    (12.60, 2.40, "F2 D3 G3 B3|C2 G2 E3 C4", "split", 0.48, [(1, 1, "A5 A4 D5", 0.64), (2, 1, "B5 B4 D5", 0.68), (3, 1.0, "C6 C5 E5 G5", 0.70)], [1, 3]),
    # --- autumn: bittersweet turn
    (15.00, 2.60, "D2 A2 F3 C4", "flow", 0.40, [(1, 1.5, "A5 F5", 0.56), (2.5, 0.5, "G5", 0.46), (3, 1, "F5", 0.46)], [1]),
    (17.60, 2.90, "Bb1 F2 Db3 G3", "flow", 0.37, [(1, 2, "Db5 F4", 0.56), (3, 1, "C5", 0.46)], [1]),
    (20.50, 2.75, "G1 D2 F2 Bb2", "flow", 0.35, [(1, 1.5, "C5", 0.46), (2.5, 0.5, "Bb4", 0.38), (3, 1, "A4", 0.40)], [1]),
    (23.25, 2.75, "Db2 Ab2 C3 F3|C2 G2 F3", "split", 0.32, [(1, 2, "F5 Ab4", 0.44), (3, 1, "E5 G4", 0.38)], [1, 3]),
    # --- the last leaf: exposed
    (26.00, 3.30, "F1 C2", "bass", 0.24, [(3, 1, "C6", 0.44)], [1]),
    (29.30, 3.30, "Bb0 F1", "bass", 0.22, [(1, 1.5, "F6", 0.48), (2.5, 1.0, "E6", 0.40)], [1]),
    (32.60, 3.20, "D1 A1", "bass", 0.21, [(1, 2, "D6", 0.44), (3, 3.0, "C6", 0.38)], [1]),
]
FLURRIES = [(16.20, "F6 D6 C6 A5", 0.20), (18.40, "F6 Db6 Bb5 F5", 0.19), (22.50, "D6 Bb5 G5 F5", 0.18), (24.60, "C6 Ab5 F5", 0.17)]
TITLE_T = 35.80
TITLE_CHORD = "Bb0 F1 F2 C3 D3 A3"       # rolled upward on the title (Bbmaj9 - IV, unresolved)
TITLE_TOP = (TITLE_T + 0.62, "A4", 0.34)
LAST_NOTE = (39.60, "E6", 0.38)           # lydian #11 over Bb: a small hopeful shimmer


def warp(x, a=0.07):
    """agogic: linger a little on the downbeat (x in 0..1 of the bar)."""
    return x + a * math.sin(2 * math.pi * x) / (2 * math.pi)


def btime(bar, beat):
    s, L = bar[0], bar[1]
    return s + L * warp((beat - 1) / 3.0)


def build_notes(seed=11):
    rng = np.random.default_rng(seed)
    notes, pedal_marks = [], []
    hum = lambda: rng.normal(0, 0.006)
    for bi, bar in enumerate(BARS):
        s, L, voic, pat, lv, mel, pch = bar
        end = s + L
        for b in pch:
            pedal_marks.append(btime(bar, b))
        # ---- left hand
        if pat == "split":
            v1, v2 = [ns(x) for x in voic.split("|")]
        else:
            v1 = v2 = ns(voic)
        ev = []
        if pat == "q":
            ev = [(1, v1[0]), (2, v1[1]), (3, v1[2]), (3.5, v1[3])]
        elif pat == "e6":
            ev = [(1, v1[0]), (1.5, v1[1]), (2, v1[2]), (2.5, v1[3]), (3, v1[2]), (3.5, v1[1])]
        elif pat == "flow":
            ev = [(1, v1[0]), (1.5, v1[1]), (2, v1[2]), (2.5, v1[3]), (3, v1[2]), (3.5, v1[1])]
        elif pat == "wide":
            ev = [(1, v1[0]), (1.5, v1[1]), (2, v1[2]), (2.5, v1[3]), (3, v1[1] + 12), (3.5, v1[2])]
        elif pat == "split":
            ev = [(1, v1[0]), (1.5, v1[1]), (2, v1[2]), (2.5, v1[3]), (3, v2[0]), (3.5, v2[1])] + [(3.75, x) for x in v2[2:3]]
        elif pat == "bass":
            ev = [(1, v1[0]), (1.02, v1[1])]
        for k, (b, m) in enumerate(ev):
            t = btime(bar, b) + hum()
            accent = 1.12 if b == 1 else (0.92 if b % 1 else 1.0)
            v = 0.85 * lv * accent * (1 + rng.normal(0, 0.03))
            notes.append((t, t + 0.30, m, float(np.clip(v, 0.1, 0.9))))
        # ---- melody (+ doubled / inner notes as chords; top note sings, others softer)
        for (b, d, ptxt, v) in mel:
            t = btime(bar, b) + 0.012 + hum()                     # melody a hair after the bass
            t_off = btime(bar, b + d) if b + d <= 4 else end + (b + d - 4) * L / 3
            ps = ns(ptxt)
            for j, m in enumerate(ps):
                vv = v if j == 0 else v * (0.78 if m < ps[0] - 7 else 0.70)
                notes.append((t + 0.008 * j, t_off + 0.03, m, float(np.clip(vv * (1 + rng.normal(0, 0.02)), 0.1, 0.9))))
    for (t0, txt, v) in FLURRIES:
        for k, m in enumerate(ns(txt)):
            t = t0 + k * 0.105 + k * k * 0.012 + hum()
            notes.append((t, t + 0.25, m, v * (1 - 0.08 * k)))
    # title chord, rolled slowly upward
    for k, m in enumerate(ns(TITLE_CHORD)):
        t = TITLE_T + k * 0.085 + hum()
        notes.append((t, DUR, m, 0.30 - 0.010 * k))
    t, p, v = TITLE_TOP
    notes.append((t, DUR, n(p), v))
    t, p, v = LAST_NOTE
    notes.append((t, DUR, n(p), v))
    # pedal: legato pedalling (up just before a change, down just after)
    pedal = []
    marks = sorted(pedal_marks) + [TITLE_T]
    for i, a in enumerate(marks):
        b = marks[i + 1] if i + 1 < len(marks) else DUR + 1
        pedal.append((a + 0.07, b - 0.015))
    pedal.append((TITLE_T + 0.07, DUR + 1))
    pedal = [p for p in pedal if p[1] > p[0]]
    # merge the duplicated title entry
    pedal = sorted(set(pedal))
    return sorted(notes), pedal


# ----------------------------------------------------------------------------- mixing
STEMS = {"sfx-wind": "wind", "sfx-lapse": "lapse", "sfx-rustle": "rustle", "sfx-music": "music",
         "scene-amb-v1": "amb", "scene-harbour-v1": "harbour", "scene-people-v1": "people"}
DUCK = {"amb": 3.5, "harbour": 3.0, "wind": 3.0, "people": 1.5}   # max dB of ducking under the piano


def envelope_db(x, win=0.05):
    hop = int(win * SR)
    m = np.mean(x ** 2, 1)
    nb = len(m) // hop
    p = 10 * np.log10(m[:nb * hop].reshape(nb, hop).mean(1) + 1e-12)
    out = np.empty(nb)
    e = p[0]
    for i in range(nb):
        c = 0.6 if p[i] > e else 0.93          # ~100 ms attack, ~700 ms release
        e = c * e + (1 - c) * p[i]
        out[i] = e
    return np.interp(np.arange(len(m)), np.arange(nb) * hop + hop / 2, out)


def ebur128(path):
    r = subprocess.run([P.FFMPEG, "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True)
    txt = r.stderr[r.stderr.rfind("Summary"):]
    I = float(txt.split("I:")[1].split("LUFS")[0])
    TP = float(txt.split("Peak:")[1].split("dBFS")[0])
    return I, TP


def limit(x, ceiling_db=-1.5, look=0.0015, rel=0.08):
    c = 10 ** (ceiling_db / 20)
    a = np.abs(x).max(1)
    w = int(look * SR)
    # running max over look-ahead window
    pad = np.concatenate([a, np.zeros(w)])
    from numpy.lib.stride_tricks import sliding_window_view
    pk = sliding_window_view(pad, w + 1).max(1)[:len(a)]
    g = np.minimum(1.0, c / (pk + 1e-12))
    hop = 48
    gb = g[:len(g) // hop * hop].reshape(-1, hop).min(1)
    out = np.empty_like(gb)
    e = 1.0
    cr = math.exp(-1 / (rel * SR / hop))
    for i, v in enumerate(gb):
        e = v if v < e else cr * e + (1 - cr) * v
        out[i] = e
    gs = np.interp(np.arange(len(g)), np.arange(len(gb)) * hop, out)
    return x * np.minimum(gs, g)[:, None]


def main():
    P.low_priority()
    os.makedirs(WORK, exist_ok=True)
    os.makedirs(PREVIEW, exist_ok=True)
    notes, pedal = build_notes()
    print("notes:", len(notes), "pedal changes:", len(pedal))
    json.dump({"notes": notes, "pedal": pedal}, open(os.path.join(WORK, "score_events.json"), "w"))
    pno = P.render(notes, pedal, DUR + 0.0, felt=0.35, reverb=0.32, workers=6)
    pno = P.compress(pno, thr_db=-24, ratio=1.5, att=0.03, rel=0.4)
    t = np.arange(len(pno)) / SR
    pno *= np.clip((DUR - t) / 0.6, 0, 1)[:, None] ** 0.5       # avoid a hard cut at the very end
    # piano alone, mastered to about -16 LUFS for the listening preview
    raw = os.path.join(WORK, "piano_raw.wav")
    P.write_f32(raw, pno)
    I, _ = ebur128(raw)
    solo = limit(pno * 10 ** ((-16.0 - I) / 20), -1.5)
    P.write_f32(os.path.join(WORK, "piano_solo.wav"), solo)

    # ---- full mix: stems at their Tesseract volumes, old music stem replaced by the piano
    stems = json.load(open(os.path.join(HERE, "stems.json")))
    N = len(pno)
    env = envelope_db(pno)
    duck_k = np.clip((env - (env.max() - 30)) / 24, 0, 1)        # 0 when piano quiet, 1 near its loudest
    mix = np.zeros((N, 2))
    for s in stems:
        name = STEMS[s["assetId"]]
        if name == "music":
            continue
        x = P.read_audio(os.path.join(HERE, name + ".wav"))[:N]
        x = np.pad(x, ((0, N - len(x)), (0, 0)))
        g = s["volume"] * 10 ** (-DUCK.get(name, 0.0) * duck_k / 20)
        mix += x * g[:, None]
    # piano level: sit where the music-box stem sat, plus ~3 dB (it now carries the scene)
    old = P.read_audio(os.path.join(HERE, "music.wav"))[:N] * 1.0
    rms = lambda y: np.sqrt(np.mean(y ** 2))
    pg = rms(old) / rms(pno) * 10 ** (3.0 / 20)
    mix += pno * pg
    pre = os.path.join(WORK, "mix_pre.wav")
    P.write_f32(pre, mix)
    I, _ = ebur128(pre)
    mix = limit(mix * 10 ** ((-16.0 - I) / 20), -1.5)
    out = os.path.join(WORK, "mix.wav")
    P.write_f32(out, mix)
    I2, TP = ebur128(out)
    print("mix: %.1f LUFS, true peak %.1f dBTP" % (I2, TP))

    # ---- previews
    ff = [P.FFMPEG, "-v", "error", "-y"]
    subprocess.run(ff + ["-i", os.path.join(WORK, "piano_solo.wav"), "-c:a", "libmp3lame", "-q:a", "2", os.path.join(PREVIEW, "intro_piano.mp3")], check=True)
    subprocess.run(ff + ["-i", out, "-c:a", "libmp3lame", "-q:a", "2", os.path.join(PREVIEW, "intro_soundtrack.mp3")], check=True)
    src_mp4 = os.path.join(VIDEO, "intro.mp4")
    subprocess.run(ff + ["-i", src_mp4, "-i", out, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
                         "-ar", "48000", "-movflags", "+faststart", "-shortest", os.path.join(PREVIEW, "intro_preview.mp4")], check=True)
    if "--apply" in sys.argv:
        src_webm = os.path.join(VIDEO, "intro.webm")
        tmp4, tmpw = os.path.join(WORK, "intro.mp4"), os.path.join(WORK, "intro.webm")
        subprocess.run(ff + ["-i", src_mp4, "-i", out, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
                             "-movflags", "+faststart", "-shortest", tmp4], check=True)
        subprocess.run(ff + ["-i", src_webm, "-i", out, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "libopus", "-b:a", "128k",
                             "-shortest", tmpw], check=True)
        for f in (tmp4, tmpw):
            assert os.path.getsize(f) < 24_000_000, f
            shutil.copy(f, os.path.join(VIDEO, os.path.basename(f)))
    for f in os.listdir(PREVIEW):
        print("preview", f, os.path.getsize(os.path.join(PREVIEW, f)))


if __name__ == "__main__":
    main()
