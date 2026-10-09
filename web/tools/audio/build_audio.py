"""
Far From the Tree - procedural sound library builder.

Synthesises every sound in sounds.py, masters it (loops: -20 LUFS integrated, circular DC
removal, wrap-aware limiter; one-shots: -1 dBTP peak), verifies it (finite, peak, RMS, LUFS,
loop-seam continuity, decoded-MP3 length/peak), encodes MP3 with ffmpeg/libmp3lame (VBR q2)
and writes public/audio/manifest.json.

    python build_audio.py                  # build everything
    python build_audio.py --only amb_street,cab_horn_1
    python build_audio.py --spectrograms   # also render tools/audio/spectrograms/*.png
    python build_audio.py --no-encode      # synth + checks only

Requires numpy, scipy, numba (optional, much faster), matplotlib (spectrograms only), ffmpeg.
Runs single-process at below-normal priority (ffmpeg at idle priority, 1 thread).
"""
import argparse
import glob
import json
import os
import subprocess
import sys
import tempfile
import time

os.environ.setdefault('OMP_NUM_THREADS', '1')
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
os.environ.setdefault('MKL_NUM_THREADS', '1')
os.environ.setdefault('NUMBA_NUM_THREADS', '1')

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402
from scipy.io import wavfile  # noqa: E402

from dsp import (SR, N, rng_for, lufs, max_momentary, true_peak, limit, remove_dc_circular, hp,  # noqa: E402
                 fade, undb, db, stereo)
from analyze import spectrogram_png, seam_check, abrupt_stops, hf_clicks  # noqa: E402
import sounds  # noqa: E402

WEB = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT_DIR = os.path.join(WEB, 'public', 'audio')
SPEC_DIR = os.path.join(HERE, 'spectrograms')
SPEC_SET = ['train_pass_uptown', 'amb_street', 'amb_station', 'kid_shout_1', 'crowd_cheer', 'cab_horn_1',
            'whoosh_drop', 'amb_park']

INTENTIONAL_CUTS = {'train_hit'}  # the roar is meant to cut dead
# smooth / tonal sounds where any short HF spike would be a defect (click detector applies)
SMOOTH_SET = {'door_chime', 'achievement_chime', 'seed_plant', 'ui_back', 'cab_horn_1', 'cab_horn_2',
              'cab_horn_3', 'cab_horn_4', 'car_horn_long', 'train_horn', 'siren_pass', 'pigeon_coo',
              'cat_meow', 'kid_shout_1', 'kid_shout_2', 'kid_shout_3', 'man_shout_hey', 'gull_cry',
              'whoosh_drop', 'whoosh_drop_big', 'corkscrew_whoosh', 'loop_whoosh', 'gust_blast',
              'steam_hiss', 'amb_wind_low', 'amb_wind_high'}
AMB_LUFS = -20.0
PEAK_DBTP = -1.0
ROLE_TARGET = {'loud': -14.0, 'medium': -18.0, 'soft': -22.0, 'ui': -23.0}


def low_priority():
    if os.name == 'nt':
        try:
            import ctypes
            BELOW_NORMAL = 0x00004000
            ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), BELOW_NORMAL)
        except Exception:
            pass
    else:
        try:
            os.nice(10)
        except Exception:
            pass


def find_ffmpeg():
    pats = [os.path.expandvars(r'%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\*\bin\ffmpeg.exe')]
    for p in pats:
        hits = sorted(glob.glob(p))
        if hits:
            return hits[-1]
    from shutil import which
    return which('ffmpeg')


def run(cmd, **kw):
    flags = 0x00000040 if os.name == 'nt' else 0  # IDLE_PRIORITY_CLASS
    return subprocess.run(cmd, check=True, creationflags=flags, **kw)


def master_loop(x, L):
    assert x.shape == (2, L), (x.shape, L)
    x = remove_dc_circular(x)
    x = x * undb(AMB_LUFS - lufs(x))
    x = limit(x, PEAK_DBTP - 0.3, wrap=True)
    # limiting lowers loudness a touch: one corrective pass
    x = x * undb(AMB_LUFS - lufs(x))
    x = limit(x, PEAK_DBTP - 0.3, wrap=True)
    return x


def trim_tail(x, floor_db=-65.0):
    st = stereo(x)
    env = np.max(np.abs(st), axis=0)
    pk = env.max()
    idx = np.nonzero(env > pk * undb(floor_db))[0]
    end = min(st.shape[-1], idx[-1] + N(0.05)) if len(idx) else st.shape[-1]
    return x[..., :end]


def master_oneshot(x):
    x = np.asarray(x, dtype=float)
    x = hp(x, 18.0, 2)
    x = x - np.mean(x, axis=-1, keepdims=True)
    x = trim_tail(x)
    x = fade(x, 0.0008, 0.03)
    x = x * (undb(PEAK_DBTP) / max(true_peak(x), 1e-9))
    return x


def is_mono(x):
    if x.ndim == 1:
        return True
    d = x[0] - x[1]
    return np.sqrt(np.mean(d ** 2)) < 1e-4 * (np.sqrt(np.mean(x ** 2)) + 1e-12)


def encode(ffmpeg, x, path_mp3, tmpdir, name):
    mono_out = is_mono(x)
    data = (x if x.ndim == 1 else (x[0] if mono_out else x.T)).astype(np.float32)
    wav = os.path.join(tmpdir, name + '.wav')
    wavfile.write(wav, SR, data)
    run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-threads', '1', '-i', wav,
         '-c:a', 'libmp3lame', '-q:a', '2', '-ar', str(SR), path_mp3])
    os.remove(wav)
    dec = run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-threads', '1', '-i', path_mp3, '-f', 'f32le',
               '-ac', '1' if mono_out else '2', '-'], stdout=subprocess.PIPE).stdout
    y = np.frombuffer(dec, dtype=np.float32).astype(float)
    if not mono_out:
        y = y.reshape(-1, 2).T
    return y, (1 if mono_out else 2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    ap.add_argument('--no-encode', action='store_true')
    ap.add_argument('--spectrograms', action='store_true')
    ap.add_argument('--spec-names', default='', help='comma list overriding the default spectrogram set')
    ap.add_argument('--spec-dir', default=SPEC_DIR)
    ap.add_argument('--wav-dir', default='', help='also dump mastered float WAVs here (analysis)')
    args = ap.parse_args()
    low_priority()
    os.makedirs(OUT_DIR, exist_ok=True)
    ffmpeg = None if args.no_encode else find_ffmpeg()
    if not args.no_encode and not ffmpeg:
        sys.exit('ffmpeg not found')
    names = list(sounds.REG.keys())
    if args.only:
        want = [s.strip() for s in args.only.split(',') if s.strip()]
        names = [n for n in names if n in want]
    man_path = os.path.join(OUT_DIR, 'manifest.json')
    manifest = {}
    if os.path.exists(man_path):
        try:
            manifest = json.load(open(man_path, encoding='utf-8')).get('sounds', {})
        except Exception:
            manifest = {}
    problems = []
    tmpdir = tempfile.mkdtemp(prefix='fftt_audio_')
    t_all = time.time()
    print(f"{'name':<22}{'dur':>7}{'ch':>3}{'peak':>8}{'tp':>7}{'rms':>8}{'lufs':>7}{'mom':>7}{'gain':>6}{'seam':>7}{'kB':>7}{'s':>6}")
    for name in names:
        meta = sounds.REG[name]
        t0 = time.time()
        rng = rng_for(name)
        if meta['loop']:
            L = N(meta['length'])
            x = meta['fn'](rng, L)
            x = stereo(np.asarray(x, dtype=float))
            if not np.all(np.isfinite(x)):
                problems.append(f'{name}: non-finite samples')
                x = np.nan_to_num(x)
            x = master_loop(x, L)
        else:
            x = meta['fn'](rng)
            if not np.all(np.isfinite(x)):
                problems.append(f'{name}: non-finite samples')
                x = np.nan_to_num(x)
            x = master_oneshot(x)
        # ---- checks on the master
        pk = float(np.max(np.abs(x)))
        tp = true_peak(x)
        rms = float(np.sqrt(np.mean(x ** 2)))
        L_int = lufs(x)
        mom = max_momentary(x)
        dc = float(np.max(np.abs(np.mean(stereo(x), axis=-1))))
        seam = seam_check(x) if meta['loop'] else None
        if name in SMOOTH_SET:
            hc = hf_clicks(x)
            if hc:
                problems.append(f'{name}: HF click(s) at ' + ', '.join(f'{s:.3f}s' for s in hc[:6]))
        stops = abrupt_stops(x)
        if stops and name not in INTENTIONAL_CUTS:
            problems.append(f'{name}: abrupt stop(s) at ' + ', '.join(f'{s:.3f}s' for s in stops[:6]))
        if pk > 1.0:
            problems.append(f'{name}: sample peak {db(pk):.2f} dBFS')
        if dc > 3e-3:
            problems.append(f'{name}: DC offset {dc:.4f}')
        if seam is not None and seam > 1.5:
            problems.append(f'{name}: loop seam ratio {seam:.2f}')
        if meta['loop']:
            gain = meta['gain'] or (min(1.0, undb(ROLE_TARGET[meta['role']] - AMB_LUFS)) if meta['role'] else 1.0)
        else:
            gain = float(min(1.0, undb(ROLE_TARGET[meta['role']] - mom)))
        dur = x.shape[-1] / SR
        size_kb = 0.0
        ch = 1 if is_mono(x) else 2
        if not args.no_encode:
            mp3 = os.path.join(OUT_DIR, name + '.mp3')
            y, ch = encode(ffmpeg, x, mp3, tmpdir, name)
            size_kb = os.path.getsize(mp3) / 1024
            dl = y.shape[-1]
            if abs(dl - x.shape[-1]) > 2:
                problems.append(f'{name}: decoded length {dl} != {x.shape[-1]} (gapless trim)')
            ypk = float(np.max(np.abs(y)))
            if ypk >= 1.0:
                problems.append(f'{name}: decoded mp3 peak {db(ypk):.2f} dBFS')
            if meta['loop']:
                ys = seam_check(y)
                if ys > 2.0:
                    problems.append(f'{name}: decoded loop seam ratio {ys:.2f}')
        manifest[name] = {
            'file': name + '.mp3',
            'loop': bool(meta['loop']),
            'gain': round(gain, 3),
            'category': meta['cat'],
            'duration': round(dur, 3),
            'samples': int(x.shape[-1]),
            'channels': ch,
            'description': meta['desc'],
        }
        print(f"{name:<22}{dur:7.2f}{ch:3d}{db(pk):8.2f}{db(tp):7.2f}{db(rms):8.2f}{L_int:7.1f}{mom:7.1f}"
              f"{gain:6.2f}{(seam if seam is not None else 0):7.2f}{size_kb:7.0f}{time.time() - t0:6.1f}", flush=True)
        if args.wav_dir:
            os.makedirs(args.wav_dir, exist_ok=True)
            wavfile.write(os.path.join(args.wav_dir, name + '.wav'), SR,
                          (x if x.ndim == 1 else x.T).astype(np.float32))
        spec_set = args.spec_names.split(',') if args.spec_names else SPEC_SET
        if args.spectrograms and name in spec_set:
            spectrogram_png(x, os.path.join(args.spec_dir, name + '.png'), name)
    order = list(sounds.REG.keys())
    manifest = {k: manifest[k] for k in order if k in manifest}
    doc = {
        'version': 1,
        'sampleRate': SR,
        'format': 'mp3 (libmp3lame VBR q2)',
        'notes': 'gain = suggested linear playback gain. Ambience loops are mastered to -20 LUFS; '
                 'one-shots are peak-normalised to -1 dBTP and their gain brings them to a role loudness '
                 '(loud -14, medium -18, soft -22, ui -23 LUFS momentary max). Loops are sample-exact '
                 'periodic: loop the whole buffer (samples = loop length).',
        'sounds': manifest,
    }
    with open(man_path, 'w', encoding='utf-8') as f:
        json.dump(doc, f, indent=2)
    total = sum(os.path.getsize(os.path.join(OUT_DIR, v['file'])) for v in manifest.values()
                if os.path.exists(os.path.join(OUT_DIR, v['file'])))
    print(f'\n{len(manifest)} sounds, total {total / 1024 / 1024:.2f} MB, built in {time.time() - t_all:.0f}s')
    if problems:
        print('\nPROBLEMS:')
        for p in problems:
            print('  ' + p)
    else:
        print('All checks passed.')
    try:
        os.rmdir(tmpdir)
    except OSError:
        pass


if __name__ == '__main__':
    main()
