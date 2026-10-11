"""Far From the Tree - ending film generator (the seed becomes a tree).

Same pipeline, palette, shaders, pixel font and 320x180 art grid as the intro (build.py, people.py):
  python ending.py           -> writes .tesseract-work/ending.json
then commit + export with tsrct and encode (render_ending.sh). The soundtrack is cut from the game's
"Next Spring" (public/music/planted.mp3) and muxed in by render_ending.sh.

Composition: a close, layered shot like the intro's. The tree grows in the foreground (its base near
the bottom of the frame) and comes to fill it; behind it, in parallax depth: the meadow (kids, kites,
snowmen), the path (walkers, runners, dog walkers, benches, the couple), the far meadow (sunbathers),
the park's trees and the Central Park South towers.

Timeline (seconds)
  0.0 -  6.0  Late November: pushed in on the sky, the last leaf falls with its seed; the camera
              follows it down and opens out as it lands in the foreground grass
  6.0 - 12.0  The seed sinks into the soil; first snow
  9.5 - 47.5  Time-lapse over ~7 years (~5 s a year): seasons cycle, sun and clouds race, brief
              nights. Sprout -> staked sapling -> young tree -> big tree. People come and go like
              ghosts in a long exposure; a yellow-raincoat kid keeps coming back and grows up; a couple
              meets on a bench, comes back together, later walks by with a pram.
 46.0 - 58.0  Real time, an October afternoon: the camera pushes in on a twig at the crown's edge
              (the intro's last shot, mirrored); its leaf lets go and rides the wind toward the city.
              Title card as the intro's: the name across the top, the closing line small at the bottom.
"""
import json, math, random, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build as B          # noqa: E402  (shared helpers, shaders, palette; intro build() is not run)
import people as PP        # noqa: E402

WORK = os.path.join(HERE, ".tesseract-work")
S = B.S
DUR = 58.0
B.DUR = DUR                 # people.character clips to B.DUR
STEP = 0.1


def ss(a, b, x):
    x = min(1.0, max(0.0, (x - a) / (b - a)))
    return x * x * (3 - 2 * x)


# ----------------------------------------------------------------------------------- wrappers
# build.py's helpers bake the intro's 44 s duration into their defaults; pin ours.
def shape(*a, **k):
    k.setdefault("dur", DUR)
    return B.shape(*a, **k)


def rect(*a, **k):
    k.setdefault("dur", DUR)
    return B.rect(*a, **k)


def rects(*a, **k):
    k.setdefault("dur", DUR)
    return B.rects(*a, **k)


def ellipse(*a, **k):
    k.setdefault("dur", DUR)
    return B.ellipse(*a, **k)


def group(*a, **k):
    k.setdefault("dur", DUR)
    return B.group(*a, **k)


nid, anim, anim_fx, keys, tr, jag = B.nid, B.anim, B.anim_fx, B.keys, B.tr, B.jag
C = B.C

# ----------------------------------------------------------------------------------- time model
LAPSE_IN = (9.5, 14.0)
LAPSE_OUT = (42.5, 47.5)
Y_END = 6.865          # years after planting when the lapse lands (mid/late October)
Y_TAIL = 0.0012        # years per second after it (the leaves keep turning, slowly)
PH_START = 0.695       # late afternoon
PH_END = 0.712         # golden late afternoon at the end
PH_BASE = 0.0009       # the sun's real-time drift outside the lapse
PH_PEAK_GUESS = 0.75   # days per second at peak (passing days, not a strobe)


def lapse(t):
    return ss(*LAPSE_IN, t) * (1 - ss(*LAPSE_OUT, t))


def integ(fn, dt=0.01):
    out, acc, t = [0.0], 0.0, 0.0
    while t < DUR + 0.3:
        acc += fn(t + dt / 2) * dt
        t += dt
        out.append(acc)
    return out


LINT = integ(lapse)
TAILINT = integ(lambda t: ss(LAPSE_OUT[0] + 2.0, LAPSE_OUT[1] + 1.0, t))


def at(seq, t):
    return seq[min(int(round(t / 0.01)), len(seq) - 1)]


T_LAND = LAPSE_OUT[1] + 0.5
# years: Y(t) = Ypk * L(t) + tail; land exactly on Y_END at T_LAND
Y_PEAK = (Y_END - Y_TAIL * at(TAILINT, T_LAND)) / at(LINT, T_LAND)


def Yf(t):
    return Y_PEAK * at(LINT, t) + Y_TAIL * at(TAILINT, t)


# day phase: whole number of days through the lapse, landing on PH_END at the end. The clock is
# warped so the nights race by and the days linger (35 s of half-dark flicker was too much).
NIGHT_RUSH = 0.93


def warp(u):
    for _ in range(2):      # (twice: nights ~12% of the time)
        u = u + NIGHT_RUSH * math.sin(2 * math.pi * u) / (2 * math.pi)
    return u


def unwarp(p):
    n = math.floor(p)
    lo, hi = n, n + 1.0
    for _ in range(60):
        m = (lo + hi) / 2
        if warp(m) < p:
            lo = m
        else:
            hi = m
    return (lo + hi) / 2


RAW_START, RAW_END = unwarp(PH_START), unwarp(PH_END)
_n = round(RAW_START + PH_BASE * DUR + PH_PEAK_GUESS * at(LINT, DUR) - RAW_END)
PH_PEAK = (_n + RAW_END - RAW_START - PH_BASE * DUR) / at(LINT, DUR)


def PHf(t):
    return warp(RAW_START + PH_BASE * t + PH_PEAK * at(LINT, t))


# world time for people: x4 during the lapse
W_PEAK = 3.0
WINT = integ(lambda t: 1 + W_PEAK * lapse(t))


def Wf(t):
    return at(WINT, t)


def t_of(fn, v):
    lo, hi = 0.0, DUR
    for _ in range(50):
        m = (lo + hi) / 2
        if fn(m) < v:
            lo = m
        else:
            hi = m
    return (lo + hi) / 2


def tY(y):
    return t_of(Yf, y)


def tW(w):
    return t_of(Wf, w)


def table(fn, step=STEP, nd=5):
    vals, t = [], 0.0
    while t <= DUR + 0.2001:
        vals.append(round(fn(t), nd))
        t += step
    return vals


def ftable(fn, n=100, nd=3):
    return [round(fn(i / n), nd) for i in range(n + 1)]


# --- seasons as functions of the year fraction f (0 = late November, the day of planting)
def snow_f(f):        # snow lying on the ground
    return ss(0.035, 0.075, f) * (1 - ss(0.25, 0.31, f))


def snowing_f(f):     # snow falling
    return ss(0.02, 0.05, f) * (1 - ss(0.20, 0.25, f))


def cold_f(f):        # pale cold sky / desaturated light
    c = 0.55 + 0.30 * ss(0.0, 0.1, f) - 0.6 * ss(0.22, 0.40, f) - 0.25 * ss(0.40, 0.55, f)
    # (never fully clear: the intro's soft, slightly overcast light)
    return max(0.18, c + 0.10 * ss(0.78, 0.92, f) + 0.45 * ss(0.92, 1.0, f))


def mix3(a, b, k):
    return tuple(a[i] + (b[i] - a[i]) * k for i in range(3))


LAWN_SUMMER = (0.30, 0.55, 0.22)
LAWN_SPRING = (0.40, 0.64, 0.25)
LAWN_AUTUMN = (0.48, 0.50, 0.24)
LAWN_DORMANT = (0.47, 0.45, 0.30)


def lawn_f(f, dark=0.0):
    c = LAWN_DORMANT
    c = mix3(c, LAWN_SPRING, ss(0.28, 0.38, f))
    c = mix3(c, LAWN_SUMMER, ss(0.42, 0.52, f))
    c = mix3(c, LAWN_AUTUMN, ss(0.74, 0.88, f))
    c = mix3(c, LAWN_DORMANT, ss(0.90, 1.0, f))
    return tuple(max(0, v - dark * (0.08 if i != 2 else 0.04)) for i, v in enumerate(c))


TREE_BARE = (0.38, 0.33, 0.34)


def distant_trees_f(f, tone):
    sp = {"dark": (0.24, 0.42, 0.20), "mid": (0.42, 0.60, 0.26), "light": (0.58, 0.74, 0.34)}[tone]
    su = {"dark": (0.12, 0.30, 0.16), "mid": (0.18, 0.42, 0.19), "light": (0.30, 0.55, 0.22)}[tone]
    bare = {"dark": (0.30, 0.26, 0.28), "mid": TREE_BARE, "light": (0.47, 0.42, 0.42)}[tone]
    c = bare
    c = mix3(c, sp, ss(0.30, 0.40, f))
    c = mix3(c, su, ss(0.44, 0.56, f))
    au = mix3(B.ramp_py(tone, ss(0.72, 0.92, f) * 0.9)[:3], bare, 0.35)
    c = mix3(c, au, ss(0.72, 0.80, f))
    c = mix3(c, bare, ss(0.90, 0.98, f))
    return c


YT = table(Yf, nd=4)
PH = table(PHf, nd=4)
WT = table(Wf, nd=3)


def cloud_fn():
    vals, acc = [0.0], 0.0
    for i in range(int((DUR + 0.3) / 0.01)):
        t = i * 0.01
        acc += (2.0 + 200 * (PH_BASE + PH_PEAK * lapse(t))) * 0.01
        vals.append(acc)
    return lambda t: vals[min(int(t / 0.01), len(vals) - 1)]


CL = table(cloud_fn(), nd=2)

BASE_JS = ("function ss(a,b,x){x=Math.min(1,Math.max(0,(x-a)/(b-a)));return x*x*(3-2*x);}"
           "function tab(T,t){var f=Math.max(0,t)/0.1;var i=Math.floor(f);if(i>=T.length-1)return T[T.length-1];return T[i]+(T[i+1]-T[i])*(f-i);}"
           "function tf(T,f){var x=Math.min(1,Math.max(0,f))*(T.length-1);var i=Math.min(T.length-2,Math.floor(x));return T[i]+(T[i+1]-T[i])*(x-i);}"
           "function fr(y){return y-Math.floor(y);}")
Y_JS = "var YT=%s;function Y(t){return tab(YT,t);}" % json.dumps(YT)
PH_JS = "var PH=%s;function phase(t){return tab(PH,t);}function sunE(t){return Math.sin(6.2831853*(phase(t)-0.25));}function dayL(t){return ss(-0.34,0.08,sunE(t));}" % json.dumps(PH)
CL_JS = "var CL=%s;function cloud(t){return tab(CL,t);}" % json.dumps(CL)
W_JS = "var WT=%s;function W(t){return tab(WT,t);}function wf(w,r){return Math.floor(w*r)%%2;}" % json.dumps(WT)
LEAF_JS = ("function leafOn(f,a,b){return ss(0.31+a,0.42+a,f)*(1-ss(0.905+b,0.975+b,f));}"
           "function turn(f,o){return ss(0.73+o,0.90+o,f);}")


def ftab_js(name, fn, n=100):
    return "var %s=%s;" % (name, json.dumps(ftable(fn, n)))


def colour_js(name, fn):
    """fillColor animator body (expects 'f'): a colour as a function of the year fraction."""
    return (ftab_js(name + "R", lambda f: fn(f)[0]) + ftab_js(name + "G", lambda f: fn(f)[1]) + ftab_js(name + "B", lambda f: fn(f)[2]))


def colour_ret(name):
    return "return [tf(%sR,f),tf(%sG,f),tf(%sB,f),1];" % (name, name, name)


H_Y = BASE_JS + Y_JS
H_ALL = BASE_JS + Y_JS + PH_JS

# ----------------------------------------------------------------------------------- camera
# Static and close: the tree grows in the foreground (its base near the bottom of the frame) with the
# meadow, the path, the park's trees and Central Park South as parallax layers behind. The film opens
# pushed in on the falling leaf (sky, clouds, tower tops) and ends pushed in on the leaf that lets go,
# like the intro's last shot.
CENTRE = (160.0, 90.0)
LAND_T = 6.0
SEED = (88.0, 174.0)          # where the seed lands = the tree's base (foreground)
LETGO_LOCAL = (99.0, -127.0)  # big-tree local coords: a twig poking out of the crown's right edge
LETGO_WORLD = (SEED[0] + LETGO_LOCAL[0], SEED[1] + LETGO_LOCAL[1])
END_ZOOM = 2.1
END_SCREEN = (128.0, 82.0)    # where the last leaf sits on screen at the end (cf. the intro's CAM_END)
PUSH_END = (46.0, 52.0)


def e3(x):
    x = min(1, max(0, x))
    return 4 * x ** 3 if x < 0.5 else 1 - (-2 * x + 2) ** 3 / 2


def cam_at(t):
    """(cx, cy, zoom): the world point at screen centre, and the zoom."""
    a = (70.0, 32.0, 2.0)
    wide = (CENTRE[0], CENTRE[1], 1.0)
    d = (LETGO_WORLD[0] + (CENTRE[0] - END_SCREEN[0]) / END_ZOOM, LETGO_WORLD[1] + (CENTRE[1] - END_SCREEN[1]) / END_ZOOM, END_ZOOM)
    if t < LAND_T + 0.4:
        k = e3(t / (LAND_T + 0.4))
        return tuple(a[i] + (wide[i] - a[i]) * k for i in range(3))
    k = e3((t - PUSH_END[0]) / (PUSH_END[1] - PUSH_END[0]))
    # zoom in screen space evenly (interpolate 1/zoom)
    z = 1 / (1 + (1 / END_ZOOM - 1) * k)
    return (wide[0] + (d[0] - wide[0]) * k, wide[1] + (d[1] - wide[1]) * k, z)


def camera_group(name, k, layers, desc=None):
    gid = nid()
    g = group(name, layers, transform=tr((CENTRE[0] * S, CENTRE[1] * S), (CENTRE[0] * S, CENTRE[1] * S)), gid=gid, desc=desc)

    def sk(t):
        return 1 + (cam_at(t)[2] - 1) * k

    def ck(t, i):
        return CENTRE[i] + (cam_at(t)[i] - CENTRE[i]) * k
    # screen(p) = pos + (p - A) * s with A = CENTRE; we want screen(c_k) = CENTRE
    px = table(lambda t: (CENTRE[0] + (CENTRE[0] - ck(t, 0)) * sk(t)) * S, nd=2)
    py = table(lambda t: (CENTRE[1] + (CENTRE[1] - ck(t, 1)) * sk(t)) * S, nd=2)
    sc = table(lambda t: 100 * sk(t), nd=3)
    anim(gid, "positionX", "var P=%s;return tab(P,input.time.seconds);" % json.dumps(px), BASE_JS)
    anim(gid, "positionY", "var P=%s;return tab(P,input.time.seconds);" % json.dumps(py), BASE_JS)
    for p in ("scaleX", "scaleY"):
        anim(gid, p, "var P=%s;return tab(P,input.time.seconds);" % json.dumps(sc), BASE_JS)
    return g


# depth layers (k = parallax: 1 = the tree's plane)
K_SKY, K_TREES, K_FAR, K_PATH, K_MID = 0.35, 0.5, 0.55, 0.65, 0.8
FAR_Y = 102.0                 # far meadow starts (under the park trees)
PATH_Y = (116.0, 122.5)       # the path: benches and lamps along its back edge
MID_Y = 122.5                 # the meadow in front of the path (kids, kites, snowmen)
FRONT_Y = 150.0               # the foreground lawn (the tree)
BENCHES = (40.0, 206.0)
LAMPS = (10.0, 128.0, 186.0, 302.0)


# ----------------------------------------------------------------------------------- skyline
def build_skyline():
    """Central Park South from Sheep Meadow, east (left) to west (right): the supertalls stand right
    of the tree so its crown never hides them."""
    L = []
    r = random.Random(57)
    base = 100
    win_day, win_lit, extra = [], [], []
    stone, glass, glass2 = (0.78, 0.74, 0.66, 1), (0.40, 0.52, 0.68, 1), (0.33, 0.43, 0.58, 1)
    specs = [(-40, 16, 70, "bldB", ""), (-24, 12, 64, "bldA", ""), (-12, 14, 74, "bldC", ""), (2, 10, 60, "bldB", ""),
             (12, 14, 68, "bldA", ""), (26, 12, 58, "bldC", ""), (38, 16, 66, "bldB", ""), (54, 10, 54, "bldA", ""),
             (64, 14, 62, "bldC", ""), (78, 12, 56, "bldB", ""), (90, 14, 64, "bldA", ""), (104, 12, 50, "bldC", ""),
             (116, 14, 60, "bldB", ""), (130, 12, 56, "bldA", ""),
             (142, 22, 66, "stone", "plaza"), (166, 9, 52, "bldB", ""), (176, 8, 12, "bldC", "432"), (184, 8, 56, "bldA", ""),
             (192, 5, 20, "bldC", "steinway"), (197, 9, 48, "bldB", ""), (206, 11, 30, "glass", "one57"),
             (217, 6, 56, "bldC", ""), (223, 12, 4, "bldA", "cpt"), (235, 10, 34, "stone", "220"),
             (245, 12, 58, "bldB", ""), (257, 9, 38, "glass2", "twc"), (270, 9, 38, "glass2", "twc"),
             (280, 14, 62, "bldC", ""), (294, 12, 56, "bldA", ""), (306, 16, 66, "bldB", ""), (322, 12, 60, "bldC", ""),
             (334, 14, 70, "bldA", ""), (348, 16, 64, "bldB", ""), (364, 14, 72, "bldC", "")]
    cols = {"stone": stone, "glass": glass, "glass2": glass2}
    for (x, w, top, col, kind) in specs:
        colour = cols.get(col) or C[col]
        if kind == "twc":
            L.append(shape("Time Warner tower", [[(x, base), (x, top + (4 if x < 265 else 0)), (x + w, top + (0 if x < 265 else 4)), (x + w, base)]], colour))
        elif kind == "one57":
            L.append(shape("One57", [[(x, base), (x, top + 10), (x + 3, top + 5), (x + 6, top + 2), (x + w, top), (x + w, base)]], colour))
            extra.append((x + 5, top + 6, 1, base - top - 8))
        elif kind == "steinway":
            L.append(shape("Steinway tower", [[(x, base), (x, top + 2), (x + 2, top - 6), (x + 3, top - 9), (x + w, top + 14), (x + w, base)]], colour))
        elif kind == "cpt":
            L.append(rect("Central Park Tower", x, top, w, base - top, colour))
            L.append(rect("CPT cantilever", x - 2, top + 34, 2, base - top - 34, colour))
            L.append(rect("CPT crown", x + 2, top - 3, w - 4, 3, colour))
        elif kind == "220":
            L.append(rect("220 CPS", x, top, w, base - top, colour))
            L.append(rects("220 crown", [(x + 2, top - 4, w - 4, 4), (x + 4, top - 6, w - 8, 2)], colour))
        elif kind == "plaza":
            L.append(rect("Plaza", x, top, w, base - top, colour))
            L.append(shape("Plaza roof", [[(x - 1, top), (x + 2, top - 6), (x + w - 2, top - 6), (x + w + 1, top)],
                                          [(x + 3, top - 6), (x + 4, top - 9), (x + 6, top - 9), (x + 7, top - 6)],
                                          [(x + w - 7, top - 6), (x + w - 6, top - 9), (x + w - 4, top - 9), (x + w - 3, top - 6)]], C["copper"]))
        else:
            L.append(rect("Tower", x, top, w, base - top, colour))
        if kind != "twc":
            L.append(rect("Tower edge", x, top, 1, base - top, C["bldEdge"], op=60))
        step_y = 2 if kind == "432" else 3
        for wy in range(int(top) + 3, base - 2, step_y):
            for wx in range(int(x) + 2, int(x + w) - 1, 2):
                if kind == "432" or r.random() < 0.5:
                    win_day.append((wx, wy, 1, 1))
                    if r.random() < 0.42 and wy < 84:     # (none below the park's tree tops)
                        win_lit.append((wx, wy, 1, 1))
    L.append(rects("Tower windows", win_day, C["win"]))
    L.append(rects("One57 stripe", extra, (0.52, 0.64, 0.80, 1)))
    beacons = [(228.5, 0, 1, 1), (179.5, 11, 1, 1), (194, 10.5, 1, 1)]
    return L[::-1], win_lit, beacons


# ----------------------------------------------------------------------------------- distant park trees
def build_treeline():
    L = []
    r = random.Random(12)
    tones = {"dark": [], "mid": [], "light": []}
    trunks = []
    x = -90
    while x < 420:
        rad = r.uniform(5.5, 9.0)
        cy = 94 + r.uniform(-2, 2.5)
        tones["dark"].append(jag(x, cy + 1.5, rad, 1.0, 0.8, 14, r, 0.22))
        tones["mid"].append(jag(x - 1, cy - 0.5, rad * 0.78, 1.0, 0.78, 12, r, 0.22))
        tones["light"].append(jag(x - 2.5, cy - 2.5, rad * 0.35, 1.0, 0.75, 9, r, 0.3))
        trunks.append((x - 0.5, cy + rad * 0.5, 1, 104 - cy - rad * 0.5 + 1))
        x += r.uniform(6, 10)
    lid = nid()
    L.append(rect("Ground under the park trees", -90, 97, 520, 24, (0.3, 0.5, 0.2, 1), lid=lid))
    anim(lid, "fillColor", "var f=fr(Y(input.time.seconds));" + colour_ret("G"), H_Y + colour_js("G", lambda f: lawn_f(f, 1.8)))
    L.append(rects("Distant trunks", trunks, (0.26, 0.22, 0.22, 1)))
    for tone in ("dark", "mid", "light"):
        lid = nid()
        L.append(shape("Distant trees %s" % tone, tones[tone], (0.3, 0.4, 0.2, 1), lid=lid))
        anim(lid, "fillColor", "var f=fr(Y(input.time.seconds));" + colour_ret("D"), H_Y + colour_js("D", lambda f, tone=tone: distant_trees_f(f, tone)))
    caps = []
    for poly in tones["mid"]:
        top = sorted(poly, key=lambda p: p[1])[:5]
        caps.append(B.circle_poly(sum(p[0] for p in top) / 5, sum(p[1] for p in top) / 5 + 0.5, 2.2, 8, 1.4, 0.55))
    sid = nid()
    L.append(shape("Snow on distant trees", caps, (0.93, 0.95, 0.98, 1), lid=sid))
    anim(sid, "opacity", "var f=fr(Y(input.time.seconds));return 100*tf(SN,f);", H_Y + ftab_js("SN", lambda f: ss(0.06, 0.10, f) * (1 - ss(0.20, 0.24, f))))
    return L[::-1]


# ----------------------------------------------------------------------------------- the meadow, in depth bands
def lawn_band(name, y0, dark, tuft_rows, tuft_n, tuft_w, seed):
    L = []
    lid = nid()
    L.append(rect(name, -90, y0, 520, 240 - y0, (0.3, 0.55, 0.22, 1), lid=lid))
    anim(lid, "fillColor", "var f=fr(Y(input.time.seconds));" + colour_ret("L"), H_Y + colour_js("L", lambda f: lawn_f(f, dark)))
    r = random.Random(seed)
    tufts = [(r.uniform(-90, 420), r.choice(tuft_rows), r.uniform(*tuft_w), 1 if tuft_w[1] < 4 else r.choice([1, 1, 2])) for _ in range(tuft_n)]
    tid = nid()
    L.append(rects(name + " tufts", tufts, (0.22, 0.44, 0.18, 1), lid=tid))
    anim(tid, "fillColor", "var f=fr(Y(input.time.seconds));" + colour_ret("T"), H_Y + colour_js("T", lambda f: lawn_f(f, dark + 1.0)))
    # snow over it (with drifts)
    s1, s2 = nid(), nid()
    L.append(rect(name + " snow", -90, y0, 520, 240 - y0, (0.90, 0.92, 0.96, 1), lid=s1))
    L.append(rects(name + " snow drifts", [(x, y + 0.5, w * 1.5, 1) for (x, y, w, h) in tufts[::2]], (0.80, 0.84, 0.93, 1), lid=s2))
    for s in (s1, s2):
        anim(s, "opacity", "var f=fr(Y(input.time.seconds));return 100*tf(SN,f);", H_Y + ftab_js("SN", snow_f))
    return L[::-1]


def build_path():
    L = []
    L.append(rect("Path", -90, PATH_Y[0], 520, PATH_Y[1] - PATH_Y[0], (0.56, 0.55, 0.55, 1)))
    L.append(rect("Path edge (back)", -90, PATH_Y[0], 520, 0.8, (0.66, 0.65, 0.63, 1)))
    L.append(rect("Path edge (front)", -90, PATH_Y[1] - 0.8, 520, 0.8, (0.47, 0.46, 0.46, 1)))
    r = random.Random(3)
    L.append(rects("Path cracks", [(r.uniform(-90, 420), r.uniform(PATH_Y[0] + 1.5, PATH_Y[1] - 2), r.randint(2, 4), 0.5) for _ in range(40)], (0.50, 0.49, 0.49, 1)))
    sid = nid()
    L.append(rects("Snow on the path", [(r.uniform(-90, 420), r.uniform(PATH_Y[0], PATH_Y[1] - 1.5), r.uniform(4, 16), r.uniform(1, 2.5)) for _ in range(60)],
                   (0.86, 0.88, 0.93, 1), lid=sid))
    anim(sid, "opacity", "var f=fr(Y(input.time.seconds));return 80*ss(0.6,1,tf(SN,f));", H_Y + ftab_js("SN", snow_f))
    lamps = []
    for lx in LAMPS:
        top = PATH_Y[0] - 19
        lamps += [(lx - 0.5, top + 3.8, 1, 16), (lx - 1.5, PATH_Y[0] - 0.5, 3, 1.5), (lx - 1.5, top + 1, 3, 0.8), (lx - 1, top, 2, 1), (lx - 2, top + 4.8, 4, 0.7)]
    L.append(rects("Lamp posts", lamps, (0.13, 0.20, 0.17, 1)))
    for bx in BENCHES:
        by = PATH_Y[0] - 5.5
        L.append(rects("Bench slats", [(bx, by + 0.5, 18, 1.2), (bx, by + 2.6, 18, 1.0)], (0.20, 0.38, 0.26, 1)))
        L.append(rects("Bench frame", [(bx + 1, by, 1, 6.5), (bx + 16, by, 1, 6.5), (bx, by + 4, 18, 0.8)], (0.10, 0.13, 0.13, 1)))
    return L[::-1]


# ----------------------------------------------------------------------------------- the tree
def limb_builder(r, polys, ends, F=1.0):
    def limb(pts, w0, w1, depth, spread=1.0):
        pts = [(x * F, y * F) for (x, y) in pts]
        w0, w1 = w0 * F, w1 * F
        _limb(pts, w0, w1, depth, spread * F)

    def _limb(pts, w0, w1, depth, spread):
        curve = B.bez(pts, 6)
        n = len(curve) - 1
        for i in range(n):
            a = w0 + (w1 - w0) * i / n
            b = w0 + (w1 - w0) * (i + 1) / n
            polys.append(B.seg_poly(curve[i], curve[i + 1], a, b))
            polys.append(B.circle_poly(curve[i + 1][0], curve[i + 1][1], b / 2, 6))
        if depth > 0:
            for i in range(2, n, 3 if depth > 1 else 2):
                p = curve[i]
                d = (curve[i + 1][0] - curve[i - 1][0], curve[i + 1][1] - curve[i - 1][1])
                ang = math.atan2(d[1], d[0]) + r.choice([-1, 1]) * r.uniform(0.45, 0.95)
                ln = r.uniform(7, 15) * (1 if depth > 1 else 0.6) * spread
                q = (p[0] + math.cos(ang) * ln, p[1] + math.sin(ang) * ln - r.uniform(1, 4) * spread)
                m = ((p[0] + q[0]) / 2 + r.uniform(-1.5, 1.5) * spread, (p[1] + q[1]) / 2 + r.uniform(-1.5, 1.5) * spread)
                wb = max(0.6, (w0 + (w1 - w0) * i / n) * 0.55)
                _limb([p, m, q], wb, 0.5, depth - 1, spread)
        ends.append(curve[-1])
        ends.append(curve[len(curve) // 2])
    return limb


TREE_STAGES = []


def growth_y(y):
    """Effective growth: trees put on size from April to August only."""
    n = math.floor(y)
    return n + ss(0.30, 0.70, y - n)


def stage_scale(heights, y):
    g = growth_y(y)
    if g <= heights[0][0]:
        return heights[0][1]
    for (g0, s0), (g1, s1) in zip(heights, heights[1:]):
        if g <= g1:
            return s0 + (s1 - s0) * (g - g0) / (g1 - g0)
    return heights[-1][1]


def canopy(r, ends, n_fill, centre, radii, spacing, rad_range):
    pts = [p for p in ends if p[1] < centre[1] + radii[1] * 0.6]
    for _ in range(n_fill):
        a = r.uniform(0, 2 * math.pi)
        rr = math.sqrt(r.random())
        pts.append((centre[0] + math.cos(a) * radii[0] * rr, centre[1] + math.sin(a) * radii[1] * rr))
    chosen = []
    for p in sorted(pts, key=lambda p: r.random()):
        if all(math.hypot(p[0] - q[0], p[1] - q[1]) > spacing for q in chosen):
            chosen.append(p)
    return [(x, y, r.uniform(*rad_range)) for (x, y) in chosen]


def cluster_group(i, x, y, rad, label):
    rr = random.Random(1000 + i + sum(map(ord, label)) * 7)
    off = rr.uniform(-0.05, 0.05)
    a = rr.uniform(-0.02, 0.03)
    b = rr.uniform(-0.02, 0.03)
    dark = [jag(0.12 * rad, 0.14 * rad, rad, 1.0, 0.82, 22, rr, 0.13)]
    mid = [jag(-0.1 * rad, -0.12 * rad, rad * 0.8, 1.0, 0.8, 18, rr, 0.14)]
    light = [jag(-0.38 * rad + rr.uniform(-1, 1) * rad / 10, -0.42 * rad, rad * 0.36, 1.0, 0.75, 10, rr, 0.25),
             jag(0.12 * rad, -0.55 * rad + rr.uniform(-1, 1) * rad / 10, rad * 0.26, 1.0, 0.75, 9, rr, 0.25)]
    specks, dspecks = [], []
    for _ in range(7 if rad > 5 else 3):
        aa = rr.uniform(0, 2 * math.pi)
        d = rr.uniform(0.2, 0.85) * rad
        x1, y1 = math.cos(aa) * d, math.sin(aa) * d * 0.8
        specks.append([(x1, y1), (x1 + 1, y1), (x1 + 1, y1 + 1), (x1, y1 + 1)])
    for _ in range(6 if rad > 5 else 2):
        aa = rr.uniform(0, 2 * math.pi)
        d = rr.uniform(0.1, 0.7) * rad
        x1, y1 = math.cos(aa) * d, math.sin(aa) * d * 0.7 + 0.2 * rad
        dspecks.append([(x1, y1), (x1 + 1, y1), (x1 + 1, y1 + 1), (x1, y1 + 1)])
    kids = []
    fresh = {"dark": [0.22, 0.46, 0.18], "mid": [0.42, 0.66, 0.24], "light": [0.66, 0.82, 0.36]}
    for tone, polys in (("light", light + specks), ("dark", dspecks), ("mid", mid), ("dark", dark)):
        lid = nid()
        kids.append(shape("Leaves %s" % tone, polys, B.RAMP[tone][0] + (1,), lid=lid))
        anim(lid, "fillColor",
             "var f=fr(Y(input.time.seconds));var c=rc(turn(f,%f)*1.02);var s=1-ss(0.36,0.50,f);var F=%s;"
             "return [c[0]+(F[0]-c[0])*s,c[1]+(F[1]-c[1])*s,c[2]+(F[2]-c[2])*s,1];" % (off, json.dumps(fresh[tone])),
             H_Y + LEAF_JS + B.ramp_js(tone))
    gid = nid()
    g = group("Canopy cluster %d" % i, kids, transform=tr((x * S, y * S)), gid=gid)
    ph = rr.uniform(0, 6.28)
    for p in ("scaleX", "scaleY"):
        anim(gid, p, "var t=input.time.seconds;var f=fr(Y(t));return 100*leafOn(f,%f,%f);" % (a, b), H_Y + LEAF_JS)
    anim(gid, "positionX", "var t=input.time.seconds;return (%f+Math.sin(t*1.6+%f)*%f)*%d;" % (x, ph, 0.25 + rad * 0.03, S), BASE_JS)
    return g, (off, a, b)


def build_stage(name, y0, y1, heights, art, clusters, extra_front=None, sway=0.4):
    lid = nid()
    kids, cl_meta = [], []
    for i, (x, y, rad) in enumerate(clusters):
        g, meta = cluster_group(i, x, y, rad, name)
        kids.append(g)
        cl_meta.append((x, y, rad, meta))
    kids = kids[::-1] + (extra_front or []) + art
    st = group("Tree: %s" % name, kids, transform=tr((SEED[0] * S, SEED[1] * S)), gid=lid,
               desc="Visible for years %.2f-%.2f; grows from its base (spring to summer)." % (y0, y1))
    sc = table(lambda t: 100 * stage_scale(heights, Yf(t)), nd=2)
    anim(lid, "scaleX", "var P=%s;return tab(P,input.time.seconds);" % json.dumps(sc), BASE_JS)
    anim(lid, "scaleY", "var P=%s;return tab(P,input.time.seconds);" % json.dumps(sc), BASE_JS)
    anim(lid, "opacity", "var y=Y(input.time.seconds);return (y>=%f&&y<%f)?100:0;" % (y0, y1), H_Y)
    anim(lid, "rotation", "var t=input.time.seconds;return Math.sin(t*1.1)*%f+Math.sin(t*2.7)*%f;" % (sway * 0.5, sway * 0.2), BASE_JS)
    TREE_STAGES.append((name, y0, y1, heights, cl_meta))
    return st


def build_tree():
    stages = []
    bark, bark2, barkHi = C["bark"], C["bark2"], C["barkHi"]

    # ---- sprout (first spring): a stem and two seed leaves out of the soil
    lf_id = nid()
    stem = shape("Sprout stem", [B.seg_poly((0, 0.5), (0.8, -7), 2.0, 1.6), B.seg_poly((0.8, -7), (0, -13), 1.6, 1.3)], (0.36, 0.52, 0.22, 1))
    leaves = shape("Seed leaves", [B.circle_poly(-3.8, -14, 3.8, 10, 1.0, 0.55), B.circle_poly(3.8, -14.6, 3.8, 10, 1.0, 0.55)], (0.48, 0.74, 0.30, 1), lid=lf_id)
    veins = rects("Seed leaf veins", [(-6, -14.2, 4, 0.7), (2, -14.8, 4, 0.7)], (0.36, 0.58, 0.22, 1))
    anim(lf_id, "fillColor", "var f=fr(Y(input.time.seconds));var k=ss(0.78,0.93,f);return [0.48+0.42*k,0.74-0.06*k,0.30-0.12*k,1];", H_Y)
    sprout = group("Sprout", [veins, leaves, stem], transform=tr((SEED[0] * S, SEED[1] * S)))
    gid = sprout["id"]
    anim(gid, "scaleY", "var y=Y(input.time.seconds);return 100*ss(0.31,0.45,y)*(0.7+0.3*ss(0.45,0.7,y));", H_Y)
    anim(gid, "scaleX", "var y=Y(input.time.seconds);return 100*(0.6+0.4*ss(0.33,0.45,y));", H_Y)
    anim(gid, "opacity", "var y=Y(input.time.seconds);return (y>0.3&&y<1.05)?100:0;", H_Y)
    anim(veins["id"], "opacity", "var f=fr(Y(input.time.seconds));return 100*(1-ss(0.78,0.85,f));", H_Y)
    stages.append(sprout)

    # ---- sapling (years 1-3), staked and tied, a mulch ring
    F = 3.4
    r = random.Random(3)
    polys, ends = [], []
    limb = limb_builder(r, polys, ends, F)
    limb([(0, 0.5), (0.3, -8), (-0.3, -15), (0.2, -22)], 1.6, 0.5, 0)
    limb([(0, -9), (-3, -12), (-6, -16)], 0.7, 0.35, 0)
    limb([(0.1, -13), (3, -16), (5.5, -20)], 0.7, 0.35, 0)
    limb([(-0.2, -17), (-2.5, -20), (-3.5, -23)], 0.55, 0.35, 0)
    limb([(0.1, -6), (2.5, -8), (4, -9.5)], 0.5, 0.3, 0)
    art = [shape("Sapling", polys, bark2), ellipse("Mulch ring", (0, 1.2), (34, 6), (0.34, 0.24, 0.17, 1))]
    stake = [rects("Stake", [(7.0, -52, 3, 54)], (0.62, 0.48, 0.30, 1)), rects("Stake light", [(7.0, -52, 1, 54)], (0.74, 0.60, 0.40, 1)),
             rects("Stake tie", [(1.8, -38, 8, 2)], (0.20, 0.42, 0.30, 1))]
    cl = [(x * F, y * F, rad * F) for (x, y, rad) in [(-5.5, -16.5, 1.5), (5.0, -19.5, 1.6), (-1.0, -22.5, 1.7), (0.8, -16.0, 1.3), (-3.2, -21, 1.2), (3.6, -9.5, 1.0), (2.0, -23.5, 1.2)]]
    stages.append(build_stage("sapling", 1.05, 3.05, [(1.0, 0.6), (3.0, 1.0)], art, cl, extra_front=stake, sway=0.8))

    # ---- young tree (years 3-5)
    F = 2.5
    r = random.Random(11)
    polys, ends = [], []
    limb = limb_builder(r, polys, ends, F)
    limb([(0, 1), (0.4, -10), (-0.4, -20), (0, -27)], 3.6, 2.0, 0)
    limb([(0, -24), (-6, -32), (-13, -40), (-18, -44)], 2.0, 0.6, 1, 0.55)
    limb([(0, -25), (-1, -36), (-2, -46), (-1, -52)], 2.0, 0.6, 1, 0.55)
    limb([(0, -24), (6, -32), (12, -40), (18, -45)], 2.0, 0.6, 1, 0.55)
    limb([(0, -18), (8, -22), (14, -26)], 1.2, 0.5, 0)
    hi = [[(-1.2 * F, 0), (-1.0 * F, -20 * F), (-0.2 * F, -20 * F), (-0.4 * F, 0)]]
    art = [shape("Young tree", polys, bark), shape("Young bark light", hi, barkHi)]
    cl = [c for c in canopy(random.Random(4), ends, 160, (0, -100), (48, 30), 9.0, (7.5, 9.5)) if c[1] < -62]
    stages.append(build_stage("young tree", 3.05, 5.05, [(3.0, 0.6), (5.0, 1.0)], art, cl, sway=0.5))

    # ---- big tree (years 5+): fills the frame like the intro's tree; its crown runs off the top
    F = 1.9
    r = random.Random(42)
    polys, ends = [], []
    limb = limb_builder(r, polys, ends, F)
    trunk = [(-13, 1), (-6, -3), (-4.5, -16), (-3.5, -30), (-2.0, -38), (2, -40), (4.5, -36), (4.5, -24), (5, -10), (6.5, -3), (14, 1)]
    polys.append([(x * F, y * F) for (x, y) in trunk])
    hi = [[(x * F, y * F) for (x, y) in [(-3.6, -4), (-2.6, -18), (-1.8, -32), (-0.4, -32), (-1.0, -18), (-1.8, -4)]]]
    roots = [[(x * F, y * F) for (x, y) in [(-13, 1), (-18, 2.2), (-8, 0.6)]], [(x * F, y * F) for (x, y) in [(14, 1), (19, 2.4), (8, 0.5)]]]
    limb([(-1, -35), (-10, -48), (-24, -58), (-38, -64)], 4.0, 0.8, 2)
    limb([(0, -38), (-4, -56), (-8, -74), (-9, -88)], 4.4, 0.8, 2)
    limb([(1, -38), (6, -58), (9, -76), (11, -92)], 4.4, 0.8, 2)
    limb([(2, -36), (14, -50), (28, -60), (42, -64)], 4.0, 0.8, 2)
    limb([(-1, -28), (-16, -36), (-30, -40), (-44, -44)], 3.0, 0.7, 1)
    limb([(3, -30), (18, -38), (32, -48), (44, -58), (LETGO_LOCAL[0] / F - 3, LETGO_LOCAL[1] / F + 2)], 3.0, 0.6, 1)
    knots = rects("Bark texture", [(x * F, y * F, w * F, h * F) for (x, y, w, h) in [(-1, -12, 1, 3), (1.5, -22, 1, 2), (-2, -30, 2, 1), (2, -8, 1, 3), (-3, -20, 1, 2)]], bark2)
    art = [knots, shape("Bark highlight", hi, barkHi), shape("Trunk and branches", polys + roots, bark)]
    cl = [c for c in canopy(random.Random(9), ends, 320, (0, -132), (90, 56), 13.0, (11.0, 14.0)) if c[1] < -76
          and math.hypot(c[0] - LETGO_LOCAL[0], c[1] - LETGO_LOCAL[1]) > 13]
    stages.append(build_stage("big tree", 5.05, 99, [(5.0, 0.68), (6.9, 1.0)], art, cl, sway=0.3))

    # autumn leaf litter in the foreground grass
    lit_r = random.Random(77)
    litter = []
    for i in range(110):
        x = lit_r.gauss(0, 46)
        litter.append((SEED[0] + x, SEED[1] + lit_r.uniform(-8, 6), lit_r.choice([1.5, 2, 2.5, 3]), lit_r.choice([1, 1.5])))
    li = []
    for j, tone in enumerate(("mid", "light", "dark")):
        lid = nid()
        li.append(rects("Leaf litter %s" % tone, litter[j::3], B.RAMP[tone][2] + (1,), lid=lid))
        anim(lid, "opacity", "var y=Y(input.time.seconds);var f=fr(y);var k=f>0.5?ss(0.80,0.95,f)*(f>0.86?1:0.55):1-ss(0.02,0.07,f);return y>3.5?100*k:0;", H_Y)
    return stages, li


def tree_point(stage_name, x, y, t):
    for (name, y0, y1, heights, cl) in TREE_STAGES:
        if name == stage_name:
            s = stage_scale(heights, Yf(t))
            return SEED[0] + x * s, SEED[1] + y * s, s
    raise KeyError(stage_name)


def build_falling_leaves():
    L = []
    r = random.Random(8)
    for (name, y0, y1, heights, cl) in TREE_STAGES:
        for yr in range(7):
            for (x, y, rad, (off, a, b)) in cl:
                fy = yr + 0.94 + b
                if not (y0 <= fy < y1) or fy > Y_END - 0.01:
                    continue
                for _ in range(2 if rad > 6 else 1):
                    t0 = tY(fy + r.uniform(-0.03, 0.02))
                    wx, wy, s = tree_point(name, x + r.uniform(-rad, rad) * 0.7, y + r.uniform(-rad, rad) * 0.5, t0)
                    col = B.ramp_py(r.choice(["mid", "mid", "light", "dark"]), ss(0.73 + off, 0.90 + off, fy - yr) * 1.02)
                    lid = nid()
                    life = 1.1
                    sz = 3 if name == "big tree" else 2
                    L.append({"type": "Rect", "id": lid, "name": "Falling leaf", "blendMode": "normal",
                              "activeRange": B.rng_ms(t0, life), "transform": tr((wx * S, wy * S), (sz * S / 2, sz * S * 0.375)),
                              "rect": {"size": [sz * S, sz * 0.75 * S], "fillColor": list(col)}})
                    ground = SEED[1] + r.uniform(-8, 5)
                    vy = (ground - wy) / (life * 0.85)
                    vx = r.uniform(6, 34)
                    anim(lid, "positionX", "var u=input.time.seconds;return (%f+%f*u+3*Math.sin(u*7+%f))*%d;" % (wx, vx, r.uniform(0, 6), S))
                    anim(lid, "positionY", "var u=input.time.seconds;return Math.min(%f,%f+%f*u)*%d;" % (ground, wy, vy, S))
                    anim(lid, "rotation", "return input.time.seconds*%f;" % r.uniform(-700, 700))
                    anim(lid, "opacity", "var u=input.time.seconds;return 100*(1-ss(%f,%f,u));" % (life - 0.3, life), BASE_JS)
    return L


# ----------------------------------------------------------------------------------- opening: the leaf and its seed
LEAF_FROM = (52.0, 6.0)
LEAF_SIZE = 22.0


def leaf_path(t):
    u = min(1.0, t / LAND_T)
    x = LEAF_FROM[0] + (SEED[0] - LEAF_FROM[0]) * u + 12 * math.sin(1.25 * t + 0.4) * (1 - u * u)
    y = LEAF_FROM[1] + (SEED[1] - 1.5 - LEAF_FROM[1]) * (1 - (1 - u) ** 1.3) + 3 * math.sin(2.5 * t) * (1 - u)
    return x, y


def build_opening():
    body = B.maple(0, 0, LEAF_SIZE, 0)
    hi = B.maple(-0.6, 0.5, LEAF_SIZE * 0.69, -0.05)
    vein = [B.seg_poly((0, 0), (0, LEAF_SIZE * 0.72), 1.2, 0.7),
            B.seg_poly((0, LEAF_SIZE * 0.3), (LEAF_SIZE * 0.3, LEAF_SIZE * 0.18), 0.7, 0.4),
            B.seg_poly((0, LEAF_SIZE * 0.3), (-LEAF_SIZE * 0.3, LEAF_SIZE * 0.18), 0.7, 0.4)]
    leaf = group("Leaf", [shape("Leaf veins", vein, (0.50, 0.09, 0.07, 1)),
                          shape("Leaf light", [[body[0]] + body[11:]], (1.0, 0.45, 0.16, 1)),
                          shape("Leaf body", [body], (0.80, 0.20, 0.10, 1)),
                          shape("Leaf stem", [B.seg_poly((0, -3.5), (0, 0.8), 1.8, 1.4)], C["bark2"])])
    rt = table(lambda t: (180 + 32 * math.cos(1.25 * t + 0.4) * (1 - min(1, t / LAND_T)) if t < LAND_T
                          else 180 + 84 * ss(LAND_T, LAND_T + 0.7, t) + 3 * math.sin(t * 2.2) * (1 - ss(LAND_T, 9, t))), nd=2)
    anim(leaf["id"], "rotation", "var P=%s;return tab(P,input.time.seconds);" % json.dumps(rt), BASE_JS)
    outer = group("The last leaf (lands with its seed)", [leaf], transform=tr((LEAF_FROM[0] * S, LEAF_FROM[1] * S)))
    oid = outer["id"]
    px = table(lambda t: leaf_path(t)[0] * S + (5 * S * ss(LAND_T, LAND_T + 0.7, t)), nd=2)
    py = table(lambda t: leaf_path(t)[1] * S, nd=2)
    anim(oid, "positionX", "var P=%s;return tab(P,input.time.seconds);" % json.dumps(px), BASE_JS)
    anim(oid, "positionY", "var P=%s;return tab(P,input.time.seconds);" % json.dumps(py), BASE_JS)
    anim(oid, "scaleY", "var t=input.time.seconds;return 100-50*ss(%f,%f,t);" % (LAND_T, LAND_T + 0.7), BASE_JS)
    keys(oid, "opacity", [(0, 100, "hold"), (11.4, 100, "hold"), (11.7, 70, "hold"), (12.0, 40, "hold"), (12.3, 0, "hold")])
    seed = group("Seed", [ellipse("Seed glint", (-1.1, -1.3), (2.0, 2.0), C["seedHi"]), ellipse("Seed body", (0, 0), (6.0, 6.6), C["seed"])])
    sid = seed["id"]
    sx = table(lambda t: (leaf_path(t)[0] if t < LAND_T else SEED[0]) * S, nd=2)
    sy = table(lambda t: (leaf_path(t)[1] if t < LAND_T else SEED[1] - 1.5 + 3.2 * ss(7.0, 8.0, t)) * S, nd=2)
    anim(sid, "positionX", "var P=%s;return tab(P,input.time.seconds);" % json.dumps(sx), BASE_JS)
    anim(sid, "positionY", "var P=%s;return tab(P,input.time.seconds);" % json.dumps(sy), BASE_JS)
    keys(sid, "opacity", [(0, 100, "hold"), (7.9, 100, "hold"), (8.1, 0, "hold")])
    soil = group("Soil mound", [rects("Soil crumbs", [(-6, -1.5, 2, 1.2), (4.5, -1, 2, 1), (-1, -3.2, 2, 1)], (0.28, 0.19, 0.13, 1)),
                                shape("Soil", [[(-8, 1.5), (-5, -1.5), (0, -2.6), (5, -1.5), (8, 1.5)]], (0.38, 0.27, 0.18, 1))],
                 transform=tr((SEED[0] * S, SEED[1] * S)))
    keys(soil["id"], "opacity", [(0, 0, "hold"), (7.1, 0, "hold"), (7.3, 40, "hold"), (7.5, 75, "hold"), (7.7, 100, "hold")])
    anim(soil["id"], "scaleY", "var y=Y(input.time.seconds);return 100*(1-ss(0.95,1.05,y));", H_Y)
    return [outer, seed], soil


# ----------------------------------------------------------------------------------- the leaf that lets go
LETGO_T = 50.0


def build_letgo():
    bx, by, s = tree_point("big tree", LETGO_LOCAL[0], LETGO_LOCAL[1], LETGO_T)
    size = 10.0
    body = B.maple(0, 0, size, 0)
    vein = [B.seg_poly((0, 0), (0, size * 0.72), 0.6, 0.35)]
    leaf = group("Letting-go leaf", [shape("veins", vein, (0.50, 0.09, 0.07, 1)),
                                     shape("light", [[body[0]] + body[11:]], (1.0, 0.45, 0.16, 1)),
                                     shape("body", [body], (0.80, 0.20, 0.10, 1)),
                                     shape("stem", [B.seg_poly((0, -1.6), (0, 0.4), 0.8, 0.6)], C["bark2"])])
    lid = leaf["id"]

    def path(t):
        if t < LETGO_T:
            return bx, by
        u = t - LETGO_T
        # drops, catches the wind and rides away to the right, over the towers (toward downtown)
        x = bx + 4 * u + 1.7 * u * u + 3 * math.sin(u * 1.9)
        y = by + 6 * u - 1.0 * u * u + 2.0 * math.sin(u * 2.6) * min(1, u)
        return x, y

    def rot(t):
        if t < LETGO_T:
            return 6 * math.sin(t * 2.4) + 18 * math.sin(t * 7.1) * ss(LETGO_T - 3.0, LETGO_T, t)
        u = t - LETGO_T
        return 30 * math.sin(u * 2.3) + u * 60
    off = int(44.0 / STEP)
    for prop, fn in (("positionX", lambda t: path(t)[0] * S), ("positionY", lambda t: path(t)[1] * S), ("rotation", rot)):
        T = table(fn, nd=2)[off:]
        anim(lid, prop, "var P=%s;return tab(P,input.time.seconds-44.0);" % json.dumps(T), BASE_JS)
    keys(lid, "opacity", [(0, 0, "hold"), (44.0, 0, "hold"), (44.05, 100, "hold")])
    twig = shape("Its twig", [B.seg_poly((bx - 16, by + 9), (bx - 7, by + 3), 1.4, 0.9), B.seg_poly((bx - 7, by + 3), (bx, by), 0.9, 0.6)], C["bark"])
    keys(twig["id"], "opacity", [(0, 0, "hold"), (44.0, 0, "hold"), (44.05, 100, "hold")])
    return [leaf, twig]


def build_streaks():
    L = []
    r = random.Random(77)
    for g in (49.4, 50.3, 51.6, 53.2, 55.0):
        for k in range(2):
            lid = nid()
            t0 = g + r.uniform(0, 0.6)
            y = r.uniform(10, 80)
            w = r.uniform(8, 18)
            L.append({"type": "Rect", "id": lid, "name": "Wind streak", "blendMode": "normal",
                      "activeRange": B.rng_ms(t0, 1.6), "transform": tr((0, y * S), op=0),
                      "rect": {"size": [w * S, 0.6 * S], "fillColor": [0.98, 0.96, 0.92, 1]}})
            x0 = r.uniform(120, 220)
            sp = r.uniform(50, 80)
            anim(lid, "positionX", "var u=input.time.seconds;return (%f+%f*u)*%d;" % (x0, sp, S))
            anim(lid, "positionY", "var u=input.time.seconds;return (%f+Math.sin(u*4+%f)*1.5)*%d;" % (y, r.uniform(0, 6), S))
            anim(lid, "opacity", "var u=input.time.seconds;return 45*Math.sin(Math.min(1,u/1.6)*3.14159);")
    return L


def build_snow():
    L = []
    r = random.Random(31)
    for i in range(70):
        x0, y0, sz = r.uniform(-10, 330), r.uniform(-10, 190), r.choice([1, 1, 1.5, 1.5, 2, 2.5])
        lid = nid()
        L.append({"type": "Rect", "id": lid, "name": "Snowflake", "blendMode": "normal",
                  "activeRange": B.rng_ms(0, DUR), "transform": tr((x0 * S, y0 * S)),
                  "rect": {"size": [sz * S, sz * S], "fillColor": [0.97, 0.98, 1.0, 1]}})
        sp = r.uniform(12, 20) * (0.7 + sz * 0.3)
        ph = r.uniform(0, 6.28)
        anim(lid, "positionX", "var u=input.time.seconds;return ((%f+Math.sin(u*0.9+%f)*4+u*3)%%340-10)*%d;" % (x0, ph, S))
        anim(lid, "positionY", "var u=input.time.seconds;var y=%f+%f*u;return ((y+10)%%200-10)*%d;" % (y0, sp, S))
    gid = nid()
    g = group("Snow (in winter; the first flakes after the seed goes in)", L, gid=gid)
    anim(gid, "opacity", "var t=input.time.seconds;var f=fr(Y(t));var o=ss(9.0,11.0,t)*(1-ss(12,13.5,t))*0.6;return 100*Math.max(o,tf(SF,f));",
         H_Y + ftab_js("SF", snowing_f))
    return g


# ----------------------------------------------------------------------------------- people
def make_people():
    """Returns (far meadow, path + benches, mid meadow) layer lists. In the time-lapse people appear
    and vanish like ghosts in a long exposure: each walks a stretch for a second or so (season-dressed)
    rather than crossing the whole frame across several seasons."""
    P = PP.People(B)
    P.WJS = W_JS
    pal = PP.pal
    HAIR, SKIN, TOPS, BOTS, SHOES = PP.HAIR, PP.SKIN, PP.TOPS, PP.BOTS, PP.SHOES
    WALK_A, WALK_B, RUN_A, RUN_B = PP.WALK_A, PP.WALK_B, PP.RUN_A, PP.RUN_B
    KID_RUN, KID_PASS, KID_JUMP, KID_KICK = PP.KID_RUN, PP.KID_PASS, PP.KID_JUMP, PP.KID_KICK
    SIT_A, SIT_B = PP.SIT_A, PP.SIT_B
    rnd = random.Random(1907)
    far, path, mid = [], [], []
    SEAT = PATH_Y[0] + 1.0          # sitters' feet
    LANES = (118.6, 119.6, 120.6, 121.6)

    def add(lst, g, lane):
        if g:
            g["_lane"] = lane
            g.pop("_y", None)
            lst.append(g)

    GSIT_A = ["..HHH...", "..HSS...", "..HSS...", "..TNNN..", "..TNnN..", "..TTT...", "..BBLLLF"]
    GSIT_B = ["..HHH...", "..HSS...", "..HSS...", "..TNnN..", "..TNNN..", "..TTT...", "..BBLLLF"]
    GSIT_C = ["..HHH...", "..HSS...", "..HSS...", "..TTT...", "..TTTS..", "..TTT...", "..BBLLLF"]
    LIE = ["HSSTTTTBBLLF.", "QQQQQQQQQQQQQ"]
    LIE_B = ["HSSTTTSBBLLF.", "QQQQQQQQQQQQQ"]
    KITE = ["..R..", ".RYR.", "RYYYR", ".RYR.", "..R..", "..Q..", ".Q...", "..Q..", "...Q."]
    SNOW1 = ["..WWWW..", ".WWWWWW.", "WWWWWWWw", "WWWWWWww", ".wwwwww."]
    SNOW2 = ["...WW...", "..WWWw..", "..WWWw..", "...ww...", "..WWWW..", ".WWWWWW.", "WWWWWWWw", "WWWWWWww", ".wwwwww."]
    SNOW3 = ["...KK...", "..KKKK..", "..WWWw..", "..WKWKOO", "..WWWw..", "..RRRR..", ".WWKWWw.", ".WWWWWw.", "WWWWKWWw", "WWWWWWww", ".wwwwww."]

    def stroller(walk):
        rows = PP.widen(walk, 15)
        for rr_, line in enumerate([".PPPPP", "PPPPPP", "PPPPPP", ".PPPPP", ".K..K."]):
            for c, ch in enumerate(line):
                if ch != ".":
                    rows = PP.put(rows, 8 + c, 8 + rr_, ch)
        rows = PP.put(rows, 6, 7, "S")
        return PP.put(rows, 7, 7, "S")

    def coat_kid(rows):
        return [r_.replace("B", "T") for r_ in rows]

    def win_t(y0, y1):
        return tY(y0), tY(y1)

    def ghost(kind, y_at, dur=1.3, p=None, winter=False, name=None, d=None, x0=None, lane=None):
        """A passer-by on the path for a stretch of real time (a ghost in the time-lapse)."""
        d = d or rnd.choice([1, -1])
        lane = lane or rnd.choice(LANES)
        sp = {"walk": 26, "run": 62, "dog": 22, "pram": 20}[kind] * rnd.uniform(0.9, 1.1)
        x0 = x0 if x0 is not None else rnd.uniform(30, 290) - d * sp * dur / 2
        p = dict(p or pal(rnd.choice(HAIR), rnd.choice(SKIN), rnd.choice(TOPS), rnd.choice(BOTS), F=rnd.choice(SHOES)))
        p.setdefault("P", (0.24, 0.30, 0.46))
        if kind == "run":
            fr_, rate = [RUN_A, RUN_B], 10
            if not winter:
                p["L"] = p["S"]
        elif kind == "dog":
            fr_, rate = [PP.dog_walker(WALK_A, PP.DOG_A, (6, 7)), PP.dog_walker(WALK_B, PP.DOG_B, (3, 7))], 6
        elif kind == "pram":
            fr_, rate = [stroller(WALK_A), stroller(WALK_B)], 5
        else:
            fr_, rate = [WALK_A, WALK_B], 6
            if rnd.random() < 0.4:
                fr_ = [PP.long_hair(f) for f in fr_]
        if winter:
            fr_ = [PP.coat(f) for f in fr_]
        t0 = tY(y_at)
        bob = "-f" if kind == "run" else ""
        brain = "function st(t){var u=t-%f;var f=wf(t,%f);return[%f+%f*u,%f%s,%d,f];}" % (t0, rate, x0, d * sp, lane, bob, d)
        add(path, P.character(name or "Passer-by (%s, year %.2f)" % (kind, y_at), fr_, p, brain, t0, t0 + dur,
                              ox=3.5 if kind in ("dog", "pram") else None), lane)

    def pop(lst, name, frames, p, x, y, y0, y1, rate=2.5, d=1, ox=None, shadow=True):
        t0, t1 = win_t(y0, y1)
        brain = "function st(t){return[%f,%f,%d,Math.floor(t*%f)%%%d];}" % (x, y, d, rate, len(frames))
        add(lst, P.character(name, frames, p, brain, t0, t1, ox=ox, shadow=shadow), y)

    yellow_kid = pal(HAIR[1], SKIN[0], (0.98, 0.82, 0.18), (0.25, 0.35, 0.60), F=(0.85, 0.18, 0.15))
    parent = pal(HAIR[0], SKIN[0], (0.36, 0.40, 0.62), (0.20, 0.20, 0.24))
    partnerA = pal(HAIR[1], SKIN[1], (0.20, 0.62, 0.62), (0.18, 0.22, 0.38))
    partnerB = pal(HAIR[2], SKIN[0], (0.95, 0.45, 0.42), (0.95, 0.45, 0.42), L=SKIN[0])
    coats = [(0.35, 0.20, 0.30), (0.22, 0.26, 0.40), (0.50, 0.26, 0.22), (0.25, 0.25, 0.28), (0.30, 0.36, 0.30)]

    # ---------------- opening (late November, real time)
    wpal = pal((0.20, 0.50, 0.55), SKIN[1], (0.35, 0.20, 0.30), (0.18, 0.16, 0.20))
    add(path, P.character("Bundled-up walker (opening)", [PP.coat(WALK_A), PP.coat(WALK_B)], wpal,
                          "function st(t){return[250-7*t,119.6,-1,wf(t,5)];}", 0.0, 11.0), 119.6)
    dpal = pal(HAIR[4], SKIN[0], (0.50, 0.26, 0.22), (0.25, 0.22, 0.20), F=SHOES[2])
    add(path, P.character("Dog walker (opening)", [PP.coat(PP.dog_walker(WALK_A, PP.DOG_A, (6, 7))), PP.coat(PP.dog_walker(WALK_B, PP.DOG_B, (3, 7)))], dpal,
                          "function st(t){return[-14+6.5*(t-2.0),121.6,1,wf(t,5)];}", 2.0, 11.0, ox=3.5), 121.6)

    # ---------------- the years
    def ok(y):
        return y < Y_END - 0.06 and tY(y) > tY(0.03)

    for yr in range(7):
        def Yw(f):
            return yr + f
        for k in range(2):          # winter: coats
            y = Yw(0.08 + 0.09 * k + rnd.uniform(0, 0.03))
            if ok(y):
                ghost(rnd.choice(["walk", "dog", "walk", "run"]), y, winter=True,
                      p=pal(rnd.choice(HAIR), rnd.choice(SKIN), rnd.choice(coats), (0.18, 0.16, 0.20), F=SHOES[0]))
        if yr in (1, 4):            # snowmen
            x, y = (238 if yr == 1 else 196), 142
            spal = pal(0, 0, 0, 0, W=(0.96, 0.97, 1.0), w=(0.78, 0.83, 0.93), K=(0.12, 0.12, 0.14), O=(0.98, 0.55, 0.15), R=(0.86, 0.16, 0.16))
            t0, t1 = win_t(Yw(0.09), Yw(0.31))
            tb1, tb2 = tY(Yw(0.12)), tY(Yw(0.15))
            tm0, tm1 = tY(Yw(0.25)), tY(Yw(0.30))
            g = P.character("Snowman (year %d)" % yr, [SNOW1, SNOW2, SNOW3], spal,
                            "function st(t){var fr=t<%f?0:(t<%f?1:2);return[%f,%f,1,fr];}" % (tb1, tb2, x, y), t0, t1, ox=4, shadow=False)
            B.anim(g["id"], "scaleY", "var t=input.time.seconds+%f;return 100*(1-0.85*ss(%f,%f,t));" % (t0, tm0, tm1), BASE_JS)
            add(mid, g, y)
            kid1 = dict(yellow_kid if yr == 1 else pal((0.86, 0.16, 0.16), SKIN[2], (0.30, 0.38, 0.70), (0.20, 0.22, 0.30)))
            kid1["B"] = kid1["T"]
            pop(mid, "Kid building a snowman (year %d)" % yr, [coat_kid(KID_KICK), coat_kid(KID_PASS)], kid1, x - 8, y, Yw(0.09), Yw(0.17), rate=3)
            pop(mid, "Second kid (snowman, year %d)" % yr, [KID_PASS, KID_KICK], pal((0.30, 0.70, 0.40), SKIN[1], (0.80, 0.30, 0.50), (0.20, 0.20, 0.25)),
                x + 8, y + 1, Yw(0.11), Yw(0.17), rate=2.5, d=-1)
        for k in range(2):          # spring
            y = Yw(0.33 + 0.06 * k + rnd.uniform(0, 0.02))
            if ok(y):
                ghost("run" if k == 0 else "walk", y)
        if yr in (2, 5):            # kites
            flyer = pal(HAIR[3], SKIN[2], (0.30, 0.55, 0.85), (0.20, 0.22, 0.38)) if yr == 2 else dict(yellow_kid, B=(0.20, 0.22, 0.38), L=(0.20, 0.22, 0.38))
            fx, fy = 262, 146
            pop(mid, "Kite flyer (year %d)" % yr, [PP.HUG], flyer, fx, fy, Yw(0.34), Yw(0.47), rate=1, d=-1)
            t0, t1 = win_t(Yw(0.34), Yw(0.47))
            kx, ky = 218, 52
            kpal = pal(0, 0, 0, 0, R=(0.90, 0.22, 0.22), Y=(0.99, 0.84, 0.25), Q=(0.95, 0.95, 0.92))
            add(mid, P.character("Kite (year %d)" % yr, [KITE], kpal, "function st(t){return[%f+5*Math.sin(t*1.3)+2*Math.sin(t*3.1),%f+3*Math.sin(t*1.7),1,0];}" % (kx, ky),
                                 t0, t1, ox=2.5, shadow=False), 40)
            sid = nid()
            hand = (fx - 4.0, fy - 8.0)
            mid.append({"type": "Rect", "id": sid, "name": "Kite string", "blendMode": "normal", "_lane": 41,
                        "activeRange": B.rng_ms(t0, t1 - t0), "transform": tr((hand[0] * S, hand[1] * S), (0, 0.2 * S), op=70),
                        "rect": {"size": [1 * S, 0.4 * S], "fillColor": [0.95, 0.95, 0.92, 1]}})
            kc = ("var t=input.time.seconds+%f;var kx=%f+5*Math.sin(t*1.3)+2*Math.sin(t*3.1);var ky=%f+3*Math.sin(t*1.7)+4;"
                  "var dx=kx-%f;var dy=ky-%f;" % (t0, kx, ky, hand[0], hand[1]))
            B.anim(sid, "rotation", kc + "return Math.atan2(dy,dx)*57.2958;")
            B.anim(sid, "scaleX", kc + "return Math.sqrt(dx*dx+dy*dy)*100;")
        for k in range(4):          # summer
            y = Yw(0.48 + 0.07 * k + rnd.uniform(0, 0.03))
            if ok(y):
                ghost(["run", "walk", "dog", "walk"][k], y)
        for k in range(3):          # sunbathers on the far meadow (Sheep Meadow!)
            a0 = Yw(0.50 + 0.06 * k + rnd.uniform(0, 0.03))
            if ok(a0):
                lp = pal(rnd.choice(HAIR), rnd.choice(SKIN), rnd.choice(TOPS), rnd.choice(BOTS),
                         Q=rnd.choice([(0.78, 0.42, 0.40), (0.36, 0.50, 0.72), (0.80, 0.72, 0.42), (0.86, 0.86, 0.82)]))
                lp["L"] = lp["S"]
                pop(far, "Sunbather", [LIE, LIE_B], lp, rnd.uniform(140, 310), rnd.choice([106.5, 109, 111.5]), a0, a0 + rnd.uniform(0.14, 0.2), rate=0.7, ox=6)
        if yr in (1, 3, 6):         # kids chasing each other
            t0, t1 = win_t(Yw(0.55), Yw(0.68))
            for name, ph, col in (("Kid A (chased)", 0.0, pal(HAIR[2], SKIN[3], (0.30, 0.75, 0.35), (0.25, 0.40, 0.80), L=SKIN[3], F=(0.85, 0.2, 0.2))),
                                  ("Kid B (chasing)", -0.9, pal(HAIR[0], SKIN[2], (0.98, 0.60, 0.20), (0.30, 0.38, 0.60), L=SKIN[2], F=SHOES[1]))):
                brain = ("function st(t){var a=1.6*t+%f;var x=238+30*Math.cos(a);var y=140+5*Math.sin(a);"
                         "var d=Math.sin(a)>0?-1:1;var f=wf(t,9);return[x,y-f*0.6,d,f];}") % ph
                add(mid, P.character(name + " (year %d)" % yr, [KID_RUN, KID_PASS], col, brain, t0, t1), 140 + (0.1 if ph else 0))
        if yr in (2, 4):            # a kid and a ball
            kc_ = yellow_kid if yr == 2 else pal(HAIR[1], SKIN[1], (0.35, 0.55, 0.95), (0.95, 0.95, 0.92), L=SKIN[1])
            t0, t1 = win_t(Yw(0.56), Yw(0.72))
            kick = "function per(w){var n=Math.floor(w/1.6);var u=w-1.6*n;var ev=(n%2==0);return{u:u,xk:ev?186:228,d:ev?1:-1};}"
            kb = kick + ("function st(t){var p=per(t);var s0=p.xk-2.5*p.d;if(p.u<0.3)return[s0,148,p.d,2];"
                         "var x=s0+p.d*45*(1-Math.exp(-2.2*(p.u-0.3)));if(p.u>1.3)return[x,148,p.d,1];return[x,148,p.d,wf(t,9)];}")
            add(mid, P.character("Kid with a ball (year %d)" % yr, [KID_RUN, KID_PASS, KID_KICK], kc_, kb, t0, t1), 148)
            bb = kick + ("function st(t){var p=per(t);var x=p.xk+p.d*40*(1-Math.exp(-3.0*p.u));"
                         "var y=148-Math.abs(Math.sin(p.u*8))*3.5*Math.exp(-2.4*p.u);return[x+p.d*1.5,y,1,0];}")
            add(mid, P.character("Ball (year %d)" % yr, [PP.BALL], pal(0, 0, 0, 0, W=(0.97, 0.97, 0.95), K=(0.2, 0.2, 0.25)), bb, t0, t1, ox=1, shadow=False), 148.5)
        if yr in (3, 5):            # picnic
            a0, a1 = Yw(0.58), Yw(0.72)
            t0, t1 = win_t(a0, a1)
            bl = nid()
            mid.append({"type": "Rect", "id": bl, "name": "Picnic blanket", "blendMode": "normal", "_lane": 133.9,
                        "activeRange": B.rng_ms(t0, t1 - t0), "transform": tr((192 * S, 132.5 * S)),
                        "rect": {"size": [22 * S, 2 * S], "fillColor": [0.86, 0.22, 0.24, 1]}})
            pop(mid, "Picnic: one", [GSIT_C, GSIT_C], partnerA if yr == 5 else pal(HAIR[3], SKIN[2], (0.98, 0.82, 0.22), (0.30, 0.38, 0.60)), 197, 134, a0, a1, rate=1)
            pop(mid, "Picnic: two", [GSIT_A, GSIT_B], partnerB if yr == 5 else pal(HAIR[0], SKIN[1], (0.55, 0.30, 0.65), (0.20, 0.20, 0.22)), 208, 134, a0, a1, rate=0.8, d=-1)
        for k in range(3):          # autumn
            y = Yw(0.79 + 0.05 * k + rnd.uniform(0, 0.02))
            if ok(y):
                ghost(["run", "walk", "dog"][k], y,
                      p=pal((0.55, 0.57, 0.60), rnd.choice(SKIN), rnd.choice([(0.55, 0.57, 0.60), (0.60, 0.30, 0.20), (0.30, 0.34, 0.26)]), (0.20, 0.20, 0.24), F=SHOES[1]))
        for k, (fa, fb) in enumerate(((0.36, 0.48), (0.52, 0.66), (0.80, 0.90))):   # bench sitters
            if rnd.random() < 0.65 and ok(Yw(fa)):
                bx = rnd.choice(BENCHES) + rnd.uniform(4, 13)
                pop(path, "Bench sitter", [SIT_A, SIT_B], pal(rnd.choice(HAIR), rnd.choice(SKIN), rnd.choice(TOPS), rnd.choice(BOTS)),
                    bx, SEAT, Yw(fa), Yw(fb), rate=0.6, d=rnd.choice([1, -1]))

    # ---------------- the stories
    # the yellow-raincoat kid: walks by with a parent the first summer (and looks at the sapling)...
    ghost("walk", 1.52, dur=1.6, p=parent, name="Parent (year 1)", d=1, x0=50, lane=121.6)
    t0 = tY(1.52)
    add(path, P.character("Yellow-raincoat kid with the parent (year 1)", [KID_PASS, KID_RUN], yellow_kid,
                          "function st(t){var u=t-%f;return[%f+%f*u,121.9,1,wf(t,7)];}" % (t0, 57, 26 * 1.0), t0, t0 + 1.6), 121.9)
    # the couple: meet on a bench (year 1 autumn), together (year 2 summer), walking together (year 4)
    pop(path, "Couple A (alone, bench)", [SIT_A, SIT_B], partnerA, BENCHES[1] + 4, SEAT, 1.80, 1.92, rate=0.6)
    pop(path, "Couple B (alone, other end)", [PP.long_hair(SIT_A), PP.long_hair(SIT_B)], partnerB, BENCHES[1] + 14, SEAT, 1.81, 1.92, rate=0.7, d=-1)
    pop(path, "Couple A (together)", [SIT_A, SIT_B], partnerA, BENCHES[0] + 7, SEAT, 2.52, 2.68, rate=0.6)
    pop(path, "Couple B (together)", [PP.long_hair(SIT_A), PP.long_hair(SIT_B)], partnerB, BENCHES[0] + 11, SEAT, 2.52, 2.68, rate=0.7, d=-1)
    t0, t1 = win_t(2.56, 2.64)
    add(path, P.character("Heart", [PP.HEART], pal(0, 0, 0, 0, R=(0.95, 0.25, 0.35)),
                          "function st(t){return[%f,%f-(t-%f)*5,1,0];}" % (BENCHES[0] + 8.5, PATH_Y[0] - 16, t0), t0, t1, ox=0, shadow=False), 100)
    ghost("walk", 4.38, dur=1.8, p=partnerA, name="Couple A walking (year 4)", d=1, x0=150, lane=120.6)
    t0 = tY(4.38)
    add(path, P.character("Couple B walking (year 4)", [PP.long_hair(WALK_A), PP.long_hair(WALK_B)], partnerB,
                          "function st(t){var u=t-%f;return[%f+%f*u,120.5,1,wf(t+0.07,6)];}" % (t0, 156.5, 26), t0, t0 + 1.8), 120.5)
    # year 3 autumn: the yellow kid jumps into a leaf pile on the meadow
    t0, t1 = win_t(3.86, 3.98)
    px_ = 170
    brain = ("function st(t){var u=(t-%f)/(%f);if(u<0.35)return[%f+40*u,146,1,wf(t,9)];if(u<0.55){var v=(u-0.35)/0.2;return[%f+14*v,146-7*Math.sin(Math.PI*v),1,2];}"
             "return[%f,146,1,wf(t,4)];}" % (t0, t1 - t0, px_ - 30, px_ - 16, px_ - 2))
    add(mid, P.character("Yellow kid: leaf jump (year 3)", [KID_RUN, KID_PASS, KID_JUMP], yellow_kid, brain, t0, t1), 146)
    pile = []
    r2 = random.Random(5)
    for tone, polys in (("light", [[(x + r2.uniform(-6, 5), y - r2.uniform(0.5, 3.5)) for (x, y) in [(0, 0), (1, 0), (1, 1), (0, 1)]] for _ in range(12)]),
                        ("mid", [[(-7, 0), (-5.5, -2.5), (-2, -3.6), (2, -3.6), (5, -2.4), (7, 0)]]), ("dark", [[(-9, 0.5), (-7, -2), (-3, -4.2), (2, -4.5), (6, -3), (9, 0.5)]])):
        pile.append(shape("Leaf pile %s" % tone, polys, B.ramp_py(tone, 0.85 if tone != "light" else 0.5), dur=t1 - t0 + 0.6))
    pg = B.group("Leaf pile (year 3)", pile, start=t0 - 0.3, dur=t1 - t0 + 0.6, transform=tr(((px_ - 2) * S, 147.5 * S)))
    pg["_lane"] = 146.5
    mid.append(pg)

    # ---------------- the end (real time, an October afternoon)
    pA = dict(partnerA, P=(0.24, 0.30, 0.46))
    add(path, P.character("Couple A with a pram (end)", [stroller(WALK_A), stroller(WALK_B)], pA,
                          "function st(t){return[%f-7*(t-44.0),121.6,-1,wf(t,4)];}" % 300, 44.0, DUR, ox=3.5), 121.6)
    add(path, P.character("Couple B beside the pram (end)", [PP.long_hair(WALK_A), PP.long_hair(WALK_B)], dict(partnerB),
                          "function st(t){return[%f-7*(t-44.0),120.4,-1,wf(t+0.1,4)];}" % 309, 44.0, DUR), 120.4)
    reader = dict(yellow_kid, B=(0.25, 0.35, 0.60), L=(0.25, 0.35, 0.60))
    add(path, P.character("The yellow-raincoat kid, grown up, reading on the bench (end)", [SIT_A, SIT_B], reader,
                          "function st(t){return[%f,%f,1,Math.floor(t/2.6)%%2];}" % (BENCHES[0] + 6, SEAT), tY(Y_END - 0.004), DUR, shadow=False), SEAT)
    add(path, P.character("Dog walker (end)", [PP.dog_walker(WALK_A, PP.DOG_A, (6, 7)), PP.dog_walker(WALK_B, PP.DOG_B, (3, 7))],
                          pal(HAIR[4], SKIN[1], (0.70, 0.40, 0.20), (0.30, 0.28, 0.25), F=SHOES[2]),
                          "function st(t){return[-16+6*(t-45.0),119.6,1,wf(t,5)];}", 45.0, DUR, ox=3.5), 119.6)
    add(path, P.character("Runner in a hoodie (end)", [RUN_A, RUN_B], pal((0.55, 0.57, 0.60), SKIN[2], (0.55, 0.57, 0.60), (0.20, 0.20, 0.24), F=SHOES[1]),
                          "function st(t){var f=wf(t,10);return[336-28*(t-47.0),118.6-f,-1,f];}", 47.0, 47.0 + 360 / 28.0), 118.6)
    for name, ph, col in (("Kid chasing leaves A (end)", 0.0, pal(HAIR[2], SKIN[3], (0.85, 0.30, 0.30), (0.25, 0.40, 0.80), F=(0.2, 0.2, 0.2))),
                          ("Kid chasing leaves B (end)", -1.1, pal(HAIR[0], SKIN[2], (0.40, 0.70, 0.90), (0.30, 0.38, 0.60), F=SHOES[1]))):
        brain = ("function st(t){var a=0.75*t+%f;var x=244+28*Math.cos(a);var y=142+5*Math.sin(a);"
                 "var d=Math.sin(a)>0?-1:1;var f=wf(t,8);return[x,y-f*0.6,d,f];}") % ph
        add(mid, P.character(name, [KID_RUN, KID_PASS], col, brain, tY(Y_END - 0.004), DUR), 142 + (0.1 if ph else 0))

    def order(lst):
        lst = sorted(lst, key=lambda g: -g.get("_lane", 0))
        for g in lst:
            g.pop("_lane", None)
        return lst
    return order(far), order(path), order(mid)


# ----------------------------------------------------------------------------------- lights
def build_emissive(win_lit, beacons):
    H = BASE_JS + PH_JS
    wid = nid()
    win = rects("Lit windows", win_lit, (1.0, 0.95, 0.62, 1), lid=wid)
    anim(wid, "opacity", "var t=input.time.seconds;var n=1-dayL(t);return 100*ss(0.25,0.75,n)*(0.85+0.15*Math.sin(t*37));", H)
    bid = nid()
    bea = rects("Aircraft beacons", beacons, (1.0, 0.25, 0.20, 1), lid=bid)
    anim(bid, "opacity", "var t=input.time.seconds;var n=1-dayL(t);return 100*ss(0.3,0.7,n)*(Math.sin(t*5)>0?1:0.2);", H)
    lamps, glows = [], []
    for lx in LAMPS:
        top = PATH_Y[0] - 19
        lamps.append((lx - 1, top + 1.4, 2, 2.6))
        glows.append(B.circle_poly(lx, top + 2.5, 4.5, 10))
    lid, gl = nid(), nid()
    lamp = rects("Lamp lights", lamps, (1.0, 0.88, 0.55, 1), lid=lid)
    glow = shape("Lamp glow", glows, (1.0, 0.75, 0.40, 1), lid=gl, op=0)
    code = "var t=input.time.seconds;var n=1-dayL(t);return %s*ss(0.3,0.7,n);"
    anim(lid, "opacity", code % "100", H)
    anim(gl, "opacity", code % "28", H)
    return [camera_group("Emissive: tower windows + beacons (k=%.2f)" % K_SKY, K_SKY, [bea, win]),
            camera_group("Emissive: lamps (k=%.2f)" % K_PATH, K_PATH, [lamp, glow])]


# ----------------------------------------------------------------------------------- title (as the intro's)
B.FONT[","] = ["00", "00", "00", "00", "00", "01", "10"]
TITLE_IN = 51.6
SUB_IN = (53.4, 54.3)
SUB = ["FROM THE LAST LEAF IN THE CITY,", "A TREE IN CENTRAL PARK."]


def build_title():
    L = []
    title = "FAR FROM THE TREE"
    px = 2
    w = B.text_width(title, px, True)
    glyphs, _ = B.text_boxes(title, int(160 - w / 2), 14, px, True)
    k = 0
    for ch, boxes in glyphs:
        if not boxes:
            continue
        shadow = [(bx + dx, by + dy, bw, bh) for (bx, by, bw, bh) in boxes for (dx, dy) in ((-1, 0), (1, 0), (0, -1), (0, 1), (1, 2), (2, 2))]
        lid = nid()
        L.append(group("Title letter %s" % ch, [rects("Glyph", boxes, (0.99, 0.95, 0.86, 1)),
                                                 rects("Glyph outline", shadow, (0.13, 0.12, 0.20, 1))], gid=lid))
        ts = TITLE_IN + k * 0.07
        k += 1
        keys(lid, "opacity", [(0, 0, "hold"), (ts, 0, "hold"), (ts + 0.07, 45, "hold"), (ts + 0.14, 100, "hold")])
        keys(lid, "positionY", [(0, -S, "hold"), (ts, -S, "hold"), (ts + 0.14, 0, "hold")])
    for li, line in enumerate(SUB):
        w = B.text_width(line, 1)
        glyphs, _ = B.text_boxes(line, int(160 - w / 2), 150 + li * 10, 1)
        boxes = [b for _, bx in glyphs for b in bx]
        shadow = [(bx + 1, by + 1, bw, bh) for (bx, by, bw, bh) in boxes]
        lid = nid()
        L.append(group("Closing line %d" % (li + 1), [rects("Text", boxes, (0.96, 0.94, 0.90, 1)), rects("Shadow", shadow, (0.08, 0.10, 0.16, 1), op=85)], gid=lid))
        ts = SUB_IN[li]
        keys(lid, "opacity", [(0, 0, "hold"), (ts, 0, "hold"), (ts + 0.1, 35, "hold"), (ts + 0.2, 70, "hold"), (ts + 0.3, 100, "hold")])
    return group("Title card", L, desc="The intro's pixel title (5x7 font): name across the top, the closing line small at the bottom.")


# ----------------------------------------------------------------------------------- assemble
def build():
    skyline, lit, beacons = build_skyline()
    treeline = build_treeline()
    far_lawn = lawn_band("Far meadow", FAR_Y, 1.0, [104, 107, 110, 113], 120, (1, 3), 5)
    mid_lawn = lawn_band("Meadow", MID_Y, 0.4, [125, 128, 132, 136, 141, 146], 150, (1, 4), 6)
    front_lawn = lawn_band("Foreground lawn", FRONT_Y, 0.0, [152, 156, 161, 166, 171, 177, 183], 120, (3, 8), 7)
    path_l = build_path()
    stages, litter = build_tree()
    opening, soil = build_opening()
    falling = build_falling_leaves()
    letgo = build_letgo()
    streaks = build_streaks()
    p_far, p_path, p_mid = make_people()
    snow = build_snow()
    emissive = build_emissive(lit, beacons)

    grade_id = nid()
    world = group("World (graded by time of day and season)", [
        camera_group("Wind streaks (k=1)", 1.0, streaks),
        camera_group("The leaf that lets go (k=1)", 1.0, letgo),
        camera_group("Opening: the last leaf and its seed (k=1)", 1.0, opening),
        camera_group("Falling leaves (k=1)", 1.0, falling),
        camera_group("The tree (k=1, foreground)", 1.0, stages[::-1] + [soil] + litter, desc="Sprout -> staked sapling -> young tree -> big tree."),
        camera_group("Foreground lawn (k=1)", 1.0, front_lawn),
        camera_group("Meadow: kids, kites, snowmen (k=%.2f)" % K_MID, K_MID, p_mid + mid_lawn),
        emissive[1],
        camera_group("Path: walkers, runners, dogs, benches, the couple (k=%.2f)" % K_PATH, K_PATH, p_path + path_l),
        camera_group("Far meadow: sunbathers (k=%.2f)" % K_FAR, K_FAR, p_far + far_lawn),
        camera_group("Park trees at the meadow's edge (k=%.2f)" % K_TREES, K_TREES, treeline),
        emissive[0],
        camera_group("Central Park South (k=%.2f)" % K_SKY, K_SKY, skyline),
    ], effects=[{"id": grade_id, "effect": {"type": "customShader", "name": "dayGrade",
                                           "description": "Time-of-day light and winter cold.",
                                           "wgsl": B.GRADE, "params": [
                                               {"name": "tint.colorR", "description": "Light tint red", "min": 0, "max": 1.5, "default": 1},
                                               {"name": "tint.colorG", "description": "Light tint green", "min": 0, "max": 1.5, "default": 1},
                                               {"name": "tint.colorB", "description": "Light tint blue", "min": 0, "max": 1.5, "default": 1},
                                               {"name": "desat", "description": "Desaturation 0..1 (cold)", "min": 0, "max": 1, "default": 0}]}}])
    H = H_ALL + ftab_js("CO", cold_f) + "function cold(t){return tf(CO,fr(Y(t)));}"
    # (nights in the time-lapse are a passing dimming, not black)
    tint_js = ("var t=input.time.seconds;var e=sunE(t);var d=ss(-0.34,0.08,e);var g=d*(1-ss(0.0,0.36,e+0.08));var c=cold(t);"
               "var night=[0.40,0.44,0.62];var gold=[1.08,0.86,0.66];var cool=[0.92,0.95,1.0];"
               "var v=night[%d]+(1-night[%d])*d;v=v*(1+(gold[%d]-1)*g*(1-0.7*c));v=v*(1+(cool[%d]-1)*c);return v;")
    for i, ch in enumerate("RGB"):
        anim_fx(grade_id, "tint.color" + ch, tint_js % (i, i, i, i), H)
    anim_fx(grade_id, "desat", "return 0.12+0.24*cold(input.time.seconds);", H)

    sky_id, sky_fx = nid(), nid()
    sky = {"type": "Rect", "id": sky_id, "name": "Sky (procedural)", "blendMode": "normal", "activeRange": B.rng_ms(0, DUR),
           "transform": tr(), "rect": {"size": [1920, 1080], "fillColor": [0.4, 0.6, 0.9, 1]},
           "effects": [{"id": sky_fx, "effect": {"type": "customShader", "name": "pixelSky",
                                                 "description": "The intro's pixel sky: day/night, sun and moon arcs, dusk glow, stars, dithered clouds.",
                                                 "wgsl": B.SKY, "params": [
                                                     {"name": "animationTime", "description": "Engine clock (s)", "min": 0, "max": 3600, "default": 0},
                                                     {"name": "phase", "description": "Time of day (0.5 = noon), wraps", "min": 0, "max": 1000, "default": 0.5},
                                                     {"name": "cloudShift", "description": "Cloud drift in art pixels", "min": 0, "max": 1000, "default": 0},
                                                     {"name": "cold", "description": "Pale overcast sky 0..1", "min": 0, "max": 1, "default": 0},
                                                     {"name": "cover", "description": "Cloud cover 0..1", "min": 0, "max": 1, "default": 0.4}]}}]}
    anim_fx(sky_fx, "phase", "return phase(input.time.seconds);", BASE_JS + PH_JS)
    anim_fx(sky_fx, "cloudShift", "return cloud(input.time.seconds);", BASE_JS + CL_JS)
    anim_fx(sky_fx, "cold", "return cold(input.time.seconds);", H)
    anim_fx(sky_fx, "cover", "var t=input.time.seconds;return 0.46+0.12*cold(t)+0.04*Math.sin(t*0.7);", H)

    pix_id = nid()
    # (the lights sit in the depth stack, just above their own planes, so the tree hides them)
    scene = group("Scene (pixel art)", [snow, world, sky],
                  effects=[{"id": pix_id, "effect": {"type": "customShader", "name": "pixelate",
                                                     "description": "Snaps the frame to the 320x180 art-pixel grid with medoid sampling and limited colour levels.",
                                                     "wgsl": B.PIXELATE, "params": [
                                                         {"name": "block", "description": "Art pixel size in canvas px", "min": 1, "max": 32, "default": S},
                                                         {"name": "levels", "description": "Colour levels per channel", "min": 2, "max": 64, "default": 18}]}}])
    doc = {"$schema": "https://jerboa.dev/schemas/fx-composition/editable/v1/document.schema.json", "formatVersion": 1,
           "dimensions": {"width": 1920, "height": 1080}, "duration": DUR,
           "composition": {"id": "main", "name": "Far From the Tree - ending", "layers": [build_title(), scene],
                           "dynamics": {"entries": B.ENTRIES}}}
    return doc


if __name__ == "__main__":
    doc = build()
    os.makedirs(WORK, exist_ok=True)
    s = json.dumps(doc, indent=None)
    open(os.path.join(WORK, "ending.json"), "w").write(s)
    print("years %.3f (peak %.3f y/s)  days in lapse ~%.0f (peak %.2f d/s)  entries %d  json %.1f MB"
          % (Y_END, Y_PEAK, PH_PEAK * at(LINT, DUR), PH_PEAK, len(B.ENTRIES), len(s) / 1e6))
    for y in range(7):
        print("  year %d starts at t=%.2f s" % (y, tY(y)))
