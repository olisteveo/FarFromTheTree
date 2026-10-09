"""Synthesises the intro's sound stems locally (no samples, no copyrighted music).

  python make_audio.py      -> writes wind.wav, lapse.wav, rustle.wav, music.wav (+ ir.wav)

Stems are imported into intro.tsrct as separate Audio layers (see ../render.sh).
Timing is shared with ../build.py (gusts, time-lapse rate and day phase).
"""
import math, os, random, struct, subprocess, sys, wave, glob

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import build as B  # noqa: E402

SR = 44100
DUR = B.DUR
N = int(SR * DUR)
FFMPEG = glob.glob(os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\*\bin\ffmpeg.exe"))[0]


def write_wav(path, L, R=None, peak_db=-3.0):
    R = R if R is not None else L
    m = max(max(abs(x) for x in L), max(abs(x) for x in R)) or 1.0
    g = 10 ** (peak_db / 20) / m
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        buf = bytearray()
        for a, b in zip(L, R):
            buf += struct.pack("<hh", int(max(-1, min(1, a * g)) * 32767), int(max(-1, min(1, b * g)) * 32767))
        w.writeframes(bytes(buf))


class Biquad:
    def __init__(self, kind, f, q=0.707):
        w0 = 2 * math.pi * f / SR
        a = math.sin(w0) / (2 * q)
        c = math.cos(w0)
        if kind == "bp":
            b0, b1, b2 = a, 0, -a
        elif kind == "lp":
            b0, b1, b2 = (1 - c) / 2, 1 - c, (1 - c) / 2
        else:  # hp
            b0, b1, b2 = (1 + c) / 2, -(1 + c), (1 + c) / 2
        a0, a1, a2 = 1 + a, -2 * c, 1 - a
        self.k = (b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
        self.z = [0.0, 0.0, 0.0, 0.0]

    def __call__(self, x):
        b0, b1, b2, a1, a2 = self.k
        x1, x2, y1, y2 = self.z
        y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        self.z = [x, x1, y, y1]
        return y


def ss(a, b, x):
    return B.ss(a, b, x)


# ------------------------------------------------------------------------------ wind
def make_wind():
    """Two filtered-noise layers (low body + airy hiss) following the gust curve."""
    out = os.path.join(HERE, "wind.wav")
    gust = "+".join("%.2f*exp(-pow((t-%.2f)/0.95,2))" % (a, g) for g, a in B.GUSTS)
    env = ("0.32+0.08*sin(t*0.63)+0.06*sin(t*1.7)"
           "+0.18*clip((t-5.5)/3,0,1)*clip((16-t)/3,0,1)*(0.5+0.5*sin(t*6.1))"
           "+1.5*(%s)"
           "+0.32*clip((t-25)/3.5,0,1)*(0.75+0.25*sin(t*0.9)+0.15*sin(t*2.3))"
           "-0.10*clip((t-40)/4,0,1)") % gust
    air_env = "(%s)*(%s)" % (env, "0.35+0.65*clip((t-14)/3,0,1)")
    fc = ("anoisesrc=d={d}:c=brown:r={sr}:a=0.9:seed=11,lowpass=f=420,highpass=f=50,volume='{e}':eval=frame[l1];"
          "anoisesrc=d={d}:c=brown:r={sr}:a=0.9:seed=12,lowpass=f=420,highpass=f=50,volume='{e}':eval=frame[r1];"
          "anoisesrc=d={d}:c=pink:r={sr}:a=0.5:seed=13,bandpass=f=1500:width_type=q:w=0.9,volume='{a}':eval=frame[l2];"
          "anoisesrc=d={d}:c=pink:r={sr}:a=0.5:seed=14,bandpass=f=1700:width_type=q:w=0.9,volume='{a}':eval=frame[r2];"
          "[l1][l2]amix=inputs=2:normalize=0[L];[r1][r2]amix=inputs=2:normalize=0[R];"
          "[L][R]join=inputs=2:channel_layout=stereo,afade=t=in:d=1.2,alimiter=limit=0.7").format(d=DUR, sr=SR, e=env, a=air_env)
    subprocess.run([FFMPEG, "-nostdin", "-y", "-hide_banner", "-loglevel", "error", "-filter_complex", fc,
                    "-c:a", "pcm_s16le", out], check=True)


# ------------------------------------------------------------------------------ time racing
def make_lapse():
    """Clock ticks that accelerate with the time-lapse plus a day/night 'whum' of filtered air."""
    rnd = random.Random(5)
    L = [0.0] * N
    R = [0.0] * N
    # ticks
    acc = 0.0
    t = 0.0
    dt = 1.0 / SR
    tick_n = 0
    tick_shape = []
    for i in range(int(0.03 * SR)):
        tt = i / SR
        tick_shape.append(math.exp(-tt * 260) * (0.6 * math.sin(2 * math.pi * 3150 * tt) + 0.4 * math.sin(2 * math.pi * 5230 * tt)))
    for i in range(N):
        t = i * dt
        r = B.rate(t, B.PEAK)
        lapse = ss(5.0, 7.0, t) * (1 - ss(15.5, 18.5, t))
        acc += (1.6 + 9.0 * r / B.PEAK) * dt
        if acc >= 1.0 and lapse > 0.02:
            acc -= 1.0
            tick_n += 1
            amp = lapse * (0.55 if tick_n % 2 else 0.4) * (0.9 + 0.2 * rnd.random())
            pan = 0.35 if tick_n % 2 else -0.35
            for j, v in enumerate(tick_shape):
                k = i + j
                if k < N:
                    L[k] += v * amp * (1 - pan)
                    R[k] += v * amp * (1 + pan)
        elif acc >= 1.0:
            acc -= 1.0
    # whum: band-passed noise pulsing once per (raced) day, sweeping up as speed increases
    bp1, bp2 = Biquad("bp", 600, 1.2), Biquad("bp", 640, 1.2)
    lp = Biquad("lp", 2500)
    for i in range(N):
        t = i * dt
        r = B.rate(t, B.PEAK)
        lapse = ss(5.2, 8.0, t) * (1 - ss(14.5, 18.0, t))
        if lapse <= 0.0005:
            continue
        ph = B.phase_at(t)
        pulse = 0.35 + 0.65 * (0.5 + 0.5 * math.sin(2 * math.pi * (ph - 0.25)))
        n1 = rnd.uniform(-1, 1)
        n2 = rnd.uniform(-1, 1)
        g = lapse * pulse * (0.35 + 0.65 * r / B.PEAK) * 2.2
        L[i] += lp(bp1(n1)) * g
        R[i] += bp2(n2) * g
    write_wav(os.path.join(HERE, "lapse.wav"), L, R, -4)


# ------------------------------------------------------------------------------ rustle
def make_rustle():
    """Crackly leaf grains on every gust, a few early strays, the hero leaf shivering later."""
    rnd = random.Random(8)
    L = [0.0] * N
    R = [0.0] * N
    events = []
    for k in range(4):
        events.append((11.5 + k * 1.0, 0.35, 0.8))
    for g, a in B.GUSTS:
        for j in range(7):
            events.append((g - 0.6 + rnd.uniform(0, 1.4), a * rnd.uniform(0.5, 1.0), rnd.uniform(0.6, 1.5)))
    for k in range(9):  # the last leaf trembling (small, close)
        events.append((27.0 + k * 1.6 + rnd.uniform(0, 0.7), 0.14, 0.45))
    for (t0, amp, dur) in events:
        i0 = int(t0 * SR)
        n = int(dur * SR)
        hp = Biquad("hp", 2200)
        bp = Biquad("bp", rnd.uniform(3200, 5200), 0.8)
        pan = rnd.uniform(-0.5, 0.9)  # mostly blowing right, toward the city
        hold = 0.0
        cnt = 0
        for j in range(n):
            if cnt <= 0:
                hold = rnd.random() ** 3
                cnt = int(SR * rnd.uniform(0.004, 0.022))
            cnt -= 1
            tt = j / n
            e = min(1.0, tt / 0.12) * (1 - tt) ** 1.6
            p = pan + 0.6 * (tt - 0.5)  # sweep right
            v = bp(hp(rnd.uniform(-1, 1))) * hold * e * amp
            k = i0 + j
            if 0 <= k < N:
                L[k] += v * (1 - p) * 0.5
                R[k] += v * (1 + p) * 0.5
    write_wav(os.path.join(HERE, "rustle.wav"), L, R, -4)


# ------------------------------------------------------------------------------ music box
def midi_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


NOTE = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}


def nm(s):
    name, octv = s[:-1], int(s[-1])
    return 12 * (octv + 1) + NOTE[name]


def score():
    """Original motif in D major, 3/4. Returns [(time_s, midi, velocity)]."""
    beat = 0.62
    # bar patterns: melody over a broken chord (low notes softer)
    bars = [
        ("D", ["D6", "A5", "F#5", "A5", "E6", "D6"], ["D4", "A4"]),
        ("Bm", ["C#6", "B5", "F#5", "B5", "D6", "C#6"], ["B3", "F#4"]),
        ("G", ["B5", "D6", "G5", "D6", "E6", "B5"], ["G3", "D4"]),
        ("A", ["A5", "C#6", "E6", "A6", "G6", "E6"], ["A3", "E4"]),
    ]
    ev = []
    # musical clock that races during the time-lapse
    def tempo(t):
        return 1 + 2.4 * ss(5.4, 9.0, t) * (1 - ss(12.0, 15.2, t))
    t, pos = 0.45, 0.0
    bar_i = 0
    step = 0
    dt = 0.001
    next_step = 0.0
    # summer + lapse: eighth-note music box until ~15.4 s
    while t < 15.4:
        if pos >= next_step:
            name, mel, bass = bars[bar_i % 4]
            k = step % 6
            vel = 0.55 if k == 0 else 0.42
            ev.append((t, nm(mel[k]), vel))
            if k == 0:
                ev.append((t, nm(bass[0]), 0.32))
            if k == 2:
                ev.append((t, nm(bass[1]), 0.24))
            step += 1
            if step % 6 == 0:
                bar_i += 1
            next_step += beat / 2
        pos += dt * tempo(t)
        t += dt
    # autumn: slower, minor colour, notes dropping out as the leaves go
    autumn = [("B5", "B3"), ("F#5", None), ("D6", None), ("C#6", "F#3"), ("B5", None), ("A5", None),
              ("G5", "G3"), ("B5", None), ("E6", None), ("D6", "D4"), ("C#6", None), ("B5", None),
              ("A5", "F#3"), ("C#6", None), ("F#5", None), ("B5", "B3"), ("D6", None), ("F#6", None),
              ("E6", "E3"), ("D6", None), ("B5", None), ("A5", "A3"), ("F#5", None), ("E5", None)]
    t = 16.0
    rnd = random.Random(4)
    for i, (m, b) in enumerate(autumn):
        keep = 1.0 - 0.75 * (i / len(autumn))
        if rnd.random() < keep or b:
            ev.append((t, nm(m), 0.45 * (0.6 + 0.4 * keep)))
        if b and rnd.random() < keep + 0.2:
            ev.append((t, nm(b), 0.22))
        t += 0.42 + 0.012 * i * i / 4
    # winter: a lonely line, then the title phrase
    for (tm, m, v) in [(27.6, "F#5", 0.34), (30.2, "A5", 0.30), (31.3, "B5", 0.26), (33.9, "E5", 0.28)]:
        ev.append((tm, nm(m), v))
    title = [(35.8, "D5", 0.30), (35.8, "D4", 0.18), (36.25, "F#5", 0.32), (36.7, "A5", 0.34), (37.15, "D6", 0.40),
             (37.9, "C#6", 0.32), (38.55, "B5", 0.30), (39.4, "A5", 0.34), (39.4, "D4", 0.16), (39.4, "F#4", 0.14),
             (41.2, "D6", 0.22)]
    ev += [(tm, nm(m), v) for (tm, m, v) in title]
    return ev


def make_music():
    L = [0.0] * N
    R = [0.0] * N
    rnd = random.Random(2)
    for (t0, m, vel) in score():
        f = midi_hz(m)
        dur = min(3.2, DUR - t0)
        n = int(dur * SR)
        i0 = int(t0 * SR)
        pan = max(-0.6, min(0.6, (m - 78) / 18.0)) + rnd.uniform(-0.1, 0.1)
        # music-box comb: fundamental + bright inharmonic tines, quick metallic attack
        parts = [(1.0, 1.0, 1.7), (2.0, 0.22, 0.7), (3.01, 0.10, 0.35), (4.17, 0.06, 0.16), (5.43, 0.035, 0.08)]
        decay_scale = 1.0 if m < 84 else 0.75
        w = [2 * math.pi * f * r / SR for (r, _, _) in parts]
        for j in range(n):
            tt = j / SR
            atk = min(1.0, tt / 0.003)
            v = 0.0
            for idx, (r, a, tau) in enumerate(parts):
                v += a * math.exp(-tt / (tau * decay_scale)) * math.sin(w[idx] * j)
            v *= atk * vel
            k = i0 + j
            if k < N:
                L[k] += v * (1 - pan) * 0.5
                R[k] += v * (1 + pan) * 0.5
    dry = os.path.join(HERE, ".music_dry.wav")
    write_wav(dry, L, R, -6)
    # synthetic stereo hall impulse response
    ir_n = int(2.6 * SR)
    lpL, lpR = Biquad("lp", 5200), Biquad("lp", 4800)
    irL, irR = [], []
    for j in range(ir_n):
        tt = j / SR
        e = math.exp(-tt * 2.6) * min(1.0, tt / 0.012)
        irL.append(lpL(rnd.uniform(-1, 1)) * e)
        irR.append(lpR(rnd.uniform(-1, 1)) * e)
    irL[0] = irR[0] = 0.0
    ir = os.path.join(HERE, ".ir.wav")
    write_wav(ir, irL, irR, -6)
    out = os.path.join(HERE, "music.wav")
    fc = "[0:a]asplit=2[d][w];[w][1:a]afir=dry=10:wet=10[rv];[d]volume=0.78[dd];[rv]volume=0.42[ww];[dd][ww]amix=inputs=2:normalize=0,highpass=f=90,alimiter=limit=0.7"
    subprocess.run([FFMPEG, "-nostdin", "-y", "-hide_banner", "-loglevel", "error", "-i", dry, "-i", ir,
                    "-filter_complex", fc, "-t", str(DUR), "-c:a", "pcm_s16le", out], check=True)
    os.remove(dry)
    os.remove(ir)


if __name__ == "__main__":
    which = sys.argv[1:] or ["wind", "lapse", "rustle", "music"]
    for w in which:
        print("making", w)
        globals()["make_" + w]()
