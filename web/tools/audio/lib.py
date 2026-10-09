"""
Reusable sound sources: vehicles, horns, sirens, trains, animals, footsteps, impacts,
water, wind, steam, music bleed, PA murmur, clapping...
All functions take an rng and return mono (1-D) or stereo (2, n) float arrays.
"""
import math

import numpy as np

from dsp import *  # noqa
from voice import say, random_phrase


# --------------------------------------------------------------------------- impacts / modal
def modal(rng, n, freqs, decays, amps, detune=0.004, attack=0.0005):
    """Sum of exponentially decaying sinusoids (modal synthesis)."""
    t = tt(n)
    y = np.zeros(n)
    for f, d, a in zip(freqs, decays, amps):
        if f >= 0.45 * SR:
            continue
        f = f * (1 + rng.uniform(-detune, detune))
        y += a * np.sin(TWO_PI * f * t + rng.uniform(0, TWO_PI)) * np.exp(-t / d)
    if attack > 0:
        y *= 1 - np.exp(-t / attack)
    return y


def metal_hit(rng, f0=800.0, dur=0.8, damp=1.0, bright=1.0, ratios=None):
    ratios = ratios or [1.0, 2.32, 2.76, 4.25, 5.4, 6.63, 8.1, 9.38, 11.3]
    n = N(dur)
    freqs = [f0 * r * rng.uniform(0.98, 1.02) for r in ratios]
    decays = [dur * 0.35 / damp / (1 + 0.35 * i) for i in range(len(ratios))]
    amps = [rng.uniform(0.5, 1.0) / (1 + 0.5 * i) * (bright ** (i / 3)) for i in range(len(ratios))]
    y = modal(rng, n, freqs, decays, amps)
    click = hp(rng.standard_normal(n), 2000, 2) * np.exp(-tt(n) / 0.0015) * 0.6 * bright
    return fade(y + click, 0.0003, 0.02)


def thump(rng, f=80.0, dur=0.25, noise=0.5, fc=400.0):
    n = N(dur)
    t = tt(n)
    fs = f * (1 + 0.8 * np.exp(-t / 0.02))
    y = sine(fs) * np.exp(-t / (dur * 0.25))
    y += noise * lp(rng.standard_normal(n), fc, 2) * np.exp(-t / (dur * 0.12))
    return fade(y, 0.0005, 0.02)


def clack(rng, dur=0.12, f0=None, bright=1.0):
    """Hard plastic/metal click, e.g. turnstile, crate."""
    f0 = f0 or rng.uniform(900, 1600)
    n = N(dur)
    y = metal_hit(rng, f0, dur, damp=4.0, bright=bright, ratios=[1, 1.6, 2.3, 3.1, 4.4])
    y += 0.6 * bp(rng.standard_normal(n), 1000, 6000, 2) * np.exp(-tt(n) / 0.004)
    return fade(y, 0.0002, 0.01)


# --------------------------------------------------------------------------- vehicles
def engine(rng, rpm, cyl=4, bright=900.0, rough=0.35, diesel=False):
    """Combustion engine from an rpm track: half-order harmonic series + pulsed exhaust noise."""
    n = len(rpm)
    fe = rpm / 60.0 * cyl / 2.0
    base = fe / 2.0
    K = 40
    amps = np.array([(1.0 if k % 2 == 0 else 0.45) / (k ** 0.9) for k in range(1, K + 1)])
    amps *= np.array([rng.uniform(0.6, 1.4) for _ in range(K)])
    tone = harmonic_amps(base * (1 + 0.004 * smooth_rand(n, rng, 3)), amps, top=min(bright * 4, 16000))
    ph = np.cumsum(fe) / SR
    pulses = (0.5 + 0.5 * np.cos(TWO_PI * ph)) ** (6 if diesel else 3)
    pulses *= 1 + rough * smooth_rand(n, rng, 25)
    nz = lp(rng.standard_normal(n), bright * (2.5 if diesel else 1.5), 2) * pulses
    y = tone / (np.std(tone) + 1e-9) + (1.2 if diesel else 0.6) * nz / (np.std(nz) + 1e-9)
    if diesel:  # injector clatter
        clat = hp(rng.standard_normal(n), 1800, 2) * (0.5 + 0.5 * np.cos(TWO_PI * ph)) ** 20
        y += 0.5 * clat / (np.std(clat) + 1e-9)
    return lp(y, bright, 2)


def tyres(rng, n, speed, wet=0.3, coarse=1.0):
    v = as_array(speed, n)
    roar = shaped_noise(n, rng, lambda f: mag_band(f, 200, 2600, 2) * mag_peak(f, 850, 6, 1.0))
    hiss = band_noise(n, rng, 2500, 9000, 2)
    g = (v / 15.0) ** 1.6
    return (roar * coarse + wet * hiss) * g * (1 + 0.15 * smooth_rand(n, rng, 6))


def vehicle_src(rng, n, kind='car', speed=12.0, wet=0.3):
    v = as_array(speed, n)
    if kind == 'truck' or kind == 'bus':
        rpm = 1300 + 40 * v + 60 * smooth_rand(n, rng, 0.5)
        eng = engine(rng, rpm, cyl=6, bright=700, diesel=True)
        y = 1.1 * eng + 0.9 * tyres(rng, n, v, wet, coarse=1.3)
        # body / load rattles
        r = np.zeros(n)
        for _ in range(int(len(v) / SR * 6)):
            h = metal_hit(rng, rng.uniform(250, 900), 0.15, damp=3, bright=0.6)
            mix_at(r, h * rng.uniform(0.1, 0.4), int(rng.integers(0, n)))
        y += r
        if kind == 'bus':
            y += 0.04 * sine(np.full(n, rng.uniform(3200, 4200))) * (v / 12)  # turbo whine
        return y
    if kind == 'moto':
        rpm = 3500 + 250 * v + 300 * smooth_rand(n, rng, 1)
        return 1.3 * engine(rng, rpm, cyl=2, bright=1600, rough=0.6) + 0.5 * tyres(rng, n, v, wet)
    rpm = 1500 + 70 * v + 150 * smooth_rand(n, rng, 0.7)
    eng = engine(rng, rpm, cyl=4, bright=900 if kind != 'cab' else 1000)
    return 0.55 * eng + 1.0 * tyres(rng, n, v, wet)


def vehicle_pass(rng, kind='car', speed=12.0, lane=6.0, direction=1, dur=7.0, wet=0.3, ref=5.0,
                 accel=0.0):
    """Drive-by with doppler. Returns stereo. Closest approach at dur/2."""
    n = N(dur)
    t = tt(n) - dur / 2
    v = speed + accel * t
    x = direction * (speed * t + 0.5 * accel * t * t)
    src = vehicle_src(rng, n, kind, np.maximum(v, 1), wet)
    st, _ = moving_source(src, x, lane, 0.6, ref=ref, rmin=2.0)
    e = np.ones(st.shape[-1])
    return fade(st * e, 0.3, 0.3)


def car_horn(rng, pattern, f1=420.0, f2=530.0, drive=2.5, bright=1.0):
    """Two-tone diaphragm car horn. pattern: [(start_s, dur_s)]."""
    total = max(s + d for s, d in pattern) + 0.12
    n = N(total)
    out = np.zeros(n)
    for (s, d) in pattern:
        m = N(d + 0.04)
        t = tt(m)
        bend = 1 - 0.035 * np.exp(-t / 0.015)
        w = 1 + 0.0025 * smooth_rand(m, rng, 8)
        tone = blpulse(f1 * bend * w, 0.33) + 0.85 * blpulse(f2 * bend * w * 1.001, 0.28, ph0=0.3)
        env = burst_env(m, 0.005, max(d - 0.02, 0.01), 0.022)
        mix_at(out, tone * env, N(s))
    y = hp(out, 220, 2)
    y = peq(y, 2300 * bright, 9, 2.2)
    y = peq(y, 3600 * bright, 5, 3)
    y = saturate(y / (np.max(np.abs(y)) + 1e-9), drive)
    y = lp(y, 7500, 2)
    return fade(y, 0.001, 0.02)


def siren_freq(n, rng, segments):
    """segments: [(mode, seconds)] with mode 'wail', 'yelp', 'hilo'."""
    f = np.zeros(n)
    pos = 0
    phase = 0.0
    for mode, d in segments:
        m = min(N(d), n - pos)
        if m <= 0:
            break
        t = tt(m)
        if mode == 'wail':
            per = 4.2
            u = ((t + phase) % per) / per
            shape = np.where(u < 0.42, np.sin(np.pi / 2 * u / 0.42), np.cos(np.pi / 2 * (u - 0.42) / 0.58))
            f[pos:pos + m] = 640 + 820 * shape ** 1.3
        elif mode == 'yelp':
            per = 0.31
            u = ((t + phase) % per) / per
            f[pos:pos + m] = 700 + 820 * (0.5 - 0.5 * np.cos(TWO_PI * u))
        elif mode == 'hilo':
            u = ((t + phase) % 1.0)
            f[pos:pos + m] = np.where(u < 0.5, 960, 770)
        elif mode == 'rumbler':
            per = 0.36
            u = ((t + phase) % per) / per
            f[pos:pos + m] = 180 + 260 * (0.5 - 0.5 * np.cos(TWO_PI * u))
        pos += m
    f[pos:] = f[pos - 1] if pos > 0 else 700
    return smooth_env(f, 0.004)


def siren_tone(rng, f, drive=1.8):
    y = 0.7 * blsquare(f) + 0.5 * harmonic(f, 1.3)
    y = bp(y, 450, 5500, 2)
    y = peq(y, 1900, 6, 1.5)
    y = saturate(y / (np.max(np.abs(y)) + 1e-9), drive)
    return lp(y, 9000, 2)


def ship_horn(rng, dur=3.2, f0=88.0, distant=True):
    n = N(dur + 1.0)
    t = tt(n)
    env = burst_env(n, 0.35, dur - 0.35, 0.8)
    rise = 1 - 0.04 * np.exp(-t / 0.25)
    y = np.zeros(n)
    for det, g in [(1.0, 1.0), (1.006, 0.8), (1.5, 0.35)]:  # two diaphones + a fifth
        f = f0 * det * rise * (1 + 0.003 * smooth_rand(n, rng, 2))
        y += g * harmonic(f, 0.9, 120, 6000, rng.uniform(0, 1))
    y = peq(y, 330, 8, 1.2)
    y = peq(y, 900, 4, 1.5)
    y = saturate(y / np.max(np.abs(y)), 1.6) * env
    if distant:
        y = lp(y, 1400, 2)
    return fade(y, 0.01, 0.2)


# --------------------------------------------------------------------------- birds & animals
def gull_note(rng, dur, f0, shape='kyow', effort=1.0):
    if shape == 'kyow':
        toks = [('i', dur * 0.25), ('a', dur * 0.45), ('o', dur * 0.3)]
        pitch = [(0, 0.85), (0.22, 1.25), (0.55, 1.15), (1, 0.75)]
    else:  # short 'ha'
        toks = [('ae', dur * 0.6), ('a', dur * 0.4)]
        pitch = [(0, 1.0), (0.3, 1.12), (1, 0.82)]
    return say(toks, f0=f0, fscale=2.4, pitch=pitch, effort=effort, rng=rng, rough=0.35,
               jitter=0.02, breath=0.18, kmax=30, top=14000, co_art=0.02)


def gull_call(rng, kind='long'):
    parts = []
    f0 = rng.uniform(820, 980)
    if kind == 'long':
        parts.append(gull_note(rng, rng.uniform(0.45, 0.6), f0 * 0.95, 'kyow'))
        parts.append(np.zeros(N(rng.uniform(0.08, 0.15))))
        k = int(rng.integers(3, 6))
        for i in range(k):
            parts.append(gull_note(rng, rng.uniform(0.14, 0.2), f0 * (1.05 - 0.03 * i), 'ha') * (1 - 0.08 * i))
            parts.append(np.zeros(N(rng.uniform(0.05, 0.1))))
    else:
        for i in range(int(rng.integers(1, 3))):
            parts.append(gull_note(rng, rng.uniform(0.3, 0.42), f0, 'kyow'))
            parts.append(np.zeros(N(rng.uniform(0.15, 0.3))))
    y = np.concatenate(parts)
    y = hp(y, 400, 2)
    return y / np.max(np.abs(y))


def crow_caw(rng, n_caws=None, f0=None):
    n_caws = n_caws or int(rng.integers(2, 4))
    f0 = f0 or rng.uniform(430, 560)
    parts = []
    for i in range(n_caws):
        d = rng.uniform(0.28, 0.4)
        c = say([('ah', d * 0.3), ('a', d * 0.5), ('aw', d * 0.2)], f0=f0 * rng.uniform(0.95, 1.05),
                fscale=1.75, pitch=[(0, 0.9), (0.2, 1.08), (0.7, 1.0), (1, 0.78)], effort=1.0, rng=rng,
                rough=0.9, jitter=0.05, shimmer=0.25, breath=0.35, kmax=40, top=9000, bw=1.6)
        parts.append(c * (1 - 0.1 * i))
        parts.append(np.zeros(N(rng.uniform(0.18, 0.32))))
    y = np.concatenate(parts)
    y = bp(y, 450, 7000, 2)
    return y / np.max(np.abs(y))


def sparrow_chirp(rng):
    d = rng.uniform(0.04, 0.11)
    n = N(d)
    u = np.linspace(0, 1, n)
    kind = rng.integers(0, 3)
    f_hi, f_lo = rng.uniform(4800, 6800), rng.uniform(2800, 3800)
    if kind == 0:   # down chirp "cheep"
        f = f_hi + (f_lo - f_hi) * u ** 0.7
    elif kind == 1:  # up-down
        f = f_lo + (f_hi - f_lo) * np.sin(np.pi * u)
    else:           # quick trill
        f = 0.5 * (f_hi + f_lo) + 0.25 * (f_hi - f_lo) * np.sin(TWO_PI * rng.uniform(40, 70) * u * d)
    y = sine(f) + 0.25 * sine(2 * f) * (f * 2 < 16000)
    y *= np.sin(np.pi * u) ** 1.5
    return y


def sparrow_bout(rng, dur=None):
    dur = dur or rng.uniform(0.6, 2.0)
    n = N(dur + 0.2)
    y = np.zeros(n)
    t = 0.0
    while t < dur:
        c = sparrow_chirp(rng)
        mix_at(y, c * rng.uniform(0.5, 1.0), N(t))
        t += len(c) / SR + rng.uniform(0.03, 0.18)
    return y


def pigeon_coo(rng):
    f0 = rng.uniform(380, 470)
    segs = [(0.16, [(0, 0.9), (1, 1.05)], 0.5), (0.05, None, 0.0),
            (rng.uniform(0.5, 0.65), [(0, 0.95), (0.25, 1.12), (0.6, 1.0), (1, 0.82)], 1.0),
            (0.06, None, 0.0), (0.22, [(0, 0.95), (1, 0.85)], 0.45)]
    out = []
    for d, pts, g in segs:
        n = N(d)
        if pts is None:
            out.append(np.zeros(n))
            continue
        f = f0 * env_cos(n, [(p * d, v) for p, v in pts]) * (1 + 0.01 * smooth_rand(n, rng, 20))
        tone = harmonic_amps(f, [1.0, 0.22, 0.07, 0.03])
        trill = 1 - 0.55 * (0.5 + 0.5 * np.sin(TWO_PI * np.cumsum(np.full(n, rng.uniform(26, 34))) / SR))
        env = np.sin(np.pi * np.linspace(0, 1, n)) ** 1.6
        out.append(tone * trill * env * g)
    y = np.concatenate(out)
    breathy = smooth_env(np.abs(y), 0.02)
    y = y + 0.12 * lp(rng.standard_normal(len(y)), 900, 2) * breathy
    y = lp(y, 2500, 2)
    return y / np.max(np.abs(y))


def wing_flaps(rng, beats=8, rate=8.5, fly_off=True):
    dur = beats / rate + 0.4
    n = N(dur)
    y = np.zeros(n)
    t = 0.02
    for i in range(beats):
        g = 1.0 if i < 3 else (0.85 ** (i - 2))
        m = N(0.09)
        sw = bp(rng.standard_normal(m), 350, 3500, 2) * ad_env(m, 0.012, 0.025)
        cl = bp(rng.standard_normal(N(0.02)), 900, 7000, 2) * np.exp(-tt(N(0.02)) / 0.0025)
        mix_at(y, sw * 0.8 * g, N(t))
        if i < 4:
            mix_at(y, cl * 1.4 * g * rng.uniform(0.7, 1.0), N(t + 0.04))
        t += 1.0 / rate * rng.uniform(0.9, 1.1)
    rustle = hp(rng.standard_normal(n), 2500, 2) * ad_env(n, 0.05, 0.25) * 0.05
    y = y + rustle
    if fly_off:
        p = np.linspace(0.0, rng.choice([-0.7, 0.7]), n)
        return pan(onepole(y, np.linspace(14000, 5000, n)), p)
    return y


def dog_bark(rng, n_barks=None, size=1.0):
    n_barks = n_barks or int(rng.integers(2, 4))
    f0 = rng.uniform(300, 380) / size
    parts = []
    for i in range(n_barks):
        d = rng.uniform(0.13, 0.19)
        b = say([('h', 0.012), ('aw', d * 0.55), ('uh', d * 0.45)], f0=f0 * rng.uniform(0.92, 1.08),
                fscale=1.05 / size ** 0.5, pitch=[(0, 1.15), (0.15, 1.2), (0.6, 0.95), (1, 0.7)],
                effort=1.0, rng=rng, rough=0.7, jitter=0.04, shimmer=0.2, breath=0.15, kmax=45,
                top=8000, bw=1.4, f1_open=0.3)
        parts.append(b)
        parts.append(np.zeros(N(rng.uniform(0.12, 0.22) if i < n_barks - 1 else 0.05)))
    y = lp(np.concatenate(parts), 5500, 2)
    return y / np.max(np.abs(y))


def cat_meow(rng):
    d = rng.uniform(0.75, 0.95)
    y = say([('i', d * 0.12), ('e', d * 0.12), ('ae', d * 0.3), ('o', d * 0.25), ('u', d * 0.21)],
            f0=rng.uniform(520, 600), fscale=1.85, pitch=[(0, 0.85), (0.3, 1.18), (0.55, 1.1), (1, 0.72)],
            effort=[(0, 0.4), (0.4, 0.75), (1, 0.3)], rng=rng, breath=0.12, jitter=0.012, kmax=40,
            top=14000, co_art=0.06, vib=0.01, vib_rate=7)
    return y / np.max(np.abs(y))


def cat_hiss(rng):
    d = rng.uniform(0.9, 1.2)
    n = N(d)
    nz = rng.standard_normal(n)
    y = shaped_noise(n, rng, lambda f: mag_band(f, 1800, 12000, 2) * mag_peak(f, 3200, 8, 2)
                     * mag_peak(f, 6500, 6, 2) * mag_peak(f, 9500, 3, 2))
    env = env_cos(n, [(0, 0), (0.04, 1), (0.25, 0.85), (d - 0.3, 0.7), (d, 0)])
    env *= 1 + 0.15 * smooth_rand(n, rng, 18)
    spit = bp(nz, 800, 8000, 2) * np.exp(-tt(n) / 0.008) * 2.5
    y = y * env + spit
    return y / np.max(np.abs(y))


# --------------------------------------------------------------------------- people
def kid_voice(rng, kind, f0=None):
    f0 = f0 or rng.uniform(300, 380)
    if kind == 'hey':
        return say([('h', 0.06), ('e', 0.28), ('i', 0.18)], 'kid', f0=f0, rng=rng,
                   pitch=[(0, 0.9), (0.25, 1.22), (0.65, 1.15), (1, 0.85)], effort=1.0, vib=0.012)
    if kind == 'whee':
        return say([('w', 0.07), ('i', 0.62)], 'kid', f0=f0, rng=rng,
                   pitch=[(0, 0.85), (0.2, 1.1), (0.8, 1.45), (1, 1.3)], effort=0.95, vib=0.015, vib_rate=6)
    if kind == 'woohoo':
        return say([('w', 0.06), ('u', 0.24), ('_', 0.04), ('h', 0.06), ('u', 0.36)], 'kid', f0=f0, rng=rng,
                   pitch=[(0, 0.95), (0.3, 1.15), (0.45, 1.05), (0.6, 1.35), (1, 1.1)], effort=0.95, vib=0.012)
    if kind == 'yay':
        return say([('y', 0.06), ('ae', 0.3), ('e', 0.12), ('i', 0.1)], 'kid', f0=f0, rng=rng,
                   pitch=[(0, 1.0), (0.3, 1.3), (1, 1.05)], effort=1.0, vib=0.01)
    if kind == 'ahh':
        return say([('a', 0.55)], 'kid', f0=f0, rng=rng, pitch=[(0, 1.2), (0.3, 1.4), (1, 0.9)], effort=1.0)
    raise ValueError(kind)


def laugh(rng, speaker='kid', pulses=None, f0=None):
    pulses = pulses or int(rng.integers(5, 9))
    f0 = f0 or (rng.uniform(320, 400) if speaker == 'kid' else rng.uniform(150, 220))
    toks = []
    pitch = []
    t = 0.0
    total = 0.0
    seq = []
    for i in range(pulses):
        dh = rng.uniform(0.035, 0.055)
        dv = rng.uniform(0.07, 0.11) * (1.6 if i == 0 else 1.0)
        gap = rng.uniform(0.035, 0.06)
        g = (1.0 - 0.06 * i) * rng.uniform(0.85, 1.0)
        v = 'a' if rng.random() < 0.6 else ('ae' if speaker == 'kid' else 'ah')
        seq.append((dh, dv, gap, g, v))
        total += dh + dv + gap
    for i, (dh, dv, gap, g, v) in enumerate(seq):
        toks += [('h', dh, g * 0.8), (v, dv, g), ('_', gap)]
        base = 1.25 - 0.4 * i / max(pulses - 1, 1)
        pitch += [((t + dh) / total, base * 1.05), ((t + dh + dv) / total, base * 0.92)]
        t += dh + dv + gap
    pitch = [(0, pitch[0][1])] + pitch + [(1, pitch[-1][1])]
    y = say(toks, speaker, f0=f0, pitch=pitch, effort=0.85, rng=rng, breath=0.18, co_art=0.015)
    return y


# --------------------------------------------------------------------------- footsteps
def footstep(rng, kind='heel'):
    if kind == 'heel':
        n = N(0.16)
        y = metal_hit(rng, rng.uniform(1700, 2400), 0.06, damp=2.5, bright=0.8, ratios=[1, 1.47, 2.09, 2.8]) * 0.5
        y = pad_to(y, n)
        y += lp(rng.standard_normal(n), 900, 2) * np.exp(-tt(n) / 0.01) * 0.6
        toe = hp(rng.standard_normal(N(0.04)), 1500, 2) * np.exp(-tt(N(0.04)) / 0.004) * 0.25
        mix_at(y, toe, N(rng.uniform(0.07, 0.09)))
        return fade(y, 0.0003, 0.02)
    if kind == 'sneaker':
        n = N(0.14)
        y = bp(rng.standard_normal(n), 250, 2600, 2) * ad_env(n, 0.006, 0.025)
        y += 0.3 * hp(rng.standard_normal(n), 3000, 2) * ad_env(n, 0.02, 0.02)
        return fade(y, 0.001, 0.02)
    if kind == 'boot':
        n = N(0.18)
        y = lp(rng.standard_normal(n), 600, 2) * ad_env(n, 0.003, 0.02) * 1.2
        y += bp(rng.standard_normal(n), 1500, 6000, 2) * ad_env(n, 0.02, 0.03) * 0.25  # grit
        return fade(y, 0.0005, 0.02)
    if kind == 'leaves':
        n = N(0.3)
        y = crackle(rng, n, density=900, lo=1200, hi=9000) * ad_env(n, 0.03, 0.08)
        y += lp(rng.standard_normal(n), 500, 2) * ad_env(n, 0.005, 0.03) * 0.4
        return fade(y, 0.001, 0.03)
    raise ValueError(kind)


def walker(rng, n, kind='heel', rate=None, p0=-0.8, p1=0.8, dist=6.0, start=0.0):
    """Stereo footsteps of someone walking past (mixed into n samples)."""
    rate = rate or rng.uniform(1.7, 2.1)
    out = np.zeros((2, n))
    t = start
    total = n / SR
    while t < total:
        u = (t - start) / max(total - start, 1e-3)
        p = p0 + (p1 - p0) * u
        d = dist * (1 + 0.6 * abs(p))
        s = footstep(rng, kind) * rng.uniform(0.7, 1.0)
        mix_at(out, place(s, d, p, ref=3.0), N(t))
        t += 1.0 / rate * rng.uniform(0.95, 1.05)
    return out


# --------------------------------------------------------------------------- textures
def crackle(rng, n, density=500.0, lo=1000.0, hi=8000.0, density_env=None, circular=False):
    """Dense random micro-impulses (paper, leaves, gravel) - each a tiny damped resonance."""
    rate = as_array(density, n) if density_env is None else density * density_env
    p = np.clip(rate / SR, 0, 1)
    hits = (rng.random(n) < p) * rng.standard_normal(n) * rng.uniform(0.2, 1.0, n) ** 2
    fr = rng.uniform(lo * 1.5, min(hi, 12000))

    def filt(h):
        return bp(h, lo, min(hi, 0.45 * SR), 2) + 0.5 * reson(h, fr, 6)
    return circ(filt, hits) if circular else filt(hits)


def drip(rng, f=None, gain=1.0):
    """Water drop: Minnaert bubble with an upward chirp + tiny impact."""
    f = f or rng.uniform(900, 2600)
    n = N(0.12)
    t = tt(n)
    d = rng.uniform(0.012, 0.03)
    fs = f * (1 + 0.6 * t / 0.05)
    y = np.sin(TWO_PI * np.cumsum(fs) / SR) * np.exp(-t / d) * (1 - np.exp(-t / 0.0007))
    y += 0.25 * hp(rng.standard_normal(n), 2000, 2) * np.exp(-t / 0.002)
    return fade(y * gain, 0.0002, 0.01)


def splash(rng, size=1.0, dur=1.2):
    n = N(dur)
    t = tt(n)
    y = np.zeros(n)
    impact = lp(rng.standard_normal(n), 1800, 2) * np.exp(-t / (0.035 * size)) * 1.5
    impact += sine(np.full(n, 85.0)) * np.exp(-t / 0.06) * 0.8 * size
    spray = bp(rng.standard_normal(n), 1500, 11000, 2) * ad_env(n, 0.01, 0.12 * size)
    y += impact + spray * 0.9
    for _ in range(int(40 * size)):
        tt0 = rng.uniform(0.02, dur * 0.65) ** 1.2
        mix_at(y, drip(rng, rng.uniform(500, 3500) / size ** 0.3, rng.uniform(0.1, 0.6) * np.exp(-tt0 / 0.4)), N(tt0))
    return fade(y, 0.0005, 0.1)


def lap_event(rng, dur=None):
    """One wave lapping against a sea wall: a slosh with a trickle back."""
    dur = dur or rng.uniform(1.2, 2.2)
    n = N(dur)
    sl = shaped_noise(n, rng, lambda f: mag_band(f, 80, 1600, 2) * mag_tilt(f, -2))
    env = env_cos(n, [(0, 0), (dur * 0.25, 1), (dur * 0.45, 0.6), (dur, 0)])
    y = sl * env
    tr = crackle(rng, n, 200, 1500, 7000) * env_cos(n, [(0, 0), (dur * 0.3, 0), (dur * 0.5, 0.6), (dur, 0)])
    y += 0.4 * tr / (np.std(tr) + 1e-9) * np.std(sl) * 0.6
    for _ in range(int(rng.integers(3, 10))):
        tt0 = rng.uniform(dur * 0.25, dur * 0.8)
        mix_at(y, drip(rng, rng.uniform(600, 1800), rng.uniform(0.05, 0.25)), N(tt0))
    return y


def wind_bed(rng, L, level=1.0, bright=1.0, gust=0.6, gust_rate=0.12, whistle=0.0,
             whistle_f=(700, 1400), lo=40.0):
    """Periodic stereo wind: two decorrelated noise layers whose mix shifts with gusts, so
    loudness and brightness move together. Exactly periodic in L."""
    g = smooth_rand(L, rng, gust_rate)
    g2 = smooth_rand(L, rng, gust_rate * 3)
    gust_env = np.exp(gust * (0.8 * g + 0.35 * g2))
    gust_env /= gust_env.mean()
    out = np.zeros((2, L))
    for ch in range(2):
        dark = shaped_noise(L, rng, lambda f: mag_band(f, lo, 500 * bright, 2) * mag_tilt(f, -3))
        mid = shaped_noise(L, rng, lambda f: mag_band(f, 150, 2200 * bright, 2) * mag_tilt(f, -2))
        air = shaped_noise(L, rng, lambda f: mag_band(f, 1200, 9000 * bright, 2) * mag_tilt(f, -2))
        b = np.clip((gust_env - 0.6) / 1.6, 0, 1)
        y = dark * 1.0 + mid * (0.25 + 0.6 * b) + air * (0.04 + 0.3 * b ** 1.5)
        y *= gust_env ** 0.9
        out[ch] = y
    if whistle > 0:
        for k in range(2):
            fc = whistle_f[0] + (whistle_f[1] - whistle_f[0]) * (0.5 + 0.35 * smooth_rand(L, rng, 0.15))
            fc *= 1 + 0.15 * np.clip(g, -1.5, 2)
            src = rng.standard_normal(L)
            wst = circ(lambda x, f: svf(x, f, 25.0, 'bp'), src, fc)
            amp = np.clip(gust_env - 0.9, 0, None) ** 1.5
            w = wst * amp * whistle * 0.25
            out += pan(w, rng.uniform(-0.6, 0.6))
    out = widen(out, 0.8)
    return out * level / (np.sqrt(np.mean(out ** 2)) + 1e-9) * 0.1


def steam(rng, dur=2.0, power=1.0, attack=0.08, burst=False):
    n = N(dur)
    t = tt(n)
    if burst:
        env = env_cos(n, [(0, 0), (0.02, 1.0), (0.25, 0.85), (dur * 0.6, 0.45), (dur, 0)])
    else:
        env = env_cos(n, [(0, 0), (attack, 0.7), (0.35, 1.0), (dur * 0.55, 0.6), (dur, 0)])
    flick = np.exp(0.25 * smooth_rand(n, rng, 30) + 0.2 * smooth_rand(n, rng, 4))
    hiss = shaped_noise(n, rng, lambda f: mag_band(f, 900, 14000, 2) * mag_peak(f, 4500, 4, 0.7))
    body = shaped_noise(n, rng, lambda f: mag_band(f, 60, 900, 2))
    fc = 2500 + 4000 * env
    hiss = svf(hiss, fc, 0.6, 'hp')
    y = hiss * env * flick + 0.7 * body * env ** 1.5 * flick
    if burst:
        y += 2.0 * lp(rng.standard_normal(n), 400, 2) * np.exp(-t / 0.05)  # pressure pop
        y += 1.2 * bp(rng.standard_normal(n), 300, 5000, 2) * np.exp(-t / 0.01)
    return fade(y * power, 0.002, 0.08)


# --------------------------------------------------------------------------- construction
def jackhammer_burst(rng, dur=3.0, rate=None):
    rate = rate or rng.uniform(19, 25)
    n = N(dur)
    t = tt(n)
    y = np.zeros(n)
    tt0 = 0.0
    metal_f = rng.uniform(1400, 2200)
    while tt0 < dur - 0.05:
        m = N(0.06)
        hit = metal_hit(rng, metal_f * rng.uniform(0.97, 1.03), 0.06, damp=3.0, bright=0.8,
                        ratios=[1, 1.7, 2.6, 3.9]) * 0.5
        hit = pad_to(hit, m)
        hit += bp(rng.standard_normal(m), 400, 5000, 2) * np.exp(-tt(m) / 0.008) * 1.0
        hit += lp(rng.standard_normal(m), 250, 2) * np.exp(-tt(m) / 0.015) * 1.4
        mix_at(y, hit * rng.uniform(0.75, 1.0), N(tt0))
        tt0 += 1.0 / rate * rng.uniform(0.96, 1.04)
    exhaust = hp(rng.standard_normal(n), 1200, 2) * 0.25 * (0.6 + 0.4 * np.sin(TWO_PI * rate * t) ** 2)
    y = y + exhaust
    env = burst_env(n, 0.05, dur - 0.2, 0.15)
    return fade(y * env, 0.002, 0.05)


def backup_beeper(rng, n, f=1120.0, on=0.5, off=0.5):
    t = tt(n)
    gate = ((t % (on + off)) < on).astype(float)
    gate = smooth_env(gate, 0.003)
    y = blsquare(np.full(n, f)) * 0.7 + sine(np.full(n, f)) * 0.5
    y = bp(y, 600, 6000, 2)
    y = peq(y, f * 3, 4, 3)
    return y * gate


def loopify(render, L, X=None):
    """Render L+X samples of a stationary process and crossfade the tail into the head
    (equal-power) so it loops seamlessly."""
    X = X or N(2.0)
    x = render(L + X)
    u = np.linspace(0, np.pi / 2, X)
    out = np.array(x[..., :L], dtype=float)
    out[..., :X] = x[..., :X] * np.sin(u) + x[..., L:L + X] * np.cos(u)
    return out


def generator_drone(rng, n):
    rpm = 1800 * (1 + 0.003 * smooth_rand(n, rng, 0.3))
    eng = engine(rng, rpm, cyl=4, bright=600, diesel=True)
    hum = harmonic_amps(np.full(n, 60.0), [1, 0.5, 0.6, 0.2, 0.3, 0.1, 0.15])
    fan = band_noise(n, rng, 300, 3000, 2) * 0.15
    return eng / np.std(eng) + 0.5 * hum / np.std(hum) + fan


# --------------------------------------------------------------------------- subway
def rail_clack(rng, gain=1.0, bright=1.0):
    n = N(0.18)
    y = metal_hit(rng, rng.uniform(380, 460), 0.18, damp=2.5, bright=0.7 * bright,
                  ratios=[1, 2.56, 4.7, 7.3, 9.9]) * 0.5
    y = pad_to(y, n)
    y += lp(rng.standard_normal(n), 320, 2) * np.exp(-tt(n) / 0.02) * 1.5
    y += bp(rng.standard_normal(n), 1500, 7000, 2) * np.exp(-tt(n) / 0.003) * 0.5 * bright
    return y * gain


def train_render(rng, dur, xf_fn, v_fn, lane=2.4, cars=8, car_len=18.3, motor=True, squeal=0.0,
                 brake=0.0, air=1.0, joint_spacing=11.9, clatter=1.0):
    """Physically laid-out subway train. xf_fn(t) = front x position (m), v_fn(t) speed (m/s),
    t in seconds (arrays). Listener at origin, track along x at distance `lane`.
    Rolling noise / motor whine / squeal come from each truck (moving, with doppler);
    rail-joint clacks come from stationary joints as each axle crosses."""
    n = N(dur)
    t = tt(n)
    xf = xf_fn(t)
    v = v_fn(t)
    out = np.zeros((2, n + N(0.6)))
    trucks = []
    for c in range(cars):
        for off in (2.6, car_len - 2.6):
            trucks.append(c * car_len + off)
    speed_g = np.clip(v / 20.0, 0, 1.5)
    for i, d in enumerate(trucks):
        roll = shaped_noise(n, rng, lambda f: mag_band(f, 120, 3500, 2) * mag_peak(f, 700, 5, 1.2)
                            * mag_peak(f, 2200, 3, 2))
        roll *= speed_g ** 1.4 * (1 + 0.25 * smooth_rand(n, rng, 3))
        src = roll * 0.9
        rumble = brown(n, rng, 25, 300) * speed_g ** 1.2
        src += 0.8 * rumble
        if motor and i % 2 == 0:
            fw = 68 * v * (1 + 0.002 * i)  # inverter/motor whine scales with speed
            whine = harmonic_amps(np.maximum(fw, 1.0), [1.0, 0.2, 0.35, 0.1]) * np.clip(v / 6, 0, 1)
            gear = harmonic_amps(np.maximum(fw * 0.21, 1.0), [1.0, 0.5, 0.25]) * np.clip(v / 6, 0, 1)
            src += 0.6 * whine + 0.5 * gear
        if squeal > 0 and rng.random() < 0.5:
            sq = np.zeros(n)
            for _ in range(int(rng.integers(1, 3))):
                d0 = rng.uniform(0.4, 1.5)
                m = N(d0)
                f = rng.uniform(2600, 4800) * (1 + 0.01 * smooth_rand(m, rng, 6))
                tone = sine(f) + 0.3 * sine(f * 2.01) + 0.15 * sine(f * 3.02)
                e = burst_env(m, 0.1, d0 * 0.5, d0 * 0.4) * (1 + 0.4 * smooth_rand(m, rng, 12))
                mix_at(sq, tone * e, int(rng.integers(0, max(1, n - m))))
            src += squeal * sq
        if brake > 0:
            bv = np.maximum(np.clip(1 - v / 10.0, 0, 1) * smooth_env(np.clip(v / 0.8, 0, 1), 0.05), 0.0)
            f = rng.uniform(3100, 3700) * (1 + 0.02 * smooth_rand(n, rng, 5) + 0.006 * np.sin(TWO_PI * 7 * t))
            tone = sine(f) + 0.45 * sine(f * 2.003) + 0.2 * sine(f * 3.01) + 0.25 * sine(f * 0.5)
            chaos = np.clip(1 + 0.8 * smooth_rand(n, rng, 9), 0, None)
            src += brake * tone * bv ** 1.2 * chaos * (0.5 + 0.5 * rng.random())
            src += brake * 0.6 * band_noise(n, rng, 2000, 9000, 2) * bv * chaos
        rattle = np.zeros(n)
        for _ in range(int(dur * 3 * float(np.mean(speed_g)))):
            h = metal_hit(rng, rng.uniform(300, 1200), 0.12, damp=3, bright=0.6)
            mix_at(rattle, h * rng.uniform(0.05, 0.2), int(rng.integers(0, n)))
        src += rattle * speed_g
        x = xf - d
        st, d0 = moving_source(src, x, lane, 0.4, ref=3.0, rmin=1.5, air_scale=60)
        mix_at(out, st * 0.35, N(d0))
    # rail joints (stationary), each axle crossing gives a clack
    axles = []
    for d in trucks:
        axles += [d - 1.05, d + 1.05]
    j0 = rng.uniform(-joint_spacing, 0)
    joints = j0 + joint_spacing * np.arange(-8, 9)
    for jx in joints:
        r = math.sqrt(jx * jx + lane * lane)
        g = 3.0 / max(r, 1.5)
        pj = float(np.clip(jx / max(r, 1.0), -1, 1)) * 0.9
        delay = r / 343.0
        for a in axles:
            idx = np.nonzero((xf - a) >= jx)[0]  # first time this axle passes the joint
            if len(idx) == 0 or idx[0] == 0:
                continue
            k = idx[0]
            sp = v[k]
            if sp < 0.5:
                continue
            c = rail_clack(rng, gain=clatter * min(sp / 15.0, 1.3) * rng.uniform(0.7, 1.0), bright=min(sp / 15, 1))
            c = distance_filter(c, r, ref=3.0)
            mix_at(out, pan(c, pj), k + N(delay))
    # piston air: pressure wave ahead of the train, turbulence alongside, wake behind
    if air > 0:
        front_dist = -xf  # >0 while front hasn't reached listener
        rear_x = xf - cars * car_len
        ahead = np.exp(-np.clip(front_dist, 0, None) / 60.0) * (front_dist > 0)
        along = ((xf >= 0) & (rear_x <= 0)).astype(float)
        behind = np.exp(-np.clip(rear_x, 0, None) / 40.0) * (rear_x > 0)
        envw = smooth_env(0.6 * ahead + 1.0 * along + 0.8 * behind, 0.15) * speed_g
        windn = np.vstack([shaped_noise(n, rng, lambda f: mag_band(f, 30, 1500, 2) * mag_tilt(f, -3)),
                           shaped_noise(n, rng, lambda f: mag_band(f, 30, 1500, 2) * mag_tilt(f, -3))])
        hissn = np.vstack([band_noise(n, rng, 1500, 9000, 2), band_noise(n, rng, 1500, 9000, 2)])
        flick = 1 + 0.3 * smooth_rand(n, rng, 8)
        wind = (windn * envw * 0.7 + hissn * 0.18 * along * speed_g) * flick
        out[:, :n] += air * wind * 0.5
    return out


# --------------------------------------------------------------------------- music bleed
def synthpop_loop(rng, L, bpm=120, root=57):
    """Generic 4-on-the-floor synth-pop bed (no lead melody), periodic in L.
    Meant to be heard heavily filtered from distant video-screen speakers."""
    beat = 60.0 / bpm
    out = np.zeros(L)
    bass = np.zeros(L)
    pad = np.zeros(L)
    nbeats = int(round(L / SR / beat))
    prog = [0, -4, 3, -2]  # vi-IV-I-V relative to root (A minor-ish)

    def mtof(m):
        return 440.0 * 2 ** ((m - 69) / 12.0)
    kick_n = N(0.35)
    tk = tt(kick_n)
    kick = fade(np.sin(TWO_PI * np.cumsum(50 + 90 * np.exp(-tk / 0.04)) / SR) * np.exp(-tk / 0.12), 0.0005, 0.05)
    snare_n = N(0.2)
    snare = fade(bp(rng.standard_normal(snare_n), 900, 7000, 2) * np.exp(-tt(snare_n) / 0.05), 0.0005, 0.04)
    hat_n = N(0.06)
    for b in range(nbeats):
        pos = N(b * beat)
        mix_at(out, kick, pos, wrap=True)
        if b % 2 == 1:
            mix_at(out, snare * 0.5, pos, wrap=True)
        hat = hp(rng.standard_normal(hat_n), 7000, 2) * np.exp(-tt(hat_n) / 0.015) * 0.18
        mix_at(out, hat, pos + N(beat / 2), wrap=True)
        bar = (b // 4) % 4
        r = root - 24 + prog[bar]
        for e in range(2):  # eighth-note bass
            m = N(beat / 2 * 0.9)
            f = np.full(m, mtof(r + (12 if (b + e) % 4 == 3 else 0)))
            nb = blsaw(f, top=4000) * ad_env(m, 0.004, 0.12)
            mix_at(bass, nb, pos + N(e * beat / 2), wrap=True)
        if b % 4 == 0:
            m = N(4 * beat)
            ch = [r + 24, r + 24 + (3 if bar == 0 else 4), r + 24 + 7, r + 36]
            p = np.zeros(m)
            for k in ch:
                for det in (-0.08, 0.08):
                    p += blsaw(np.full(m, mtof(k + det)), top=6000, ph0=rng.uniform(0, 1))
            p *= burst_env(m, 0.15, 4 * beat - 0.5, 0.3)
            mix_at(pad, p, pos, wrap=True)
    bass = circ(lambda x: lp(x, 600, 2), bass)
    pad = circ(lambda x: lp(x, 2200, 2), pad)
    y = out / (np.std(out) + 1e-9) + 0.8 * bass / (np.std(bass) + 1e-9) + 0.45 * pad / (np.std(pad) + 1e-9)
    return y


# --------------------------------------------------------------------------- PA / crowds
def pa_murmur(rng, dur=4.0):
    """Garbled, telephone-band announcement: a formant voice speaking nonsense syllables,
    through a small bandpassed, slightly overdriven speaker."""
    parts = []
    t = 0.0
    spk = 'man' if rng.random() < 0.6 else 'woman'
    while t < dur:
        ph = random_phrase(rng, spk, nsyl=int(rng.integers(5, 12)), rate=1.05, effort=0.55)
        parts.append(ph)
        gap = np.zeros(N(rng.uniform(0.15, 0.4)))
        parts.append(gap)
        t += (len(ph) + len(gap)) / SR
    y = np.concatenate(parts)
    y = bp(y, 380, 3200, 3)
    y = peq(y, 1800, 6, 1.5)
    y = saturate(y / np.max(np.abs(y)), 2.2)
    y = bp(y, 300, 4000, 2)
    return fade(y, 0.05, 0.1)


def clap_burst(rng, dur, claps_per_sec=4.5, people=30, fade_tail=1.5):
    n = N(dur)
    y = np.zeros((2, n))
    for _ in range(people):
        p = rng.uniform(-1, 1)
        res = rng.uniform(900, 2200)
        rate = claps_per_sec * rng.uniform(0.85, 1.2)
        t = rng.uniform(0, 0.4)
        stop = dur - rng.uniform(0, fade_tail)
        dist = rng.uniform(4, 20)
        while t < stop:
            m = N(0.05)
            c = rng.standard_normal(m) * np.exp(-tt(m) / rng.uniform(0.006, 0.012))
            c = reson(c, res, 2.5) + 0.3 * hp(c, 3000, 2)
            g = (4 / dist) * min(1.0, (stop - t) / 0.8) * rng.uniform(0.6, 1.0)
            mix_at(y, pan(c * g, p), N(t))
            t += 1.0 / rate * rng.uniform(0.9, 1.1)
    return y


def crowd_voices(rng, dur, voices=30, kind='cheer', dist=(4, 25)):
    """Many simultaneous voices: 'cheer' (rising whoo/yeah/aah), 'gasp', 'ooh'."""
    n = N(dur)
    out = np.zeros((2, n + N(1.0)))
    for i in range(voices):
        spk = ['man', 'woman', 'man', 'woman', 'kid'][i % 5]
        f0b = {'man': 125, 'woman': 225, 'kid': 300}[spk] * rng.uniform(0.85, 1.2)
        start = rng.uniform(0, 0.25 if kind != 'cheer' else 0.5)
        if kind == 'cheer':
            choice = rng.integers(0, 4)
            d = rng.uniform(dur * 0.45, dur * 0.85)
            if choice == 0:
                toks = [('w', 0.06), ('u', d)]
            elif choice == 1:
                toks = [('y', 0.06), ('e', d * 0.4), ('ae', d * 0.6)]
            elif choice == 2:
                toks = [('a', d)]
            else:
                toks = [('w', 0.06), ('u', d * 0.5), ('h', 0.05), ('u', d * 0.5)]
            pitch = [(0, 0.95), (0.25, 1.25 * rng.uniform(0.95, 1.1)), (0.8, 1.2), (1, 0.95)]
            v = say(toks, spk, f0=f0b * 1.25, pitch=pitch, effort=rng.uniform(0.8, 1.0), rng=rng,
                    vib=rng.uniform(0.005, 0.02), breath=0.08)
            e = env_cos(len(v), [(0, 0), (0.08, 1), (len(v) / SR * 0.7, 0.9), (len(v) / SR, 0)])
            v *= e
        elif kind == 'gasp':
            d = rng.uniform(0.25, 0.45)
            v = say([('h', d * 0.55), ('a', d * 0.2, 0.25), ('o', d * 0.25, 0.15)], spk, f0=f0b * 1.3,
                    pitch=[(0, 1.1), (1, 1.2)], effort=0.3, rng=rng, breath=0.3)
            ooh = say([('o', 0.15, 0.4), ('u', rng.uniform(0.5, 0.9), 0.8)], spk, f0=f0b * 1.1,
                      pitch=[(0, 1.15), (0.3, 1.2), (1, 0.85)], effort=0.45, rng=rng, breath=0.12)
            if rng.random() < 0.7:
                v = np.concatenate([v, np.zeros(N(rng.uniform(0.1, 0.3))), ooh * 0.7])
        else:
            raise ValueError(kind)
        dd = rng.uniform(*dist)
        st = place(v, dd, rng.uniform(-0.95, 0.95), ref=4.0) * rng.uniform(0.6, 1.0)
        mix_at(out, st, N(start))
    return out
