"""
Core DSP for the Far From the Tree sound library.

Everything here is numpy/scipy, with a few per-sample kernels compiled by numba
(falls back to plain Python if numba is missing, which works but is slow).

Conventions
- SR = 44100. Mono signals are 1-D float64 arrays, stereo is shape (2, n).
- Anything named *_loop / circular=True is periodic: sample n wraps to sample 0, so
  ambience loops are seamless by construction (FFT noise, wrap-around event mixing,
  circular convolution, circular filtering).
"""
import math
import zlib

import numpy as np
from scipy import signal
from scipy.ndimage import minimum_filter1d, uniform_filter1d

try:
    from numba import njit
except ImportError:  # pragma: no cover
    def njit(*a, **k):
        if a and callable(a[0]):
            return a[0]
        return lambda f: f

SR = 44100
NYQ = SR / 2.0
TWO_PI = 2.0 * math.pi


# --------------------------------------------------------------------------- basics
def N(sec):
    return int(round(sec * SR))


def tt(n):
    return np.arange(n) / SR


def rng_for(name, salt=0):
    return np.random.default_rng(zlib.crc32(name.encode()) * 7 + salt)


def db(x):
    return 20.0 * np.log10(np.maximum(np.abs(x), 1e-12))


def undb(d):
    return 10.0 ** (d / 20.0)


def as_array(v, n):
    if np.isscalar(v):
        return np.full(n, float(v))
    v = np.asarray(v, dtype=float)
    if len(v) != n:
        v = np.interp(np.linspace(0, 1, n), np.linspace(0, 1, len(v)), v)
    return v


def pad_to(x, n):
    if x.shape[-1] >= n:
        return x[..., :n]
    w = [(0, 0)] * (x.ndim - 1) + [(0, n - x.shape[-1])]
    return np.pad(x, w)


def stereo(x):
    if x.ndim == 2:
        return x
    return np.vstack([x, x])


def mono(x):
    return x if x.ndim == 1 else x.mean(axis=0)


def length(x):
    return x.shape[-1]


# --------------------------------------------------------------------------- envelopes
def fade(x, fin=0.002, fout=0.02):
    x = np.array(x, dtype=float)
    n = x.shape[-1]
    a, b = min(N(fin), n // 2), min(N(fout), n // 2)
    if a > 0:
        x[..., :a] *= 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, a))
    if b > 0:
        x[..., n - b:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, b))
    return x


def env_pts(n, pts, smooth=0.0):
    """Piecewise-linear envelope through (time_sec, value) points, optional smoothing (sec)."""
    ts = np.array([p[0] for p in pts], dtype=float) * SR
    vs = np.array([p[1] for p in pts], dtype=float)
    e = np.interp(np.arange(n), ts, vs)
    if smooth > 0:
        e = smooth_env(e, smooth)
    return e


def env_cos(n, pts):
    """Raised-cosine (smoothstep) interpolation between points - no corners."""
    ts = np.array([p[0] for p in pts], dtype=float) * SR
    vs = np.array([p[1] for p in pts], dtype=float)
    i = np.arange(n)
    k = np.clip(np.searchsorted(ts, i, side='right') - 1, 0, len(ts) - 2)
    t0, t1 = ts[k], ts[k + 1]
    f = np.clip((i - t0) / np.maximum(t1 - t0, 1e-9), 0, 1)
    f = 0.5 - 0.5 * np.cos(np.pi * f)
    return vs[k] + (vs[k + 1] - vs[k]) * f


def smooth_env(e, sec):
    w = max(1, N(sec))
    return uniform_filter1d(uniform_filter1d(e, w, mode='nearest'), w, mode='nearest')


def ad_env(n, attack, decay, curve=1.0):
    """Attack (raised cosine) then exponential decay with time-constant `decay`."""
    t = tt(n)
    a = np.clip(t / max(attack, 1e-5), 0, 1)
    a = 0.5 - 0.5 * np.cos(np.pi * a)
    d = np.exp(-np.maximum(t - attack, 0) / decay) ** curve
    e = a * d
    k = min(N(0.04), max(1, n // 8))  # always land on zero: truncated decays click
    e[n - k:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, k))
    return e


def burst_env(n, attack, hold, release):
    t = tt(n)
    a = np.clip(t / max(attack, 1e-5), 0, 1)
    r = np.clip(1 - (t - attack - hold) / max(release, 1e-5), 0, 1)
    e = np.minimum(a, r)
    return 0.5 - 0.5 * np.cos(np.pi * e)


# --------------------------------------------------------------------------- noise
def white(n, rng):
    return rng.standard_normal(n)


def mag_band(f, lo=None, hi=None, order=2):
    m = np.ones_like(f)
    with np.errstate(divide='ignore', invalid='ignore'):
        if hi is not None:
            m = m / np.sqrt(1 + (f / hi) ** (2 * order))
        if lo is not None:
            m = m / np.sqrt(1 + (lo / np.maximum(f, 1e-3)) ** (2 * order))
    return m


def mag_tilt(f, db_oct, ref=1000.0):
    return (np.maximum(f, 10.0) / ref) ** (db_oct / 6.0206)


def mag_peak(f, f0, gain_db, q):
    """Smooth bell in log-frequency (magnitude only)."""
    bw = 1.0 / q
    x = np.log2(np.maximum(f, 1.0) / f0) / bw
    return undb(gain_db * np.exp(-0.5 * (x * 2.3548) ** 2))


def shaped_noise(n, rng, magfn=None):
    """Periodic Gaussian noise of length n with arbitrary magnitude spectrum; std 1."""
    m = n // 2 + 1
    spec = rng.standard_normal(m) + 1j * rng.standard_normal(m)
    if magfn is not None:
        f = np.fft.rfftfreq(n, 1.0 / SR)
        spec *= magfn(f)
    spec[0] = 0
    x = np.fft.irfft(spec, n)
    s = np.std(x)
    return x / s if s > 0 else x


def pink(n, rng, lo=20, hi=18000):
    return shaped_noise(n, rng, lambda f: mag_tilt(f, -3) * mag_band(f, lo, hi, 2))


def brown(n, rng, lo=20, hi=18000):
    return shaped_noise(n, rng, lambda f: mag_tilt(f, -6) * mag_band(f, lo, hi, 2))


def band_noise(n, rng, lo, hi, order=2, tilt=0.0):
    return shaped_noise(n, rng, lambda f: mag_band(f, lo, hi, order) * mag_tilt(f, tilt))


def smooth_rand(n, rng, rate):
    """Periodic slow random control signal, mean 0, std 1, bandwidth ~rate Hz."""
    return shaped_noise(n, rng, lambda f: np.exp(-0.5 * (f / max(rate, 1e-3)) ** 2))


def fft_filter(x, magfn):
    """Zero-phase, circular filtering by an arbitrary magnitude response."""
    n = x.shape[-1]
    f = np.fft.rfftfreq(n, 1.0 / SR)
    return np.fft.irfft(np.fft.rfft(x, axis=-1) * magfn(f), n, axis=-1)


# --------------------------------------------------------------------------- IIR filters
def _sos(kind, f, order):
    if isinstance(f, (list, tuple)):
        f = [min(max(v, 5.0), NYQ * 0.97) for v in f]
    else:
        f = min(max(f, 5.0), NYQ * 0.97)
    return signal.butter(order, f, btype=kind, fs=SR, output='sos')


def lp(x, fc, order=2):
    return signal.sosfilt(_sos('lowpass', fc, order), x, axis=-1)


def hp(x, fc, order=2):
    return signal.sosfilt(_sos('highpass', fc, order), x, axis=-1)


def bp(x, lo, hi, order=2):
    return signal.sosfilt(_sos('bandpass', [lo, hi], order), x, axis=-1)


def lp0(x, fc, order=2):
    """Zero-phase lowpass (forward-backward)."""
    return signal.sosfiltfilt(_sos('lowpass', fc, order), x, axis=-1)


def _rbj(kind, f0, gain_db, q):
    A = 10 ** (gain_db / 40.0)
    w0 = TWO_PI * min(f0, NYQ * 0.97) / SR
    cw, sw = math.cos(w0), math.sin(w0)
    al = sw / (2 * q)
    if kind == 'peak':
        b = [1 + al * A, -2 * cw, 1 - al * A]
        a = [1 + al / A, -2 * cw, 1 - al / A]
    elif kind == 'lowshelf':
        sA = 2 * math.sqrt(A) * al
        b = [A * ((A + 1) - (A - 1) * cw + sA), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - sA)]
        a = [(A + 1) + (A - 1) * cw + sA, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - sA]
    elif kind == 'highshelf':
        sA = 2 * math.sqrt(A) * al
        b = [A * ((A + 1) + (A - 1) * cw + sA), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - sA)]
        a = [(A + 1) - (A - 1) * cw + sA, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - sA]
    elif kind == 'bpq':  # constant 0 dB peak gain bandpass
        b = [al, 0, -al]
        a = [1 + al, -2 * cw, 1 - al]
    else:
        raise ValueError(kind)
    b = np.array(b) / a[0]
    a = np.array(a) / a[0]
    return np.concatenate([b, a])[None, :]


def peq(x, f0, gain_db, q=1.0):
    return signal.sosfilt(_rbj('peak', f0, gain_db, q), x, axis=-1)


def lowshelf(x, f0, gain_db, q=0.707):
    return signal.sosfilt(_rbj('lowshelf', f0, gain_db, q), x, axis=-1)


def highshelf(x, f0, gain_db, q=0.707):
    return signal.sosfilt(_rbj('highshelf', f0, gain_db, q), x, axis=-1)


def reson(x, f0, q):
    """Constant-peak-gain resonant bandpass."""
    return signal.sosfilt(_rbj('bpq', f0, 0, q), x, axis=-1)


def circ(fn, x, *tracks):
    """Apply a causal process with short memory to a periodic signal so the result stays
    periodic: run it over two periods and keep the second."""
    n = x.shape[-1]
    xx = np.concatenate([x, x], axis=-1)
    tr = [np.concatenate([t, t], axis=-1) if isinstance(t, np.ndarray) and t.shape[-1] == n else t
          for t in tracks]
    y = fn(xx, *tr)
    return y[..., n:]


# --------------------------------------------------------------------------- numba kernels
@njit(cache=True)
def _svf(x, fc, q, mode):
    n = x.shape[0]
    y = np.empty(n)
    ic1 = 0.0
    ic2 = 0.0
    for i in range(n):
        f = fc[i]
        if f > 0.47 * SR:
            f = 0.47 * SR
        if f < 5.0:
            f = 5.0
        g = math.tan(math.pi * f / SR)
        k = 1.0 / q[i]
        a1 = 1.0 / (1.0 + g * (g + k))
        a2 = g * a1
        a3 = g * a2
        v3 = x[i] - ic2
        v1 = a1 * ic1 + a2 * v3
        v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2.0 * v1 - ic1
        ic2 = 2.0 * v2 - ic2
        if mode == 0:
            y[i] = v2
        elif mode == 1:
            y[i] = k * v1
        else:
            y[i] = x[i] - k * v1 - v2
    return y


def svf(x, fc, q=0.707, mode='lp'):
    """Time-varying TPT state-variable filter (stable under fast modulation).
    mode: 'lp', 'bp' (unity peak gain), 'hp'."""
    m = {'lp': 0, 'bp': 1, 'hp': 2}[mode]
    n = x.shape[-1]
    fc = as_array(fc, n)
    q = as_array(q, n)
    if x.ndim == 2:
        return np.vstack([_svf(np.ascontiguousarray(c), fc, q, m) for c in x])
    return _svf(np.ascontiguousarray(x, dtype=float), fc, q, m)


@njit(cache=True)
def _onepole(x, fc):
    n = x.shape[0]
    y = np.empty(n)
    z = 0.0
    for i in range(n):
        a = math.exp(-TWO_PI * fc[i] / SR)
        z = (1.0 - a) * x[i] + a * z
        y[i] = z
    return y


def onepole(x, fc):
    n = x.shape[-1]
    fc = as_array(fc, n)
    if x.ndim == 2:
        return np.vstack([_onepole(np.ascontiguousarray(c), fc) for c in x])
    return _onepole(np.ascontiguousarray(x, dtype=float), fc)


@njit(cache=True)
def _hermite(src, pos):
    n = src.shape[0]
    out = np.zeros(pos.shape[0])
    for i in range(pos.shape[0]):
        p = pos[i]
        k = int(math.floor(p))
        if k < 1 or k > n - 3:
            if 0 <= k < n:
                out[i] = src[k]
            continue
        f = p - k
        xm1 = src[k - 1]
        x0 = src[k]
        x1 = src[k + 1]
        x2 = src[k + 2]
        c1 = 0.5 * (x1 - xm1)
        c2 = xm1 - 2.5 * x0 + 2.0 * x1 - 0.5 * x2
        c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1)
        out[i] = ((c3 * f + c2) * f + c1) * f + x0
    return out


def read_at(src, pos):
    return _hermite(np.ascontiguousarray(src, dtype=float), np.ascontiguousarray(pos, dtype=float))


def resample_ratio(x, ratio):
    """Play x at `ratio` speed (ratio>1 = higher & shorter). Band-limits first when speeding up."""
    if ratio > 1.0:
        x = lp(x, 0.45 * SR / ratio, 6)
    m = int((len(x) - 3) / ratio)
    return read_at(x, np.arange(m) * ratio)


@njit(cache=True)
def _klatt_cascade(x, F, B):
    """Cascade of Klatt 2-pole resonators, per-sample formant frequencies F (k x n),
    bandwidths B (k x n). Unity gain at DC."""
    k, n = F.shape
    y = x.copy()
    T = 1.0 / SR
    for j in range(k):
        y1 = 0.0
        y2 = 0.0
        for i in range(n):
            f = F[j, i]
            if f > 0.45 * SR:
                f = 0.45 * SR
            c = -math.exp(-TWO_PI * B[j, i] * T)
            b = 2.0 * math.exp(-math.pi * B[j, i] * T) * math.cos(TWO_PI * f * T)
            a = 1.0 - b - c
            v = a * y[i] + b * y1 + c * y2
            y2 = y1
            y1 = v
            y[i] = v
    return y


def klatt_cascade(x, F, B):
    return _klatt_cascade(np.ascontiguousarray(x, dtype=float), np.ascontiguousarray(F, dtype=float),
                          np.ascontiguousarray(B, dtype=float))


@njit(cache=True)
def _additive(ph, f0, amp_exp, kmax, top):
    """Band-limited harmonic series sum_k k^-amp_exp[i] sin(2 pi k ph), harmonics faded out
    between top-2000 Hz and top. Chebyshev recurrence avoids per-harmonic sin()."""
    n = ph.shape[0]
    y = np.zeros(n)
    for i in range(n):
        th = TWO_PI * ph[i]
        s1 = math.sin(th)
        c2 = 2.0 * math.cos(th)
        sp = 0.0
        sk = s1
        f = f0[i]
        e = amp_exp[i]
        acc = 0.0
        for k in range(1, kmax + 1):
            fk = k * f
            if fk >= top:
                break
            g = 1.0
            if fk > top - 2000.0:
                g = (top - fk) / 2000.0
            acc += g * sk * float(k) ** (-e)
            nxt = c2 * sk - sp
            sp = sk
            sk = nxt
        y[i] = acc
    return y


def harmonic(f0, amp_exp=1.0, kmax=200, top=17000.0, ph0=0.0):
    """Band-limited harmonic tone with spectral slope k^-amp_exp (1 = saw-like)."""
    f0 = np.asarray(f0, dtype=float)
    n = len(f0)
    ph = ph0 + np.cumsum(f0) / SR
    return _additive(ph, f0, as_array(amp_exp, n), int(kmax), float(top))


@njit(cache=True)
def _additive_amps(ph, f0, amps, top):
    n = ph.shape[0]
    K = amps.shape[0]
    y = np.zeros(n)
    for i in range(n):
        th = TWO_PI * ph[i]
        c2 = 2.0 * math.cos(th)
        sp = 0.0
        sk = math.sin(th)
        f = f0[i]
        acc = 0.0
        for k in range(1, K + 1):
            fk = k * f
            if fk >= top:
                break
            g = 1.0
            if fk > top - 2000.0:
                g = (top - fk) / 2000.0
            acc += g * sk * amps[k - 1]
            nxt = c2 * sk - sp
            sp = sk
            sk = nxt
        y[i] = acc
    return y


def harmonic_amps(f0, amps, top=17000.0, ph0=0.0):
    """Band-limited harmonic tone with a fixed amplitude per harmonic."""
    f0 = np.asarray(f0, dtype=float)
    ph = ph0 + np.cumsum(f0) / SR
    return _additive_amps(ph, f0, np.asarray(amps, dtype=float), float(top))


def blsaw(f0, top=17000.0, ph0=0.0):
    return harmonic(f0, 1.0, 400, top, ph0)


def blsquare(f0, top=17000.0, ph0=0.0):
    amps = np.array([(1.0 / k if k % 2 else 0.0) for k in range(1, 300)])
    return harmonic_amps(f0, amps, top, ph0)


def blpulse(f0, duty=0.3, top=17000.0, ph0=0.0):
    amps = np.array([math.sin(math.pi * k * duty) / k for k in range(1, 300)])
    return harmonic_amps(f0, amps, top, ph0)


def sine(f0, ph0=0.0):
    f0 = np.asarray(f0, dtype=float)
    return np.sin(TWO_PI * (ph0 + np.cumsum(f0) / SR))


@njit(cache=True)
def _comb_tv(x, d, fb, damp):
    """Feedback comb with fractional, time-varying delay d (samples) and one-pole damping."""
    n = x.shape[0]
    size = 1
    while size < n + 8:
        size *= 2
    buf = np.zeros(size)
    mask = size - 1
    y = np.empty(n)
    lpz = 0.0
    for i in range(n):
        p = i - d[i]
        k = int(math.floor(p))
        f = p - k
        a = buf[k & mask] if k >= 0 else 0.0
        b = buf[(k + 1) & mask] if k + 1 >= 0 else 0.0
        dl = a + (b - a) * f
        lpz = (1.0 - damp) * dl + damp * lpz
        v = x[i] + fb * lpz
        buf[i & mask] = v
        y[i] = v
    return y


def comb(x, delay_sec, fb=0.7, damp=0.2):
    n = x.shape[-1]
    d = as_array(delay_sec, n) * SR
    return _comb_tv(np.ascontiguousarray(x, dtype=float), d, float(fb), float(damp))


# --------------------------------------------------------------------------- oversampled nonlinearity
def saturate(x, drive=2.0, os=4):
    """tanh saturation at 4x oversampling (no aliasing), output normalised to drive."""
    up = signal.resample_poly(x, os, 1, axis=-1)
    up = np.tanh(drive * up) / math.tanh(drive)
    return signal.resample_poly(up, 1, os, axis=-1)[..., :x.shape[-1]]


# --------------------------------------------------------------------------- stereo / space
def pan(x, p):
    """Equal-power pan. p in [-1, 1] (scalar or per-sample)."""
    x = mono(x)
    p = np.clip(as_array(p, len(x)) if not np.isscalar(p) else p, -1, 1)
    th = (p + 1) * np.pi / 4
    return np.vstack([x * np.cos(th), x * np.sin(th)]) * math.sqrt(2)


def widen(st, w):
    m = 0.5 * (st[0] + st[1])
    s = 0.5 * (st[0] - st[1]) * w
    return np.vstack([m + s, m - s])


def mix_at(buf, ev, pos, gain=1.0, wrap=False):
    """Add event ev (mono or stereo) into buf at sample pos. With wrap=True the event wraps
    around the end of a loop buffer."""
    L = buf.shape[-1]
    if buf.ndim == 2:
        ev = stereo(ev)
    m = ev.shape[-1]
    pos = int(pos)
    if wrap:
        pos %= L
        done = 0
        while done < m:
            start = (pos + done) % L
            chunk = min(m - done, L - start)
            buf[..., start:start + chunk] += gain * ev[..., done:done + chunk]
            done += chunk
    else:
        if pos >= L or pos + m <= 0:
            return buf
        s0 = max(0, -pos)
        e0 = min(m, L - pos)
        buf[..., pos + s0:pos + e0] += gain * ev[..., s0:e0]
    return buf


def distance_filter(x, dist, ref=5.0):
    """Static air/obstruction absorption + 1/r gain for a source `dist` metres away."""
    g = ref / max(dist, ref * 0.2)
    fc = 17000.0 / (1.0 + dist / 35.0)
    y = lp(x, max(fc, 500.0), 2) if fc < 16000 else x
    return y * g


def place(x, dist, p, ref=5.0):
    return pan(distance_filter(mono(x), dist, ref), p)


def moving_source(src, x, y, z=0.0, c=343.0, ref=5.0, rmin=1.0, air=True, pan_amt=0.9,
                  air_scale=35.0):
    """Render a moving point source to stereo with physical doppler (variable delay line),
    1/r spreading, distance-dependent air absorption and azimuth panning.
    src: mono samples in *emission* time. x, y, z: source position (m) per emission sample
    (or scalars); listener at origin facing +y, +x is to the right."""
    n = len(src)
    x = as_array(x, n)
    y = as_array(y, n)
    z = as_array(z, n)
    te = np.arange(n) / SR
    r = np.sqrt(x * x + y * y + z * z)
    ta = te + r / c
    m = int((ta[-1] - ta[0]) * SR)
    tout = ta[0] + np.arange(m) / SR
    pos = np.interp(tout, ta, te) * SR
    s = read_at(src, pos)
    rr = np.interp(tout, ta, r)
    xr = np.interp(tout, ta, x)
    g = ref / np.maximum(rr, rmin)
    if air:
        fc = 17000.0 / (1.0 + rr / air_scale)
        s = onepole(s, np.maximum(fc, 400.0))
        s = onepole(s, np.maximum(fc * 1.3, 500.0))
    p = np.clip(xr / np.maximum(rr, 1.0), -1, 1) * pan_amt
    return pan(s * g, p), ta[0]


# --------------------------------------------------------------------------- reverb
_IR_CACHE = {}


def make_ir(seed, dur, t60, xover=(250.0, 4000.0), predelay=0.01, early=(), er_lp=8000.0,
            onset=0.02, tail_gain=1.0, modes=(), flutter=None):
    """Synthesised stereo impulse response.
    t60: (low, mid, high) decay times; early: [(delay_s, gain, pan)]; modes: [(freq, t60, gain)]
    resonant ringing (metal, tunnel modes); flutter: (period_s, gain, t60, lp) a train of
    regularly spaced reflections between parallel walls."""
    key = (seed, dur)
    if key in _IR_CACHE:
        return _IR_CACHE[key]
    rng = np.random.default_rng(zlib.crc32(seed.encode()))
    n = N(dur)
    t = tt(n)
    pre = N(predelay)
    out = np.zeros((2, n))
    for ch in range(2):
        w = rng.standard_normal(n)
        lo = lp(w, xover[0], 2)
        hi = hp(w, xover[1], 2)
        mid = bp(w, xover[0], xover[1], 1)
        tail = (lo * np.exp(-6.908 * t / t60[0]) + mid * np.exp(-6.908 * t / t60[1])
                + hi * np.exp(-6.908 * t / t60[2]))
        tail *= (1 - np.exp(-t / onset)) * tail_gain
        er = np.zeros(n)
        for (d, g, p) in early:
            i = N(d)
            if i < n:
                th = (p + 1) * np.pi / 4
                er[i] += g * (math.cos(th) if ch == 0 else math.sin(th)) * math.sqrt(2) * rng.uniform(0.85, 1.15)
        if flutter is not None:
            per, g0, ft60, flp = flutter
            k = 1
            while k * per < dur:
                i = N(k * per + rng.uniform(-0.0004, 0.0004))
                if i < n:
                    er[i] += g0 * math.exp(-6.908 * k * per / ft60) * (1 if (k + ch) % 2 else 0.8)
                k += 1
            er = lp(er, flp, 2)
        er = lp(er, er_lp, 2)
        for (f, mt60, g) in modes:
            ph = rng.uniform(0, TWO_PI)
            er += g * 0.02 * np.sin(TWO_PI * f * t + ph) * np.exp(-6.908 * t / mt60) * (1 - np.exp(-t / 0.01))
        sig = np.zeros(n)
        sig[pre:] = (tail + er)[:n - pre]
        out[ch] = sig
    out = fade(out, 0, 0.05)
    out /= math.sqrt(np.sum(out ** 2) / 2)
    _IR_CACHE[key] = out
    return out


def ir_station():
    early = [(0.006, 0.6, -0.5), (0.011, 0.5, 0.6), (0.019, 0.45, -0.2), (0.027, 0.4, 0.4),
             (0.034, 0.35, -0.7), (0.045, 0.3, 0.2), (0.058, 0.25, 0.7), (0.071, 0.2, -0.4)]
    return make_ir('station', 3.6, (2.6, 2.5, 1.5), xover=(300, 5000), predelay=0.006, early=early,
                   er_lp=10000, onset=0.03, flutter=(0.029, 0.35, 1.2, 7000))


def ir_tunnel():
    early = [(0.004, 0.7, -0.6), (0.009, 0.6, 0.6), (0.015, 0.45, 0.0), (0.024, 0.4, -0.3)]
    modes = [(43, 3.5, 4.0), (71, 3.0, 3.0), (97, 2.6, 2.5), (131, 2.2, 1.6), (433, 1.0, 0.9),
             (1171, 0.7, 0.6), (2214, 0.5, 0.35)]
    return make_ir('tunnel', 4.0, (3.8, 2.3, 0.8), xover=(220, 2500), predelay=0.004, early=early,
                   er_lp=6000, onset=0.04, modes=modes, flutter=(0.0142, 0.45, 0.6, 4500))


def ir_slap():
    early = [(0.045, 0.45, -0.6), (0.112, 0.40, 0.7), (0.168, 0.25, -0.3), (0.236, 0.2, 0.5),
             (0.31, 0.14, -0.8), (0.39, 0.1, 0.3), (0.52, 0.06, -0.2), (0.66, 0.04, 0.6)]
    return make_ir('slap', 1.8, (1.2, 0.9, 0.45), xover=(300, 3000), predelay=0.02, early=early,
                   er_lp=4500, onset=0.06, tail_gain=0.35)


def ir_open():
    early = [(0.07, 0.15, -0.5), (0.19, 0.1, 0.6), (0.35, 0.06, 0.1)]
    return make_ir('open', 1.4, (0.9, 0.7, 0.35), xover=(300, 3000), predelay=0.015, early=early,
                   er_lp=4000, onset=0.08, tail_gain=0.4)


def ir_shaft():
    """Tall metal shaft / pipe: dense metallic flutter, strong modes."""
    modes = [(173, 1.6, 3.0), (347, 1.3, 2.2), (521, 1.1, 1.6), (1240, 0.8, 1.0), (2633, 0.5, 0.5)]
    return make_ir('shaft', 2.5, (2.2, 1.6, 0.6), xover=(250, 3000), predelay=0.002,
                   early=[(0.003, 0.6, -0.3), (0.006, 0.5, 0.3)], er_lp=7000, onset=0.01,
                   modes=modes, flutter=(0.0058, 0.5, 0.5, 5000))


def reverb(x, ir, wet=0.3, dry=1.0, circular=False):
    """Convolution reverb. Mono or stereo in, stereo out. One-shots get the tail appended;
    circular=True wraps the tail to the start of a loop (seamless)."""
    x = stereo(x)
    n = x.shape[-1]
    if circular:
        assert ir.shape[-1] <= n
        X = np.fft.rfft(x, axis=-1)
        H = np.fft.rfft(pad_to(ir, n), axis=-1)
        w = np.fft.irfft(X * H, n, axis=-1)
        return dry * x + wet * w
    w = signal.oaconvolve(x, ir, axes=-1)
    return dry * pad_to(x, w.shape[-1]) + wet * w


# --------------------------------------------------------------------------- loudness
def _kfilter_sos():
    # BS.1770 K-weighting designed for SR (pyloudnorm-style parameters)
    G, Q, fc = 3.99984385397, 0.7071752369554193, 1681.9744509555319
    A = 10 ** (G / 40.0)
    w0 = TWO_PI * fc / SR
    al = math.sin(w0) / (2.0 * Q)
    cw = math.cos(w0)
    sA = 2 * math.sqrt(A) * al
    b = [A * ((A + 1) + (A - 1) * cw + sA), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - sA)]
    a = [(A + 1) - (A - 1) * cw + sA, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - sA]
    s1 = np.concatenate([np.array(b) / a[0], np.array(a) / a[0]])
    fc2, Q2 = 38.13547087613982, 0.5003270373253953
    w0 = TWO_PI * fc2 / SR
    al = math.sin(w0) / (2.0 * Q2)
    cw = math.cos(w0)
    b = [1.0, -2.0, 1.0]
    a = [1 + al, -2 * cw, 1 - al]
    s2 = np.concatenate([np.array(b) / a[0], np.array(a) / a[0]])
    return np.vstack([s1, s2])


_KSOS = _kfilter_sos()


def lufs(x, gated=True):
    """Integrated loudness (BS.1770-4) of mono or stereo signal."""
    x = stereo(x) if x.ndim == 1 else x
    if x.ndim == 2 and x is not None and x.shape[0] == 2 and np.array_equal(x[0], x[1]):
        pass
    y = signal.sosfilt(_KSOS, x, axis=-1)
    blk, hop = N(0.4), N(0.1)
    n = y.shape[-1]
    if n < blk:
        return -0.691 + 10 * math.log10(max(np.sum(np.mean(y ** 2, axis=-1)), 1e-12))
    p = y ** 2
    cs = np.cumsum(np.pad(p, ((0, 0), (1, 0))), axis=-1)
    starts = np.arange(0, n - blk + 1, hop)
    z = (cs[:, starts + blk] - cs[:, starts]) / blk
    zs = z.sum(axis=0)
    lk = -0.691 + 10 * np.log10(np.maximum(zs, 1e-12))
    if not gated:
        return float(-0.691 + 10 * math.log10(max(zs.mean(), 1e-12)))
    keep = lk > -70
    if not keep.any():
        return -70.0
    rel = -0.691 + 10 * math.log10(zs[keep].mean()) - 10
    keep2 = keep & (lk > rel)
    return float(-0.691 + 10 * math.log10(zs[keep2].mean()))


def max_momentary(x):
    """Max momentary (400 ms) loudness, LUFS - used to rank one-shot loudness."""
    x = stereo(x)
    y = signal.sosfilt(_KSOS, x, axis=-1)
    blk = N(0.4)
    p = (y ** 2).sum(axis=0)
    if len(p) < blk:
        p = np.pad(p, (0, blk - len(p)))
    m = uniform_filter1d(p, blk, mode='constant')
    return float(-0.691 + 10 * math.log10(max(m.max(), 1e-12)))


def true_peak(x):
    up = signal.resample_poly(stereo(x), 4, 1, axis=-1)
    return float(np.max(np.abs(up)))


def limit(x, thr_db=-1.0, lookahead=0.003, hold=0.03, wrap=False):
    """Look-ahead peak limiter (gain never overshoots). wrap=True for loops."""
    x = np.array(x, dtype=float)
    st = stereo(x)
    thr = undb(thr_db)
    n = st.shape[-1]
    if wrap:  # inter-sample peaks of a periodic signal: upsample circularly via FFT
        up = signal.resample(st, 4 * n, axis=-1)
    else:
        up = signal.resample_poly(st, 4, 1, axis=-1)[:, :4 * n]
    pk = np.abs(up).reshape(st.shape[0], n, 4).max(axis=2).max(axis=0)
    pk = np.maximum(pk, np.max(np.abs(st), axis=0))
    greq = np.minimum(1.0, thr / np.maximum(pk, 1e-9))
    if greq.min() >= 1.0:
        return x
    la = max(1, N(lookahead))
    mode = 'wrap' if wrap else 'nearest'
    g = minimum_filter1d(greq, 2 * la + 1 + N(hold), mode=mode)
    g = uniform_filter1d(g, la, mode=mode)
    g = np.minimum(g, greq)
    return x * g if x.ndim == 1 else x * g[None, :]


def remove_dc_circular(x, fc=18.0):
    return fft_filter(x, lambda f: mag_band(f, fc, None, 3))
