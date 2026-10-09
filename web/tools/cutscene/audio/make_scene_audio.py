"""Scene sound for the intro: ambience + people/harbour one-shots synced to on-screen events.

  python make_scene_audio.py   -> amb.wav, people.wav, harbour.wav (44.1 kHz stereo, absolute levels)

Uses the game's own library (web/public/audio, see manifest.json) so the intro and the game
sound like one world, plus a few local syntheses for things the library lacks
(hurried heel clicks, trainer footfalls, runner breathing, the couple's giggle,
the leaf-pile crunch, the ball kick, a distant ferry horn).
Event times are derived from the character 'brains' in ../people.py.
"""
import array, glob, json, math, os, random, subprocess, sys, wave

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import build as B  # noqa: E402
import people  # noqa: E402

LIB = os.path.normpath(os.path.join(HERE, "..", "..", "..", "public", "audio"))
MAN = json.load(open(os.path.join(LIB, "manifest.json")))["sounds"]
SR = 44100
DUR = B.DUR
N = int(SR * DUR)
FFMPEG = glob.glob(os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\*\bin\ffmpeg.exe"))[0]
rnd = random.Random(99)
P = people.People(B)


def W(t):
    return P.w_at(t)


def t_of_w(w):
    return P.t_of_w(w)


# ------------------------------------------------------------------ io
_cache = {}


def load(name, speed=1.0):
    """Library sound as (L, R) float lists at SR, optionally sped up (pitch rises, like fast-forward)."""
    key = (name, speed)
    if key in _cache:
        return _cache[key]
    path = os.path.join(LIB, MAN[name]["file"])
    af = "asetrate=%d,aresample=%d" % (int(SR * speed), SR) if speed != 1.0 else "anull"
    raw = subprocess.run([FFMPEG, "-nostdin", "-hide_banner", "-loglevel", "error", "-i", path, "-af", af,
                          "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    a = array.array("f")
    a.frombytes(raw)
    L, R = list(a[0::2]), list(a[1::2])
    _cache[key] = (L, R)
    return L, R


def write(path, L, R):
    peak = max(max(abs(x) for x in L), max(abs(x) for x in R))
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        buf = array.array("h", [0]) * (2 * len(L))
        for i in range(len(L)):
            buf[2 * i] = int(max(-1.0, min(1.0, L[i])) * 32767)
            buf[2 * i + 1] = int(max(-1.0, min(1.0, R[i])) * 32767)
        w.writeframes(buf.tobytes())
    print("%s peak %.1f dBFS" % (os.path.basename(path), 20 * math.log10(peak or 1e-9)))


def place(bus, src, t0, gain, pan=0.0, fade_out=None):
    L, R = bus
    sl, sr = src
    i0 = int(t0 * SR)
    gl = gain * math.sqrt(0.5 * (1 - pan)) * math.sqrt(2)
    gr = gain * math.sqrt(0.5 * (1 + pan)) * math.sqrt(2)
    n = len(sl)
    fo = int((fade_out or 0) * SR)
    for j in range(n):
        k = i0 + j
        if k < 0:
            continue
        if k >= N:
            break
        e = 1.0
        if fo and j > n - fo:
            e = (n - j) / fo
        L[k] += sl[j] * gl * e
        R[k] += sr[j] * gr * e


def pan_x(x):
    """World x (art pixels, 0..320) -> stereo pan."""
    return max(-0.8, min(0.8, (x / 320.0) * 2 - 1)) * 0.85


def mono(sig):
    return (sig, sig)


# ------------------------------------------------------------------ small DSP
class Biquad:
    def __init__(self, kind, f, q=0.707):
        w0 = 2 * math.pi * f / SR
        a = math.sin(w0) / (2 * q)
        c = math.cos(w0)
        if kind == "bp":
            b = (a, 0, -a)
        elif kind == "lp":
            b = ((1 - c) / 2, 1 - c, (1 - c) / 2)
        else:
            b = ((1 + c) / 2, -(1 + c), (1 + c) / 2)
        a0 = 1 + a
        self.k = (b[0] / a0, b[1] / a0, b[2] / a0, -2 * c / a0, (1 - a) / a0)
        self.z = [0.0] * 4

    def __call__(self, x):
        b0, b1, b2, a1, a2 = self.k
        x1, x2, y1, y2 = self.z
        y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        self.z = [x, x1, y, y1]
        return y


def heel_click(r):
    n = int(0.07 * SR)
    bp = Biquad("bp", r.uniform(2300, 3000), 1.6)
    out = []
    for j in range(n):
        t = j / SR
        v = bp(r.uniform(-1, 1)) * math.exp(-t * 75) * 1.6
        v += math.sin(2 * math.pi * 140 * t) * math.exp(-t * 55) * 0.35
        out.append(v)
    return out


def trainer_step(r):
    n = int(0.09 * SR)
    lp = Biquad("lp", 450)
    hp = Biquad("bp", 1800, 0.8)
    out = []
    for j in range(n):
        t = j / SR
        out.append(lp(r.uniform(-1, 1)) * math.exp(-t * 45) * 1.4 + hp(r.uniform(-1, 1)) * math.exp(-t * 90) * 0.25)
    return out


def breath(r, dur=0.26, f=1100):
    n = int(dur * SR)
    bp = Biquad("bp", f, 0.9)
    lp = Biquad("lp", 3000)
    out = []
    for j in range(n):
        x = j / n
        e = math.sin(math.pi * min(1, x * 1.6)) ** 1.5 * (1 - x) ** 0.5
        out.append(lp(bp(r.uniform(-1, 1))) * e)
    return out


def giggle(r, f0=215, syll=4):
    """Soft 'ha-ha-ha' from a glottal pulse through 'a' formants, breathy and far."""
    seg = 0.12
    n = int((seg * syll + 0.2) * SR)
    fs = [Biquad("bp", 820, 6), Biquad("bp", 1250, 7), Biquad("bp", 2800, 8)]
    lp = Biquad("lp", 3200)
    out = []
    ph = 0.0
    for j in range(n):
        t = j / SR
        k = t / seg
        s = int(k)
        u = k - s
        env = 0.0
        if s < syll:
            env = (math.sin(math.pi * min(1.0, u / 0.75)) ** 2) * (1 - 0.15 * s)
        f = f0 * (1.08 - 0.03 * s) * (1 + 0.04 * math.sin(u * math.pi))
        ph += f / SR
        pulse = 1.0 if ph % 1.0 < f / SR else 0.0
        src = pulse * 0.9 + r.uniform(-1, 1) * 0.12
        v = fs[0](src) * 1.0 + fs[1](src) * 0.6 + fs[2](src) * 0.25
        out.append(lp(v) * env * 3.0)
    return out


def crunch(r, dur=0.45, dens=0.35):
    n = int(dur * SR)
    hp = Biquad("hp", 1400)
    bp = Biquad("bp", 3800, 0.7)
    lp = Biquad("lp", 300)
    out = []
    for j in range(n):
        x = j / n
        e = min(1, x / 0.04) * (1 - x) ** 1.8
        imp = r.uniform(-1, 1) if r.random() < dens * (1 - x) else 0.0
        v = bp(hp(imp)) * 2.2 + lp(r.uniform(-1, 1)) * 0.9 * math.exp(-x * 9)
        out.append(v * e)
    return out


def kick_thump(r):
    n = int(0.16 * SR)
    out = []
    for j in range(n):
        t = j / SR
        out.append(math.sin(2 * math.pi * (95 - 120 * t) * t) * math.exp(-t * 26) +
                   r.uniform(-1, 1) * math.exp(-t * 160) * 0.3)
    return out


def ferry_horn(dur=1.9):
    """Distant ship horn: two low reedy tones, slow swell, muffled by distance."""
    n = int((dur + 1.2) * SR)
    lp1, lp2 = Biquad("lp", 650), Biquad("lp", 900)
    out = []
    for j in range(n):
        t = j / SR
        e = min(1, t / 0.25) * (1 if t < dur else math.exp(-(t - dur) * 5))
        v = 0.0
        for f, a in ((116.5, 1.0), (146.8, 0.7)):
            ph = (f * t) % 1.0
            v += a * (2 * ph - 1)                     # sawtooth: reedy
        v = lp2(lp1(v)) * e
        out.append(v)
    # crude distance: add two late echoes off the far shore
    for d, g in ((0.33, 0.35), (0.71, 0.18)):
        k = int(d * SR)
        for j in range(len(out) - 1, k - 1, -1):
            out[j] += out[j - k] * g
    return out


def norm(sig, peak=0.5):
    m = max(abs(x) for x in sig) or 1
    return [x * peak / m for x in sig]


# ------------------------------------------------------------------ buses
def bus():
    return ([0.0] * N, [0.0] * N)


def make_amb():
    out = bus()
    hL, hR = load("amb_harbour")
    wl, wr = load("amb_wind_low")
    g = MAN["amb_harbour"]["gain"]
    gw = MAN["amb_wind_low"]["gain"]
    L, R = out
    nh, nw = len(hL), len(wl)
    off = int(6.6 * SR)   # the loop's own distant ferry horn (file 8-11.5 s) lands at ~1.4 s, while the ferry sits out on the water
    for i in range(N):
        t = i / SR
        # harbour: full in summer, a little quieter as the park empties, steady quiet harbour at the end
        eh = (0.95 - 0.25 * B.ss(14, 22, t) - 0.12 * B.ss(24, 30, t)) * min(1, t / 1.0)
        ew = 0.85 * B.ss(23, 31, t)                   # the game's opening cold-wind bed
        L[i] = hL[(i + off) % nh] * g * eh + wl[i % nw] * gw * ew
        R[i] = hR[(i + off) % nh] * g * eh + wr[i % nw] * gw * ew
    write(os.path.join(HERE, "amb.wav"), L, R)


def make_harbour():
    out = bus()
    # gulls: summer pair, one distant in early autumn, none later
    for t, pan, g in ((0.4, 0.35, 0.75), (3.9, -0.25, 0.6), (17.6, 0.55, 0.35)):
        place(out, load("gull_cry"), t, MAN["gull_cry"]["gain"] * g, pan)
    # ferry: a distant horn while it sits out on the water in summer, then fast-forward blips as it crosses
    # (the summer horn comes from amb_harbour itself, aligned in make_amb)
    import build as BB
    prev = None
    blips = 0
    for i in range(int(5.6 * 100), int(15.5 * 100)):
        t = i / 100.0
        f = (BB.phase_at(t) + 0.62) % 1.0
        x = 340 - f * 420
        if prev is not None and prev > 200 >= x and blips < 5:
            short = norm(ferry_horn(0.35), 0.10)
            place(out, mono(short), t, 1.0, pan_x(x) * 0.6)
            blips += 1
        prev = x
    write(os.path.join(HERE, "harbour.wav"), *out)


def make_people():
    out = bus()
    G = lambda n: MAN[n]["gain"]
    # ---- summer kids (positions from people.py brains)
    def kidA_x(t):
        a = 1.15 * W(t)
        return 232 + 40 * math.cos(a)
    place(out, load("kid_shout_2"), 0.7, G("kid_shout_2") * 0.55, pan_x(kidA_x(0.9)))
    place(out, load("kid_laugh"), 2.3, G("kid_laugh") * 0.5, pan_x(kidA_x(2.5)))
    place(out, load("kid_shout_1"), 4.0, G("kid_shout_1") * 0.45, pan_x(232 + 40 * math.cos(1.15 * 4.1 - 0.9)))
    place(out, mono(norm(kick_thump(rnd), 0.22)), 5.0, 1.0, pan_x(184))
    place(out, load("kid_shout_3"), 5.15, G("kid_shout_3") * 0.5, pan_x(184))
    # fast-forward: sped-up (higher) little shouts in the lapse
    place(out, load("kid_laugh", 1.6), 7.3, G("kid_laugh") * 0.3, 0.3)
    place(out, load("kid_shout_2", 1.7), 9.7, G("kid_shout_2") * 0.25, -0.2)
    # ---- dog
    place(out, load("dog_bark"), 1.6, G("dog_bark") * 0.45, pan_x(14 + 7 * 1.6 + 11))
    place(out, load("dog_bark", 1.6), 8.4, G("dog_bark") * 0.22, pan_x(150))
    # ---- couple: soft giggle while they hug, a lower chuckle answering
    place(out, mono(norm(giggle(rnd, 225, 4), 0.06)), 3.05, 1.0, pan_x(200))
    place(out, mono(norm(giggle(rnd, 128, 3), 0.045)), 3.5, 1.0, pan_x(194))
    # ---- summer runner: trainer footfalls + breathing (real time only, before the lapse)
    t = 0.0
    k = 0
    while True:
        t = t_of_w(k / 5.0)
        if t > 5.4:
            break
        x = -8 + 30 * W(t)
        if -5 < x < 330:
            place(out, mono(norm(trainer_step(rnd), 0.06)), t, 1.0, pan_x(x))
            if k % 2 == 0:
                place(out, mono(norm(breath(rnd), 0.03)), t + 0.02, 1.0, pan_x(x))
        k += 1
    # ---- autumn: businessman's hurried heel clicks (frame-A strikes, 4.5 per second)
    t = 16.2
    while t < 27.5:
        if t < 21.9 or t >= 22.8:
            x = -10 + 28 * (t - 16.2) if t < 21.9 else 149.6 + 28 * (t - 22.8)
            fade = 1 - B.ss(25.3, 27.3, t)
            if -5 < x < 330:
                place(out, mono(norm(heel_click(rnd), 0.26 * rnd.uniform(0.85, 1.1))), t, fade, pan_x(x))
        t += 2 / 9.0
        if 21.9 <= t < 22.8:
            t = 22.8
    # ---- autumn runner in the hoodie: steps + heavier breathing, right to left
    t = 16.8
    k = 0
    while t < 27.6:
        x = 330 - 30 * (t - 16.8)
        fade = 1 - B.ss(25.0, 27.2, t)
        place(out, mono(norm(trainer_step(rnd), 0.13)), t, fade, pan_x(x))
        if k % 2 == 0:
            place(out, mono(norm(breath(rnd, 0.3, 950), 0.06)), t + 0.03, fade, pan_x(x))
        t += 0.2
        k += 1
    # ---- autumn: the leaf-pile jump
    place(out, load("kid_shout_2"), 21.25, G("kid_shout_2") * 0.5, pan_x(150))
    place(out, mono(norm(crunch(rnd, 0.55, 0.45), 0.30)), 21.88, 1.0, pan_x(166))
    place(out, mono(norm(crunch(rnd, 0.3, 0.3), 0.14)), 22.6, 1.0, pan_x(166))
    place(out, load("kid_laugh"), 22.7, G("kid_laugh") * 0.45, pan_x(170))
    # winter: nothing - the wind, the harbour and the lonely notes carry the ending
    write(os.path.join(HERE, "people.wav"), *out)


if __name__ == "__main__":
    which = sys.argv[1:] or ["amb", "harbour", "people"]
    for w in which:
        print("making", w)
        globals()["make_" + w]()
