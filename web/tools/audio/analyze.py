"""Analysis helpers: spectrogram PNGs and signal checks."""
import os

import numpy as np

from dsp import SR, mono


def spectrogram_png(x, path, title, fmax=16000):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from scipy import signal
    st = x if x.ndim == 2 else x[None, :]
    m = mono(x)
    f, t, S = signal.spectrogram(m, SR, nperseg=2048, noverlap=2048 - 256, window='hann')
    Sdb = 10 * np.log10(S + 1e-14)
    vmax = Sdb.max()
    fig, axs = plt.subplots(2, 1, figsize=(12, 7), gridspec_kw={'height_ratios': [4, 1]}, sharex=True)
    ax = axs[0]
    ax.pcolormesh(t, f, Sdb, vmin=vmax - 90, vmax=vmax, cmap='magma', shading='auto')
    ax.set_ylim(0, fmax)
    ax.set_ylabel('Hz')
    ax.set_title(title)
    tt = np.arange(st.shape[-1]) / SR
    for c, col in zip(st, ['#3b82f6', '#ef4444']):
        axs[1].plot(tt, c, lw=0.3, color=col, alpha=0.7)
    axs[1].set_ylim(-1, 1)
    axs[1].set_xlabel('s')
    fig.tight_layout()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fig.savefig(path, dpi=80)
    plt.close(fig)


def abrupt_stops(x, drop_db=30.0, floor_db=-40.0):
    """Times (s) where the 1 ms envelope falls by more than drop_db within 3 ms from a level
    above floor_db (relative to peak) - i.e. truncated decays that click. Attacks are ignored."""
    from scipy.ndimage import uniform_filter1d, maximum_filter1d
    p = (x * x).sum(axis=0) if x.ndim == 2 else x * x
    w = max(1, int(SR * 0.001))
    env = np.sqrt(np.maximum(uniform_filter1d(p, w), 0) + 1e-20)
    pk = env.max()
    lag = int(SR * 0.003)
    span = int(SR * 0.006)
    fut = maximum_filter1d(env, span, origin=-(span // 2))  # max over the next ~6 ms
    a, b = env[:-lag], fut[lag:]
    bad = (a > pk * 10 ** (floor_db / 20)) & (b < a * 10 ** (-drop_db / 20))
    idx = np.nonzero(bad)[0]
    out = []
    for i in idx:
        if not out or i / SR - out[-1] > 0.05:
            out.append(i / SR)
    return out


def hf_clicks(x, rise_db=20.0):
    """For smooth/tonal sounds: short broadband spikes (energy > 7 kHz jumping rise_db above
    BOTH the preceding and following 5-50 ms) - discontinuities hidden under ongoing sound."""
    from scipy import signal
    from scipy.ndimage import uniform_filter1d, median_filter
    p = x.sum(axis=0) if x.ndim == 2 else x
    h = signal.sosfilt(signal.butter(4, 7000, 'highpass', fs=SR, output='sos'), p)
    hop = int(SR * 0.002)
    e = uniform_filter1d(h * h, hop)[::hop] + 1e-14
    k = 22  # ~45 ms
    pre = np.array([np.median(e[max(0, i - k):max(1, i - 2)]) for i in range(len(e))])
    post = np.array([np.median(e[min(len(e) - 1, i + 3):i + k] if i + 3 < len(e) else e[-1:]) for i in range(len(e))])
    thr = 10 ** (rise_db / 10)
    loud = e > e.max() * 1e-4
    bad = np.nonzero((e > thr * pre) & (e > thr * post) & loud)[0]
    out = []
    for i in bad:
        if i > 3 and (not out or i * hop / SR - out[-1] > 0.05):
            out.append(i * hop / SR)
    return out


def seam_check(x):
    """Ratio of the loop-seam jump to the 99.9th percentile of in-file sample steps.
    <= ~1 means the wrap is indistinguishable from any other sample step."""
    st = x if x.ndim == 2 else x[None, :]
    worst = 0.0
    for c in st:
        d = np.abs(np.diff(c))
        ref = np.percentile(d, 99.9) + 1e-12
        jump = abs(c[0] - c[-1])
        # also compare 2nd difference (slope continuity)
        d2 = np.abs(np.diff(c, 2))
        ref2 = np.percentile(d2, 99.9) + 1e-12
        j2 = abs(c[1] - 2 * c[0] + c[-1])
        worst = max(worst, jump / ref, j2 / ref2)
    return worst
