"""Far From the Tree - Chinatown textures, authored as editable Tesseract compositions.

Imported by build_chinatown.py (system Python, standard library only). Reuses the Doc helpers from
../park/park_design.py. Each entry in DOCS becomes tesseract/<Name>/<Name>.tsrct (the editable source)
and a rendered <Name>.png; the named rectangles (R, BR) go to tesseract/layout.json for the Blender
script, which UV-maps the models into them.

  ChinatownAtlas 1024x1024  the paifang gates (red lacquer, green glazed tiles, painted beams, gilded
                            plaques with 華埠 / 天下為公, granite drums), the paper lanterns (ribs,
                            gold bands, 福), tassels, festival stalls, the street-closed signs, neon
                            blade signs and flat swatches
  BridgeTruss    512x256    the Manhattan Bridge's stiffening truss panel and tower lattice (alpha)
  BridgeGranite, BridgeLimestone, BridgeSteel  256x256  repeating: granite ashlar (piers, anchorages,
                            approaches), the arch and colonnade's limestone, the pale blue-grey riveted steel
"""
import math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "park"))
from park_design import Doc, mul, mix  # noqa: E402

FONTS = [r"C:\Windows\Fonts\arialbd.ttf", r"C:\Windows\Fonts\msyhbd.ttc", r"C:\Windows\Fonts\georgiab.ttf"]
LATIN = ("Arial", "Bold")
HAN = ("Microsoft YaHei", "Bold")
SERIF = ("Georgia", "Bold")

# --------------------------------------------------------------------------------- layouts (pixels, top-left origin)
R = {
    "lacquer": (0, 0, 256, 256),
    "tiles": (256, 0, 256, 256),
    "beam_a": (512, 0, 512, 128),
    "beam_b": (512, 128, 512, 128),
    "stone": (0, 256, 256, 256),
    "lantern": (256, 256, 256, 256),
    "plaque_a": (512, 256, 512, 128),
    "plaque_b": (512, 384, 512, 128),
    "gold": (0, 512, 256, 256),
    "tassel": (256, 512, 256, 128),
    "lion_face": (256, 640, 128, 128),
    "awning": (512, 512, 256, 256),
    "lion": (768, 512, 256, 128),
    "cracker": (768, 640, 256, 128),
    "sign_closed": (0, 768, 512, 128),
    "sign_welcome": (0, 896, 512, 128),
    "neon_0": (512, 768, 128, 256),
    "neon_1": (640, 768, 128, 256),
    "neon_2": (768, 768, 128, 256),
    "neon_3": (896, 768, 128, 256),
}
SWATCHES = {
    "red": (0.62, 0.05, 0.04), "gold_flat": (0.86, 0.62, 0.16), "green_glaze": (0.10, 0.36, 0.22), "black": (0.03, 0.03, 0.03),
    "white": (0.88, 0.86, 0.80), "wood": (0.30, 0.17, 0.09), "blue": (0.08, 0.18, 0.42), "teal": (0.05, 0.38, 0.36),
    "orange": (0.92, 0.42, 0.06), "pink": (0.95, 0.45, 0.55), "canvas": (0.80, 0.74, 0.62), "iron": (0.14, 0.14, 0.15),
}
# the swatches live in the bottom of the awning cell's neighbour: a 4x3 grid of 32 px in the lion cell's right part
for i, k in enumerate(SWATCHES):
    R["sw_" + k] = (896 + 32 * (i % 4), 512 + 32 * (i // 4), 32, 32)
R["lion"] = (768, 512, 128, 128)
# more swatches (the district kit: water towers, cars, the subway train): the spare 4x1 row under the
# first ones, and a 4x4 block in the free cell beside the lion's face
SWATCHES2 = {
    "tank_wood": (0.36, 0.24, 0.15), "silver": (0.72, 0.74, 0.76), "car_white": (0.85, 0.86, 0.86), "car_black": (0.05, 0.05, 0.06),
    "car_silver": (0.55, 0.57, 0.59), "car_blue": (0.10, 0.20, 0.42), "car_red": (0.55, 0.06, 0.05), "yellow_cab": (0.95, 0.72, 0.08),
    "glass_dark": (0.08, 0.10, 0.12), "window_lit": (1.0, 0.82, 0.50), "concrete": (0.55, 0.54, 0.51), "rust": (0.42, 0.22, 0.12),
    "tar": (0.12, 0.12, 0.12), "train_blue": (0.10, 0.22, 0.55), "headlight": (1.0, 0.95, 0.80), "tail_red": (0.9, 0.08, 0.05),
    "jersey": (0.70, 0.69, 0.66), "lamp_head": (1.0, 0.85, 0.55), "pole_green": (0.12, 0.20, 0.15), "pole_grey": (0.30, 0.31, 0.32),
}
for i, k in enumerate(SWATCHES2):
    R["sw_" + k] = (896 + 32 * i, 608, 32, 32) if i < 4 else (384 + 32 * ((i - 4) % 4), 640 + 32 * ((i - 4) // 4), 32, 32)

# the bridge's alpha atlas (BridgeTruss, 512x256); its stone and steel are separate repeating textures
BR = {
    "truss": (0, 0, 256, 256),
    "lattice": (256, 0, 128, 256),
    "cable": (384, 0, 128, 128),
    "deck": (384, 128, 128, 128),
}


def layout_json():
    from district_design import DR, DR_METRES
    return {"atlas": {"size": 1024, "rects": R, "swatches": {**SWATCHES, **SWATCHES2}}, "bridge": {"size": [512, 256], "rects": BR},
            "district": {"size": 1024, "rects": DR, "metres": DR_METRES}}


def T(d, x, y, s, size, c, font=LATIN, just="center", tracking=0.0, name="text"):
    d.font = font
    return d.text(x, y, s, size, c, just=just, name=name, tracking=tracking)


def cell(d, name, layers, rects=None):
    x, y, w, h = (rects or R)[name]
    return d.group(name, x, y, w, h, layers)


GOLD = (0.95, 0.72, 0.22)
GOLD_D = (0.62, 0.40, 0.10)
RED = (0.66, 0.06, 0.05)
RED_D = (0.36, 0.02, 0.02)
GREEN = (0.10, 0.40, 0.24)
BLUE = (0.06, 0.16, 0.40)


def gold_fill(d, x, y, w, h):
    return d.lin(x, y, x + w * 0.3, y + h, [(0, (1.0, 0.86, 0.45)), (0.35, GOLD), (0.6, GOLD_D), (0.8, (0.92, 0.70, 0.28)), (1, GOLD_D)])


# ================================================================================ gate parts

def lacquer(d, w, h):
    r = d.rng
    L = [d.rect(0, 0, w, h, RED, grad=d.lin(0, 0, w, 0, [(0, mul(RED, 0.75)), (0.35, mul(RED, 1.12)), (0.5, mul(RED, 1.2)), (0.75, RED), (1, mul(RED, 0.72))]))]
    for _ in range(40):   # brush strokes / wood grain under the lacquer
        x = r.random() * w
        L.append(d.line([(x, -10), (x + (r.random() - 0.5) * 8, h + 10)], mul(RED, 0.8 + r.random() * 0.35), 1 + r.random() * 3, op=35, smooth=True))
    L.append(d.noise(w, h, op=22, scale=30, kind="cloudy", seed=3))
    for _ in range(14):   # crazing and chips showing the dark undercoat
        x, y = r.random() * w, r.random() * h
        L.append(d.poly(d.blob(x, y, 2 + r.random() * 5, 1.5 + r.random() * 3), RED_D, op=70, smooth=True))
    for _ in range(6):    # city grime running down
        x = r.random() * w
        L.append(d.line([(x, h * 0.4 + r.random() * 60), (x + 4, h + 4)], (0.15, 0.05, 0.04), 6 + r.random() * 10, op=18, effects=[d.blur(5)]))
    L.append(d.rect(0, 0, w, h, (0.5, 0.5, 0.5), op=6, effects=[d.grain(6)]))
    return L


def tiles(d, w, h):
    """green glazed barrel tiles: 4 columns of rolls across, 4 courses down (the cell repeats per roof quad)"""
    r = d.rng
    L = [d.rect(0, 0, w, h, (0.03, 0.10, 0.06), name="gaps")]
    cols, rows = 4, 4
    cw, rh = w / cols, h / rows
    for i in range(cols):
        for j in range(rows):
            x0, y0 = i * cw, j * rh
            base = mix((0.14, 0.50, 0.30), (0.24, 0.62, 0.38), r.random() * 0.6)
            # the pan tile between rolls (darker), then the roll (convex, with a highlight)
            L.append(d.rect(x0, y0, cw, rh, mul(base, 0.55), grad=d.lin(0, 0, 0, rh, [(0, mul(base, 0.45)), (1, mul(base, 0.7))])))
            L.append(d.rect(x0 + cw * 0.12, y0 - 2, cw * 0.76, rh + 2, base, round_=cw * 0.3,
                            grad=d.lin(0, 0, cw * 0.76, 0, [(0, mul(base, 0.5)), (0.25, mul(base, 1.0)), (0.4, mul(base, 1.25)), (0.55, mul(base, 1.1)), (0.8, mul(base, 0.8)), (1, mul(base, 0.45))])))
            # the round tile end of the course above casts a lip
            L.append(d.rect(x0 + cw * 0.18, y0 + rh - 6, cw * 0.64, 6, mul(base, 0.4), op=70, round_=3))
    L.append(d.noise(w, h, op=25, scale=18, kind="cloudy", seed=5))
    for _ in range(5):   # soot
        x = r.random() * w
        L.append(d.line([(x, r.random() * h * 0.5), (x, h)], (0.05, 0.08, 0.06), 6 + r.random() * 6, op=18, effects=[d.blur(4)]))
    return L


def cloud(d, cx, cy, s, c, op=100):
    """a stylised xiangyun cloud scroll"""
    L = []
    for dx, dy, rr in ((-1.0, 0.1, 0.55), (0.0, -0.25, 0.7), (1.0, 0.1, 0.55), (0.5, 0.35, 0.45), (-0.5, 0.35, 0.45)):
        L.append(d.ellipse(cx + dx * s, cy + dy * s, rr * s * 2, rr * s * 2, c, op=op))
    L.append(d.ellipse(cx, cy - 0.25 * s, 0.7 * s, 0.7 * s, mul(c, 0.55), op=op))
    return L


def beam(d, w, h, a=True):
    """painted beam face: gold-banded ends, a central cartouche, blue-green banding (hexi / xuanzi style)"""
    base = BLUE if a else (0.05, 0.30, 0.22)
    alt = (0.05, 0.30, 0.22) if a else BLUE
    L = [d.rect(0, 0, w, h, base, grad=d.lin(0, 0, 0, h, [(0, mul(base, 1.3)), (0.5, base), (1, mul(base, 0.6))]))]
    # border lines
    for y in (6, h - 10):
        L.append(d.rect(0, y, w, 4, GOLD, grad=gold_fill(d, 0, 0, w, 4)))
    # end panels (zaotou) with whirl roundels
    for x0 in (0, w - 110):
        L.append(d.rect(x0 + 6, 14, 98, h - 28, alt))
        for k in range(3):
            cx = x0 + 22 + k * 33
            L.append(d.ellipse(cx, h / 2, 28, 28, GOLD, op=90))
            L.append(d.ellipse(cx, h / 2, 20, 20, (0.85, 0.88, 0.92)))
            L.append(d.ellipse(cx, h / 2, 12, 12, alt))
            L.append(d.ellipse(cx, h / 2, 5, 5, GOLD))
    # chevron bands between ends and centre
    for x0 in (112, w - 160):
        for k in range(3):
            xx = x0 + k * 16
            L.append(d.poly([(xx, 14), (xx + 10, 14), (xx + 22, h / 2), (xx + 10, h - 14), (xx, h - 14), (xx + 12, h / 2)], GOLD, op=85))
    # the central cartouche: a long lozenge, red with gold clouds (or a gold dragon-ish swirl)
    cx = w / 2
    pts = [(cx - 120, h / 2), (cx - 95, 18), (cx + 95, 18), (cx + 120, h / 2), (cx + 95, h - 18), (cx - 95, h - 18)]
    L.append(d.poly(pts, GOLD, stroke=(GOLD_D, 3)))
    inner = [(cx - 108, h / 2), (cx - 88, 24), (cx + 88, 24), (cx + 108, h / 2), (cx + 88, h - 24), (cx - 88, h - 24)]
    L.append(d.poly(inner, RED if a else (0.08, 0.20, 0.45)))
    for k in (-60, 0, 60):
        L += cloud(d, cx + k, h / 2 + 4, 13, GOLD, op=95)
    # pearls along the borders
    for x in range(120, w - 120, 22):
        if abs(x - cx) < 128:
            continue
        L.append(d.ellipse(x, 8, 5, 5, (0.95, 0.95, 0.90), op=80))
        L.append(d.ellipse(x, h - 8, 5, 5, (0.95, 0.95, 0.90), op=80))
    L.append(d.noise(w, h, op=18, scale=26, seed=7))
    L.append(d.rect(0, 0, w, h, (0.5, 0.5, 0.5), op=5, effects=[d.grain(5)]))
    return L


def plaque(d, w, h, text, size, sub=None):
    L = [d.rect(0, 0, w, h, GOLD, grad=gold_fill(d, 0, 0, w, h))]
    L.append(d.rect(6, 6, w - 12, h - 12, GOLD_D))
    L.append(d.rect(10, 10, w - 20, h - 20, BLUE, grad=d.lin(0, 0, 0, h - 20, [(0, (0.10, 0.22, 0.52)), (1, (0.03, 0.08, 0.24))])))
    L.append(d.rect(16, 16, w - 32, h - 32, (0, 0, 0), op=0, name="inner"))
    L.append(d.line([(18, 18), (w - 18, 18), (w - 18, h - 18), (18, h - 18), (18, 18)], GOLD, 2, op=80))
    # corner cloud ornaments
    for cx, cy in ((34, 30), (w - 34, 30), (34, h - 30), (w - 34, h - 30)):
        L += cloud(d, cx, cy, 6, GOLD, op=90)
    # the characters: a dark drop shadow then gold
    base = h / 2 + size * 0.36 if not sub else h / 2 + size * 0.26
    L.append(T(d, w / 2 + 3, base + 3, text, size, (0.02, 0.03, 0.08), font=HAN, tracking=size * 0.4))
    L.append(T(d, w / 2, base, text, size, (1.0, 0.82, 0.36), font=HAN, tracking=size * 0.4))
    if sub:
        L.append(T(d, w / 2, h - 22, sub, 15, (0.95, 0.80, 0.45), font=SERIF, tracking=6))
    L.append(d.noise(w, h, op=14, scale=20, seed=11))
    return L


def stone(d, w, h):
    r = d.rng
    L = [d.rect(0, 0, w, h, (0.56, 0.54, 0.50)), d.noise(w, h, op=40, scale=8, kind="turbulentSmooth", seed=2)]
    for _ in range(900):   # granite speckle
        x, y = r.random() * w, r.random() * h
        c = r.choice([(0.25, 0.24, 0.23), (0.78, 0.76, 0.72), (0.62, 0.52, 0.46)])
        L.append(d.ellipse(x, y, 1.5 + r.random() * 2.5, 1.5 + r.random() * 2.5, c, op=55))
    # a carved border (bands at top and bottom, a lotus-petal row)
    L.append(d.rect(0, 0, w, 16, (0.66, 0.64, 0.60), op=80))
    L.append(d.rect(0, h - 22, w, 22, (0.40, 0.38, 0.35), op=70))
    for x in range(0, w, 32):
        L.append(d.poly([(x, 16), (x + 16, 40), (x + 32, 16)], (0.48, 0.46, 0.43), op=70, smooth=True))
    L.append(d.rect(0, h * 0.6, w, h * 0.4, (0.2, 0.2, 0.2), op=30, blend="multiply", grad=d.lin(0, 0, 0, h * 0.4, [(0, (1, 1, 1)), (1, (0.5, 0.5, 0.5))])))
    return L


def lantern(d, w, h):
    """round paper lantern unrolled: u around (two 福 roundels, front and back), v down; ribs and gold caps"""
    L = [d.rect(0, 0, w, h, (0.85, 0.08, 0.05), grad=d.lin(0, 0, 0, h, [(0, (0.55, 0.04, 0.03)), (0.15, (0.92, 0.12, 0.06)), (0.5, (1.0, 0.24, 0.10)), (0.85, (0.92, 0.12, 0.06)), (1, (0.55, 0.04, 0.03))]))]
    L.append(d.noise(w, h, op=20, scale=10, kind="turbulentSmooth", seed=4, name="paper"))
    for k in range(17):   # bamboo ribs
        x = k * w / 16
        L.append(d.line([(x, 0), (x, h)], (0.45, 0.03, 0.02), 2.2, op=75))
    for k in range(2):
        cx = w * (0.25 + 0.5 * k)
        L.append(d.ellipse(cx, h * 0.52, 74, 92, (1.0, 0.78, 0.30), op=90))
        L.append(d.ellipse(cx, h * 0.52, 66, 84, (0.86, 0.10, 0.05)))
        L.append(T(d, cx, h * 0.52 + 20, "福", 58, (1.0, 0.86, 0.40), font=HAN))
    # gold caps and black trim bands
    L.append(d.rect(0, 0, w, 22, GOLD, grad=gold_fill(d, 0, 0, w, 22)))
    L.append(d.rect(0, 22, w, 5, (0.08, 0.03, 0.02)))
    L.append(d.rect(0, h - 22, w, 22, GOLD, grad=gold_fill(d, 0, 0, w, 22)))
    L.append(d.rect(0, h - 27, w, 5, (0.08, 0.03, 0.02)))
    for x in range(0, w, 16):
        L.append(d.poly([(x, 27), (x + 8, 38), (x + 16, 27)], GOLD, op=85))
        L.append(d.poly([(x, h - 27), (x + 8, h - 38), (x + 16, h - 27)], GOLD, op=85))
    return L


def gold(d, w, h):
    L = [d.rect(0, 0, w, h, GOLD, grad=gold_fill(d, 0, 0, w, h)), d.noise(w, h, op=30, scale=14, kind="turbulentSmooth", seed=9)]
    for k in range(8):
        L.append(d.line([(0, k * 32 + 10), (w, k * 32 + 4)], (1.0, 0.92, 0.6), 3, op=30, effects=[d.blur(2)]))
    return L


def tassel(d, w, h):
    r = d.rng
    L = [d.rect(0, 0, w, h, (0.70, 0.04, 0.03))]
    for _ in range(140):
        x = r.random() * w
        c = mix((0.95, 0.10, 0.06), (0.45, 0.02, 0.02), r.random())
        L.append(d.line([(x, 0), (x + (r.random() - 0.5) * 6, h)], c, 1.5 + r.random() * 2.5, op=85))
    L.append(d.rect(0, 0, w, 40, GOLD, grad=gold_fill(d, 0, 0, w, 40)))
    L.append(d.rect(0, 40, w, 6, (0.4, 0.25, 0.05)))
    return L


def awning(d, w, h):
    """festival stall canopy: red and yellow stripes, a scalloped gold-trimmed valance at the bottom"""
    L = []
    n = 8
    for k in range(n):
        c = (0.82, 0.08, 0.06) if k % 2 == 0 else (0.98, 0.78, 0.16)
        L.append(d.rect(k * w / n, 0, w / n + 1, h, c))
    L.append(d.rect(0, 0, w, h, (0, 0, 0), op=30, blend="multiply", grad=d.lin(0, 0, 0, h, [(0, (0.8, 0.8, 0.8)), (0.75, (1, 1, 1)), (1, (0.7, 0.7, 0.7))])))
    for k in range(n):
        x = k * w / n
        L.append(d.ellipse(x + w / n / 2, h - 30, w / n, 40, (0.82, 0.08, 0.06) if k % 2 == 0 else (0.98, 0.78, 0.16)))
    L.append(d.rect(0, h - 56, w, 6, GOLD))
    L.append(d.noise(w, h, op=20, scale=16, seed=12))
    return L


def lion(d, w, h):
    """lion-dance fur: gold, red and white tufts"""
    r = d.rng
    L = [d.rect(0, 0, w, h, (0.92, 0.66, 0.12))]
    for _ in range(220):
        x, y = r.random() * w, r.random() * h
        c = r.choice([(0.98, 0.80, 0.25), (0.85, 0.12, 0.06), (0.98, 0.96, 0.90), (0.75, 0.45, 0.05)])
        L.append(d.line([(x, y), (x + (r.random() - 0.5) * 6, y + 8 + r.random() * 12)], c, 2 + r.random() * 2, op=85, smooth=True))
    return L


def lion_face(d, w, h):
    """the front of a lion-dance head: gold fur, white brows, big eyes, a mirror, red mouth and teeth"""
    L = [d.rect(0, 0, w, h, (0.95, 0.70, 0.15))]
    L.append(d.ellipse(w / 2, h * 0.16, 24, 24, (0.80, 0.85, 0.90)))          # mirror
    L.append(d.ellipse(w / 2, h * 0.16, 16, 16, (0.95, 0.97, 1.0)))
    for sx in (-1, 1):
        cx = w / 2 + sx * 30
        L.append(d.ellipse(cx, h * 0.33, 46, 20, (0.98, 0.98, 0.95)))         # furry brow
        L.append(d.ellipse(cx, h * 0.47, 36, 34, (1.0, 1.0, 1.0)))            # eye
        L.append(d.ellipse(cx + sx * 2, h * 0.48, 18, 22, (0.05, 0.05, 0.05)))
        L.append(d.ellipse(cx + sx * 5, h * 0.44, 6, 6, (1, 1, 1)))
        L.append(d.ellipse(w / 2 + sx * 44, h * 0.66, 22, 18, (0.92, 0.25, 0.25), op=80))   # cheeks
    L.append(d.ellipse(w / 2, h * 0.60, 26, 18, (0.86, 0.12, 0.08)))           # nose
    L.append(d.ellipse(w / 2, h * 0.84, 96, 30, (0.75, 0.05, 0.05)))           # mouth
    for k in range(6):
        L.append(d.rect(w / 2 - 36 + k * 12, h * 0.78, 10, 8, (1, 1, 1)))
    return L


def cracker(d, w, h):
    """a string of firecrackers: red paper tubes with gold wrappers, seen side on (u around, v down)"""
    L = [d.rect(0, 0, w, h, (0.75, 0.05, 0.04))]
    for k in range(8):
        y = k * h / 8
        L.append(d.rect(0, y, w, h / 8 - 2, (0.86, 0.08, 0.05), grad=d.lin(0, 0, 0, h / 8, [(0, (0.6, 0.03, 0.02)), (0.5, (0.95, 0.15, 0.08)), (1, (0.6, 0.03, 0.02))])))
        L.append(d.rect(0, y + 4, w, 3, GOLD, op=90))
    for k in range(2):
        L.append(T(d, w * (0.25 + 0.5 * k), h * 0.62, "福", 46, (1.0, 0.82, 0.32), font=HAN))
    return L


def sign_closed(d, w, h):
    L = [d.rect(0, 0, w, h, (0.72, 0.06, 0.05))]
    L.append(d.rect(5, 5, w - 10, h - 10, (0, 0, 0), op=0))
    L.append(d.line([(6, 6), (w - 6, 6), (w - 6, h - 6), (6, h - 6), (6, 6)], GOLD, 4))
    L.append(T(d, w / 2, 50, "MULBERRY ST FESTIVAL", 34, (1.0, 0.86, 0.36), tracking=1))
    L.append(T(d, w / 2 - 70, 104, "STREET CLOSED", 34, (1.0, 1.0, 1.0)))
    L.append(T(d, w / 2 + 160, 106, "封路", 40, (1.0, 0.86, 0.36), font=HAN))
    return L


def sign_welcome(d, w, h):
    L = [d.rect(0, 0, w, h, (0.05, 0.12, 0.30))]
    L.append(d.line([(6, 6), (w - 6, 6), (w - 6, h - 6), (6, h - 6), (6, 6)], GOLD, 4))
    L.append(T(d, 120, 88, "華埠", 64, (1.0, 0.82, 0.36), font=HAN, tracking=10))
    L.append(T(d, 345, 62, "CHINATOWN", 38, (1.0, 1.0, 1.0), tracking=2))
    L.append(T(d, 345, 104, "LUNAR LANTERN FAIR", 20, (1.0, 0.82, 0.36), tracking=2))
    return L


NEON = [("茶樓", (0.30, 1.0, 0.75)), ("麵家", (1.0, 0.35, 0.55)), ("酒家", (1.0, 0.85, 0.25)), ("金行", (0.45, 0.75, 1.0))]


def neon(d, w, h, k):
    s, c = NEON[k]
    L = [d.rect(0, 0, w, h, (0.03, 0.02, 0.04))]
    # the tube border and the characters, with a soft halo (blurred copy) behind the crisp tube
    border = [(8, 8), (w - 8, 8), (w - 8, h - 8), (8, h - 8), (8, 8)]
    halo = mix(c, (1, 1, 1), 0.0)
    L.append(d.line(border, halo, 10, op=60, effects=[d.blur(8)]))
    L.append(d.line(border, mix(c, (1, 1, 1), 0.5), 3))
    for i, ch in enumerate(s):
        y = 46 + i * 104 + 70
        L.append(T(d, w / 2, y, ch, 92, halo, font=HAN, name="halo"))
        L[-1]["effects"] = [d.blur(10)]
        L.append(T(d, w / 2, y, ch, 92, mix(c, (1, 1, 1), 0.55), font=HAN))
    return L


def swatch(d, w, h, c):
    return [d.rect(0, 0, w, h, c), d.noise(w, h, op=12, scale=8, seed=1)]


def atlas_doc():
    d = Doc(21)
    layers = [d.rect(0, 0, 1024, 1024, (0.5, 0.5, 0.5))]
    painters = {
        "lacquer": lacquer, "tiles": tiles, "beam_a": lambda d, w, h: beam(d, w, h, True), "beam_b": lambda d, w, h: beam(d, w, h, False),
        "stone": stone, "lantern": lantern,
        "plaque_a": lambda d, w, h: plaque(d, w, h, "華埠", 70, "CHINATOWN"), "plaque_b": lambda d, w, h: plaque(d, w, h, "天下為公", 62),
        "gold": gold, "tassel": tassel, "awning": awning, "lion": lion, "cracker": cracker, "lion_face": lion_face,
        "sign_closed": sign_closed, "sign_welcome": sign_welcome,
    }
    for k in range(4):
        painters["neon_%d" % k] = (lambda k: lambda d, w, h: neon(d, w, h, k))(k)
    for name, fn in painters.items():
        x, y, w, h = R[name]
        layers.append(d.group(name, x, y, w, h, fn(d, w, h)))
    for k, c in {**SWATCHES, **SWATCHES2}.items():
        x, y, w, h = R["sw_" + k]
        layers.append(d.group("sw_" + k, x, y, w, h, swatch(d, w, h, c)))
    return 1024, 1024, (0.5, 0.5, 0.5, 1), layers, d


# ================================================================================ bridge

STEEL = (0.50, 0.56, 0.60)   # the bridge's pale blue-grey


def steel(d, w, h):
    r = d.rng
    L = [d.rect(0, 0, w, h, STEEL), d.noise(w, h, op=22, scale=20, seed=3)]
    # riveted plates: seams and rows of rivets
    for k in range(5):
        y = k * h / 4
        L.append(d.rect(0, y - 2, w, 4, mul(STEEL, 0.62), op=80))
        for x in range(6, w, 12):
            L.append(d.ellipse(x, y + 8, 4, 4, mul(STEEL, 1.2), op=70))
            L.append(d.ellipse(x, y - 8, 4, 4, mul(STEEL, 1.2), op=70))
    for k in range(3):
        x = (k + 0.5) * w / 3
        L.append(d.rect(x - 2, 0, 4, h, mul(STEEL, 0.65), op=70))
    for _ in range(18):   # rust weeping from the rivets, flaking paint
        x, y = r.random() * w, r.random() * h
        L.append(d.line([(x, y), (x + 2, y + 20 + r.random() * 50)], (0.45, 0.28, 0.16), 3 + r.random() * 4, op=30, effects=[d.blur(3)]))
    L.append(d.rect(0, 0, w, h, (0.5, 0.5, 0.5), op=5, effects=[d.grain(5)]))
    return L


def truss(d, w, h):
    """one panel of the stiffening truss, transparent between the members: chords top and bottom, a
    vertical at each end, a pair of diagonals (Warren) and a lattice of light bracing"""
    c = mul(STEEL, 0.9)
    L = []
    th = 22
    L.append(d.rect(0, 0, w, th, c, grad=d.lin(0, 0, 0, th, [(0, mul(c, 1.2)), (1, mul(c, 0.7))])))
    L.append(d.rect(0, h - th, w, th, c, grad=d.lin(0, 0, 0, th, [(0, mul(c, 1.2)), (1, mul(c, 0.7))])))
    for x in (0, w - 12):
        L.append(d.rect(x, 0, 12, h, c))
    L.append(d.rect(w / 2 - 6, 0, 12, h, mul(c, 0.95)))
    L.append(d.line([(6, th), (w / 2, h - th)], c, 13))
    L.append(d.line([(w / 2, h - th), (w - 6, th)], c, 13))
    L.append(d.line([(6, h - th), (w / 2, th)], mul(c, 0.8), 6))
    L.append(d.line([(w / 2, th), (w - 6, h - th)], mul(c, 0.8), 6))
    for y in (th / 2, h - th / 2):   # rivet rows on the chords
        for x in range(6, w, 10):
            L.append(d.ellipse(x, y, 3, 3, mul(c, 1.3), op=70))
    return L


def lattice(d, w, h):
    """tower bracing: a double lattice of flat bars (X X X) between two flanges"""
    c = mul(STEEL, 0.95)
    L = [d.rect(0, 0, 14, h, c), d.rect(w - 14, 0, 14, h, c)]
    n = 6
    for k in range(n):
        y0, y1 = k * h / n, (k + 1) * h / n
        L.append(d.line([(7, y0), (w - 7, y1)], c, 7))
        L.append(d.line([(w - 7, y0), (7, y1)], c, 7))
        L.append(d.rect(0, y0 - 3, w, 6, c))
    return L


def granite(d, w, h, warm=True):
    r = d.rng
    base = (0.60, 0.57, 0.52) if warm else (0.80, 0.78, 0.72)
    L = [d.rect(0, 0, w, h, mul(base, 0.6 if warm else 0.82))]
    rows = 4
    for j in range(rows):
        x = 0 if j % 2 == 0 else -(40 + r.random() * 40)
        while x < w:
            bw = 70 + r.random() * 70
            if x + bw > w - 30:
                bw = w - x
            c = mul(base, (0.88 + r.random() * 0.22) if warm else (0.95 + r.random() * 0.08))
            L.append(d.rect(x + 2, j * h / rows + 2, bw - 4, h / rows - 4, c, grad=d.lin(0, 0, 0, h / rows, [(0, mul(c, 1.1)), (1, mul(c, 0.85))])))
            x += bw
    L.append(d.noise(w, h, op=30, scale=10, kind="turbulentSmooth", seed=6))
    for _ in range(10 if warm else 4):
        x = r.random() * w
        L.append(d.line([(x, 0), (x, h * (0.4 + r.random() * 0.6))], (0.2, 0.2, 0.2), 8 + r.random() * 12, op=16 if warm else 8, effects=[d.blur(6)]))
    return L


def truss_doc():
    d = Doc(31)
    layers = []
    painters = {"truss": truss, "lattice": lattice,
                "cable": lambda d, w, h: [d.rect(0, 0, w, h, (0.30, 0.33, 0.35)), d.noise(w, h, op=25, scale=6, seed=2)] + [d.line([(x, 0), (x + 30, h)], (0.2, 0.22, 0.24), 3, op=60) for x in range(-30, w, 10)],
                "deck": lambda d, w, h: [d.rect(0, 0, w, h, (0.22, 0.22, 0.22)), d.noise(w, h, op=30, scale=8, seed=4)]}
    for name, fn in painters.items():
        x, y, w, h = BR[name]
        layers.append(d.group(name, x, y, w, h, fn(d, w, h)))
    return 512, 256, (0, 0, 0, 0), layers, d


def single(fn, W=256, H=256, seed=5):
    def doc():
        d = Doc(seed)
        return W, H, (0.5, 0.5, 0.5, 1), fn(d, W, H), d
    return doc


NEEDS_FONT = {"ChinatownAtlas"}   # (fonts get embedded in the .tsrct: only where there's text)
DOCS = {"ChinatownAtlas": atlas_doc, "BridgeTruss": truss_doc,
        "BridgeGranite": single(lambda d, w, h: granite(d, w, h, True)), "BridgeLimestone": single(lambda d, w, h: granite(d, w, h, False), seed=8),
        "BridgeSteel": single(steel, seed=9)}


def build_doc(name):
    W, H, bg, layers, d = DOCS[name]()
    layers = list(reversed(layers))   # layers[0] is frontmost
    return {"$schema": "https://jerboa.dev/schemas/fx-composition/editable/v1/document.schema.json", "formatVersion": 1,
            "dimensions": {"width": W, "height": H}, "duration": 3.0, "backgroundColor": list(bg),
            "composition": {"id": "main", "name": "Chinatown " + name, "layers": layers}}

# the bridge district's facade atlas (district_design.py)
from district_design import DISTRICT_DOCS  # noqa: E402
DOCS.update(DISTRICT_DOCS)
NEEDS_FONT.add("DistrictAtlas")
