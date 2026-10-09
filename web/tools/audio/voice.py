"""
Formant voice synthesis: band-limited glottal source (harmonic series with effort-dependent
spectral tilt, jitter, shimmer, optional period-doubling roughness) + pitch-synchronous
aspiration noise, through a cascade of 5 time-varying Klatt resonators, plus a parallel
frication path for consonants. Used for shouts, laughter, crowds, walla, PA murmur and
(with re-scaled formants) animals.
"""
import numpy as np

from dsp import (SR, N, tt, smooth_rand, klatt_cascade, _additive, as_array, bp, hp, lp,
                 fade, pan, fft_filter, mag_band, resample_ratio, env_cos, mix_at)

# F1-F3 (adult male reference). Consonant entries are loci for transitions.
VOW = {
    'a': (730, 1090, 2440), 'ah': (640, 1190, 2390), 'ae': (660, 1720, 2410),
    'e': (530, 1840, 2480), 'i': (270, 2290, 3010), 'ih': (390, 1990, 2550),
    'o': (570, 840, 2410), 'oh': (470, 800, 2380), 'u': (300, 870, 2240),
    'uh': (440, 1020, 2240), 'er': (490, 1350, 1690), 'aw': (680, 1000, 2400),
    'w': (290, 640, 2200), 'y': (260, 2200, 3000), 'l': (360, 1050, 2700),
    'r': (420, 1250, 1600), 'm': (270, 1100, 2300), 'n': (270, 1500, 2500),
    'ng': (270, 1900, 2400),
    'b': (250, 900, 2300), 'd': (260, 1700, 2600), 'g': (260, 2000, 2300),
    'p': (250, 900, 2300), 't': (260, 1700, 2600), 'k': (260, 2000, 2300),
    's': (300, 1700, 2600), 'sh': (300, 1800, 2400), 'f': (300, 1000, 2300),
    'z': (300, 1700, 2600), 'v': (300, 1000, 2300),
}
VOWELS = ['a', 'ah', 'ae', 'e', 'i', 'ih', 'o', 'oh', 'u', 'uh', 'er', 'aw']
GLIDES = {'w', 'y', 'l', 'r'}
NASALS = {'m', 'n', 'ng'}
STOPS = {'p': (700, 1600, False), 't': (3500, 7500, False), 'k': (1500, 3500, False),
         'b': (500, 1400, True), 'd': (2800, 6000, True), 'g': (1300, 3000, True)}
FRICS = {'s': (4500, 9500, 1.0, False), 'sh': (2200, 6500, 1.0, False), 'f': (1500, 8000, 0.35, False),
         'z': (4500, 9000, 0.6, True), 'v': (1500, 6000, 0.25, True)}

SPK = {'man': (1.0, 112.0), 'woman': (1.17, 205.0), 'kid': (1.34, 285.0)}


def _tok(t):
    if len(t) == 2:
        return t[0], t[1], 1.0
    return t[0], t[1], t[2]


def say(tokens, speaker='man', f0=None, pitch=None, effort=0.5, rng=None, fscale=None,
        breath=0.06, jitter=0.006, shimmer=0.06, rough=0.0, vib=0.0, vib_rate=5.5,
        bw=1.0, f1_open=0.15, top=11000.0, co_art=0.03, kmax=90, drift=0.02, end_taper=0.3):
    """Synthesise an utterance.
    tokens: list of (symbol, seconds[, gain]); symbols are vowels, glides, nasals, stops,
            fricatives, 'h' (aspiration with the following vowel's formants), '_' (silence).
    pitch:  list of (relative_time 0..1, multiplier) or an array of multipliers.
    effort: scalar, list of (relative_time, value) or array; 0 soft/breathy .. 1 shouting.
    """
    rng = rng if rng is not None else np.random.default_rng(1)
    fs0, f0d = SPK.get(speaker, SPK['man'])
    fs = fscale if fscale is not None else fs0
    f0 = f0 if f0 is not None else f0d
    toks = [_tok(t) for t in tokens]
    n = sum(N(d) for _, d, _ in toks) + N(0.12)
    Ft = np.zeros((3, n))
    va = np.zeros(n)
    aa = np.zeros(n)
    fric = np.zeros(n)
    pos = 0
    spans = []
    for idx, (s, d, g) in enumerate(toks):
        m = N(d)
        spans.append((pos, pos + m, s, g))
        if s in VOW:
            Ft[:, pos:pos + m] = np.array(VOW[s])[:, None]
        if s in VOWELS:
            va[pos:pos + m] = g
            aa[pos:pos + m] = breath * g
        elif s in GLIDES:
            va[pos:pos + m] = 0.6 * g
            aa[pos:pos + m] = breath * 0.5 * g
        elif s in NASALS:
            va[pos:pos + m] = 0.28 * g
        elif s == 'h':
            aa[pos:pos + m] = 0.55 * g
        elif s in STOPS:
            lo, hi, voiced = STOPS[s]
            if voiced:
                va[pos:pos + m] = 0.07 * g
            bl = N(rng.uniform(0.006, 0.014))
            b = bp(rng.standard_normal(bl + N(0.03)), lo, min(hi, 0.45 * SR), 2)
            b *= np.exp(-tt(len(b)) / 0.006)
            b /= np.max(np.abs(b)) + 1e-9
            mix_at(fric, b * 0.9 * g, pos + m - N(0.004))
            if not voiced:  # aspiration after release
                asp_m = N(rng.uniform(0.02, 0.045))
                aa[pos + m:pos + m + asp_m] = np.maximum(aa[pos + m:pos + m + asp_m], 0.45 * g)
        elif s in FRICS:
            lo, hi, lev, voiced = FRICS[s]
            nz = bp(rng.standard_normal(m + N(0.02)), lo, min(hi, 0.45 * SR), 2)[:m]
            nz /= np.std(nz) + 1e-9
            nz *= np.sin(np.linspace(0, np.pi, m)) ** 0.6 * lev * 0.45 * g
            fric[pos:pos + m] += nz
            if voiced:
                va[pos:pos + m] = 0.2 * g
        pos += m
    # 'h' and stops take formants from the next voiced token (coarticulation)
    for i, (a, b, s, g) in enumerate(spans):
        if s == 'h' or s == '_':
            nxt = next((sp for sp in spans[i + 1:] if sp[2] in VOW), None)
            prv = spans[i - 1] if i > 0 else None
            src = nxt if nxt is not None else prv
            if src is not None and src[2] in VOW:
                Ft[:, a:b] = np.array(VOW[src[2]])[:, None]
    Ft[:, pos:] = Ft[:, max(pos - 1, 0)][:, None]
    # natural release: the last voiced token dies away instead of stopping dead
    if end_taper > 0:
        last = next((sp for sp in reversed(spans) if sp[2] in VOW and sp[2] not in STOPS and sp[2] not in FRICS), None)
        if last is not None:
            a, b = last[0], last[1]
            m = max(1, int((b - a) * end_taper))
            va[b - m:b] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, m))
            aa[b - m:b] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, m))
    # smooth formant tracks (coarticulation) and amplitudes (no clicks)
    w = max(1, N(co_art))
    k = np.ones(w) / w
    for j in range(3):
        f = np.pad(Ft[j], (w, w), mode='edge')
        Ft[j] = np.convolve(np.convolve(f, k, 'same'), k, 'same')[w:-w]
    ws = max(1, N(0.008))
    ks = np.ones(ws) / ws
    va = np.convolve(np.convolve(va, ks, 'same'), ks, 'same')
    aa = np.convolve(np.convolve(aa, ks, 'same'), ks, 'same')

    # effort / pitch tracks
    if isinstance(effort, (list, tuple)):
        eff = env_cos(n, [(p * n / SR, v) for p, v in effort])
    else:
        eff = as_array(effort, n)
    if pitch is None:
        pm = np.ones(n)
    elif isinstance(pitch, (list, tuple)):
        pm = env_cos(n, [(p * n / SR, v) for p, v in pitch])
    else:
        pm = as_array(pitch, n)
    f0t = f0 * pm * np.exp(jitter * smooth_rand(n, rng, 70) + drift * smooth_rand(n, rng, 2.5))
    if vib > 0:
        f0t *= 1 + vib * np.sin(2 * np.pi * vib_rate * tt(n) + rng.uniform(0, 6.28))
    f0t = np.maximum(f0t, 30.0)
    ph = rng.uniform(0, 1) + np.cumsum(f0t) / SR
    tilt = 1.6 - 0.62 * np.clip(eff, 0, 1.2)
    voiced = _additive(ph, f0t, tilt, kmax, top)
    if rough > 0:  # period doubling / subharmonic roughness
        voiced *= 1 + as_array(rough, n) * np.sin(np.pi * ph + 0.3)
    voiced /= np.sqrt(np.sum(np.arange(1, 40) ** (-2 * 1.0)))
    va = va * (1 + shimmer * smooth_rand(n, rng, 45))
    nz = rng.standard_normal(n)
    pulse = 0.35 + 0.65 * np.maximum(0, np.cos(2 * np.pi * ph)) ** 2
    src = voiced * va * (0.6 + 0.4 * eff) + nz * aa * pulse * 0.9
    F = np.zeros((5, n))
    F[0] = Ft[0] * fs * (1 + f1_open * eff)
    F[1] = Ft[1] * fs
    F[2] = Ft[2] * fs
    F[3] = 3350 * fs
    F[4] = 4300 * fs
    B = np.zeros((5, n))
    for j, b0 in enumerate([75, 95, 135, 190, 260]):
        B[j] = b0 * bw * (fs ** 0.6) * (1 + (0.6 if j == 0 else 0.25) * (1 - np.clip(eff, 0, 1)) * breath * 4)
    out = klatt_cascade(src, F, B)
    # parallel presence path: real voices keep energy above F5 that a pure cascade loses
    pres = lp(hp(src, 3000, 2), 6000 * fs, 2) * (0.03 + 0.06 * np.clip(eff, 0, 1)) * fs
    out = out + pres * np.std(out) / max(np.std(src), 1e-9) * 3.0
    out = hp(out, 70 if speaker != 'man' else 55, 2)
    vmask = va > 0.3
    ref = np.sqrt(np.mean(out[vmask] ** 2)) if vmask.any() else np.std(out)
    out = out + fric * ref * 0.35
    out = fade(out, 0.002, 0.03)
    pk = np.max(np.abs(out))
    return out / pk if pk > 0 else out


# --------------------------------------------------------------------------- walla / babble
CONS = ['b', 'd', 'g', 'p', 't', 'k', 's', 'sh', 'f', 'z', 'v', 'm', 'n', 'l', 'r', 'w', 'y', 'h']
CONS_W = np.array([4, 6, 3, 3, 8, 5, 7, 2, 3, 2, 2, 6, 7, 5, 4, 3, 2, 4], float)


def random_phrase(rng, speaker, nsyl=None, rate=1.0, effort=0.4):
    nsyl = nsyl or int(rng.integers(3, 13))
    toks = []
    accents = []
    t = 0.0
    for i in range(nsyl):
        if rng.random() < 0.8:
            c = rng.choice(CONS, p=CONS_W / CONS_W.sum())
            if c in STOPS:
                d = rng.uniform(0.03, 0.06)
            elif c in FRICS:
                d = rng.uniform(0.05, 0.10)
            else:
                d = rng.uniform(0.04, 0.08)
            toks.append((c, d / rate))
            t += d / rate
        v = str(rng.choice(VOWELS))
        stressed = rng.random() < 0.35
        d = rng.uniform(0.07, 0.16) * (1.5 if stressed else 1.0) / rate
        if i == nsyl - 1:
            d *= 1.5
        toks.append((v, d, 1.0 if stressed else rng.uniform(0.55, 0.85)))
        accents.append((t + d * 0.4, stressed))
        t += d
        if rng.random() < 0.25:  # coda consonant
            c = str(rng.choice(['n', 'm', 't', 's', 'k', 'l', 'r']))
            d = rng.uniform(0.04, 0.08) / rate
            toks.append((c, d))
            t += d
    total = t
    # declination + accent bumps + final rise or fall
    pts = [(0.0, rng.uniform(1.0, 1.12))]
    for (ta, st) in accents:
        dec = 1.08 - 0.22 * ta / total
        pts.append((ta / total, dec * (1.0 + (rng.uniform(0.1, 0.22) if st else rng.uniform(-0.04, 0.05)))))
    end = rng.uniform(0.78, 0.9) if rng.random() < 0.75 else rng.uniform(1.05, 1.2)
    pts.append((1.0, end))
    pts = sorted(pts)
    return say(toks, speaker=speaker, pitch=pts, effort=effort, rng=rng,
               f0=SPK[speaker][1] * rng.uniform(0.85, 1.18), breath=rng.uniform(0.03, 0.1))


_POOL = {}


def phrase_pool(count=36, seed=4242):
    if seed in _POOL:
        return _POOL[seed]
    rng = np.random.default_rng(seed)
    pool = []
    for i in range(count):
        spk = ['man', 'woman', 'man', 'woman', 'kid'][i % 5]
        pool.append((spk, random_phrase(rng, spk, rate=rng.uniform(0.9, 1.2), effort=rng.uniform(0.3, 0.6))))
    _POOL[seed] = pool
    return pool


def babble_loop(rng, L, talkers=24, dist=(6.0, 40.0), pool_seed=4242, gap=(0.2, 1.6),
                kid_frac=0.1, lively=0.0):
    """Periodic stereo crowd walla of length L samples (no reverb applied).
    Talkers are grouped into 4 distance tiers, each tier filtered for air absorption."""
    pool = phrase_pool(seed=pool_seed)
    tiers_d = np.geomspace(dist[0], dist[1], 4)
    tiers = [np.zeros((2, L)) for _ in tiers_d]
    for _ in range(talkers):
        d = rng.uniform(dist[0], dist[1])
        ti = int(np.argmin(np.abs(np.log(tiers_d / d))))
        p = rng.uniform(-0.95, 0.95)
        kids = rng.random() < kid_frac
        cands = [x for x in pool if (x[0] == 'kid') == kids]
        ratio = rng.uniform(0.9, 1.1)
        level = rng.uniform(0.5, 1.0) * (5.0 / d) ** 0.85
        t = int(rng.integers(0, L))
        end = t + L
        while t < end:
            spk, ph = cands[int(rng.integers(0, len(cands)))]
            v = resample_ratio(ph, ratio * rng.uniform(0.97, 1.03))
            g = level * rng.uniform(0.6, 1.0) * (1 + lively * rng.uniform(0, 1))
            st = pan(v, p + rng.uniform(-0.05, 0.05)) * g
            mix_at(tiers[ti], st, t, wrap=True)
            t += len(v) + N(rng.uniform(*gap))
    out = np.zeros((2, L))
    for d, b in zip(tiers_d, tiers):
        fc = 14000.0 / (1.0 + d / 18.0)
        out += fft_filter(b, lambda f, fc=fc: mag_band(f, 90, fc, 2))
    return out
