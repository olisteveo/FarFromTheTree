"""Far From the Tree - pedestrian texture atlas, authored as an editable Tesseract composition.

Imported by build_people.py (runs under the system Python, no dependencies). Produces
atlas/Atlas.tsrct (editable source) and people_atlas.png (1024x1024).

Layout (pixels, origin top-left):
  y   0..512   faces: 4 cols x 4 rows of 256x128 cells. Each face cell is a cylindrical wrap of the
               head: x 0 = back of head, x 128 = front (nose), x 256 = back again; y 0 = crown,
               y 128 = base of the neck. Hair is painted on so the head reads even under a hat.
  y 512..1024  fabrics + details: 8 cols x 4 rows of 128x128 cells (see FABRICS).
Tintable fabrics are painted in light neutral greys: the renderer multiplies them by a
per-instance coat / accessory colour (mask comes from the mesh's vertex colour).
"""
import json, math, random

W, H = 1024, 1280
FACE_W, FACE_H = 256, 128
CELL = 128

# name -> (col, row) in the 8x6 fabric grid (row 0 starts at y=512)
FABRICS = {
    "wool": (0, 0), "puffer": (1, 0), "parka": (2, 0), "knit": (3, 0),
    "fleece": (4, 0), "denim": (5, 0), "charcoal": (6, 0), "khaki": (7, 0),
    "leggings": (0, 1), "sweats": (1, 1), "plaid_red": (2, 1), "plaid_green": (3, 1),
    "stripe_scarf": (4, 1), "leather_brown": (5, 1), "leather_black": (6, 1), "sneaker": (7, 1),
    "tote": (0, 2), "paperbag": (1, 2), "courier": (2, 2), "nylon": (3, 2),
    "misc": (4, 2), "hair_black": (5, 2), "hair_brown": (6, 2), "hair_blonde": (7, 2),
    "hair_grey": (0, 3), "hair_red": (1, 3), "fur": (2, 3), "camel": (3, 3),
    "houndstooth": (4, 3), "flannel": (5, 3), "hivis": (6, 3), "boot_tan": (7, 3),
    "trench": (0, 4), "stroller": (1, 4), "gear": (2, 4), "windbreaker": (3, 4),
    "dog_golden": (4, 4), "dog_golden_head": (5, 4), "dog_doxie": (6, 4), "dog_doxie_head": (7, 4),
    "dog_white": (0, 5), "dog_white_head": (1, 5), "dog_fawn": (2, 5), "dog_fawn_head": (3, 5),
    "dog_coat": (4, 5), "hairlight": (5, 5), "spare1": (6, 5), "spare2": (7, 5),
}
TINTABLE = {"wool", "puffer", "parka", "knit", "fleece", "nylon", "houndstooth", "windbreaker", "dog_coat", "hairlight",
            "dog_golden"}

# faces: index -> spec. skin, hair colour, hair style, extras
FACES = [
    dict(name="ben",    skin=(0.93, 0.76, 0.64), hair=(0.30, 0.20, 0.12), style="short", brow=(0.28, 0.18, 0.11), extras=["stubble"]),
    dict(name="marcus", skin=(0.42, 0.27, 0.18), hair=(0.06, 0.05, 0.05), style="fade",  brow=(0.08, 0.06, 0.05), extras=[]),
    dict(name="priya",  skin=(0.72, 0.52, 0.38), hair=(0.07, 0.05, 0.05), style="long",  brow=(0.10, 0.07, 0.06), extras=["lashes"]),
    dict(name="mei",    skin=(0.95, 0.80, 0.66), hair=(0.06, 0.05, 0.06), style="bob",   brow=(0.10, 0.08, 0.07), extras=["lashes"]),
    dict(name="siobhan",skin=(0.97, 0.82, 0.73), hair=(0.62, 0.27, 0.12), style="long",  brow=(0.50, 0.25, 0.14), extras=["lashes", "freckles"]),
    dict(name="omar",   skin=(0.78, 0.58, 0.42), hair=(0.09, 0.07, 0.06), style="short", brow=(0.09, 0.07, 0.06), extras=["beard"]),
    dict(name="walter", skin=(0.91, 0.74, 0.65), hair=(0.80, 0.80, 0.78), style="balding", brow=(0.70, 0.70, 0.68), extras=["glasses", "wrinkles"]),
    dict(name="gloria", skin=(0.36, 0.23, 0.16), hair=(0.82, 0.81, 0.80), style="short_curl", brow=(0.55, 0.53, 0.52), extras=["wrinkles", "lashes"]),
    dict(name="leo",    skin=(0.70, 0.50, 0.36), hair=(0.22, 0.14, 0.09), style="short", brow=(0.20, 0.13, 0.09), extras=["kid"]),
    dict(name="ava",    skin=(0.96, 0.81, 0.70), hair=(0.85, 0.68, 0.38), style="long",  brow=(0.68, 0.52, 0.30), extras=["kid", "lashes"]),
    dict(name="nia",    skin=(0.30, 0.19, 0.13), hair=(0.05, 0.04, 0.04), style="braids", brow=(0.06, 0.05, 0.04), extras=["lashes"]),
    dict(name="arjun",  skin=(0.62, 0.43, 0.30), hair=(0.06, 0.05, 0.05), style="short", brow=(0.06, 0.05, 0.04), extras=["mustache"]),
    dict(name="kenji",  skin=(0.92, 0.77, 0.62), hair=(0.08, 0.07, 0.07), style="short", brow=(0.09, 0.07, 0.06), extras=["glasses"]),
    dict(name="rosa",   skin=(0.85, 0.64, 0.50), hair=(0.18, 0.11, 0.07), style="bun",   brow=(0.16, 0.10, 0.07), extras=["lashes"]),
    dict(name="harold", skin=(0.48, 0.32, 0.22), hair=(0.86, 0.85, 0.83), style="balding", brow=(0.75, 0.74, 0.72), extras=["wrinkles", "beard"]),
    dict(name="mae",    skin=(0.96, 0.80, 0.70), hair=(0.92, 0.91, 0.90), style="bun",   brow=(0.62, 0.60, 0.58), extras=["wrinkles", "glasses", "lashes"]),
]
# face groups used for per-instance face swaps (m/f adults, older m/f, kids)
GROUPS = {"ben": "m", "marcus": "m", "omar": "m", "arjun": "m", "kenji": "m", "priya": "f", "mei": "f", "siobhan": "f",
          "nia": "f", "rosa": "f", "walter": "om", "harold": "om", "gloria": "of", "mae": "of", "leo": "kid", "ava": "kid"}


def half(name, top):
    """dog fur cells: top half for the body, bottom half for legs / tail / ears / neck"""
    x, y, w, h = fabric_rect(name)
    return (x, y + (0 if top else h // 2), w, h // 2)


def face_rect(i):
    c, r = i % 4, i // 4
    return (c * FACE_W, r * FACE_H, FACE_W, FACE_H)


def fabric_rect(name):
    c, r = FABRICS[name]
    return (c * CELL, 512 + r * CELL, CELL, CELL)


# the plain-skin patch in every face cell (front of the neck): hands map here
SKIN_PATCH = (112, 104, 32, 18)   # x, y, w, h inside the face cell
# the misc cell is split in four 64x64 quarters
MISC = {"phone": (0, 0), "cup": (1, 0), "metal": (0, 1), "white": (1, 1)}


def misc_rect(name):
    x, y, _, _ = fabric_rect("misc")
    c, r = MISC[name]
    return (x + c * 64, y + r * 64, 64, 64)


def layout_json():
    return {
        "size": [W, H],
        "faces": [{"name": f["name"], "rect": face_rect(i), "group": GROUPS[f["name"]], "hair": f["hair"], "skin": f["skin"]}
                  for i, f in enumerate(FACES)],
        "fabrics": {k: fabric_rect(k) for k in FABRICS},
        "misc": {k: misc_rect(k) for k in MISC},
        "tintable": sorted(TINTABLE),
    }


# ---------------------------------------------------------------------------------- Tesseract doc

class Doc:
    def __init__(self):
        self.next_id = 1
        self.next_fx = 1
        self.rng = random.Random(1129)

    def lid(self):
        self.next_id += 1
        return self.next_id

    def fx(self, effect):
        self.next_fx += 1
        return {"id": self.next_fx, "effect": effect}

    @staticmethod
    def tf(x=0.0, y=0.0, rot=0.0, op=100):
        return {"anchorPoint": [0, 0], "position": [x, y], "scale": [100, 100], "rotation": rot, "opacity": op}

    AR = {"start": 0, "duration": 3000}

    def rect(self, x, y, w, h, c, op=100, blend="normal", effects=None, round_=0.0, name=None, grad=None, rot=0.0):
        r = {"size": [w, h], "fillColor": list(c) + ([1.0] if len(c) == 3 else []), "roundness": round_}
        if grad:
            r["fillPaint"] = grad
        return {"type": "Rect", "id": self.lid(), "name": name or "rect", "blendMode": blend, "activeRange": self.AR,
                "transform": self.tf(x, y, rot, op), "rect": r, "effects": effects or []}

    def _fill(self, c, op=100, grad=None):
        paint = grad or {"type": "solid", "color": list(c) + ([1.0] if len(c) == 3 else [])}
        return [{"paint": paint, "fillRule": "nonZeroWinding", "blendMode": "normal", "opacity": op / 100.0}]

    def ellipse(self, cx, cy, w, h, c, op=100, blend="normal", name=None, grad=None, effects=None, rot=0.0):
        return {"type": "Shape", "id": self.lid(), "name": name or "ellipse", "blendMode": blend, "activeRange": self.AR,
                "transform": self.tf(cx, cy, rot), "effects": effects or [],
                "shape": {"path": {"commands": []}, "ellipse": {"size": [w, h]}, "fills": self._fill(c, op, grad)}}

    def poly(self, pts, c, op=100, blend="normal", name=None, smooth=False, stroke=None, effects=None, closed=True):
        cmds = [{"type": "moveTo", "x": pts[0][0], "y": pts[0][1]}]
        if smooth and len(pts) > 2:
            # Catmull-Rom through the points, as cubic beziers
            P = pts + ([pts[0], pts[1], pts[2]] if closed else [pts[-1], pts[-1]])
            n = len(pts) if closed else len(pts) - 1
            for i in range(n):
                p0, p1, p2, p3 = P[i - 1] if (i > 0 or closed) else P[0], P[i], P[i + 1], P[i + 2]
                cmds.append({"type": "cubicTo",
                             "c1x": p1[0] + (p2[0] - p0[0]) / 6, "c1y": p1[1] + (p2[1] - p0[1]) / 6,
                             "c2x": p2[0] - (p3[0] - p1[0]) / 6, "c2y": p2[1] - (p3[1] - p1[1]) / 6,
                             "x": p2[0], "y": p2[1]})
        else:
            cmds += [{"type": "lineTo", "x": p[0], "y": p[1]} for p in pts[1:]]
        if closed:
            cmds.append({"type": "close"})
        shape = {"path": {"commands": cmds}, "fills": self._fill(c, op) if c is not None else []}
        if stroke:
            sc, sw = stroke
            shape["strokes"] = [{"paint": {"type": "solid", "color": list(sc) + [1.0]}, "width": sw, "cap": "round",
                                 "join": "round", "miterLimit": 4, "blendMode": "normal", "opacity": 1.0}]
        return {"type": "Shape", "id": self.lid(), "name": name or "poly", "blendMode": blend, "activeRange": self.AR,
                "transform": self.tf(0, 0), "shape": shape, "effects": effects or []}

    def line(self, pts, c, width, op=100, blend="normal", name=None):
        lay = self.poly(pts, None, name=name or "line", stroke=(c, width), closed=False, blend=blend)
        lay["shape"]["strokes"][0]["opacity"] = op / 100.0
        return lay

    def group(self, name, x, y, w, h, layers, effects=None, clip=True):
        g = {"type": "Group", "id": self.lid(), "name": name, "blendMode": "normal",
             "playback": {"type": "windowed", "inputRange": dict(self.AR),
                          "mapping": {"type": "linear", "input": dict(self.AR), "output": dict(self.AR)}, "inputOffsetMs": 0},
             "transform": self.tf(x, y), "layers": list(reversed(layers)), "effects": effects or []}
        if clip:
            g["masks"] = [{"id": self.lid(), "mode": "add", "opacity": 100, "path": {"commands": [
                {"type": "moveTo", "x": 0, "y": 0}, {"type": "lineTo", "x": w, "y": 0}, {"type": "lineTo", "x": w, "y": h},
                {"type": "lineTo", "x": 0, "y": h}, {"type": "close"}]}}]
        return g

    def lin(self, x0, y0, x1, y1, stops):
        return {"type": "gradient", "gradientType": "linear", "start": [x0, y0], "end": [x1, y1],
                "stops": [{"offset": o, "color": list(c) + ([1.0] if len(c) == 3 else [])} for o, c in stops]}

    def rad(self, cx, cy, r, stops):
        return {"type": "gradient", "gradientType": "radial", "start": [cx, cy], "end": [cx + r, cy],
                "stops": [{"offset": o, "color": list(c) + ([1.0] if len(c) == 4 - 1 else [])} for o, c in stops]}

    # texture helpers ---------------------------------------------------------------------
    def noise(self, w, h, op=18, scale=40, blend="overlay", kind="cloudy", seed=0.0):
        return self.rect(0, 0, w, h, (0.5, 0.5, 0.5), op=op, blend=blend, name="noise",
                         effects=[self.fx({"type": "turbulentNoise", "scale": scale, "fractalType": kind, "evolution": seed,
                                           "contrast": 120, "complexity": 4})])

    def grain(self, amount=6, size=1.0):
        return self.fx({"type": "grain", "amount": amount, "size": size, "softness": 0.3})

    def desat(self):
        return self.fx({"type": "hueSaturation", "saturation": -100})


def mul(c, k):
    return tuple(max(0.0, min(1.0, v * k)) for v in c)


def mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


# ---------------------------------------------------------------------------------- fabrics

def twill(d, w, h, base, step=4, dark=0.88, light=1.08, op=55, angle=1.0):
    out = [d.rect(0, 0, w, h, base, name="base")]
    k = -h
    while k < w + h:
        out.append(d.line([(k, h), (k + h * angle, 0)], mul(base, dark), 1.4, op=op))
        out.append(d.line([(k + step / 2, h), (k + step / 2 + h * angle, 0)], mul(base, light), 1.0, op=op * 0.7))
        k += step
    return out


def fabric_layers(d, name, w=CELL, h=CELL):
    L = []
    if name == "wool":
        base = (0.80, 0.80, 0.80)
        L += twill(d, w, h, base, step=3, op=45)
        L.append(d.noise(w, h, op=22, scale=30))
        # side seams (u=.25/.75) and a centre-front button placket (u=.5)
        for sx in (32, 96):
            L.append(d.line([(sx, 0), (sx, h)], mul(base, 0.8), 1.2, op=60))
        L.append(d.rect(62, 0, 5, h, mul(base, 0.86), op=80))
        for by in (20, 44, 68):
            L.append(d.ellipse(58, by, 6, 6, (0.12, 0.11, 0.10)))
            L.append(d.ellipse(71, by, 6, 6, (0.12, 0.11, 0.10)))
        L.append(d.rect(20, 78, 22, 4, mul(base, 0.7), op=70))   # pocket flaps
        L.append(d.rect(86, 78, 22, 4, mul(base, 0.7), op=70))
    elif name == "puffer":
        base = (0.82, 0.82, 0.82)
        L.append(d.rect(0, 0, w, h, base))
        band = h / 6
        for i in range(6):
            y0 = i * band
            L.append(d.rect(0, y0, w, band, base, grad=d.lin(0, y0, 0, y0 + band, [
                (0.0, mul(base, 0.62)), (0.22, mul(base, 0.95)), (0.45, mul(base, 1.18)), (0.8, mul(base, 0.92)), (1.0, mul(base, 0.6))])))
            L.append(d.line([(0, y0), (w, y0)], mul(base, 0.45), 1.5, op=90))
        L.append(d.rect(62, 0, 4, h, (0.25, 0.25, 0.26)))   # zip
        L.append(d.rect(63, 0, 2, h, (0.62, 0.62, 0.64)))
        L.append(d.noise(w, h, op=8, scale=60))
    elif name == "parka":
        base = (0.76, 0.76, 0.74)
        L += twill(d, w, h, base, step=2, op=25)
        L.append(d.noise(w, h, op=16, scale=25))
        L.append(d.rect(60, 0, 8, h, mul(base, 0.85)))           # storm flap
        for y in range(6, h, 14):
            L.append(d.ellipse(64, y, 4, 4, (0.25, 0.25, 0.25)))  # snaps
        for px in (18, 84):                                       # cargo pockets
            L.append(d.rect(px, 66, 26, 30, mul(base, 0.93), round_=3))
            L.append(d.rect(px - 1, 62, 28, 8, mul(base, 0.82), round_=2))
            L.append(d.line([(px + 2, 72), (px + 24, 72)], mul(base, 0.6), 0.8, op=70))
        for sx in (32, 96):
            L.append(d.line([(sx, 0), (sx, h)], mul(base, 0.75), 1.2, op=60))
        L.append(d.rect(0, 30, w, 3, mul(base, 0.8), op=60))      # waist drawcord channel
    elif name == "knit":
        base = (0.80, 0.80, 0.80)
        L.append(d.rect(0, 0, w, h, base))
        for x in range(0, w, 6):
            L.append(d.rect(x, 0, 3, h, base, grad=d.lin(x, 0, x + 3, 0, [(0, mul(base, 0.78)), (0.5, mul(base, 1.1)), (1, mul(base, 0.85))])))
        for y in range(0, h, 4):
            L.append(d.line([(0, y), (w, y)], mul(base, 0.85), 0.6, op=40))
        L.append(d.rect(0, h - 26, w, 26, mul(base, 0.92), op=60))  # cuff band
        L.append(d.line([(0, h - 26), (w, h - 26)], mul(base, 0.7), 1.5, op=80))
    elif name == "fleece":
        base = (0.80, 0.80, 0.80)
        L.append(d.rect(0, 0, w, h, base))
        L.append(d.noise(w, h, op=30, scale=12, kind="turbulentSmooth"))
        L.append(d.rect(62, 0, 4, h, (0.3, 0.3, 0.3)))           # zip
        L.append(d.rect(0, h - 14, w, 14, mul(base, 0.85)))      # hem band
        L.append(d.rect(0, 0, w, 10, mul(base, 0.88)))           # collar band
    elif name == "denim":
        base = (0.22, 0.33, 0.52)
        L += twill(d, w, h, base, step=3, dark=0.8, light=1.35, op=60)
        L.append(d.noise(w, h, op=25, scale=35))
        L.append(d.rect(48, 10, 32, 50, (0.6, 0.7, 0.85), op=14, round_=12))  # thigh fade
        for sx in (32, 96):
            L.append(d.line([(sx, 0), (sx, h)], (0.78, 0.55, 0.25), 1.0, op=80))
        L.append(d.rect(0, h - 6, w, 6, mul(base, 0.8)))         # hem
    elif name in ("charcoal", "khaki"):
        base = (0.17, 0.17, 0.19) if name == "charcoal" else (0.66, 0.57, 0.42)
        L += twill(d, w, h, base, step=2, dark=0.92, light=1.1, op=30)
        L.append(d.noise(w, h, op=14, scale=30))
        L.append(d.line([(64, 0), (64, h)], mul(base, 1.35), 1.0, op=60))   # front crease
        L.append(d.line([(0, 0), (0, h)], mul(base, 1.35), 1.0, op=60))
        for sx in (32, 96):
            L.append(d.line([(sx, 0), (sx, h)], mul(base, 0.7), 1.0, op=60))
    elif name == "leggings":
        base = (0.07, 0.07, 0.08)
        L.append(d.rect(0, 0, w, h, base, grad=d.lin(0, 0, w, 0, [(0, base), (0.25, (0.16, 0.16, 0.18)), (0.5, base), (0.75, (0.16, 0.16, 0.18)), (1, base)])))
    elif name == "sweats":
        base = (0.52, 0.52, 0.54)
        L.append(d.rect(0, 0, w, h, base))
        L.append(d.noise(w, h, op=35, scale=8, kind="turbulentSmooth"))
        for sx in (30, 94):
            L.append(d.rect(sx, 0, 4, h, (0.93, 0.93, 0.93)))
        L.append(d.rect(0, h - 14, w, 14, mul(base, 0.85)))      # cuffs
    elif name in ("plaid_red", "plaid_green"):
        if name == "plaid_red":
            base, a, b, t = (0.62, 0.10, 0.10), (0.10, 0.20, 0.12), (0.08, 0.10, 0.22), (0.95, 0.82, 0.30)
        else:
            base, a, b, t = (0.12, 0.26, 0.18), (0.06, 0.10, 0.25), (0.05, 0.06, 0.08), (0.85, 0.20, 0.15)
        L.append(d.rect(0, 0, w, h, base))
        for o in (0, 64):
            L.append(d.rect(o + 6, 0, 18, h, a, op=55))
            L.append(d.rect(0, o + 6, w, 18, a, op=55))
            L.append(d.rect(o + 34, 0, 8, h, b, op=60))
            L.append(d.rect(0, o + 34, w, 8, b, op=60))
            L.append(d.rect(o + 50, 0, 2, h, t, op=80))
            L.append(d.rect(0, o + 50, w, 2, t, op=80))
        L.append(d.noise(w, h, op=20, scale=20))
        for x in (0, w - 6):                                    # fringe ends
            pass
    elif name == "stripe_scarf":
        cols = [(0.86, 0.66, 0.18), (0.92, 0.88, 0.80), (0.12, 0.17, 0.32), (0.92, 0.88, 0.80)]
        for i in range(8):
            L.append(d.rect(0, i * 16, w, 16, cols[i % 4]))
        for x in range(0, w, 5):
            L.append(d.line([(x, 0), (x, h)], (0, 0, 0), 0.7, op=12))
        L.append(d.noise(w, h, op=15, scale=15))
    elif name in ("leather_brown", "leather_black", "boot_tan"):
        base = {"leather_brown": (0.36, 0.20, 0.11), "leather_black": (0.08, 0.075, 0.07), "boot_tan": (0.55, 0.38, 0.20)}[name]
        L.append(d.rect(0, 0, w, h, base, grad=d.lin(0, 0, w, 0, [(0, mul(base, 0.8)), (0.5, mul(base, 1.35)), (1, mul(base, 0.8))])))
        L.append(d.noise(w, h, op=20, scale=10, kind="rocky"))
        # sole bands at the ring's bottom (u=0 and u=1 edges), welt stitch, laces at the top (u=.5)
        sole = (0.10, 0.08, 0.07) if name != "leather_black" else (0.03, 0.03, 0.03)
        if name == "boot_tan":
            sole = (0.20, 0.13, 0.08)
        L.append(d.rect(0, 0, 16, h, sole))
        L.append(d.rect(w - 16, 0, 16, h, sole))
        L.append(d.line([(19, 0), (19, h)], mul(base, 1.5), 0.8, op=70))
        L.append(d.line([(w - 19, 0), (w - 19, h)], mul(base, 1.5), 0.8, op=70))
        if name != "leather_black":
            for y in range(40, 100, 10):
                L.append(d.line([(56, y), (72, y + 4)], (0.85, 0.80, 0.70), 1.4))
                L.append(d.line([(72, y), (56, y + 4)], (0.85, 0.80, 0.70), 1.4))
    elif name == "sneaker":
        base = (0.93, 0.93, 0.92)
        L.append(d.rect(0, 0, w, h, base))
        L.append(d.rect(0, 0, 18, h, (0.80, 0.80, 0.78)))
        L.append(d.rect(w - 18, 0, 18, h, (0.80, 0.80, 0.78)))
        L.append(d.rect(16, 0, 3, h, (0.55, 0.56, 0.58)))
        L.append(d.rect(w - 19, 0, 3, h, (0.55, 0.56, 0.58)))
        L.append(d.poly([(26, 70), (40, 52), (54, 66), (60, 58)], None, stroke=((0.20, 0.35, 0.62), 4)))   # invented swoosh-free stripe mark
        L.append(d.poly([(102, 70), (88, 52), (74, 66), (68, 58)], None, stroke=((0.20, 0.35, 0.62), 4)))
        for y in range(36, 96, 9):
            L.append(d.line([(58, y), (70, y)], (0.75, 0.75, 0.75), 2))
        L.append(d.rect(0, 108, w, 20, (0.85, 0.85, 0.84)))     # toe cap
    elif name == "tote":
        base = (0.88, 0.84, 0.74)
        L += twill(d, w, h, base, step=2, op=30)
        # invented logo: a falling leaf inside a ring, plus a bar "wordmark"
        L.append(d.ellipse(64, 50, 46, 46, (0.16, 0.34, 0.22)))
        L.append(d.ellipse(64, 50, 38, 38, base))
        L.append(d.poly([(64, 34), (74, 46), (70, 60), (64, 66), (58, 60), (54, 46)], (0.83, 0.38, 0.13), smooth=True))
        L.append(d.line([(64, 40), (64, 70)], (0.16, 0.34, 0.22), 1.6))
        L.append(d.rect(40, 80, 48, 5, (0.16, 0.34, 0.22), round_=2))
        L.append(d.rect(48, 89, 32, 3, (0.16, 0.34, 0.22), round_=1))
    elif name == "paperbag":
        base = (0.64, 0.47, 0.30)
        L.append(d.rect(0, 0, w, h, base))
        for x in range(0, w, 3):
            L.append(d.line([(x, 0), (x, h)], mul(base, 0.9), 0.8, op=30))
        L.append(d.noise(w, h, op=18, scale=20))
        L.append(d.rect(0, 0, w, 10, mul(base, 0.85)))            # folded top
        # invented store mark: white roundel with a stylised acorn and two bars
        L.append(d.ellipse(64, 56, 40, 40, (0.97, 0.95, 0.90)))
        L.append(d.ellipse(64, 60, 16, 18, (0.42, 0.20, 0.12)))
        L.append(d.rect(55, 46, 18, 7, (0.25, 0.15, 0.10), round_=3))
        L.append(d.rect(38, 84, 52, 4, (0.97, 0.95, 0.90)))
        L.append(d.rect(46, 92, 36, 3, (0.97, 0.95, 0.90)))
    elif name == "courier":
        base = (0.96, 0.42, 0.10)
        L.append(d.rect(0, 0, w, h, base, grad=d.lin(0, 0, 0, h, [(0, mul(base, 1.08)), (1, mul(base, 0.85))])))
        L.append(d.noise(w, h, op=10, scale=30))
        # invented courier logo "zip arrow" on a white rounded square
        L.append(d.rect(38, 34, 52, 52, (0.98, 0.97, 0.94), round_=10))
        L.append(d.poly([(48, 70), (62, 50), (66, 60), (80, 44), (78, 56), (84, 54), (66, 76), (62, 64)], (0.10, 0.10, 0.12)))
        L.append(d.rect(0, 100, w, 6, (0.75, 0.76, 0.78)))      # reflective strip
    elif name == "nylon":
        base = (0.78, 0.78, 0.78)
        L += twill(d, w, h, base, step=2, op=20)
        L.append(d.rect(36, 56, 56, 46, mul(base, 0.9), round_=8))   # front pocket (u=.5)
        L.append(d.line([(40, 60), (88, 60)], (0.2, 0.2, 0.2), 1.6))
        L.append(d.rect(56, 6, 16, 10, (0.15, 0.15, 0.15), round_=2))  # logo patch
        L.append(d.rect(59, 9, 10, 4, (0.85, 0.85, 0.85)))
        L.append(d.line([(0, 30), (w, 30)], mul(base, 0.6), 1.2, op=60))
    elif name == "misc":
        # phone (top-left), coffee cup (top-right), metal (bottom-left), white (bottom-right)
        L.append(d.rect(0, 0, 64, 64, (0.05, 0.05, 0.06)))
        L.append(d.rect(10, 6, 44, 52, (0.35, 0.55, 0.85), round_=4, grad=d.lin(0, 6, 0, 58, [(0, (0.55, 0.75, 0.95)), (1, (0.25, 0.35, 0.75))])))
        L.append(d.rect(16, 14, 32, 6, (1, 1, 1), op=70))
        L.append(d.rect(16, 26, 24, 4, (1, 1, 1), op=50))
        L.append(d.rect(64, 0, 64, 64, (0.96, 0.95, 0.92)))
        L.append(d.rect(64, 22, 64, 22, (0.55, 0.36, 0.20)))
        L.append(d.ellipse(96, 33, 14, 14, (0.14, 0.40, 0.30)))
        L.append(d.rect(0, 64, 64, 64, (0.6, 0.6, 0.62), grad=d.lin(0, 64, 64, 128, [(0, (0.8, 0.8, 0.82)), (0.5, (0.45, 0.45, 0.48)), (1, (0.7, 0.7, 0.72))])))
        L.append(d.rect(64, 64, 64, 64, (0.94, 0.94, 0.93)))
    elif name.startswith("hair_"):
        base = {"hair_black": (0.06, 0.05, 0.05), "hair_brown": (0.28, 0.17, 0.10), "hair_blonde": (0.82, 0.66, 0.38),
                "hair_grey": (0.78, 0.78, 0.76), "hair_red": (0.60, 0.26, 0.11)}[name]
        L.append(d.rect(0, 0, w, h, base, grad=d.lin(0, 0, 0, h, [(0, mul(base, 1.15)), (1, mul(base, 0.8))])))
        r = d.rng
        for i in range(70):
            x = r.uniform(0, w)
            k = r.choice((0.6, 1.5, 1.8))
            L.append(d.line([(x, 0), (x + r.uniform(-6, 6), h)], mul(base, k) if base[0] > 0.1 else mix(base, (0.35, 0.3, 0.3), 0.5 if k > 1 else 0), r.uniform(0.6, 1.6), op=45))
    elif name == "fur":
        base = (0.88, 0.84, 0.76)
        L.append(d.rect(0, 0, w, h, base))
        L.append(d.noise(w, h, op=55, scale=6, kind="turbulentSharp", blend="multiply"))
        r = d.rng
        for i in range(60):
            x, y = r.uniform(0, w), r.uniform(0, h)
            L.append(d.line([(x, y), (x + r.uniform(-4, 4), y + r.uniform(5, 10))], (1, 0.98, 0.94), 1.0, op=60))
    elif name == "camel":
        base = (0.68, 0.52, 0.33)
        L += twill(d, w, h, base, step=3, op=40)
        L.append(d.noise(w, h, op=18, scale=30))
        L.append(d.rect(62, 0, 5, h, mul(base, 0.88)))
        for by in (24, 50, 76):
            L.append(d.ellipse(58, by, 6, 6, (0.25, 0.16, 0.10)))
        L.append(d.rect(0, 52, w, 7, mul(base, 0.85)))           # belt
        L.append(d.rect(58, 50, 12, 11, (0.75, 0.65, 0.40)))
    elif name == "houndstooth":
        base = (0.86, 0.86, 0.86)
        dark = (0.40, 0.40, 0.40)
        L.append(d.rect(0, 0, w, h, base))
        s = 8
        for gx in range(0, w, s):
            for gy in range(0, h, s):
                if (gx // s + gy // s) % 2 == 0:
                    L.append(d.poly([(gx, gy), (gx + s / 2, gy), (gx + s, gy - s / 2), (gx + s, gy + s / 2), (gx + s / 2, gy + s), (gx, gy + s)], dark, op=85))
        L.append(d.line([(64, 0), (64, h)], mul(base, 0.5), 2))
        L.append(d.noise(w, h, op=10, scale=30))
    elif name == "flannel":
        base = (0.62, 0.12, 0.10)
        L.append(d.rect(0, 0, w, h, base))
        for o in range(0, w, 32):
            L.append(d.rect(o, 0, 12, h, (0.08, 0.06, 0.06), op=65))
            L.append(d.rect(0, o, w, 12, (0.08, 0.06, 0.06), op=65))
            L.append(d.rect(o + 22, 0, 2, h, (0.95, 0.9, 0.85), op=60))
            L.append(d.rect(0, o + 22, w, 2, (0.95, 0.9, 0.85), op=60))
        L.append(d.noise(w, h, op=18, scale=20))
    elif name == "hivis":
        base = (0.93, 0.85, 0.12)
        L.append(d.rect(0, 0, w, h, base, grad=d.lin(0, 0, 0, h, [(0, mul(base, 1.05)), (1, mul(base, 0.82))])))
        L.append(d.noise(w, h, op=12, scale=30))
        for y in (42, 92):
            L.append(d.rect(0, y, w, 9, (0.80, 0.82, 0.84)))
            L.append(d.rect(0, y + 3, w, 3, (0.95, 0.96, 0.97)))
        L.append(d.rect(62, 0, 4, h, (0.2, 0.2, 0.2)))
    elif name == "trench":
        base = (0.72, 0.62, 0.45)
        L += twill(d, w, h, base, step=2, op=35)
        L.append(d.noise(w, h, op=12, scale=30))
        L.append(d.rect(0, 50, w, 8, mul(base, 0.8)))                       # belt
        L.append(d.rect(56, 48, 16, 12, (0.30, 0.22, 0.14), round_=2))      # buckle
        L.append(d.rect(60, 51, 8, 6, mul(base, 0.8)))
        for by in (16, 32, 72, 90):                                         # double-breasted buttons
            for bx in (52, 76):
                L.append(d.ellipse(bx, by, 6, 6, (0.22, 0.16, 0.10)))
        L.append(d.line([(66, 0), (60, 128)], mul(base, 0.75), 1.2, op=70))
        L.append(d.rect(14, 0, 24, 20, mul(base, 0.92), op=80))             # storm flap
    elif name == "stroller":
        base = (0.16, 0.18, 0.22)
        L.append(d.rect(0, 0, w, h, base, grad=d.lin(0, 0, 0, h, [(0, mul(base, 1.3)), (1, mul(base, 0.8))])))
        L += [d.line([(0, y), (w, y)], mul(base, 1.6), 1.0, op=40) for y in range(8, h, 16)]
        L.append(d.rect(0, 0, w, 10, (0.75, 0.76, 0.78)))                   # piping
        L.append(d.ellipse(64, 52, 22, 22, (0.85, 0.55, 0.35)))            # invented brand dot
    elif name == "gear":
        # quarters: camera body (TL), lens (TR), hard hat (BL), rubber (BR)
        L.append(d.rect(0, 0, 64, 64, (0.08, 0.08, 0.09)))
        L.append(d.rect(0, 20, 64, 22, (0.20, 0.20, 0.22)))
        L.append(d.rect(6, 6, 12, 8, (0.75, 0.75, 0.78)))
        L.append(d.rect(64, 0, 64, 64, (0.05, 0.05, 0.06)))
        L.append(d.ellipse(96, 32, 40, 40, (0.20, 0.22, 0.28)))
        L.append(d.ellipse(96, 32, 22, 22, (0.35, 0.45, 0.65)))
        L.append(d.ellipse(92, 28, 7, 7, (0.9, 0.95, 1.0)))
        L.append(d.rect(0, 64, 64, 64, (0.95, 0.94, 0.90), grad=d.lin(0, 64, 0, 128, [(0, (1, 1, 0.97)), (1, (0.82, 0.82, 0.78))])))
        L.append(d.rect(0, 100, 64, 4, (0.85, 0.40, 0.12)))
        L.append(d.rect(64, 64, 64, 64, (0.10, 0.10, 0.10)))
    elif name == "windbreaker":
        base = (0.84, 0.84, 0.84)
        L.append(d.rect(0, 0, w, h, base, grad=d.lin(0, 0, w, 0, [(0, mul(base, 0.9)), (0.5, mul(base, 1.08)), (1, mul(base, 0.9))])))
        L.append(d.rect(0, 34, w, 14, mul(base, 0.62)))                     # colour-block band
        L.append(d.rect(62, 0, 4, h, (0.22, 0.22, 0.24)))
        for px in (24, 86):
            L.append(d.line([(px, 70), (px + 14, 96)], (0.25, 0.25, 0.25), 1.6))
    elif name in ("dog_golden", "dog_doxie", "dog_white", "dog_fawn"):
        base = {"dog_golden": (0.86, 0.80, 0.70), "dog_doxie": (0.07, 0.06, 0.05), "dog_white": (0.93, 0.92, 0.88),
                "dog_fawn": (0.80, 0.64, 0.42)}[name]
        L.append(d.rect(0, 0, w, h, base, grad=d.lin(0, 0, w, 0, [(0, mul(base, 0.85)), (0.5, mul(base, 1.08)), (1, mul(base, 0.85))])))
        r = d.rng
        for i in range(90):
            x, y = r.uniform(0, w), r.uniform(0, h)
            L.append(d.line([(x, y), (x + r.uniform(-2, 2), y + r.uniform(4, 9))], mul(base, 0.75) if base[0] > 0.2 else (0.22, 0.2, 0.18), 1.0, op=45))
        if name == "dog_doxie":   # tan belly (u=0 edges of the body half) and tan paws (bottom of the leg half)
            tan = (0.62, 0.36, 0.16)
            L.append(d.rect(0, 0, 18, 64, tan, op=90))
            L.append(d.rect(w - 18, 0, 18, 64, tan, op=90))
            L.append(d.rect(0, 104, w, 24, tan))
        if name == "dog_white":
            L.append(d.rect(0, 116, w, 12, mul(base, 0.85)))
    elif name.endswith("_head") and name.startswith("dog_"):
        kind = name[4:-5]
        base = {"golden": (0.86, 0.80, 0.70), "doxie": (0.07, 0.06, 0.05), "white": (0.93, 0.92, 0.88), "fawn": (0.80, 0.64, 0.42)}[kind]
        # head loft: u=0 under the jaw, u=.5 on top; v=0 back of skull (y=128), v=1 nose (y=0)
        L.append(d.rect(0, 0, w, h, base, grad=d.lin(0, 0, w, 0, [(0, mul(base, 0.85)), (0.5, mul(base, 1.05)), (1, mul(base, 0.85))])))
        if kind == "doxie":
            L.append(d.rect(0, 0, 26, 70, (0.62, 0.36, 0.16)))
            L.append(d.rect(w - 26, 0, 26, 70, (0.62, 0.36, 0.16)))
            for s_ in (-1, 1):
                L.append(d.ellipse(64 + s_ * 20, 58, 8, 6, (0.62, 0.36, 0.16)))
        if kind == "fawn":
            L.append(d.rect(0, 0, w, 60, (0.10, 0.08, 0.07)))             # black muzzle mask
            for y in (50, 56):
                L.append(d.line([(40, y), (64, y - 4), (88, y)], (0.04, 0.03, 0.03), 1.4))
        for s_ in (-1, 1):                                                 # eyes
            ex = 64 + s_ * 17
            L.append(d.ellipse(ex, 66, 11, 10, (0.04, 0.03, 0.03)))
            L.append(d.ellipse(ex + 2, 63, 3, 3, (1, 1, 1)))
            L.append(d.line([(ex - 6, 57), (ex + 5, 58)], mul(base, 0.6) if base[0] > 0.2 else (0.5, 0.3, 0.15), 2.0))
        L.append(d.rect(0, 0, w, 14, (0.05, 0.04, 0.04)))                    # nose (tip rows)
        L.append(d.rect(30, 14, 68, 8, (0.08, 0.06, 0.06), round_=4))
        for x in (0, w - 6):                                               # mouth line under the snout
            L.append(d.rect(x, 0, 6, 46, (0.10, 0.06, 0.06)))
    elif name == "dog_coat":
        base = (0.82, 0.82, 0.82)
        L.append(d.rect(0, 0, w, h, base))
        for i in range(8):
            y0 = i * 16
            L.append(d.rect(0, y0, w, 16, base, grad=d.lin(0, y0, 0, y0 + 16, [(0, mul(base, 0.65)), (0.45, mul(base, 1.15)), (1, mul(base, 0.65))])))
        L.append(d.rect(0, 0, w, 8, (0.15, 0.15, 0.15)))
    elif name == "hairlight":
        # neutral strands for tinted hair meshes (the renderer multiplies in the hair colour)
        base = (0.80, 0.80, 0.80)
        L.append(d.rect(0, 0, w, h, base, grad=d.lin(0, 0, 0, h, [(0, mul(base, 1.1)), (1, mul(base, 0.8))])))
        r = d.rng
        for i in range(80):
            x = r.uniform(0, w)
            L.append(d.line([(x, 0), (x + r.uniform(-6, 6), h)], mul(base, r.choice((0.6, 0.75, 1.2))), r.uniform(0.6, 1.6), op=55))
    elif name.startswith("spare"):
        L.append(d.rect(0, 0, w, h, (0.5, 0.5, 0.5)))
    return L


# ---------------------------------------------------------------------------------- faces

def face_layers(d, f):
    w, h = FACE_W, FACE_H
    skin, hair, brow = f["skin"], f["hair"], f["brow"]
    kid = "kid" in f["extras"]
    L = []
    # base skin with a soft shadow toward the back of the head and under the jaw
    L.append(d.rect(0, 0, w, h, skin, grad=d.lin(0, 0, w, 0, [(0, mul(skin, 0.86)), (0.35, skin), (0.5, mul(skin, 1.03)), (0.65, skin), (1, mul(skin, 0.86))])))
    L.append(d.rect(0, 84, w, 44, skin, grad=d.lin(0, 84, 0, 128, [(0, mul(skin, 0.8) + (0.0,)), (0.35, mul(skin, 0.8) + (0.6,)), (1, mul(skin, 0.8) + (0.7,))])))  # neck shade
    L.append(d.poly([(96, 92), (112, 100), (144, 100), (160, 92), (160, 97), (144, 104), (112, 104), (96, 97)], mul(skin, 0.72), op=45))  # jaw shadow
    # ears (x 64 / 192 = sides)
    for ex in (64, 192):
        L.append(d.ellipse(ex, 60, 12, 20, mul(skin, 0.88)))
        L.append(d.ellipse(ex, 60, 6, 12, mul(skin, 0.72)))
    # cheeks
    blush = mix(skin, (0.85, 0.35, 0.35), 0.25)
    for cx in (106, 150):
        L.append(d.ellipse(cx, 72, 16, 10, blush, op=45))
    # nose: soft side shading + highlight
    L.append(d.ellipse(128, 67, 10, 12, mul(skin, 0.86), op=70))
    L.append(d.ellipse(128, 63, 4, 9, mul(skin, 1.12), op=70))
    L.append(d.ellipse(125, 72, 3, 2, mul(skin, 0.55), op=80))
    L.append(d.ellipse(131, 72, 3, 2, mul(skin, 0.55), op=80))
    # eyes
    ey, ex0 = 52, 18
    ew, eh = (13, 8) if kid else (12, 6.5)
    for s in (-1, 1):
        cx = 128 + s * ex0
        L.append(d.ellipse(cx, ey + 1.5, ew + 4, eh + 4, mul(skin, 0.80), op=60))        # socket shade
        L.append(d.ellipse(cx, ey, ew, eh, (0.96, 0.95, 0.93)))
        L.append(d.ellipse(cx + s * 0.5, ey, eh + 0.5, eh + 0.5, (0.16, 0.10, 0.07) if skin[0] < 0.8 else (0.25, 0.32, 0.38)))
        L.append(d.ellipse(cx + s * 0.5, ey, eh * 0.45, eh * 0.45, (0.02, 0.02, 0.02)))
        L.append(d.ellipse(cx + s * 0.5 + 1.2, ey - 1.2, 1.8, 1.8, (1, 1, 1)))
        lash = 2.2 if "lashes" in f["extras"] else 1.4
        L.append(d.line([(cx - ew / 2 - 1, ey + 0.5), (cx - 2, ey - eh / 2 - 0.4), (cx + ew / 2 + 1, ey - 0.5)], (0.08, 0.05, 0.04), lash))
        # brows
        by = ey - 9
        bx = [cx - s * 7, cx, cx + s * 8]
        L.append(d.line([(bx[0], by + 1.5), (bx[1], by - 1.5), (bx[2], by + 0.5)], brow, 3.2 if not kid else 2.6))
    # mouth
    lip = mix(skin, (0.55, 0.18, 0.18), 0.45)
    L.append(d.poly([(118, 82), (123, 80), (128, 81), (133, 80), (138, 82), (128, 83.5)], mul(lip, 0.65), smooth=True))
    L.append(d.ellipse(128, 85.5, 13, 4, lip, op=85))
    L.append(d.ellipse(128, 91, 10, 3, mul(skin, 0.85), op=60))                # chin dimple shade
    if "freckles" in f["extras"]:
        for i in range(18):
            x = 128 + d.rng.uniform(-26, 26)
            L.append(d.ellipse(x, d.rng.uniform(62, 74), 1.6, 1.6, mul(skin, 0.72), op=70))
    if "wrinkles" in f["extras"]:
        for y in (34, 38):
            L.append(d.line([(112, y), (128, y - 1), (144, y)], mul(skin, 0.78), 1.0, op=70))
        for s in (-1, 1):
            L.append(d.line([(128 + s * 8, 70), (128 + s * 13, 80), (128 + s * 12, 86)], mul(skin, 0.75), 1.2, op=70))
            L.append(d.line([(128 + s * 28, 50), (128 + s * 32, 53)], mul(skin, 0.75), 1.0, op=70))
    if "stubble" in f["extras"]:
        L.append(d.poly([(100, 74), (110, 92), (128, 98), (146, 92), (156, 74), (150, 90), (128, 101), (106, 90)], hair, op=30))
        L.append(d.ellipse(128, 89, 26, 14, hair, op=22))
        L.append(d.ellipse(128, 78, 22, 5, hair, op=25))
    if "beard" in f["extras"]:
        L.append(d.poly([(96, 60), (100, 80), (112, 98), (128, 104), (144, 98), (156, 80), (160, 60), (152, 76), (140, 86), (128, 88), (116, 86), (104, 76)], hair, smooth=False))
        L.append(d.poly([(116, 79), (128, 76.5), (140, 79), (138, 81), (128, 79.5), (118, 81)], hair))
        L.append(d.ellipse(128, 85.5, 9, 2.5, lip, op=80))
    if "mustache" in f["extras"]:
        L.append(d.poly([(115, 81), (122, 77), (128, 78), (134, 77), (141, 81), (134, 80), (128, 80.5), (122, 80)], hair, smooth=True))
    # hair painted on the scalp
    st = f["style"]
    hl = {"short": 26, "fade": 24, "long": 22, "bob": 24, "balding": 30, "short_curl": 25, "braids": 22, "bun": 24}[st]
    back = {"short": 78, "fade": 74, "long": 128, "bob": 100, "balding": 76, "short_curl": 80, "braids": 128, "bun": 84}[st]
    hairshape = [(0, 0), (w, 0), (w, back), (210, back - 4), (200, 52), (186, 40), (166, hl + 4), (150, hl - 2), (128, hl + 2),
                 (106, hl - 2), (90, hl + 4), (70, 40), (56, 52), (46, back - 4), (0, back)]
    if st in ("long", "bob", "braids"):
        # hair falls in front of the ears too
        hairshape = [(0, 0), (w, 0), (w, back), (204, back), (196, 70), (176, 36), (158, hl), (128, hl + 6),
                     (98, hl), (80, 36), (60, 70), (52, back), (0, back)]
    if st == "fade":
        L.append(d.poly(hairshape, hair, op=55))
        L.append(d.poly([(0, 0), (w, 0), (w, 40), (180, 32), (150, hl - 2), (128, hl + 1), (106, hl - 2), (76, 32), (0, 40)], hair))
    elif st == "balding":
        L.append(d.poly(hairshape, hair, op=95))
        L.append(d.poly([(60, 0), (196, 0), (190, 26), (128, 36), (66, 26)], skin, smooth=True))      # bald crown
        L.append(d.ellipse(128, 18, 70, 30, mul(skin, 1.08), op=60))
    else:
        L.append(d.poly(hairshape, hair, smooth=False))
    if st in ("short_curl",):
        for i in range(60):
            x, y = d.rng.uniform(0, w), d.rng.uniform(0, hl + 10)
            if 80 < x < 176 and y > hl - 6:
                continue
            L.append(d.ellipse(x, y, 5, 5, mul(hair, 0.8), op=60))
    # strand texture, kept inside the hair outline
    outline = sorted([p for p in hairshape if p[1] > 0 and 0 < p[0] < w] + [(0, back), (w, back)])

    def edge(x):
        for (x0, y0), (x1, y1) in zip(outline, outline[1:]):
            if x0 <= x <= x1:
                return y0 + (y1 - y0) * ((x - x0) / max(1e-6, x1 - x0))
        return back
    for i in range(50):
        x = d.rng.uniform(0, w)
        yb = edge(x) - 5
        if st == "balding" and 60 < x < 196:
            continue
        L.append(d.line([(x, 0), (x + d.rng.uniform(-3, 3), max(4, yb))], mul(hair, 1.6) if hair[0] < 0.2 else mul(hair, 0.75), 0.8, op=35))
    if st == "braids":
        for x in list(range(4, 52, 7)) + list(range(208, 256, 7)):
            L.append(d.line([(x, 20), (x, 128)], mul(hair, 2.4), 1.2, op=60))
    if "glasses" in f["extras"]:
        fr = (0.10, 0.08, 0.08)
        for s in (-1, 1):
            cx = 128 + s * ex0
            L.append(d.poly([(cx - 9, ey - 6), (cx + 9, ey - 6), (cx + 9, ey + 6), (cx - 9, ey + 6)], None, stroke=(fr, 2.0)))
            L.append(d.line([(cx + s * 9, ey - 4), (128 + s * 58, ey - 2)], fr, 1.6))
        L.append(d.line([(124, ey - 3), (132, ey - 3)], fr, 1.8))
    return L


def build_doc():
    d = Doc()
    layers = []
    for i, f in enumerate(FACES):
        x, y, w, h = face_rect(i)
        layers.append(d.group("face_" + f["name"], x, y, w, h, face_layers(d, f)))
    for name in FABRICS:
        x, y, w, h = fabric_rect(name)
        layers.append(d.group("fabric_" + name, x, y, w, h, fabric_layers(d, name)))
    layers.reverse()   # layers[0] is frontmost; order is irrelevant (cells don't overlap) but keep faces on top
    return {"$schema": "https://jerboa.dev/schemas/fx-composition/editable/v1/document.schema.json", "formatVersion": 1,
            "dimensions": {"width": W, "height": H}, "duration": 3.0, "backgroundColor": [0.5, 0.5, 0.5, 1.0],
            "composition": {"id": "main", "name": "People atlas", "layers": layers}}


if __name__ == "__main__":
    print(json.dumps(build_doc())[:200])
