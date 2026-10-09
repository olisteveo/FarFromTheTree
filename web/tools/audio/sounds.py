"""
Every named sound in the Far From the Tree library.

@amb(name, seconds, ...)  -> fn(rng, L) returns a periodic stereo array of exactly L samples.
@sfx(name, ...)           -> fn(rng) returns mono or stereo; tails/trim handled by the build.
"""
import numpy as np

from dsp import *  # noqa
from lib import *  # noqa
from voice import say, babble_loop

REG = {}


def amb(name, seconds, desc, gain=1.0):
    def deco(fn):
        REG[name] = dict(fn=fn, cat='ambience', loop=True, length=seconds, desc=desc, gain=gain, role=None)
        return fn
    return deco


def sfx(name, desc, role='medium', cat='sfx', loop=False, length=None):
    def deco(fn):
        REG[name] = dict(fn=fn, cat=cat, loop=loop, length=length, desc=desc, gain=None, role=role)
        return fn
    return deco


def rms_to(x, dbv):
    r = np.sqrt(np.mean(np.asarray(x) ** 2))
    return x * (undb(dbv) / r if r > 0 else 0)


def peak_to(x, dbv):
    p = np.max(np.abs(x))
    return x * (undb(dbv) / p if p > 0 else 0)


def scatter(buf, rng, count, make, dist=(10, 40), pan_r=(-0.9, 0.9), peak_db=-12, ref=5.0,
            spacing=None):
    """Mix `count` events (from make(rng) -> mono/stereo) at random times, wrapping round the loop.
    Events are pre-normalised to peak_db at the reference distance, then distance-attenuated."""
    L = buf.shape[-1]
    if spacing:
        base = rng.uniform(0, L)
        times = [(base + i * L / count + rng.uniform(-0.3, 0.3) * L / count) % L for i in range(count)]
    else:
        times = rng.uniform(0, L, count)
    for t in times:
        e = make(rng)
        e = peak_to(e, peak_db)
        d = rng.uniform(*dist)
        p = rng.uniform(*pan_r)
        if e.ndim == 1:
            e = place(e, d, p, ref=ref)
        mix_at(buf, e, int(t), wrap=True)
    return buf


def periodic_wave(L, rng, period, depth=0.5):
    """Periodic swell (integer cycles per loop) with a little randomness."""
    sec = L / SR
    k = max(1, round(sec / period))
    t = np.arange(L) / L
    w = 0.5 + 0.5 * np.sin(TWO_PI * k * t + rng.uniform(0, TWO_PI))
    w = w ** 2 * (1 + 0.4 * smooth_rand(L, rng, 0.3))
    return 1 - depth + depth * np.clip(w, 0, None)


# =========================================================================== AMBIENCES
@amb('amb_harbour', 48, 'Battery Park waterfront: water lapping on the sea wall, gulls, a distant ferry horn, light cold wind, faint city behind.')
def amb_harbour(rng, L):
    wind = wind_bed(rng, L, bright=0.8, gust=0.5, gust_rate=0.09)
    water = np.vstack([shaped_noise(L, rng, lambda f: mag_band(f, 50, 900, 2) * mag_tilt(f, -2))
                       for _ in range(2)])
    water *= periodic_wave(L, rng, 3.3, 0.7)
    water = widen(water, 0.6)
    city = np.vstack([brown(L, rng, 25, 400) for _ in range(2)])
    ev = np.zeros((2, L))
    scatter(ev, rng, 22, lambda r: lap_event(r), dist=(3, 9), peak_db=-10, ref=4, spacing=True)
    scatter(ev, rng, 5, lambda r: gull_call(r, 'long' if r.random() < 0.5 else 'short'),
            dist=(25, 90), peak_db=-6, ref=10)
    for _ in range(4):  # flagpole halyard clinks, in little clusters
        t0 = rng.uniform(0, L)
        for k in range(int(rng.integers(2, 4))):
            mix_at(ev, place(peak_to(metal_hit(rng, 2350, 0.6, damp=1.5, bright=0.5), -22), 15, 0.6),
                   int(t0 + N(k * rng.uniform(0.3, 0.7))), wrap=True)
    horn = np.zeros((2, L))
    h = ship_horn(rng, 3.4, 86.0)
    mix_at(horn, pan(peak_to(h, -14), -0.4), int(rng.uniform(0.1, 0.4) * L), wrap=True)
    h2 = ship_horn(rng, 1.4, 86.0)
    mix_at(horn, pan(peak_to(h2, -16), -0.4), int(rng.uniform(0.6, 0.85) * L), wrap=True)
    horn = reverb(horn, ir_slap(), wet=0.9, dry=0.6, circular=True)
    ev = reverb(ev, ir_open(), wet=0.3, circular=True)
    return rms_to(wind, -30) + rms_to(water, -27) + rms_to(city, -38) + ev + horn


def _traffic_bed(rng, L, lo=30, hi=1500):
    b = np.vstack([shaped_noise(L, rng, lambda f: mag_band(f, lo, hi, 2) * mag_tilt(f, -3) * mag_peak(f, 90, 4, 1))
                   for _ in range(2)])
    return b * (1 + 0.2 * smooth_rand(L, rng, 0.15))


def _vehicle_make(kinds, weights, speed=(8, 15), lane=(4, 14)):
    w = np.array(weights, float) / sum(weights)

    def make(r):
        k = kinds[r.choice(len(kinds), p=w)]
        return vehicle_pass(r, k, r.uniform(*speed), r.uniform(*lane), 1 if r.random() < 0.5 else -1,
                            dur=7.0, wet=0.35)
    return make


def _horn_make(r):
    pats = [[(0, 0.12), (0.2, 0.14)], [(0, 0.45)], [(0, 0.09), (0.15, 0.09), (0.3, 0.1)],
            [(0, 0.16), (0.32, 0.6)], [(0, 0.25)], [(0, 0.1), (0.17, 0.35)]]
    p = pats[int(r.integers(0, len(pats)))]
    f1 = r.uniform(360, 500)
    return car_horn(r, p, f1, f1 * r.choice([1.2, 1.25, 1.26, 1.33]), drive=r.uniform(1.8, 3))


@amb('amb_street', 60, 'Busy downtown street (Broadway, Financial District): traffic hum, tyres and passing cars/cabs/buses with doppler, cab horns, footsteps, pedestrian murmur, slap-back off the buildings.')
def amb_street(rng, L):
    bed = _traffic_bed(rng, L)
    ev = np.zeros((2, L))
    scatter(ev, rng, 26, _vehicle_make(['car', 'cab', 'bus', 'truck', 'moto'], [50, 28, 8, 9, 5]),
            dist=(1, 1), peak_db=-9, spacing=True)
    scatter(ev, rng, 9, _horn_make, dist=(15, 60), peak_db=-8, ref=10)
    for _ in range(7):
        s = int(rng.uniform(0, L))
        w = walker(rng, N(rng.uniform(5, 9)), rng.choice(['heel', 'sneaker', 'boot']),
                   p0=rng.uniform(-1, 0), p1=rng.uniform(0, 1), dist=rng.uniform(2.5, 5))
        if rng.random() < 0.5:
            w = w[::-1]
        mix_at(ev, peak_to(w, -22), s, wrap=True)
    s = siren_tone(rng, siren_freq(N(9), rng, [('wail', 9)])) * burst_env(N(9), 2, 5, 2)
    mix_at(ev, place(peak_to(s, -12), 220, -0.5, ref=10), int(rng.uniform(0, L)), wrap=True)
    bb = bus_brake(rng)
    mix_at(ev, place(peak_to(bb, -14), 25, 0.5, ref=10), int(rng.uniform(0, L)), wrap=True)
    walla = babble_loop(rng, L, talkers=12, dist=(5, 25))
    ev = reverb(ev, ir_slap(), wet=0.35, circular=True)
    walla = reverb(walla, ir_slap(), wet=0.4, circular=True)
    return rms_to(bed, -27) + ev + rms_to(walla, -33)


def _cart(rng):
    d = rng.uniform(4, 6)
    n = N(d)
    rumble = crackle(rng, n, density=70, lo=120, hi=1500) * 3
    rumble += 0.4 * brown(n, rng, 40, 400) * (1 + 0.5 * smooth_rand(n, rng, 8))
    rat = np.zeros(n)
    for _ in range(int(d * 7)):
        mix_at(rat, metal_hit(rng, rng.uniform(600, 1800), 0.1, damp=3, bright=0.6) * rng.uniform(0.1, 0.4),
               int(rng.integers(0, n)))
    y = (rumble / (np.std(rumble) + 1e-9) + rat * 2) * burst_env(n, 0.8, d - 1.8, 1.0)
    return pan(y, np.linspace(rng.uniform(-1, -0.3), rng.uniform(0.3, 1), n) * rng.choice([-1, 1]))


def _clatter(rng):
    k = rng.integers(0, 4)
    if k == 0:  # crate set down
        th = thump(rng, rng.uniform(90, 150), 0.25, 0.8, 900)
        return th + 0.6 * pad_to(clack(rng, 0.1), len(th))
    if k == 1:  # metal tray / tongs
        return metal_hit(rng, rng.uniform(1200, 3000), 0.5, damp=1.5, bright=0.8)
    if k == 2:  # plastic bags rustle
        n = N(rng.uniform(0.4, 0.9))
        return crackle(rng, n, 1500, 1500, 10000) * burst_env(n, 0.05, len(np.zeros(n)) / SR * 0.5, 0.2)
    return clack(rng, 0.12, rng.uniform(600, 1100))


def vendor_call(rng, f0=None):
    f0 = f0 or rng.uniform(150, 185)
    syl = [('l', 0.05), ('a', 0.22), ('_', 0.04), ('y', 0.04), ('a', 0.16), ('h', 0.04), ('o', 0.42)]
    pitch = [(0, 1.0), (0.2, 1.25), (0.4, 1.1), (0.55, 1.3), (0.75, 1.2), (1, 0.85)]
    one = say(syl, 'man', f0=f0, pitch=pitch, effort=0.95, rng=rng, vib=0.012)
    gap = np.zeros(N(0.35))
    two = say(syl, 'man', f0=f0 * 1.02, pitch=pitch, effort=0.9, rng=rng, vib=0.012)
    return np.concatenate([one, gap, two * 0.9])


@amb('amb_chinatown', 48, 'Dense Chinatown market street: close crowd babble, hand-cart wheels, crates and metal clatter, plastic bags, a far vendor calling out, light traffic.')
def amb_chinatown(rng, L):
    walla = babble_loop(rng, L, talkers=34, dist=(3, 20), lively=0.5)
    bed = _traffic_bed(rng, L, hi=1000)
    ev = np.zeros((2, L))
    for _ in range(4):
        mix_at(ev, peak_to(_cart(rng), -14), int(rng.uniform(0, L)), wrap=True)
    scatter(ev, rng, 22, _clatter, dist=(4, 15), peak_db=-10)
    scatter(ev, rng, 3, vendor_call, dist=(25, 35), peak_db=-8, ref=8, spacing=True)
    scatter(ev, rng, 6, _vehicle_make(['car', 'cab', 'truck'], [5, 3, 2], speed=(4, 8)),
            dist=(1, 1), peak_db=-16)
    scatter(ev, rng, 3, _horn_make, dist=(25, 60), peak_db=-8, ref=10)
    ev = reverb(ev, ir_slap(), wet=0.35, circular=True)
    walla = reverb(walla, ir_slap(), wet=0.3, circular=True)
    return rms_to(walla, -24) + rms_to(bed, -33) + ev


@amb('amb_timessquare', 48, 'Times Square: a dense crowd hubbub, synth-pop bleeding from the giant screens, lots of impatient cab horns, crawling traffic.')
def amb_timessquare(rng, L):
    walla = babble_loop(rng, L, talkers=50, dist=(3, 30), lively=0.8, kid_frac=0.12)
    music = synthpop_loop(rng, L, bpm=120)
    music = np.vstack([fft_filter(music, lambda f: mag_band(f, 80, 1800, 2) * mag_peak(f, 250, 3, 1)),
                       fft_filter(np.roll(music, N(0.011)), lambda f: mag_band(f, 80, 1600, 2))])
    music = reverb(music, ir_slap(), wet=1.0, dry=0.5, circular=True)
    bed = _traffic_bed(rng, L, hi=1200)
    ev = np.zeros((2, L))
    scatter(ev, rng, 20, _horn_make, dist=(8, 50), peak_db=-8, ref=10)
    scatter(ev, rng, 12, _vehicle_make(['car', 'cab', 'bus'], [3, 6, 1], speed=(3, 7), lane=(5, 12)),
            dist=(1, 1), peak_db=-13)
    scatter(ev, rng, 6, lambda r: kid_voice(r, r.choice(['hey', 'woohoo', 'yay'])) if r.random() < 0.4
            else laugh(r, 'man' if r.random() < 0.5 else 'kid'), dist=(10, 30), peak_db=-10)
    ev = reverb(ev, ir_slap(), wet=0.4, circular=True)
    walla = reverb(walla, ir_slap(), wet=0.35, circular=True)
    return rms_to(walla, -23) + rms_to(music, -31) + rms_to(bed, -32) + ev


@amb('amb_rooftop', 48, 'Rooftop: strong cold November wind gusts whistling round parapets and antennas, the city roar far below, an HVAC unit, a faint far siren.')
def amb_rooftop(rng, L):
    wind = wind_bed(rng, L, bright=1.1, gust=0.95, gust_rate=0.14, whistle=1.0, whistle_f=(650, 1500))
    roar = np.vstack([shaped_noise(L, rng, lambda f: mag_band(f, 30, 900, 2) * mag_tilt(f, -3)) for _ in range(2)])
    roar *= 1 + 0.15 * smooth_rand(L, rng, 0.1)
    hv = harmonic_amps(np.full(L, 60.0), [0.4, 1, 0.5, 0.3, 0.2]) + 0.6 * band_noise(L, rng, 200, 1800, 2)
    hv = pan(hv, 0.55)
    ev = np.zeros((2, L))
    s = siren_tone(rng, siren_freq(N(11), rng, [('wail', 11)])) * burst_env(N(11), 3, 5, 3)
    mix_at(ev, place(peak_to(s, -10), 600, 0.4, ref=10), int(rng.uniform(0, L)), wrap=True)
    scatter(ev, rng, 3, _horn_make, dist=(150, 250), peak_db=-6, ref=10)
    ev = reverb(ev, ir_slap(), wet=0.8, circular=True)
    return rms_to(wind, -22) + rms_to(roar, -31) + rms_to(hv, -42) + ev


def _creak(rng):
    d = rng.uniform(0.8, 1.8)
    n = N(d)
    rate = rng.uniform(25, 60) * (1 + 0.5 * smooth_rand(n, rng, 2))
    ph = np.cumsum(np.maximum(rate, 5)) / SR
    pulses = (np.diff(np.floor(ph), prepend=0) > 0).astype(float) * (1 + 0.3 * rng.standard_normal(n))
    y = reson(pulses, rng.uniform(380, 650), 12) + 0.5 * reson(pulses, rng.uniform(900, 1500), 10)
    return y * burst_env(n, 0.2, d - 0.5, 0.3)


def _kid_far(r):
    if r.random() < 0.3:
        return laugh(r, 'kid')
    return kid_voice(r, r.choice(['hey', 'whee', 'woohoo', 'yay', 'ahh']))


@amb('amb_park', 60, 'Central Park in winter: wind through bare branches with twig rattle and creaks, crows, sparrows, kids playing and shouting in the distance, a far dog, the city faintly beyond.')
def amb_park(rng, L):
    wind = wind_bed(rng, L, bright=1.1, gust=0.25, gust_rate=0.13, whistle=0.5, whistle_f=(1400, 2800))
    g = np.exp(0.35 * smooth_rand(L, rng, 0.13))
    twigs = np.vstack([crackle(rng, L, density=200 * g, lo=1800, hi=9000, circular=True) for _ in range(2)])
    city = np.vstack([brown(L, rng, 25, 500) for _ in range(2)])
    ev = np.zeros((2, L))
    scatter(ev, rng, 4, _creak, dist=(5, 12), peak_db=-14)
    scatter(ev, rng, 5, lambda r: crow_caw(r), dist=(30, 80), peak_db=-4, ref=10, spacing=True)
    scatter(ev, rng, 9, lambda r: sparrow_bout(r), dist=(8, 25), peak_db=-12, ref=6)
    scatter(ev, rng, 12, _kid_far, dist=(55, 110), peak_db=0, ref=10, spacing=True)
    scatter(ev, rng, 2, lambda r: dog_bark(r), dist=(60, 90), peak_db=-4, ref=10, spacing=True)
    w = walker(rng, N(8), 'leaves', rate=1.8, p0=-0.6, p1=0.7, dist=5)
    mix_at(ev, peak_to(w, -20), int(rng.uniform(0, L)), wrap=True)
    kids_far = babble_loop(rng, L, talkers=5, dist=(70, 120), kid_frac=1.0, lively=1.0)
    ev = reverb(ev, ir_open(), wet=0.45, circular=True)
    return (rms_to(wind, -27) + rms_to(twigs, -38) + rms_to(city, -40)
            + ev + rms_to(kids_far, -42))


def _clang_group(rng):
    k = int(rng.integers(1, 5))
    f0 = rng.uniform(280, 650)
    out = np.zeros(N(0.7 * k + 1.5))
    for i in range(k):
        h = metal_hit(rng, f0 * rng.uniform(0.99, 1.01), 1.4, damp=0.9, bright=0.9,
                      ratios=[1, 2.76, 5.4, 8.93, 13.3])
        mix_at(out, h * rng.uniform(0.7, 1.0), N(i * rng.uniform(0.55, 0.8)))
    return out


@amb('amb_construction', 45, 'Construction site: jackhammer bursts, a truck reverse beeper, steel hammer clangs, a diesel generator drone, traffic behind.')
def amb_construction(rng, L):
    gen = pan(loopify(lambda m: generator_drone(rng, m), L), 0.35)
    bed = _traffic_bed(rng, L)
    ev = np.zeros((2, L))
    for i in range(6):
        jb = jackhammer_burst(rng, rng.uniform(1.5, 4.0))
        mix_at(ev, place(peak_to(jb, -6), 15, -0.3, ref=8), int((i + rng.uniform(0, 0.5)) * L / 6), wrap=True)
    for i in range(2):
        d = rng.uniform(6, 9)
        b = backup_beeper(rng, N(d)) * burst_env(N(d), 0.01, d - 0.03, 0.02)
        p = np.linspace(0.5, 0.2, N(d))
        mix_at(ev, pan(peak_to(lp(b, 5000), -12) * 8 / 25, p), int((0.25 + 0.5 * i) * L), wrap=True)
    scatter(ev, rng, 9, _clang_group, dist=(12, 30), peak_db=-6, ref=8)
    scatter(ev, rng, 2, _vehicle_make(['truck'], [1], speed=(6, 9)), dist=(1, 1), peak_db=-12)
    ev = reverb(ev, ir_slap(), wet=0.45, circular=True)
    return rms_to(gen, -30) + rms_to(bed, -33) + ev


def _far_rumble(rng):
    d = rng.uniform(9, 14)
    n = N(d)
    r = brown(n, rng, 20, 260) * (1 + 0.3 * smooth_rand(n, rng, 4))
    cl = np.zeros(n)
    t = 0.5
    while t < d - 0.5:
        mix_at(cl, rail_clack(rng, 0.6), N(t))
        t += rng.choice([0.12, 0.6, 0.15, 0.9]) * rng.uniform(0.9, 1.1)
    y = r + 0.3 * lp(cl, 700, 2)
    return y * burst_env(n, d * 0.45, 0.5, d * 0.45)


@amb('amb_tunnel', 48, 'Subway tunnel: low tunnel drone, third-rail electrical hum, dripping water, ticking metal, distant train rumble - all in a boomy metallic tunnel reverb.')
def amb_tunnel(rng, L):
    drone = np.vstack([shaped_noise(L, rng, lambda f: mag_band(f, 20, 350, 2) * mag_tilt(f, -4)
                                    * mag_peak(f, 43, 8, 4) * mag_peak(f, 71, 6, 4) * mag_peak(f, 97, 5, 4))
                       for _ in range(2)])
    drone *= 1 + 0.2 * smooth_rand(L, rng, 0.08)
    k = int(round(60.0 * L / SR))  # exactly periodic 60 Hz family in L
    f60 = k * SR / L
    hum = harmonic_amps(np.full(L, f60), [0.5, 1.0, 0.8, 0.35, 0.4, 0.2, 0.25, 0.1, 0.12, 0.06] + [0.04] * 20,
                        top=4000)
    hum *= 1 + 0.08 * smooth_rand(L, rng, 1.5)
    hum = pan(hum, -0.25)
    ev = np.zeros((2, L))
    scatter(ev, rng, 48, lambda r: drip(r, gain=r.uniform(0.4, 1)), dist=(2, 25), peak_db=-14, ref=4)
    scatter(ev, rng, 7, lambda r: metal_hit(r, r.uniform(2500, 4000), 0.15, damp=2, bright=0.5),
            dist=(5, 20), peak_db=-24)
    scatter(ev, rng, 2, _far_rumble, dist=(5, 5), peak_db=-14, pan_r=(-0.7, 0.7), spacing=True)
    ev = reverb(ev, ir_tunnel(), wet=0.8, dry=0.5, circular=True)
    return rms_to(drone, -26) + rms_to(hum, -40) + ev


def turnstile(rng):
    y = np.zeros(N(0.6))
    mix_at(y, clack(rng, 0.1, rng.uniform(1100, 1500)) * 0.7, 0)
    for i in range(3):
        mix_at(y, clack(rng, 0.05, rng.uniform(2000, 2600)) * 0.25, N(0.08 + i * 0.035))
    th = thump(rng, 110, 0.2, 0.7, 700)
    mix_at(y, th + 0.8 * pad_to(clack(rng, 0.12, rng.uniform(700, 900)), len(th)), N(0.2))
    return y


@amb('amb_station', 60, 'Subway station platform: crowd murmur and footsteps in a long bright tiled reverb, garbled PA announcements, turnstile clacks, distant trains, fluorescent hum.')
def amb_station(rng, L):
    walla = babble_loop(rng, L, talkers=26, dist=(4, 25))
    ev = np.zeros((2, L))
    for _ in range(10):
        w = walker(rng, N(rng.uniform(4, 8)), rng.choice(['heel', 'sneaker', 'heel', 'boot']),
                   p0=rng.uniform(-1, 0.2), p1=rng.uniform(-0.2, 1), dist=rng.uniform(3, 9))
        mix_at(ev, peak_to(w, -18), int(rng.uniform(0, L)), wrap=True)
    scatter(ev, rng, 12, turnstile, dist=(8, 16), peak_db=-8, ref=6)
    scatter(ev, rng, 2, _far_rumble, dist=(5, 5), peak_db=-13, spacing=True)
    pa = np.zeros((2, L))
    for i in range(2):
        a = pa_murmur(rng, rng.uniform(3.5, 5))
        mix_at(pa, pan(peak_to(a, -10), rng.uniform(-0.3, 0.3)), int((0.2 + 0.5 * i + rng.uniform(0, 0.1)) * L), wrap=True)
    k = int(round(120.0 * L / SR))
    buzz = harmonic_amps(np.full(L, k * SR / L), [1, 0.4, 0.3, 0.2, 0.15, 0.1], top=3000)
    mix = ev + rms_to(walla, -26) + pa
    mix = reverb(mix, ir_station(), wet=0.6, dry=0.6, circular=True)
    return mix + rms_to(pan(buzz, 0.2), -48)


@amb('amb_wind_low', 30, 'Neutral gentle wind bed for low airspeed; smooth, no spikes. Crossfade with amb_wind_high by airspeed.', gain=0.9)
def amb_wind_low(rng, L):
    return wind_bed(rng, L, bright=0.75, gust=0.3, gust_rate=0.07)


@amb('amb_wind_high', 30, 'Neutral fast-airflow rush for high airspeed: brighter turbulent roar with a hint of whistle. Crossfade with amb_wind_low.', gain=0.9)
def amb_wind_high(rng, L):
    w = wind_bed(rng, L, bright=1.6, gust=0.35, gust_rate=0.25, whistle=0.35, whistle_f=(900, 1900), lo=60)
    rush = np.vstack([shaped_noise(L, rng, lambda f: mag_band(f, 400, 7000, 2) * mag_peak(f, 1500, 3, 1))
                      for _ in range(2)])
    rush *= np.exp(0.25 * smooth_rand(L, rng, 6))
    return rms_to(w, -22) + rms_to(rush, -28)


# =========================================================================== SUBWAY
def _train_pass(rng, direction):
    v = rng.uniform(19, 23)
    t_front = 2.3
    tr = train_render(rng, 10.0, lambda t: v * (t - t_front), lambda t: np.full_like(t, v), lane=2.4,
                      squeal=0.05, clatter=1.0)
    if direction < 0:
        tr = tr[::-1]
    tr = reverb(tr, ir_tunnel(), wet=0.3)
    return tr[:, :N(10.5)]


@sfx('train_pass_uptown', 'Express train blasting past in a tunnel, left to right: approach, wheel-joint clatter, motor whine, rush of air, doppler recede.', 'loud')
def s_train_up(rng):
    return _train_pass(rng, 1)


@sfx('train_pass_downtown', 'Express train blasting past in a tunnel, right to left (different train).', 'loud')
def s_train_down(rng):
    return _train_pass(rng, -1)


@sfx('train_arrive', 'Train pulling into the station: slowing clatter, brake screech, stop clunk, pneumatic hiss.', 'loud')
def s_train_arrive(rng):
    v0, T = 13.0, 6.4
    x0 = -24.0

    def v_fn(t):
        return np.where(t < T, v0 * (1 - t / T), 0.0)

    def xf_fn(t):
        tc = np.minimum(t, T)
        return x0 + v0 * (tc - tc * tc / (2 * T))
    tr = train_render(rng, 7.2, xf_fn, v_fn, lane=2.0, cars=8, brake=0.7, squeal=0.25, air=0.6, clatter=0.8)
    out = np.zeros((2, N(9.0)))
    mix_at(out, tr, 0)
    stop = N(T + 0.05)
    mix_at(out, pan(thump(rng, 70, 0.4, 1.0, 500) * 0.25 + 0.08 * metal_hit(rng, 500, 0.4, damp=2), 0.4), stop)
    hiss = steam(rng, 1.3, attack=0.02, burst=False)
    hiss = hp(hiss, 1500, 2)
    mix_at(out, pan(peak_to(hiss, -14), 0.3), N(T + 0.45))
    return reverb(out, ir_station(), wet=0.4)


@sfx('train_horn', 'Subway train horn: harsh buzzy two-tone blast, echoing down the tunnel.', 'loud')
def s_train_horn(rng):
    d = 1.25
    n = N(d + 0.2)
    t = tt(n)
    env = burst_env(n, 0.03, d - 0.1, 0.08)
    bend = 1 - 0.02 * np.exp(-t / 0.05)
    y = np.zeros(n)
    for f, g in [(349.2, 1.0), (440.0, 0.85), (523.3, 0.4)]:
        y += g * blpulse(f * bend * (1 + 0.002 * smooth_rand(n, rng, 6)), 0.3, ph0=rng.uniform(0, 1))
    y = peq(hp(y, 200, 2), 1300, 6, 1.5)
    y = saturate(y / np.max(np.abs(y)), 2.5) * env
    y = lp(y, 8000, 2)
    return reverb(y, ir_tunnel(), wet=0.45)


@sfx('door_chime', 'Generic descending two-tone "ding-dong" door chime through a platform speaker (not the real MTA chime).', 'medium')
def s_door_chime(rng):
    def bell(f, dur):
        n = N(dur)
        t = tt(n)
        y = (np.sin(TWO_PI * f * t) + 0.25 * np.sin(TWO_PI * 2 * f * t) * np.exp(-t / 0.15)
             + 0.08 * np.sin(TWO_PI * 3.01 * f * t) * np.exp(-t / 0.08))
        return y * ad_env(n, 0.004, 0.45)
    n = N(1.9)
    y = np.zeros(n)
    mix_at(y, bell(1174.7, 1.4), 0)
    mix_at(y, bell(932.3, 1.4), N(0.45))
    y = bp(y, 300, 6000, 2)
    y = saturate(y / np.max(np.abs(y)), 1.3)
    return reverb(y, ir_station(), wet=0.18)


# =========================================================================== STREET
@sfx('cab_horn_1', 'Yellow cab horn: quick impatient double tap.', 'medium')
def s_cab1(rng):
    y = car_horn(rng, [(0, 0.12), (0.19, 0.14)], 415, 520, drive=2.6)
    return reverb(y, ir_slap(), wet=0.12)


@sfx('cab_horn_2', 'Yellow cab horn: long lean then a short jab.', 'medium')
def s_cab2(rng):
    y = car_horn(rng, [(0, 0.48), (0.62, 0.12)], 455, 570, drive=2.2)
    return reverb(y, ir_slap(), wet=0.12)


@sfx('cab_horn_3', 'Yellow cab horn: rapid triple tap, lower pitched.', 'medium')
def s_cab3(rng):
    y = car_horn(rng, [(0, 0.09), (0.14, 0.09), (0.28, 0.1)], 375, 470, drive=3.0)
    return reverb(y, ir_slap(), wet=0.12)


@sfx('cab_horn_4', 'Yellow cab horn: sharp single beep then an annoyed lean, higher pitched.', 'medium')
def s_cab4(rng):
    y = car_horn(rng, [(0, 0.15), (0.33, 0.65)], 480, 600, drive=2.4)
    return reverb(y, ir_slap(), wet=0.12)


@sfx('car_horn_long', 'Car horn held down for nearly two seconds (gridlock rage).', 'medium')
def s_car_long(rng):
    y = car_horn(rng, [(0, 1.85)], 400, 505, drive=2.2)
    return reverb(y, ir_slap(), wet=0.15)


def bus_brake(rng):
    n = N(2.4)
    y = np.zeros(n)
    sq_n = N(0.5)
    f = rng.uniform(2200, 2700) * (1 + 0.01 * smooth_rand(sq_n, rng, 8))
    sq = (sine(f) + 0.3 * sine(2 * f)) * burst_env(sq_n, 0.05, 0.3, 0.12)
    mix_at(y, sq * 0.25, 0)
    hn = N(1.8)
    t = tt(hn)
    hiss = shaped_noise(hn, rng, lambda fr: mag_band(fr, 1500, 14000, 2) * mag_peak(fr, 5000, 4, 1))
    env = (1 - np.exp(-t / 0.008)) * np.exp(-t / 0.45) * (1 + 0.15 * smooth_rand(hn, rng, 25))
    pop = lp(rng.standard_normal(hn), 600, 2) * np.exp(-t / 0.03) * 0.8
    mix_at(y, hiss * env + pop, N(0.55))
    return y


@sfx('bus_brake_hiss', 'City bus stopping: brief brake squeal then the big pneumatic "pssssh".', 'medium')
def s_bus(rng):
    return reverb(bus_brake(rng), ir_slap(), wet=0.2)


@sfx('siren_pass', 'NYPD-style police car passing: wail, switching to yelp with a low rumbler as it passes, doppler and building echoes.', 'loud')
def s_siren(rng):
    dur = 11.0
    n = N(dur)
    v = 14.0
    t = tt(n) - dur / 2
    f = siren_freq(n, rng, [('wail', 3.8), ('yelp', 3.6), ('wail', 3.6)])
    s = siren_tone(rng, f)
    rum = siren_tone(rng, siren_freq(n, rng, [('rumbler', dur)]), 2.5)
    rum = lp(rum, 900, 2) * burst_env(n, 1.5, 2.5, 1.5) * np.where(tt(n) > 3.6, 1, 0)
    car = vehicle_src(rng, n, 'car', v, 0.3)
    src = 0.9 * s + 0.5 * rum + 0.25 * car / np.std(car) * np.std(s)
    st, _ = moving_source(src, v * t, 7.0, 1.0, ref=7.0, rmin=3)
    st = fade(st, 1.0, 1.0)
    return reverb(st, ir_slap(), wet=0.4)


@sfx('truck_pass', 'Heavy diesel truck rumbling past with rattles and doppler.', 'medium')
def s_truck(rng):
    y = vehicle_pass(rng, 'truck', 11.0, 4.5, 1, dur=8.0, wet=0.3)
    return reverb(y, ir_slap(), wet=0.3)


@sfx('steam_hiss', 'Steam puffing from a manhole / street steam stack (about 2 s).', 'medium')
def s_steam(rng):
    return reverb(steam(rng, 2.2), ir_slap(), wet=0.15)


@sfx('steam_burst', 'Sudden, powerful steam burst with a pressure pop and roaring hiss.', 'loud')
def s_steam_burst(rng):
    return reverb(steam(rng, 3.2, power=1.0, burst=True), ir_slap(), wet=0.2)


# =========================================================================== ANIMALS
@sfx('pigeon_flap', 'Pigeon taking off: wing claps then flapping away.', 'medium')
def s_pflap(rng):
    return reverb(wing_flaps(rng, beats=9), ir_slap(), wet=0.12)


@sfx('pigeon_coo', 'Pigeon cooing: rolled "oo-RROOO-oo", twice.', 'soft')
def s_pcoo(rng):
    a = pigeon_coo(rng)
    b = pigeon_coo(rng)
    y = np.concatenate([a, np.zeros(N(0.35)), b * 0.85])
    return reverb(y, ir_slap(), wet=0.1)


@sfx('gull_cry', 'Herring gull long call over the harbour: a "kyow" then laughing "ha-ha-ha".', 'medium')
def s_gull(rng):
    return reverb(gull_call(rng, 'long'), ir_open(), wet=0.3)


@sfx('crow_caw', 'Crow cawing three times, harsh and raspy.', 'medium')
def s_crow(rng):
    return reverb(crow_caw(rng, 3), ir_open(), wet=0.3)


@sfx('dog_bark', 'Medium dog barking: "rowf-rowf... rowf".', 'medium')
def s_dog(rng):
    a = dog_bark(rng, 2)
    b = dog_bark(rng, 1)
    return reverb(np.concatenate([a, np.zeros(N(0.35)), b]), ir_open(), wet=0.25)


@sfx('cat_hiss', 'Alley cat hissing with a spit.', 'medium')
def s_cathiss(rng):
    return cat_hiss(rng)


@sfx('cat_meow', 'Cat meowing "mi-aow".', 'medium')
def s_catmeow(rng):
    return reverb(cat_meow(rng), ir_slap(), wet=0.08)


# =========================================================================== PEOPLE
@sfx('kid_shout_1', 'Kid shouting "hey!".', 'medium')
def s_kid1(rng):
    return reverb(kid_voice(rng, 'hey'), ir_open(), wet=0.2)


@sfx('kid_shout_2', 'Kid shouting a long rising "wheee!".', 'medium')
def s_kid2(rng):
    return reverb(kid_voice(rng, 'whee'), ir_open(), wet=0.2)


@sfx('kid_shout_3', 'Kid shouting "woo-hoo!".', 'medium')
def s_kid3(rng):
    return reverb(kid_voice(rng, 'woohoo'), ir_open(), wet=0.2)


@sfx('kid_laugh', 'Kid giggling "ha-ha-ha-ha".', 'medium')
def s_kidlaugh(rng):
    return reverb(laugh(rng, 'kid', pulses=7), ir_open(), wet=0.18)


@sfx('man_shout_hey', 'Grown man shouting "hey!" (a startled New Yorker).', 'medium')
def s_man(rng):
    y = say([('h', 0.07), ('e', 0.27), ('i', 0.13)], 'man', f0=185, rng=rng,
            pitch=[(0, 0.88), (0.25, 1.15), (0.6, 1.08), (1, 0.8)], effort=1.0, vib=0.01)
    return reverb(y, ir_slap(), wet=0.2)


@sfx('crowd_cheer', 'Warm joyful crowd cheer with applause and whistles - for planting the seed.', 'loud')
def s_cheer(rng):
    dur = 4.2
    v = crowd_voices(rng, dur, voices=40, kind='cheer')
    c = clap_burst(rng, dur, people=45)
    out = np.zeros((2, N(dur + 1.2)))
    mix_at(out, rms_to(v, -16), 0)
    mix_at(out, rms_to(lp(c, 6500, 2), -21), N(0.15))
    for i in range(3):  # two-finger whistles
        d = rng.uniform(0.5, 0.9)
        m = N(d)
        f = rng.uniform(2200, 2700) * env_cos(m, [(0, 0.85), (0.12, 1.08), (d * 0.8, 1.05), (d, 0.95)])
        f *= 1 + 0.01 * np.sin(TWO_PI * 6 * tt(m))
        w = (sine(f) + 0.05 * bp(rng.standard_normal(m), 2000, 4000, 2)) * burst_env(m, 0.04, d * 0.7, d * 0.2)
        mix_at(out, place(peak_to(w, -18), rng.uniform(6, 15), rng.uniform(-0.8, 0.8)), N(rng.uniform(0.3, 1.8)))
    out = out * env_cos(out.shape[-1], [(0, 0.0), (0.12, 1), (dur - 1.0, 1), (dur + 1.2, 0)])
    out = lowshelf(out, 250, 2.0)
    out = lp(out, 9000, 2)
    return reverb(out, ir_slap(), wet=0.3)


@sfx('crowd_gasp', 'Crowd gasping then a falling "oooh".', 'medium')
def s_gasp(rng):
    v = crowd_voices(rng, 1.6, voices=30, kind='gasp')
    return reverb(v, ir_slap(), wet=0.25)


# =========================================================================== LEAF
@sfx('leaf_flutter_loop', 'Seamless loop: the dry leaf fluttering/flapping in fast airflow. Fade in with airspeed.', 'soft', loop=True, length=4.0)
def s_flutter(rng, L):
    sec = L / SR
    rate = 22 * np.exp(0.18 * smooth_rand(L, rng, 1.2))
    cycles = round(rate.sum() / SR)
    rate *= cycles / (rate.sum() / SR)  # integer flap count -> periodic
    ph = np.cumsum(rate) / SR
    flap = (0.5 + 0.5 * np.cos(TWO_PI * ph)) ** 6
    amp = np.exp(0.3 * smooth_rand(L, rng, 3))
    out = np.zeros((2, L))
    for ch in range(2):
        cr = crackle(rng, L, density=3500, lo=1500, hi=9000, circular=True)
        papery = shaped_noise(L, rng, lambda f: mag_band(f, 700, 8000, 2) * mag_peak(f, 2500, 4, 1))
        buffet = shaped_noise(L, rng, lambda f: mag_band(f, 80, 600, 2))
        y = papery * flap * 0.8 + 0.35 * cr / (np.std(cr) + 1e-9) * flap + 0.6 * buffet * flap ** 0.5
        y += 0.15 * shaped_noise(L, rng, lambda f: mag_band(f, 1000, 9000, 2))
        out[ch] = y * amp
    return widen(out, 0.5)


def _tear(rng, dur, lo, power):
    n = N(dur)
    rip = env_cos(n, [(0, 0), (0.01, 0.6), (dur * 0.3, 1), (dur * 0.8, 0.8), (dur, 0)])
    rip *= np.clip(1 + 0.6 * smooth_rand(n, rng, 25), 0.1, None)
    cr = crackle(rng, n, density=6000 * power, lo=lo, hi=11000, density_env=None) * rip
    fib = bp(rng.standard_normal(n), lo * 0.5, 3500, 2) * rip * 0.4
    snap = hp(rng.standard_normal(n), 1500, 2) * np.exp(-tt(n) / 0.004) * 1.5
    y = cr / (np.std(cr) + 1e-9) + fib / (np.std(fib) + 1e-9) * 0.4 + snap
    y = highshelf(y, 6000, -7)
    y = peq(y, 3500, 3, 1.0)
    return fade(y, 0.0005, 0.02)


@sfx('leaf_tear_small', 'Small dry-leaf tear: a short crisp rip.', 'medium')
def s_tear_s(rng):
    return _tear(rng, 0.32, 1800, 0.8)


@sfx('leaf_tear_big', 'Big leaf rip: a long, ragged paper tear with snaps.', 'medium')
def s_tear_b(rng):
    a = _tear(rng, 0.75, 900, 1.2)
    b = _tear(rng, 0.25, 1200, 1.0)
    y = np.zeros(N(1.15))
    mix_at(y, a, 0)
    mix_at(y, b * 0.8, N(0.8))
    return y


@sfx('leaf_scrape', 'The leaf skidding/sliding across concrete.', 'soft')
def s_scrape(rng):
    d = 0.95
    n = N(d)
    rough = np.clip(1 + 0.8 * smooth_rand(n, rng, 30), 0, None)
    env = env_cos(n, [(0, 0), (0.03, 1), (d * 0.5, 0.8), (d, 0)])
    cr = crackle(rng, n, density=2500, lo=1000, hi=9000) * rough * env
    gr = bp(rng.standard_normal(n), 2000, 8000, 2) * rough * env * 0.3
    skit = lp(rng.standard_normal(n), 600, 2) * (rough ** 2) * env * 0.4
    y = cr / np.std(cr) + gr / np.std(gr) * 0.4 + skit / np.std(skit) * 0.4
    return pan(fade(y, 0.002, 0.04), np.linspace(-0.25, 0.25, n))


@sfx('leaf_hit_wall', 'Soft papery thwack of the leaf slapping into a wall.', 'medium')
def s_hitwall(rng):
    n = N(0.35)
    t = tt(n)
    th = bp(rng.standard_normal(n), 150, 2500, 2) * np.exp(-t / 0.018) * (1 - np.exp(-t / 0.0008))
    cr = crackle(rng, n, density=3000, lo=1500, hi=9000) * np.exp(-t / 0.05)
    y = th / np.max(np.abs(th)) + 0.3 * cr / np.max(np.abs(cr)) + 0.4 * thump(rng, 140, 0.35, 0.2, 400)[:n]
    return reverb(fade(y, 0.0003, 0.05), ir_slap(), wet=0.1)


# =========================================================================== DEATHS
@sfx('puddle_splash', 'Leaf lands in a puddle: splash and droplets (death).', 'medium')
def s_splash(rng):
    return reverb(splash(rng, 1.0, 1.3), ir_slap(), wet=0.15)


@sfx('manhole_fall', 'Falling down a manhole: whoosh down a pipe into an echoey drop and splash below.', 'loud')
def s_manhole(rng):
    d = 1.6
    n = N(d)
    nz = np.vstack([pink(n, rng), pink(n, rng)])
    env = env_cos(n, [(0, 0), (0.25, 1.0), (d * 0.75, 0.85), (d, 0.0)])
    fc = np.geomspace(2600, 380, n)
    air = np.vstack([svf(c, fc, 1.1, 'bp') for c in nz]) * env
    tube = comb(mono(air), np.full(n, 1 / 210.0) * np.linspace(1, 1.25, n), fb=0.8, damp=0.35)
    fall = air + 0.7 * stereo(tube) / np.std(tube) * np.std(air)
    fall = onepole(fall, np.geomspace(9000, 1500, n))
    out = np.zeros((2, N(d + 3.5)))
    mix_at(out, fall, 0)
    mix_at(out, pan(metal_hit(rng, 900, 0.5, damp=2, bright=0.6) * 0.15, -0.3), N(0.5))
    land = thump(rng, 60, 0.6, 1.2, 600) + 0.6 * mono(splash(rng, 0.7, 0.9))[:N(0.6)]
    shaft = reverb(land, ir_shaft(), wet=0.9, dry=0.5)
    mix_at(out, shaft, N(d - 0.06))
    out = reverb(out, ir_tunnel(), wet=0.25)
    return out


@sfx('train_hit', 'Hit by a train: a sudden overwhelming roar and screech that cuts to silence with a faint ring.', 'loud')
def s_trainhit(rng):
    n = N(2.2)
    t = tt(n)
    cut = N(0.78)
    roar = np.vstack([brown(n, rng, 25, 2000) + 0.6 * band_noise(n, rng, 300, 6000, 2) for _ in range(2)])
    env = np.clip(t / 0.78, 0, 1) ** 3
    sc = (sine(np.full(n, 3300) * (1 + 0.02 * smooth_rand(n, rng, 10))) + 0.5 * sine(np.full(n, 6650))) * env ** 2
    cl = np.zeros(n)
    for k in range(6):
        mix_at(cl, rail_clack(rng, 1.0), N(0.35 + k * 0.07))
    y = roar * env + 0.25 * stereo(sc) + 0.8 * stereo(cl)
    y = y / np.max(np.abs(y[:, :cut]))
    g = np.ones(n)
    g[cut:cut + N(0.006)] = np.linspace(1, 0, N(0.006))
    g[cut + N(0.006):] = 0
    y *= g
    ring = sine(np.full(n, 3520.0)) * np.exp(-(t - 0.8) / 0.6) * (t > 0.8) * 0.05
    ring = smooth_env(np.where(t > 0.8, 1.0, 0.0), 0.02) * ring
    thd = np.zeros(n)
    mix_at(thd, thump(rng, 45, 0.7, 0.5, 300) * 0.5, cut)
    return y + stereo(ring + thd)


# =========================================================================== WHOOSHES
def _whoosh(rng, dur, peak_t, f_lo, f_hi, f_end, q=1.2, pan_from=0.7, pan_to=-0.7, sub=None,
            tonal=0.5, width=0.6):
    n = N(dur)
    t = tt(n)
    env = env_cos(n, [(0, 0), (peak_t * 0.6, 0.35), (peak_t, 1.0), (peak_t + (dur - peak_t) * 0.35, 0.45), (dur, 0)])
    fc = np.where(t < peak_t, f_lo * (f_hi / f_lo) ** (t / peak_t),
                  f_hi * (f_end / f_hi) ** ((t - peak_t) / (dur - peak_t)))
    out = np.zeros((2, n))
    for ch in range(2):
        nz = pink(n, rng)
        a = svf(nz, fc, q, 'bp')
        b = svf(rng.standard_normal(n), fc * 0.8, 5.0, 'bp')
        out[ch] = (a / np.std(a) + tonal * b / np.std(b)) * env
    out = widen(out, width)
    p = np.clip(pan_from + (pan_to - pan_from) * (0.5 + 0.5 * np.tanh((t - peak_t) / (dur * 0.12))), -1, 1)
    out = pan(mono(out), p) * 0.6 + out * 0.4
    if sub is not None:
        f0, f1, st, ln = sub
        m = N(ln)
        u = tt(m)
        fs = f1 + (f0 - f1) * np.exp(-u / (ln * 0.3))
        s = sine(fs) * ad_env(m, 0.04, ln * 0.35)
        s = saturate(s, 1.5)
        mix_at(out, stereo(s) * 0.85, N(st))
    return out


@sfx('whoosh_drop', 'Layer-drop speed boost: big satisfying swept whoosh crossing the stereo field with a sub-bass drop.', 'loud')
def s_whoosh_drop(rng):
    y = _whoosh(rng, 1.6, 0.42, 350, 3200, 500, q=1.1, sub=(95, 38, 0.3, 1.2))
    return y


@sfx('whoosh_drop_big', 'Roof-to-subway combo drop: rising tension, a huge whoosh, deep sub boom and rushing tail.', 'loud')
def s_whoosh_big(rng):
    dur = 2.8
    n = N(dur)
    t = tt(n)
    pre = np.vstack([pink(n, rng), pink(n, rng)])
    fcp = 600 * (8 ** np.clip(t / 0.85, 0, 1))
    pre = np.vstack([svf(c, fcp, 0.9, 'hp') for c in pre]) * env_cos(n, [(0, 0), (0.8, 0.6), (0.9, 0), (dur, 0)])
    w = _whoosh(rng, 2.0, 0.35, 250, 3800, 300, q=0.9, pan_from=-0.8, pan_to=0.8, sub=(80, 28, 0.25, 1.7),
                width=0.8)
    out = np.zeros((2, n))
    mix_at(out, pre * 0.5, 0)
    mix_at(out, w, N(0.62))
    boom = thump(rng, 42, 1.4, 0.8, 250)
    mix_at(out, stereo(boom) * 0.9, N(0.95))
    rumble = np.vstack([brown(n, rng, 20, 400) for _ in range(2)]) * env_cos(n, [(0, 0), (0.9, 0), (1.1, 0.6), (dur, 0)])
    out += rumble * 0.4
    return reverb(out, ir_tunnel(), wet=0.15)


@sfx('corkscrew_whoosh', 'Corkscrew: whoosh spiralling around the head with accelerating rotation.', 'medium')
def s_cork(rng):
    dur = 1.9
    n = N(dur)
    t = tt(n)
    rot = np.cumsum(2.5 + 5.5 * (t / dur) ** 1.5) / SR
    ang = TWO_PI * rot
    env = env_cos(n, [(0, 0), (0.25, 0.8), (dur * 0.7, 1.0), (dur, 0)])
    fc = 900 + 1300 * (0.5 + 0.5 * np.cos(ang)) + 1500 * t / dur
    nz = pink(n, rng)
    a = svf(nz, fc, 1.4, 'bp')
    behind = 0.5 - 0.5 * np.cos(ang)
    a = onepole(a, 9000 - 6500 * behind)
    y = pan(a / np.std(a) * env * (1 - 0.35 * behind), 0.9 * np.sin(ang))
    tone = svf(rng.standard_normal(n), fc * 1.3, 6, 'bp')
    y += pan(tone / np.std(tone) * env * 0.35, 0.9 * np.sin(ang + 0.3))
    return y


@sfx('loop_whoosh', 'Loop-the-loop: one big circular whoosh rising and falling as it sweeps around.', 'medium')
def s_loopw(rng):
    dur = 1.6
    n = N(dur)
    t = tt(n)
    u = t / dur
    ang = TWO_PI * (0.5 - 0.5 * np.cos(np.pi * u))
    env = np.sin(np.pi * u) ** 1.2
    fc = 500 + 2600 * np.sin(np.pi * u) ** 2
    out = np.zeros((2, n))
    for ch in range(2):
        a = svf(pink(n, rng), fc, 1.2, 'bp')
        out[ch] = a / np.std(a)
    p = 0.85 * np.sin(ang)
    y = pan(mono(out) * env, p) * 0.7 + out * env * 0.3
    sub = sine(np.full(n, 55.0) * (1 + 0.3 * np.sin(np.pi * u))) * env ** 2 * 0.5
    return y + stereo(sub)


@sfx('gust_blast', 'A sudden strong gust of cold wind slamming in then easing off.', 'loud')
def s_gust(rng):
    dur = 2.4
    n = N(dur)
    t = tt(n)
    env = env_cos(n, [(0, 0), (0.28, 1.0), (0.6, 0.8), (dur, 0)])
    env *= np.exp(0.25 * smooth_rand(n, rng, 5))
    out = np.zeros((2, n))
    for ch in range(2):
        d = shaped_noise(n, rng, lambda f: mag_band(f, 40, 700, 2) * mag_tilt(f, -3))
        m = shaped_noise(n, rng, lambda f: mag_band(f, 300, 5000, 2) * mag_tilt(f, -2))
        b = svf(m, 700 + 2500 * env, 0.8, 'lp')
        out[ch] = (d + 0.8 * b / np.std(b)) * env
    wh = svf(rng.standard_normal(n), 900 * (1 + 0.4 * env), 30, 'bp') * env ** 2 * 0.8
    out += pan(wh / np.std(wh) * 0.3, 0.3)
    return widen(out, 1.2)


@sfx('vent_blast', 'Shot up a metal air-vent shaft: fan hum, rising metallic rush with duct resonance and rattling sheet metal.', 'loud')
def s_vent(rng):
    dur = 2.6
    n = N(dur)
    t = tt(n)
    env = env_cos(n, [(0, 0), (0.2, 0.5), (1.6, 1.0), (2.1, 0.6), (dur, 0)])
    fc = 250 * (24 ** np.clip(t / 1.8, 0, 1))
    nz = pink(n, rng)
    rush = svf(nz, fc, 0.9, 'lp') + 0.5 * svf(nz, fc * 1.5, 2.0, 'bp')
    duct = comb(rush, np.full(n, 1 / 173.0) * (1 - 0.15 * t / dur), fb=0.82, damp=0.35)
    y = (rush / np.std(rush) + 0.6 * duct / np.std(duct)) * env
    fan = harmonic_amps(np.full(n, 100.0) * (1 + 0.2 * t / dur), [1, 0.5, 0.3, 0.2]) * env_cos(n, [(0, 0.6), (dur, 0)])
    rat = np.zeros(n)
    for _ in range(14):
        mix_at(rat, metal_hit(rng, rng.uniform(700, 2200), 0.2, damp=2.5, bright=0.6) * rng.uniform(0.2, 0.5),
               N(rng.uniform(0.3, 2.0)))
    y = y + 0.3 * fan + rat
    st = pan(y, np.linspace(-0.2, 0.2, n))
    return reverb(st, ir_shaft(), wet=0.35)


# =========================================================================== SEED / UI
def fm_tone(f, dur, ratio=1.0, index=1.6, idx_decay=0.25, decay=0.8, attack=0.004):
    n = N(dur)
    t = tt(n)
    I = index * np.exp(-t / idx_decay)
    mod = np.sin(TWO_PI * f * ratio * t)
    y = np.sin(TWO_PI * f * t + I * mod)
    y += 0.3 * np.sin(TWO_PI * 2 * f * t) * np.exp(-t / (decay * 0.4))
    return y * ad_env(n, attack, decay)


def ir_magic():
    return make_ir('magic', 3.0, (2.4, 2.6, 2.0), xover=(300, 4000), predelay=0.02, early=[(0.03, 0.2, -0.5), (0.05, 0.2, 0.5)],
                   er_lp=12000, onset=0.08)


@sfx('seed_plant', 'Planting the seed: a soft earthy thud and crumble, then a gentle rising magical shimmer.', 'medium')
def s_seed(rng):
    dur = 3.8
    n = N(dur)
    out = np.zeros((2, n))
    th = thump(rng, 68, 0.6, 0.9, 350)
    mix_at(out, stereo(th) * 0.9, 0)
    m = N(0.6)
    soil = crackle(rng, m, density=1200, lo=300, hi=3500) * np.exp(-tt(m) / 0.15)
    mix_at(out, pan(soil / np.max(np.abs(soil)) * 0.35, 0.1), N(0.02))
    notes = [1046.5, 1318.5, 1568.0, 2093.0, 2637.0]
    for i, f in enumerate(notes):
        tone = fm_tone(f, 2.2, ratio=2.0, index=0.8, idx_decay=0.15, decay=0.7, attack=0.012)
        mix_at(out, pan(tone * 0.22 * (1 - 0.08 * i), -0.5 + 0.25 * i), N(0.18 + i * 0.085))
    pm = N(3.2)
    padv = (sine(np.full(pm, 523.25)) + 0.7 * sine(np.full(pm, 784.0)) + 0.4 * sine(np.full(pm, 1046.5) * 1.002))
    padv *= env_cos(pm, [(0, 0), (0.9, 1), (3.2, 0)]) * 0.12
    mix_at(out, widen(np.vstack([padv, np.roll(padv, 200)]), 1.0), N(0.25))
    for _ in range(28):
        st = rng.uniform(0.25, 2.2)
        f = rng.uniform(3000, 7000)
        pm2 = N(0.25)
        ping = sine(np.full(pm2, f)) * ad_env(pm2, 0.003, 0.06)
        mix_at(out, pan(ping * 0.06 * np.exp(-(st - 0.25) / 1.2), rng.uniform(-0.9, 0.9)), N(st))
    return reverb(out, ir_magic(), wet=0.35)


@sfx('achievement_chime', 'Achievement unlocked: a warm, short, rewarding rising arpeggio with a soft glow.', 'ui', cat='ui')
def s_ach(rng):
    out = np.zeros((2, N(2.0)))
    notes = [(783.99, 0.0), (1046.5, 0.075), (1318.5, 0.15), (1567.98, 0.225)]
    for i, (f, st) in enumerate(notes):
        last = i == len(notes) - 1
        tone = fm_tone(f, 1.6 if last else 0.9, ratio=1.0, index=1.3, idx_decay=0.12,
                       decay=0.55 if last else 0.25, attack=0.004)
        mix_at(out, pan(tone * (0.35 if last else 0.28), -0.3 + 0.2 * i), N(st))
    pm = N(1.6)
    pad = (sine(np.full(pm, 261.63)) + 0.6 * sine(np.full(pm, 392.0)) + 0.4 * sine(np.full(pm, 523.25)))
    pad *= env_cos(pm, [(0, 0), (0.25, 1), (1.6, 0)]) * 0.1
    mix_at(out, stereo(pad), N(0.15))
    return reverb(out, ir_magic(), wet=0.25)


@sfx('ui_click', 'Soft UI click.', 'ui', cat='ui')
def s_click(rng):
    n = N(0.06)
    t = tt(n)
    y = bp(rng.standard_normal(n), 2000, 7000, 2) * np.exp(-t / 0.0015)
    y += 0.5 * np.sin(TWO_PI * 1900 * t) * np.exp(-t / 0.008)
    y += 0.4 * np.sin(TWO_PI * 320 * t) * np.exp(-t / 0.012)
    return fade(y, 0.0002, 0.01)


@sfx('ui_back', 'Soft UI back/cancel: two quick descending blips.', 'ui', cat='ui')
def s_back(rng):
    out = np.zeros(N(0.22))
    for i, f in enumerate([1250.0, 830.0]):
        m = N(0.09)
        t = tt(m)
        b = (np.sin(TWO_PI * f * t) + 0.15 * np.sin(TWO_PI * 2 * f * t)) * ad_env(m, 0.003, 0.025)
        mix_at(out, b * (1 - 0.15 * i), N(i * 0.065))
    return fade(out, 0.0005, 0.01)
