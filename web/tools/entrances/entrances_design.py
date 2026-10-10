"""Far From the Tree - subway entrance, stairwell and air-vent textures, as editable Tesseract compositions.

Imported by build_entrances.py (system Python, no dependencies). Reuses the Doc helpers and a few
painters from ../subway/subway_design.py so both sets of art share one hand. Three documents:

  atlas/EntranceAtlas.tsrct 2048x2048  everything entrances.glb and the stairwell trim sample (named rects below)
  atlas/StairWall.tsrct      512x1280  stair / passage wall: 2 m across, 5 m up from 0.6 m below the stair line
  atlas/Grate.tsrct          512x512   1 m of heavy bar grating (bars light on black: the build keys black to alpha)

All text and branding is invented: no real transit marks.
"""
import json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "subway"))
import subway_design as sd  # noqa: E402
from subway_design import Doc, mul, mix, BLACK, WHITE, YEL, doc  # noqa: E402

AW = AH = 2048

# --------------------------------------------------------------------------------- atlas layout
R = {
    # cast iron, stone, steel
    "iron_green": (0, 0, 256, 256),
    "iron_panel": (256, 0, 256, 256),
    "iron_dark": (512, 0, 256, 256),
    "verdigris": (768, 0, 256, 256),
    "limestone": (1024, 0, 512, 256),
    "granite": (1536, 0, 256, 256),
    "granite_dark": (1792, 0, 256, 256),
    "steel_brushed": (0, 256, 256, 256),
    "steel_galv": (256, 256, 256, 256),
    "diamond_plate": (512, 256, 256, 256),
    "hazard": (768, 256, 256, 128),
    "hazard_red": (768, 384, 256, 128),
    "concrete_shaft": (1024, 256, 256, 256),
    "ceiling_paint": (1280, 256, 256, 256),
    "tread": (1536, 256, 512, 128),
    "riser": (1536, 384, 512, 128),
    # stairwell trim, vents
    "stringer": (0, 512, 512, 128),
    "cables": (0, 640, 512, 128),
    "louver": (512, 512, 256, 256),
    "fan_blade": (768, 512, 256, 128),
    "fan_hub": (768, 640, 128, 128),
    "fan_guard": (896, 640, 128, 128),
    "warn_in": (1024, 512, 512, 256),
    "warn_out": (1536, 512, 512, 256),
    # signs
    "sign_subway": (0, 768, 1024, 192),
    "sign_exit": (1024, 768, 1024, 192),
    "cartouche_in": (0, 960, 512, 256),
    "cartouche_out": (512, 960, 512, 256),
    "lintel_in": (1024, 960, 1024, 192),
    "lintel_out": (1024, 1152, 1024, 192),
    "band_in": (0, 1216, 1024, 128),
    "band_out": (0, 1344, 1024, 128),
    "glass": (1024, 1344, 256, 512),
    "way_trains": (1280, 1344, 512, 128),
    "way_street": (1280, 1472, 512, 128),
    "mosaic_plaque": (1792, 1344, 256, 256),
    "poster_a": (0, 1472, 256, 384),
    "poster_b": (256, 1472, 256, 384),
    "poster_c": (512, 1472, 256, 384),
    "bronze_plaque": (768, 1472, 256, 128),
    "grime": (1792, 1600, 256, 256),
}
GLOWS = ["globe_green", "globe_red", "globe_white", "fluor", "amber", "lamp_warm", "glow_white", "beacon"]
for i, g in enumerate(GLOWS):
    R[g] = (1280 + 64 * i, 1600, 64, 64)
SWATCHES = {
    "paint_green": (0.09, 0.22, 0.14), "black": (0.03, 0.03, 0.03), "white": (0.90, 0.90, 0.88), "bronze": (0.42, 0.29, 0.14),
    "brass": (0.66, 0.50, 0.22), "steel_dark": (0.20, 0.20, 0.21), "rubber": (0.03, 0.03, 0.03), "yellow": (0.95, 0.72, 0.06),
    "concrete": (0.52, 0.51, 0.48), "orange": (0.88, 0.40, 0.06), "red": (0.62, 0.08, 0.06), "stainless": (0.70, 0.71, 0.72),
}
for i, k in enumerate(SWATCHES):
    R[k] = (1280 + 64 * (i % 12), 1664 + 64 * (i // 12), 64, 64)


def layout_json():
    return {"size": [AW, AH], "rects": R, "swatches": list(SWATCHES), "glows": GLOWS}


GREEN = (0.10, 0.25, 0.16)
MAROON, OCHRE, BLUE = (0.36, 0.16, 0.10), (0.80, 0.58, 0.20), (0.16, 0.30, 0.46)


# --------------------------------------------------------------------------------- materials

def paint_wear(d, w, h, base, chips=40, rust=True):
    """painted metal: brush texture, chipped edges showing dark iron, rust weeps"""
    L = [d.rect(0, 0, w, h, base), d.noise(w, h, op=22, scale=18, seed=d.rng.uniform(0, 50))]
    for _ in range(int(h / 4)):
        L.append(d.rect(0, d.rng.uniform(0, h), w, d.rng.uniform(0.5, 1.4), mul(base, d.rng.choice([0.8, 1.2])), op=d.rng.uniform(10, 25)))
    L += d.spots(w, h, chips, (0.05, 0.05, 0.04), size=(2, 7), op=(40, 85))
    if rust:
        L += d.spots(w, h, chips // 3, (0.42, 0.20, 0.07), size=(2, 9), op=(30, 60))
        L += d.streaks(w, h, 6, c=(0.45, 0.22, 0.08), top=(0.2, 0.6), length=(0.1, 0.3), op=(20, 40), width=(2, 6))
    L.append(d.dirt_bottom(w, h, 0.3, a=0.45))
    return L


def p_iron_green(d, w, h):
    return paint_wear(d, w, h, GREEN)


def p_iron_panel(d, w, h):
    """a cast panel: raised moulded border, a recessed field with a rosette and scroll corners"""
    hi, lo = mul(GREEN, 1.55), mul(GREEN, 0.55)
    L = paint_wear(d, w, h, GREEN, chips=20)
    L.append(d.rect(14, 14, w - 28, 6, hi))
    L.append(d.rect(14, 14, 6, h - 28, hi))
    L.append(d.rect(14, h - 20, w - 28, 6, lo))
    L.append(d.rect(w - 20, 14, 6, h - 28, lo))
    L.append(d.rect(28, 28, w - 56, h - 56, mul(GREEN, 0.8)))
    cx, cy = w / 2, h / 2
    for k in range(12):   # rosette petals
        a = k * math.pi / 6
        L.append(d.ellipse(cx + math.cos(a) * 22, cy + math.sin(a) * 22, 26, 12, mul(GREEN, 1.35), rot=math.degrees(a)))
    L.append(d.ellipse(cx, cy, 30, 30, mul(GREEN, 1.6)))
    L.append(d.ellipse(cx, cy, 14, 14, (0.55, 0.45, 0.2)))
    for sx, sy in ((40, 40), (w - 40, 40), (40, h - 40), (w - 40, h - 40)):   # scrolls
        pts = [(sx + 12 * math.cos(t / 3) * (1 - t / 30), sy + 12 * math.sin(t / 3) * (1 - t / 30)) for t in range(0, 28)]
        L.append(d.line(pts, mul(GREEN, 1.5), 3))
    L.append(d.noise(w, h, op=10, scale=30))
    return L


def p_iron_dark(d, w, h):
    return paint_wear(d, w, h, (0.07, 0.075, 0.075), chips=25)


def p_verdigris(d, w, h):
    base = (0.33, 0.55, 0.47)
    L = [d.rect(0, 0, w, h, base), d.noise(w, h, op=45, scale=14), d.noise(w, h, op=30, scale=60, seed=3)]
    L += d.spots(w, h, 30, (0.22, 0.30, 0.24), size=(6, 26), op=(20, 45))
    L += d.streaks(w, h, 14, c=(0.20, 0.28, 0.22), op=(20, 40))
    return L


def p_limestone(d, w, h):
    """rusticated ashlar: 512 px = 2 m wide x 1 m high, courses of 0.5 m, deep V joints"""
    L = [d.rect(0, 0, w, h, (0.40, 0.38, 0.34))]
    for r in range(2):
        y0 = r * h / 2
        off = (r % 2) * w / 4
        for k in range(-1, 3):
            x0 = k * w / 2 + off
            v = d.rng.uniform(0.92, 1.04)
            c = mul((0.78, 0.74, 0.66), v)
            L.append(d.rect(x0 + 5, y0 + 5, w / 2 - 10, h / 2 - 10, c, grad=d.lin(0, y0, 0, y0 + h / 2, [(0, mul(c, 1.08)), (0.5, c), (1, mul(c, 0.85))])))
    L.append(d.noise(w, h, op=28, scale=10))
    L.append(d.noise(w, h, op=20, scale=70, seed=5))
    L += d.spots(w, h, 40, (0.30, 0.28, 0.24), size=(1, 4), op=(30, 60))
    L += d.streaks(w, h, 10, c=(0.40, 0.36, 0.30), op=(15, 30))
    L.append(d.dirt_bottom(w, h, 0.4, a=0.35))
    return L


def p_granite(d, w, h, base=(0.48, 0.44, 0.42)):
    L = [d.rect(0, 0, w, h, base), d.noise(w, h, op=40, scale=6)]
    L += d.spots(w, h, 260, (0.12, 0.11, 0.11), size=(1, 3), op=(50, 90))
    L += d.spots(w, h, 160, (0.80, 0.74, 0.70), size=(1, 3), op=(40, 80))
    L += d.spots(w, h, 60, (0.55, 0.30, 0.25), size=(1, 4), op=(30, 60))
    L.append(d.rect(0, 0, w, h, (1, 1, 1), op=10, blend="screen", grad=d.lin(0, 0, w, h, [(0, (0, 0, 0)), (0.5, (1, 1, 1)), (1, (0, 0, 0))])))
    return L


def p_steel_brushed(d, w, h, base=(0.62, 0.63, 0.65)):
    L = [d.rect(0, 0, w, h, base)]
    for _ in range(int(h * 0.8)):
        y = d.rng.uniform(0, h)
        L.append(d.rect(0, y, w, d.rng.uniform(0.4, 1.0), mul(base, d.rng.choice([0.88, 1.1])), op=d.rng.uniform(20, 45)))
    L.append(d.noise(w, h, op=10, scale=40))
    L += d.spots(w, h, 12, (0.35, 0.33, 0.30), size=(4, 16), op=(10, 25))
    return L


def p_steel_galv(d, w, h):
    base = (0.58, 0.60, 0.60)
    L = [d.rect(0, 0, w, h, base), d.noise(w, h, op=35, scale=24)]
    for _ in range(26):   # spangle
        x, y = d.rng.uniform(0, w), d.rng.uniform(0, h)
        r = d.rng.uniform(14, 40)
        L.append(d.poly([(x + r * math.cos(a), y + r * math.sin(a)) for a in [d.rng.uniform(0, 6.28) for _ in range(5)]], mul(base, d.rng.choice([0.85, 1.12])), op=40))
    L += d.streaks(w, h, 10, c=(0.25, 0.22, 0.18), op=(20, 40))
    L += d.spots(w, h, 20, (0.18, 0.16, 0.14), size=(4, 14), op=(20, 50))
    return L


def p_diamond_plate(d, w, h):
    base = (0.50, 0.51, 0.52)
    L = [d.rect(0, 0, w, h, base), d.noise(w, h, op=25, scale=20)]
    s = 32
    for j in range(-1, h // s + 2):
        for i in range(-1, w // s + 2):
            x, y = i * s + (j % 2) * s / 2, j * s
            ang = 45 if (i + j) % 2 == 0 else -45
            L.append(d.ellipse(x + 2, y + 2, 22, 6, mul(base, 0.55), rot=ang))
            L.append(d.ellipse(x, y, 22, 6, mul(base, 1.35), rot=ang))
    L += d.spots(w, h, 25, (0.15, 0.13, 0.11), size=(5, 20), op=(25, 55))
    L += d.spots(w, h, 10, (0.40, 0.22, 0.10), size=(4, 12), op=(25, 50))
    L.append(d.noise(w, h, op=15, scale=70, seed=9))
    return L


def p_hazard_c(d, w, h, a, b):
    L = [d.rect(0, 0, w, h, a)]
    for x in range(-h, w + h, 64):
        L.append(d.poly([(x, h), (x + 32, h), (x + 32 + h, 0), (x + h, 0)], b))
    L.append(d.noise(w, h, op=25, scale=16))
    L += d.spots(w, h, 30, (0.1, 0.09, 0.08), size=(3, 10), op=(30, 60))
    L.append(d.dirt_bottom(w, h, 0.5, a=0.3))
    return L


def p_concrete_shaft(d, w, h):
    L = [d.rect(0, 0, w, h, (0.36, 0.35, 0.33)), d.noise(w, h, op=35, scale=14), d.noise(w, h, op=30, scale=80, seed=7)]
    L.append(d.rect(0, h * 0.5, w, 2.5, (0.12, 0.11, 0.1), op=55))
    L += d.streaks(w, h, 16, c=(0.18, 0.16, 0.13), op=(25, 50), width=(3, 18))
    L += d.streaks(w, h, 6, c=(0.55, 0.32, 0.15), op=(25, 40), width=(2, 8))
    L += d.streaks(w, h, 5, c=(0.4, 0.4, 0.36), op=(10, 25), light=True)
    L.append(d.dirt_bottom(w, h, 0.4, a=0.5))
    return L


def p_ceiling(d, w, h):
    base = (0.66, 0.64, 0.58)
    L = [d.rect(0, 0, w, h, base), d.noise(w, h, op=25, scale=30)]
    for _ in range(4):   # water stains: rings of brown
        x, y, r = d.rng.uniform(0, w), d.rng.uniform(0, h), d.rng.uniform(20, 60)
        L.append(d.ellipse(x, y, r * 2, r * 1.6, (0.55, 0.45, 0.32), op=16))
        L.append(d.ellipse(x, y, r * 1.6, r * 1.2, base, op=60))
    L += d.spots(w, h, 10, (0.25, 0.23, 0.2), size=(4, 14), op=(8, 18))
    for _ in range(3):   # peeling paint
        x, y = d.rng.uniform(0, w - 40), d.rng.uniform(0, h - 30)
        L.append(d.poly([(x, y), (x + d.rng.uniform(15, 40), y + 4), (x + 30, y + d.rng.uniform(10, 30)), (x + 5, y + 20)], (0.42, 0.40, 0.36), op=80))
    L.append(d.rect(0, 0, w, h, (0.2, 0.18, 0.16), blend="multiply", grad=d.rad(w / 2, h / 2, w * 0.75, [(0, (1, 1, 1)), (1, (0.75, 0.73, 0.7))])))
    return L


def p_tread(d, w, h):
    """a step seen from above: s across the stair, t from the back (top of image) to the nosing (bottom)"""
    L = [d.rect(0, 0, w, h, (0.50, 0.49, 0.46)), d.noise(w, h, op=30, scale=12)]
    L.append(d.ellipse(w / 2, h * 0.55, w * 0.62, h * 0.9, (0.30, 0.29, 0.27), op=45))   # worn path in the middle
    L += d.spots(w, h, 40, (0.10, 0.09, 0.08), size=(2, 6), op=(40, 80))                 # gum
    L.append(d.rect(0, h - 26, w, 26, YEL))                                               # the safety nosing
    for x in range(0, w, 10):
        L.append(d.rect(x, h - 24, 4, 22, mul(YEL, 0.7), op=70))
    L.append(d.rect(0, h - 28, w, 3, (0.15, 0.14, 0.12)))
    L += d.spots(w, h, 14, (0.12, 0.1, 0.05), size=(3, 9), op=(30, 60))
    L.append(d.rect(0, 0, 18, h, (0.18, 0.16, 0.14), op=60))
    L.append(d.rect(w - 18, 0, 18, h, (0.18, 0.16, 0.14), op=60))
    return L


def p_riser(d, w, h):
    L = [d.rect(0, 0, w, h, (0.42, 0.41, 0.38)), d.noise(w, h, op=30, scale=12)]
    L.append(d.rect(0, 0, w, 14, mul(YEL, 0.85)))
    L += d.spots(w, h, 20, (0.12, 0.11, 0.1), size=(4, 16), op=(20, 45))   # scuffs
    L.append(d.vfade(0, 0, w, h, (0.2, 0.18, 0.15), 0.5))
    return L


def p_stringer(d, w, h):
    L = [d.rect(0, 0, w, h, (0.20, 0.18, 0.16)), d.noise(w, h, op=30, scale=14)]
    L.append(d.rect(0, 0, w, 10, (0.36, 0.16, 0.10)))
    L += d.spots(w, h, 30, (0.05, 0.05, 0.04), size=(3, 12), op=(30, 60))
    return L


def p_cables(d, w, h):
    L = [d.rect(0, 0, w, h, (0.08, 0.08, 0.08))]
    cols = [(0.05, 0.05, 0.05), (0.12, 0.12, 0.12), (0.45, 0.30, 0.08), (0.08, 0.08, 0.1), (0.5, 0.1, 0.05), (0.1, 0.1, 0.1)]
    y = 4
    for c in cols * 2:
        hh = d.rng.uniform(7, 12)
        L.append(d.rect(0, y, w, hh, c, grad=d.lin(0, y, 0, y + hh, [(0, mul(c, 2.2)), (0.4, c), (1, mul(c, 0.4))])))
        y += hh
        if y > h - 8:
            break
    for x in range(30, w, 120):
        L.append(d.rect(x, 0, 10, h, (0.4, 0.4, 0.4)))
    L.append(d.noise(w, h, op=20, scale=20))
    return L


def p_louver(d, w, h):
    L = [d.rect(0, 0, w, h, (0.15, 0.15, 0.15))]
    for y in range(8, h, 24):
        L.append(d.rect(6, y, w - 12, 16, (0.5, 0.5, 0.5), grad=d.lin(0, y, 0, y + 16, [(0, (0.7, 0.7, 0.7)), (1, (0.25, 0.25, 0.25))])))
    L.append(d.noise(w, h, op=20, scale=20))
    L += d.streaks(w, h, 6, c=(0.3, 0.2, 0.1), op=(20, 40))
    return L


def p_fan_blade(d, w, h):
    L = p_steel_galv(d, w, h)[:3]
    L.append(d.rect(0, 0, w, h, (0.4, 0.4, 0.4), op=40, blend="multiply", grad=d.lin(0, 0, w, 0, [(0, (0.6, 0.6, 0.6)), (1, (1, 1, 1))])))
    L.append(d.rect(w - 34, 0, 30, h, YEL))   # painted blade tips: you see them spin
    L.append(d.text(w * 0.45, h * 0.62, "No 3", 30, (0.1, 0.1, 0.1), op=70))
    L += d.spots(w, h, 12, (0.15, 0.13, 0.1), size=(3, 9))
    return L


def p_fan_hub(d, w, h):
    L = [d.rect(0, 0, w, h, (0.09, 0.09, 0.1)), d.ellipse(w / 2, h / 2, w * 0.9, h * 0.9, YEL), d.ellipse(w / 2, h / 2, w * 0.62, h * 0.62, (0.1, 0.1, 0.1))]
    for k in range(6):
        a = k * math.pi / 3
        L.append(d.ellipse(w / 2 + math.cos(a) * 22, h / 2 + math.sin(a) * 22, 10, 10, (0.6, 0.6, 0.6)))
    L.append(d.poly([(w / 2 - 6, h / 2 - 20), (w / 2 + 6, h / 2 - 20), (w / 2, h / 2 - 32)], (0.95, 0.1, 0.05)))   # rotation arrow
    return L


def p_fan_guard(d, w, h):
    L = [d.rect(0, 0, w, h, (0, 0, 0))]
    for r in range(8, 64, 9):
        L.append(d.ellipse(w / 2, h / 2, r * 2, r * 2, (0.55, 0.56, 0.56), op=100))
        L.append(d.ellipse(w / 2, h / 2, r * 2 - 5, r * 2 - 5, (0, 0, 0)))
    for k in range(8):
        a = k * math.pi / 4
        L.append(d.line([(w / 2, h / 2), (w / 2 + math.cos(a) * 64, h / 2 + math.sin(a) * 64)], (0.55, 0.56, 0.56), 4))
    return L


def p_warn(d, w, h, title, lines, out):
    """an enamel warning sign: hazard header, big pictogram, text; invented authority"""
    bg = (0.97, 0.80, 0.08) if not out else (0.96, 0.95, 0.92)
    head = BLACK if not out else (0.70, 0.08, 0.05)
    L = [d.rect(0, 0, w, h, (0.15, 0.15, 0.15)), d.rect(6, 6, w - 12, h - 12, bg, round_=10)]
    L.append(d.rect(6, 6, w - 12, 64, head, round_=10))
    L.append(d.text(w / 2, 56, title, 50, WHITE if out else YEL))
    # pictogram: a fan (in) or arrows rushing up (out)
    cx, cy = 92, 160
    if not out:
        L.append(d.ellipse(cx, cy, 120, 120, BLACK))
        L.append(d.ellipse(cx, cy, 106, 106, bg))
        for k in range(5):
            a = k * 2 * math.pi / 5
            L.append(d.poly([(cx, cy), (cx + 48 * math.cos(a), cy + 48 * math.sin(a)), (cx + 44 * math.cos(a + 0.7), cy + 44 * math.sin(a + 0.7))], BLACK))
        L.append(d.ellipse(cx, cy, 18, 18, BLACK))
    else:
        for k, dx in enumerate((-30, 0, 30)):
            x = cx + dx
            L.append(d.poly([(x - 9, cy + 54), (x + 9, cy + 54), (x + 9, cy - 20), (x + 20, cy - 20), (x, cy - 52), (x - 20, cy - 20), (x - 9, cy - 20)], (0.70, 0.08, 0.05)))
    y = 128
    for s, size in lines:
        L.append(d.text(176, y, s, size, BLACK, just="left"))
        y += size * 1.12
    L.append(d.text(w - 20, h - 18, "CITY TRANSIT AIR WORKS", 16, mul(BLACK, 3), just="right"))
    L.append(d.noise(w, h, op=16, scale=20))
    L += d.spots(w, h, 12, (0.35, 0.18, 0.06), size=(3, 10), op=(30, 60))   # rusted chips round the bolts
    for x, y in ((18, 18), (w - 18, 18), (18, h - 18), (w - 18, h - 18)):
        L.append(d.ellipse(x, y, 10, 10, (0.4, 0.4, 0.4)))
    return L


def p_sign_subway(d, w, h, title, sub, red=False):
    """the black porcelain-enamel sign band: thin white rule on top, big white Helvetica-ish word"""
    bg = (0.03, 0.03, 0.03) if not red else (0.62, 0.07, 0.05)
    L = [d.rect(0, 0, w, h, bg), d.rect(0, 14, w, 5, WHITE)]
    L.append(d.text(48, h * 0.70, title, 104, WHITE, just="left"))
    if sub:
        L.append(d.text(w - 48, h * 0.70, sub, 40, mul(WHITE, 0.9), just="right"))
    L.append(d.noise(w, h, op=10, scale=30))
    L.append(d.dirt_bottom(w, h, 0.3, a=0.3))
    return L


def p_cartouche(d, w, h, word):
    gold, gold2 = (0.86, 0.68, 0.28), (0.55, 0.40, 0.14)
    L = paint_wear(d, w, h, GREEN, chips=10, rust=False)
    L.append(d.ellipse(w / 2, h / 2, w * 0.92, h * 0.78, gold2))
    L.append(d.ellipse(w / 2, h / 2, w * 0.88, h * 0.72, gold))
    L.append(d.ellipse(w / 2, h / 2, w * 0.82, h * 0.64, (0.06, 0.14, 0.09)))
    for sx in (-1, 1):   # acanthus scrolls either side
        for k in range(5):
            L.append(d.ellipse(w / 2 + sx * (w * 0.43 + k * 3), h / 2 - 40 + k * 20, 26, 14, gold, rot=sx * (20 + k * 15)))
    L.append(d.poly([(w / 2 - 30, 18), (w / 2 + 30, 18), (w / 2, 0)], gold))
    L.append(d.text(w / 2, h / 2 + 30, word, 82 if len(word) < 7 else 70, gold, font=("Georgia", "Bold"), tracking=80))
    L.append(d.text(w / 2, h / 2 + 62, "~ BROADWAY LINE ~", 20, mul(gold, 0.9), font=("Georgia", "Bold")))
    L.append(d.noise(w, h, op=12, scale=30))
    return L


def p_lintel(d, w, h, word, sub):
    L = [d.rect(0, 0, w, h, (0.76, 0.72, 0.64)), d.noise(w, h, op=26, scale=10), d.noise(w, h, op=18, scale=70, seed=4)]
    L.append(d.rect(0, 0, w, 12, (0.62, 0.58, 0.50)))
    L.append(d.rect(0, h - 12, w, 12, (0.55, 0.51, 0.44)))
    # incised serif letters: a dark offset under a light face
    L.append(d.text(w / 2 + 3, h * 0.66 + 3, word, 108, (0.30, 0.27, 0.22), font=("Georgia", "Bold"), tracking=200))
    L.append(d.text(w / 2, h * 0.66, word, 108, (0.50, 0.46, 0.40), font=("Georgia", "Bold"), tracking=200))
    L.append(d.text(w / 2, h * 0.9, sub, 24, (0.42, 0.38, 0.32), font=("Georgia", "Bold"), tracking=300))
    L += d.streaks(w, h, 8, c=(0.4, 0.36, 0.3), op=(15, 30))
    return L


def p_band(d, w, h, title, red):
    """modern back-lit glass band (drawn with the glow material)"""
    bg = (0.06, 0.07, 0.08) if not red else (0.55, 0.06, 0.04)
    L = [d.rect(0, 0, w, h, bg), d.rect(0, 0, w, h, (1, 1, 1), op=12, grad=d.lin(0, 0, 0, h, [(0, (1, 1, 1)), (1, (0, 0, 0))]))]
    L.append(d.ellipse(70, h / 2, 84, 84, (0.15, 0.62, 0.36) if not red else (0.95, 0.95, 0.92)))
    L.append(d.text(70, h / 2 + 18, "S" if not red else "X", 54, WHITE if not red else (0.55, 0.06, 0.04)))
    L.append(d.text(132, h * 0.68, title, 72, WHITE, just="left"))
    L.append(d.poly([(w - 90, h / 2 - 30), (w - 50, h / 2), (w - 90, h / 2 + 30)], WHITE))
    return L


def p_glass(d, w, h):
    L = [d.rect(0, 0, w, h, (0.42, 0.47, 0.50))]
    for _ in range(3):   # reflection sweeps
        x = d.rng.uniform(-60, w)
        L.append(d.poly([(x, h), (x + 40, h), (x + 40 + h * 0.4, 0), (x + h * 0.4, 0)], (0.85, 0.9, 0.95), op=d.rng.uniform(12, 25)))
    L.append(d.vfade(0, h * 0.6, w, h * 0.4, (0.35, 0.3, 0.25), 0.5))
    L += d.spots(w, h, 20, (0.3, 0.3, 0.3), size=(3, 10), op=(15, 35))
    L.append(d.text(w / 2, h * 0.84, "NO  BILLS", 22, (0.85, 0.85, 0.85), op=40))
    return L


def p_way(d, w, h, title, arrow_up):
    L = [d.rect(0, 0, w, h, (0.03, 0.03, 0.03)), d.rect(0, 6, w, 3, WHITE)]
    ax, ay = 54, h / 2 + 4
    if arrow_up:
        L.append(d.poly([(ax, ay - 36), (ax + 28, ay - 6), (ax + 11, ay - 6), (ax + 11, ay + 32), (ax - 11, ay + 32), (ax - 11, ay - 6), (ax - 28, ay - 6)], WHITE))
    else:
        L.append(d.poly([(ax + 36, ay), (ax + 6, ay + 28), (ax + 6, ay + 11), (ax - 32, ay + 11), (ax - 32, ay - 11), (ax + 6, ay - 11), (ax + 6, ay - 28)], WHITE))
    L.append(d.text(110, h / 2 + 20, title, 54, WHITE, just="left"))
    return L


def p_mosaic_plaque(d, w, h):
    """a small mosaic wall plaque: a single autumn leaf on cream, meander border"""
    s = 8
    n = w // s
    cream, brown = (0.92, 0.88, 0.78), (0.30, 0.17, 0.10)
    L = [d.rect(0, 0, w, h, (0.3, 0.27, 0.22))]
    leaf = [(0.5, 0.12), (0.62, 0.3), (0.82, 0.28), (0.72, 0.48), (0.88, 0.62), (0.62, 0.62), (0.54, 0.84), (0.46, 0.84), (0.38, 0.62), (0.12, 0.62), (0.28, 0.48), (0.18, 0.28), (0.38, 0.3)]
    leafpx = [(x * w, y * h) for x, y in leaf]
    for j in range(n):
        for i in range(n):
            ring = min(i, j, n - 1 - i, n - 1 - j)
            x, y = i * s + s / 2, j * s + s / 2
            if ring < 3:
                c = OCHRE if (i + j) % 4 < 2 and ring == 1 else MAROON if ring != 1 else brown
            elif sd.inpoly(leafpx, x, y):
                c = mix((0.85, 0.42, 0.10), (0.65, 0.22, 0.08), (y / h))
            elif abs(x - w / 2) < 5 and h * 0.6 < y < h * 0.95:
                c = brown
            else:
                c = cream
            L.append(d.tess(i * s, j * s, s, c, var=0.12))
    L.append(d.noise(w, h, op=12, scale=30))
    return L


def p_poster(d, w, h, kind):
    L = []
    if kind == "a":
        L += [d.rect(0, 0, w, h, (0.93, 0.55, 0.18)), d.ellipse(w / 2, h * 0.42, 170, 170, (0.75, 0.25, 0.06))]
        L.append(d.rect(w / 2 - 6, h * 0.42 - 100, 12, 30, (0.25, 0.4, 0.15)))
        L.append(d.text(w / 2, h * 0.78, "PUMPKIN", 46, WHITE, font=("Impact", "Regular")))
        L.append(d.text(w / 2, h * 0.88, "SPICE EVERYTHING", 24, (0.3, 0.12, 0.04)))
        L.append(d.text(w / 2, h * 0.95, "Old Tree Coffee Co.", 16, (0.3, 0.12, 0.04)))
    elif kind == "b":
        L += [d.rect(0, 0, w, h, (0.12, 0.2, 0.32)), d.rect(0, h * 0.55, w, h * 0.45, (0.08, 0.12, 0.18))]
        for k in range(9):
            x, y = d.rng.uniform(20, w - 20), d.rng.uniform(40, h * 0.5)
            L.append(d.ellipse(x, y, 6, 6, (0.95, 0.9, 0.7)))
        L.append(d.text(w / 2, h * 0.64, "RIDE THE", 40, WHITE, font=("Impact", "Regular")))
        L.append(d.text(w / 2, h * 0.82, "WIND", 74, (0.95, 0.75, 0.2), font=("Impact", "Regular")))
        L.append(d.text(w / 2, h * 0.93, "the city's oldest way up", 16, WHITE))
    else:
        L += [d.rect(0, 0, w, h, (0.95, 0.94, 0.9))]
        L.append(d.text(w / 2, 70, "LOST", 72, BLACK, font=("Impact", "Regular")))
        L.append(d.poly([(w / 2, 110), (w / 2 + 40, 160), (w / 2 + 20, 200), (w / 2 + 50, 250), (w / 2, 280), (w / 2 - 50, 250), (w / 2 - 20, 200), (w / 2 - 40, 160)], (0.75, 0.38, 0.1)))
        L.append(d.text(w / 2, 318, "ONE LEAF. BROWN.", 22, BLACK))
        L.append(d.text(w / 2, 346, "answers to nothing", 18, mul(BLACK, 4)))
        for x in range(10, w, 26):   # tear-off tabs
            L.append(d.rect(x, h - 26, 18, 26, (0.9, 0.9, 0.86)))
    return sd.poster_frame(d, w, h, L)


def p_bronze_plaque(d, w, h):
    b = (0.40, 0.28, 0.13)
    L = [d.rect(0, 0, w, h, b), d.rect(6, 6, w - 12, h - 12, mul(b, 1.25)), d.noise(w, h, op=30, scale=12)]
    L.append(d.text(w / 2, h * 0.48, "ENTRANCE", 34, mul(b, 0.5), font=("Georgia", "Bold"), tracking=120))
    L.append(d.text(w / 2, h * 0.78, "UPTOWN & DOWNTOWN", 18, mul(b, 0.55), font=("Georgia", "Bold")))
    L += d.spots(w, h, 20, (0.25, 0.45, 0.38), size=(3, 10), op=(30, 60))
    return L


def p_glow(d, w, h, name):
    c = {"globe_green": (0.45, 1.0, 0.55), "globe_red": (1.0, 0.22, 0.12), "globe_white": (1.0, 0.97, 0.9), "fluor": (0.93, 0.97, 1.0),
         "amber": (1.0, 0.62, 0.22), "lamp_warm": (1.0, 0.85, 0.6), "glow_white": (1.0, 1.0, 1.0), "beacon": (1.0, 0.55, 0.05)}[name]
    return [d.rect(0, 0, w, h, mul(c, 0.8)),
            d.ellipse(w / 2, h / 2, w * 1.1, h * 1.1, c, grad=d.rad(w / 2, h / 2, w * 0.55, [(0, (1, 1, 1)), (0.5, c), (1, mul(c, 0.8))]))]


def p_grime(d, w, h):
    return [d.rect(0, 0, w, h, (0.13, 0.11, 0.09)), d.noise(w, h, op=45, scale=20)]


def build_atlas_doc():
    d = Doc(1904)
    P = {
        "iron_green": p_iron_green, "iron_panel": p_iron_panel, "iron_dark": p_iron_dark, "verdigris": p_verdigris,
        "limestone": p_limestone, "granite": p_granite, "granite_dark": lambda d, w, h: p_granite(d, w, h, (0.17, 0.16, 0.16)),
        "steel_brushed": p_steel_brushed, "steel_galv": p_steel_galv, "diamond_plate": p_diamond_plate,
        "hazard": lambda d, w, h: p_hazard_c(d, w, h, YEL, BLACK), "hazard_red": lambda d, w, h: p_hazard_c(d, w, h, (0.92, 0.92, 0.9), (0.72, 0.08, 0.05)),
        "concrete_shaft": p_concrete_shaft, "ceiling_paint": p_ceiling, "tread": p_tread, "riser": p_riser,
        "stringer": p_stringer, "cables": p_cables, "louver": p_louver, "fan_blade": p_fan_blade, "fan_hub": p_fan_hub, "fan_guard": p_fan_guard,
        "warn_in": lambda d, w, h: p_warn(d, w, h, "DANGER", [("FANS BELOW", 46), ("STRONG DOWNDRAFT", 30), ("KEEP OFF GRATING", 30)], False),
        "warn_out": lambda d, w, h: p_warn(d, w, h, "CAUTION", [("AIR EXHAUST", 46), ("HIGH VELOCITY UPDRAFT", 26), ("KEEP CLEAR", 30)], True),
        "sign_subway": lambda d, w, h: p_sign_subway(d, w, h, "Subway", "Uptown & Downtown"),
        "sign_exit": lambda d, w, h: p_sign_subway(d, w, h, "Exit Only", "No Entry", red=True),
        "cartouche_in": lambda d, w, h: p_cartouche(d, w, h, "SUBWAY"),
        "cartouche_out": lambda d, w, h: p_cartouche(d, w, h, "EXIT"),
        "lintel_in": lambda d, w, h: p_lintel(d, w, h, "SUBWAY", "TO ALL TRAINS"),
        "lintel_out": lambda d, w, h: p_lintel(d, w, h, "EXIT", "NO ENTRY"),
        "band_in": lambda d, w, h: p_band(d, w, h, "Subway", False),
        "band_out": lambda d, w, h: p_band(d, w, h, "Exit only", True),
        "glass": p_glass,
        "way_trains": lambda d, w, h: p_way(d, w, h, "To all trains", False),
        "way_street": lambda d, w, h: p_way(d, w, h, "Exit to street", True),
        "mosaic_plaque": p_mosaic_plaque,
        "poster_a": lambda d, w, h: p_poster(d, w, h, "a"), "poster_b": lambda d, w, h: p_poster(d, w, h, "b"), "poster_c": lambda d, w, h: p_poster(d, w, h, "c"),
        "bronze_plaque": p_bronze_plaque, "grime": p_grime,
    }
    layers = []
    for name, (x, y, w, h) in R.items():
        if name in P:
            L = P[name](d, w, h)
        elif name in SWATCHES:
            L = sd.p_swatch(d, w, h, SWATCHES[name])
        else:
            L = p_glow(d, w, h, name)
        layers.append(d.group(name, x, y, w, h, L))
    layers.reverse()
    return doc(AW, AH, layers, "Entrance atlas", bg=(0.12, 0.12, 0.12))


# ---- stair / passage wall: 512 px = 2 m across, 1280 px = 5 m up from 0.6 m below the stair line (or passage floor)
SW_W, SW_H, SW_M, SW_Y0 = 512, 1280, 5.0, -0.6


def build_stair_wall_doc():
    d = Doc(1913)
    W, H = SW_W, SW_H
    Y = lambda z: H - (z - SW_Y0) / SW_M * H   # z: metres above the stair line
    px = W / 2.0

    def tiles(z0, z1, tw, th, base=(0.88, 0.87, 0.83), grout=(0.50, 0.48, 0.44), var=0.05):
        out = [d.rect(0, Y(z1), W, Y(z0) - Y(z1), grout)]
        rows = max(1, int(round((z1 - z0) / th)))
        ty, tx = (Y(z0) - Y(z1)) / rows, tw * px
        for r in range(rows):
            off = (r % 2) * tx / 2
            y = Y(z1) + r * ty
            k = -1
            while k * tx + off < W:
                v = d.rng.uniform(1 - var, 1)
                out.append(d.rect(k * tx + off + 1.2, y + 1.2, tx - 2.4, ty - 2.4, mul(base, v), round_=1.2))
                k += 1
        return out

    L = [d.rect(0, 0, W, H, (0.30, 0.28, 0.26)), d.noise(W, H, op=25, scale=20)]
    L.append(d.rect(0, Y(0.15), W, Y(-0.6) - Y(0.15), (0.16, 0.14, 0.12)))                      # under the steps / skirting
    L += tiles(0.15, 0.55, 0.30, 0.20, base=MAROON, grout=(0.2, 0.15, 0.12), var=0.12)            # glazed base course
    L.append(d.rect(0, Y(0.62), W, Y(0.55) - Y(0.62), (0.78, 0.56, 0.18)))
    L += tiles(0.62, 1.95, 0.152, 0.076)
    # mosaic band with a stepped meander, tiling every 0.5 m (64 tesserae of 8 px across)
    bh = Y(1.95) - Y(2.3)
    s = bh / 11
    band = [d.rect(0, 0, W, bh, (0.3, 0.26, 0.2)), d.rect(0, 0, W, bh, MAROON)]
    for r in range(11):
        for c in range(64):
            if r in (0, 10):
                col = OCHRE
            elif r in (1, 9):
                col = None
            else:
                m = abs((c % 16) - 7.5) + abs(r - 5)
                col = OCHRE if 3.0 < m < 4.8 else BLUE if m < 1.6 else None
            if col:
                band.append(d.tess(c * 8, r * s, 8, col))
    band += [d.rect(x - 0.6, 0, 1.2, bh, (0.3, 0.26, 0.2), op=55) for x in range(0, W + 1, 8)]
    L.append(d.group("trim_band", 0, Y(2.3), W, bh, band))
    L += tiles(2.3, 3.0, 0.152, 0.076)
    L.append(d.rect(0, Y(3.12), W, Y(3.0) - Y(3.12), MAROON))
    L.append(d.rect(0, Y(3.15), W, 4, (0.78, 0.56, 0.18)))
    # above the tile: painted concrete, soot
    L.append(d.rect(0, 0, W, Y(3.15), (0.52, 0.50, 0.46)))
    L.append(d.noise(W, Y(3.15), op=30, scale=30))
    L.append(d.vfade(0, 0, W, Y(3.15), (0.1, 0.09, 0.08), 0.6, up=True))
    # wear: hands along the rail height, leaks, dirt kicked up the base, a missing tile or two
    L.append(d.rect(0, Y(1.05), W, Y(0.75) - Y(1.05), (0.55, 0.48, 0.38), op=25, blend="multiply"))
    L += d.streaks(W, H, 12, c=(0.62, 0.55, 0.42), op=(12, 28), top=(0.22, 0.32), length=(0.15, 0.4), width=(3, 14))
    L.append(d.vfade(0, Y(1.2), W, Y(0.15) - Y(1.2), (0.25, 0.2, 0.15), 0.5))
    for _ in range(3):
        L.append(d.rect(d.rng.uniform(20, W - 60), Y(d.rng.uniform(0.9, 2.8)), 37, 19, (0.40, 0.38, 0.34)))
    L.append(d.noise(W, H, op=10, scale=40))
    return doc(W, H, list(reversed(L)), "Stair wall")


def build_grate_doc():
    """heavy bar grating, 1 m square: bearing bars along u every 32 px (6 cm), cross rods every 128 px"""
    d = Doc(7)
    W = H = 512
    L = [d.rect(0, 0, W, H, (0, 0, 0))]
    for x in range(0, W, 32):
        L.append(d.rect(x, 0, 14, H, (0.55, 0.56, 0.57), grad=d.lin(x, 0, x + 14, 0, [(0, (0.75, 0.76, 0.77)), (0.5, (0.55, 0.56, 0.57)), (1, (0.30, 0.31, 0.32))])))
    for y in range(0, H, 128):
        L.append(d.rect(0, y, W, 10, (0.48, 0.49, 0.5)))
    L.append(d.noise(W, H, op=30, scale=16, blend="multiply"))
    L += d.spots(W, H, 30, (0.25, 0.16, 0.08), size=(4, 16), op=(40, 70))
    return doc(W, H, list(reversed(L)), "Bar grating", bg=(0, 0, 0))


DOCS = {"EntranceAtlas": build_atlas_doc, "StairWall": build_stair_wall_doc, "Grate": build_grate_doc}

if __name__ == "__main__":
    for k, f in DOCS.items():
        s = json.dumps(f())
        print(k, len(s))
