"""Far From the Tree - New York street furniture textures, authored as editable Tesseract compositions.

Imported by build_street.py (system Python, standard library only) and by street_blender.py (for the
atlas rects). Each entry in DOCS becomes tools/street/tesseract/<Name>/<Name>.tsrct (the editable
source) and a rendered <Name>.png.

  Atlas  2048x2048 RGBA  everything the street_props.glb models and the runtime's sign plates sample:
                         galvanised steel, cast iron, stainless, hydrant paint, the blue mailbox,
                         concrete, the green wire basket (alpha), sidewalk-shed plywood and deck,
                         Con Ed stack stripes, signal housings, bus-shelter ads, the kiosk screen,
                         the bike-share kiosk, newsstand panels, a pay station, parking-rule signs,
                         ONE WAY arrows, the bus stop flag, WALK / hand glyphs, lenses, the halal
                         cart sign and umbrella (rects in R below; v = 1 - y / 2048).
  Names  2048x2048 RGB   green street-name blades with the real street names from city.json,
                         256x56 px each, 8 per row, in sorted order (see names_layout()).

All branding is invented: no real logos, agencies or companies.
"""
import json, math, os, random

AW = AH = 2048
HERE = os.path.dirname(os.path.abspath(__file__))

# --------------------------------------------------------------------------------- atlas layout
R = {
    # row A (y 0..256)
    "galv": (0, 0, 256, 256), "iron": (256, 0, 256, 256), "steel": (512, 0, 256, 256), "hydrant": (768, 0, 256, 256),
    "red": (1024, 0, 256, 256), "mail_front": (1280, 0, 256, 256), "mail_side": (1536, 0, 256, 256), "concrete": (1792, 0, 256, 256),
    # row B (y 256..512)
    "wire": (0, 256, 256, 256), "bag": (256, 256, 256, 256), "plywood": (512, 256, 512, 256), "deck": (1024, 256, 256, 256),
    "stack": (1280, 256, 256, 256), "soil": (1536, 256, 256, 256), "sigbody": (1792, 256, 256, 256),
    # row C (y 512..1024)
    "ad_soup": (0, 512, 256, 512), "ad_pigeon": (256, 512, 256, 512), "ad_leaf": (512, 512, 256, 512),
    "kiosk_screen": (768, 512, 256, 512), "bike_kiosk": (1024, 512, 256, 512),
    "news_front": (1280, 512, 512, 256), "news_sign": (1280, 768, 512, 128), "news_side": (1280, 896, 512, 128),
    "munimeter": (1792, 512, 256, 256), "bus_info": (1792, 768, 256, 256),
    # row D (y 1024..1344): signs and glyphs
    "oneway_r": (0, 1024, 384, 128), "oneway_l": (0, 1152, 384, 128),
    "noparking": (384, 1024, 192, 288), "nostanding": (576, 1024, 192, 288), "sweep": (768, 1024, 192, 288),
    "loading": (960, 1024, 192, 288), "bus_sign": (1152, 1024, 224, 304),
    "walk": (1408, 1024, 128, 128), "hand": (1536, 1024, 128, 128), "lens": (1664, 1024, 128, 128), "lamp": (1792, 1024, 128, 128),
    "white": (1920, 1024, 128, 128),
    "plate_back": (1408, 1152, 128, 128), "rubber": (1536, 1152, 128, 128), "glass": (1664, 1152, 128, 128), "bike_brand": (1792, 1152, 256, 128),
    "blank_blade": (0, 1280, 384, 64),
    # row E (y 1344..)
    "cart_sign": (0, 1344, 512, 256), "umbrella": (512, 1344, 256, 256), "dock": (768, 1344, 128, 256),
    "ad_cider": (896, 1344, 256, 512), "jersey": (1152, 1344, 512, 256), "shed_end": (1664, 1344, 384, 256),
    "bench_seat": (0, 1600, 256, 128), "news_roof": (256, 1600, 256, 128), "cobra": (512, 1600, 256, 256),
}

NAME_W, NAME_H, NAME_COLS = 256, 56, 8


def street_names():
    """every roadway name in city.json, sorted (the runtime looks names up by string)"""
    with open(os.path.join(HERE, "..", "..", "public", "city.json")) as f:
        city = json.load(f)
    return sorted({s["n"] for s in city["streets"] if s["rw"] == 1})


def pretty(n):
    """'W  33 ST' -> 'W 33 St', '5 AVE' -> '5 Av', 'AVE OF THE AMERICAS' -> 'Av of the Americas'"""
    words = n.split()
    out = []
    small = {"OF": "of", "THE": "the", "AND": "and"}
    abbr = {"ST": "St", "AVE": "Av", "PL": "Pl", "SQ": "Sq", "DR": "Dr", "BRG": "Brg", "ALY": "Aly", "RD": "Rd", "SLP": "Slip",
            "BLVD": "Blvd", "EN": "Ent", "TER": "Ter", "PLZ": "Plz", "CIR": "Cir", "HWY": "Hwy", "LN": "Ln"}
    for i, w in enumerate(words):
        if w in ("E", "W", "N", "S"):
            out.append(w)
        elif w in abbr:
            out.append(abbr[w])
        elif w in small and i > 0:
            out.append(small[w])
        elif w.isdigit():
            out.append(w)
        else:
            out.append(w[:1] + w[1:].lower())
    return " ".join(out)


def names_layout():
    names = street_names()
    cells = {}
    for i, n in enumerate(names):
        cells[n] = (i % NAME_COLS * NAME_W, i // NAME_COLS * NAME_H, NAME_W, NAME_H)
    return names, cells


def layout_json():
    names, cells = names_layout()
    return {"atlas": {"size": [AW, AH], "rects": R}, "names": {"size": [AW, AH], "rects": cells}}


# --------------------------------------------------------------------------------- doc helpers

class Doc:
    AR = {"start": 0, "duration": 3000}

    def __init__(self, seed, fonts):
        self.nid = 1
        self.rng = random.Random(seed)
        self.fonts = fonts   # name -> (family, style)

    def lid(self):
        self.nid += 1
        return self.nid

    def fx(self, effect):
        return {"id": self.lid(), "effect": effect}

    @staticmethod
    def tf(x=0.0, y=0.0, rot=0.0, op=100, sx=100, sy=100):
        return {"anchorPoint": [0, 0], "position": [x, y], "scale": [sx, sy], "rotation": rot, "opacity": op}

    @staticmethod
    def col(c):
        return list(c) + ([1.0] if len(c) == 3 else [])

    def rect(self, x, y, w, h, c, op=100, blend="normal", effects=None, round_=0.0, name="rect", grad=None, rot=0.0):
        r = {"size": [w, h], "fillColor": self.col(c), "roundness": round_}
        if grad:
            r["fillPaint"] = grad
        return {"type": "Rect", "id": self.lid(), "name": name, "blendMode": blend, "activeRange": self.AR,
                "transform": self.tf(x, y, rot, op), "rect": r, "effects": effects or []}

    def _fill(self, c, op=100, grad=None):
        return [{"paint": grad or {"type": "solid", "color": self.col(c)}, "fillRule": "nonZeroWinding", "blendMode": "normal", "opacity": op / 100.0}]

    def ellipse(self, cx, cy, w, h, c, op=100, blend="normal", name="ellipse", grad=None, effects=None, rot=0.0):
        return {"type": "Shape", "id": self.lid(), "name": name, "blendMode": blend, "activeRange": self.AR,
                "transform": self.tf(cx, cy, rot), "effects": effects or [],
                "shape": {"path": {"commands": []}, "ellipse": {"size": [w, h]}, "fills": self._fill(c, op, grad)}}

    def poly(self, pts, c, op=100, blend="normal", name="poly", smooth=False, stroke=None, effects=None, closed=True):
        cmds = [{"type": "moveTo", "x": pts[0][0], "y": pts[0][1]}]
        if smooth and len(pts) > 2:
            P = pts + ([pts[0], pts[1], pts[2]] if closed else [pts[-1], pts[-1]])
            n = len(pts) if closed else len(pts) - 1
            for i in range(n):
                p0 = P[i - 1] if (i > 0 or closed) else P[0]
                p1, p2, p3 = P[i], P[i + 1], P[i + 2]
                cmds.append({"type": "cubicTo", "c1x": p1[0] + (p2[0] - p0[0]) / 6, "c1y": p1[1] + (p2[1] - p0[1]) / 6,
                             "c2x": p2[0] - (p3[0] - p1[0]) / 6, "c2y": p2[1] - (p3[1] - p1[1]) / 6, "x": p2[0], "y": p2[1]})
        else:
            cmds += [{"type": "lineTo", "x": p[0], "y": p[1]} for p in pts[1:]]
        if closed:
            cmds.append({"type": "close"})
        shape = {"path": {"commands": cmds}, "fills": self._fill(c, op) if c is not None else []}
        if stroke:
            sc, sw = stroke[0], stroke[1]
            sop = stroke[2] if len(stroke) > 2 else 100
            shape["strokes"] = [{"paint": {"type": "solid", "color": self.col(sc)}, "width": sw, "cap": "round", "join": "round",
                                 "miterLimit": 4, "blendMode": "normal", "opacity": sop / 100.0}]
        return {"type": "Shape", "id": self.lid(), "name": name, "blendMode": blend, "activeRange": self.AR,
                "transform": self.tf(0, 0), "shape": shape, "effects": effects or []}

    def line(self, pts, c, width, op=100, blend="normal", name="line", smooth=False, effects=None):
        return self.poly(pts, None, name=name, stroke=(c, width, op), closed=False, blend=blend, smooth=smooth, effects=effects)

    def text(self, x, y, s, size, c, font="arial", just="center", name="text", tracking=0.0, op=100, rot=0.0, sx=100):
        fam, sty = self.fonts[font]
        t = {"type": "Text", "id": self.lid(), "name": name + ":" + s[:16], "blendMode": "normal", "activeRange": self.AR,
             "transform": self.tf(x, y, rot, op, sx=sx), "effects": [],
             "sourceText": {"text": s, "fontFamily": fam, "fontStyle": sty, "fontSize": size, "fillColor": self.col(c),
                            "strokeWidth": 0, "justification": just, "tracking": tracking}}
        return t

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
                "stops": [{"offset": o, "color": self.col(c)} for o, c in stops]}

    def rad(self, cx, cy, r, stops):
        return {"type": "gradient", "gradientType": "radial", "start": [cx, cy], "end": [cx + r, cy],
                "stops": [{"offset": o, "color": self.col(c)} for o, c in stops]}

    def noise(self, w, h, op=18, scale=40, blend="softLight", kind="cloudy", seed=0.0, contrast=70, name="noise"):
        return self.rect(0, 0, w, h, (0.5, 0.5, 0.5), op=op, blend=blend, name=name,
                         effects=[self.fx({"type": "turbulentNoise", "scale": scale, "fractalType": kind, "evolution": seed,
                                           "contrast": contrast, "complexity": 5})])

    def blur(self, r):
        return self.fx({"type": "gaussianBlur", "blurriness": r})

    def grain(self, amount=6, size=1.0):
        return self.fx({"type": "grain", "amount": amount, "size": size, "softness": 0.3})

    def blob(self, cx, cy, rx, ry, n=9, jit=0.35, rot=0.0):
        pts = []
        for i in range(n):
            a = i / n * math.tau
            k = 1 + (self.rng.random() - 0.5) * 2 * jit
            x, y = math.cos(a) * rx * k, math.sin(a) * ry * k
            pts.append((cx + x * math.cos(rot) - y * math.sin(rot), cy + x * math.sin(rot) + y * math.cos(rot)))
        return pts


def mul(c, k):
    return tuple(max(0.0, min(1.0, v * k)) for v in c[:3])


def mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


WHITE = (0.95, 0.95, 0.93)
BLACK = (0.06, 0.06, 0.07)
RED = (0.78, 0.10, 0.09)
NYGREEN = (0.0, 0.42, 0.25)


def grime(d, w, h, op=40, top=False):
    """road dirt splashed up from the bottom (or rain streaks down from the top)"""
    L = []
    if top:
        for _ in range(int(w / 18)):
            x = d.rng.random() * w
            L.append(d.line([(x, 0), (x + (d.rng.random() - 0.5) * 8, h * (0.3 + d.rng.random() * 0.6))], (0.2, 0.18, 0.16), 3 + d.rng.random() * 6, op=op * 0.5, effects=[d.blur(4)]))
    else:
        L.append(d.rect(0, h * 0.62, w, h * 0.38, (0.22, 0.19, 0.16), op=op, blend="multiply",
                        grad=d.lin(0, h * 0.62, 0, h, [(0, (1, 1, 1)), (1, (0.45, 0.42, 0.38))]), name="splash"))
    return L


def scratches(d, w, h, n, c, op=50):
    L = []
    for _ in range(n):
        x, y = d.rng.random() * w, d.rng.random() * h
        a = d.rng.random() * math.tau
        l = 4 + d.rng.random() * 18
        L.append(d.line([(x, y), (x + math.cos(a) * l, y + math.sin(a) * l)], c, 0.8 + d.rng.random() * 1.2, op=op))
    return L


def chips(d, w, h, n, c, op=80, s=5):
    return [d.poly(d.blob(d.rng.random() * w, d.rng.random() * h, 1 + d.rng.random() * s, 1 + d.rng.random() * s * 0.7, n=6), c, op=op) for _ in range(n)]


def stickers(d, w, h, n):
    """faded stickers and tags: abstract blocks of colour and scribbles (no real brands)"""
    L = []
    for _ in range(n):
        x, y = d.rng.random() * (w - 40), d.rng.random() * (h - 30)
        c = d.rng.choice([(0.95, 0.92, 0.85), (0.9, 0.75, 0.2), (0.85, 0.35, 0.3), (0.3, 0.55, 0.85), (0.15, 0.15, 0.15)])
        sw, sh = 18 + d.rng.random() * 30, 10 + d.rng.random() * 18
        L.append(d.rect(x, y, sw, sh, c, op=55 + d.rng.random() * 30, round_=2, rot=(d.rng.random() - 0.5) * 20))
        L.append(d.line([(x + 3, y + sh * 0.5), (x + sw * 0.4, y + sh * 0.3), (x + sw - 4, y + sh * 0.6)], mul(c, 0.4), 1.5, op=60, smooth=True))
    return L


# --------------------------------------------------------------------------------- the atlas cells

def cell_layers(d, name, w, h):
    r = d.rng
    L = []
    if name == "galv":   # galvanised steel poles: spangled zinc grey, wrapped round (u), grime at the foot (v down)
        base = (0.56, 0.58, 0.58)
        L.append(d.rect(0, 0, w, h, base, grad=d.lin(0, 0, w, 0, [(0, mul(base, 0.75)), (0.32, mul(base, 1.22)), (0.5, base), (1, mul(base, 0.72))])))
        for _ in range(140):   # spangle
            L.append(d.poly(d.blob(r.random() * w, r.random() * h, 3 + r.random() * 8, 3 + r.random() * 8, n=6), mix(base, (0.75, 0.77, 0.78) if r.random() < 0.5 else (0.42, 0.44, 0.45), 0.5), op=35))
        L.append(d.noise(w, h, op=25, scale=18, kind="turbulentSmooth"))
        L += stickers(d, w, h * 0.5, 3)
        L += grime(d, w, h, 45)
        L += chips(d, w, h, 18, (0.42, 0.30, 0.20), op=55, s=3)
    elif name == "iron":  # NYC lamppost green-black cast iron
        base = (0.10, 0.15, 0.12)
        L.append(d.rect(0, 0, w, h, base, grad=d.lin(0, 0, w, 0, [(0, mul(base, 0.6)), (0.3, mul(base, 2.0)), (0.45, mul(base, 1.2)), (1, mul(base, 0.6))])))
        L.append(d.noise(w, h, op=22, scale=20, kind="turbulentSmooth"))
        L += chips(d, w, h, 40, (0.34, 0.22, 0.14), op=60, s=4)
        L += grime(d, w, h, 35)
    elif name == "steel":  # brushed stainless with seams
        base = (0.66, 0.68, 0.70)
        L.append(d.rect(0, 0, w, h, base, grad=d.lin(0, 0, 0, h, [(0, (0.80, 0.82, 0.84)), (0.5, base), (1, (0.52, 0.53, 0.55))])))
        for _ in range(110):
            y = r.random() * h
            L.append(d.line([(0, y), (w, y)], r.choice([(0.86, 0.87, 0.89), (0.52, 0.53, 0.55)]), 0.8, op=40))
        L.append(d.line([(w / 2, 0), (w / 2, h)], (0.38, 0.39, 0.41), 2))
        L += scratches(d, w, h, 30, (0.9, 0.9, 0.92), 40)
        L += grime(d, w, h, 30)
    elif name == "hydrant":  # NYC hydrant: silver paint over cast iron, chipped to rust
        base = (0.70, 0.71, 0.70)
        L.append(d.rect(0, 0, w, h, base, grad=d.lin(0, 0, w, 0, [(0, mul(base, 0.7)), (0.35, mul(base, 1.25)), (0.6, base), (1, mul(base, 0.68))])))
        L.append(d.noise(w, h, op=30, scale=10, kind="turbulentSmooth"))
        L += chips(d, w, h, 50, (0.45, 0.25, 0.13), op=75, s=5)
        L += chips(d, w, h, 25, (0.15, 0.13, 0.12), op=60, s=3)
        L += grime(d, w, h, 50)
    elif name == "red":   # red paint (caps, standpipes)
        base = (0.70, 0.09, 0.07)
        L.append(d.rect(0, 0, w, h, base, grad=d.lin(0, 0, w, 0, [(0, mul(base, 0.7)), (0.35, mul(base, 1.3)), (1, mul(base, 0.7))])))
        L.append(d.noise(w, h, op=25, scale=14, kind="turbulentSmooth"))
        L += chips(d, w, h, 30, (0.40, 0.22, 0.12), op=70, s=4)
        L += grime(d, w, h, 35)
    elif name in ("mail_front", "mail_side"):  # the blue collection box (invented markings)
        base = (0.11, 0.24, 0.52)
        L.append(d.rect(0, 0, w, h, base, grad=d.lin(0, 0, 0, h, [(0, mul(base, 1.25)), (0.6, base), (1, mul(base, 0.75))])))
        L.append(d.noise(w, h, op=20, scale=16, kind="turbulentSmooth"))
        if name == "mail_front":
            L.append(d.rect(28, 16, w - 56, 50, mul(base, 0.75), round_=6))           # the pull-down chute
            L.append(d.rect(48, 26, w - 96, 14, (0.75, 0.76, 0.78), round_=6))
            L.append(d.text(w / 2, 108, "MAIL", 40, WHITE, font="arial", tracking=60))
            L.append(d.rect(52, 128, w - 104, 70, (0.92, 0.92, 0.9), round_=3))      # pickup times label
            for i, s in enumerate(["LAST PICKUP", "MON-FRI  5:00 PM", "SAT  1:00 PM"]):
                L.append(d.text(w / 2, 148 + i * 20, s, 13, (0.12, 0.14, 0.2), font="arial"))
            L.append(d.ellipse(w / 2, 225, 34, 34, (0.85, 0.85, 0.82), op=85))      # an invented emblem: a winged envelope
            L.append(d.poly([(w / 2 - 10, 219), (w / 2 + 10, 219), (w / 2 + 10, 232), (w / 2 - 10, 232)], base))
            L.append(d.line([(w / 2 - 10, 219), (w / 2, 226), (w / 2 + 10, 219)], WHITE, 1.5))
        else:
            L += stickers(d, w, h, 6)
            L.append(d.text(w / 2, 70, "U.S. MAIL", 26, WHITE, font="arial", tracking=40, op=90))
        L += scratches(d, w, h, 40, (0.6, 0.65, 0.75), 35)
        L += grime(d, w, h, 40)
    elif name == "concrete":
        base = (0.62, 0.61, 0.58)
        L.append(d.rect(0, 0, w, h, base))
        L.append(d.noise(w, h, op=40, scale=12, kind="turbulentSmooth", contrast=60))
        for _ in range(60):
            L.append(d.ellipse(r.random() * w, r.random() * h, 2 + r.random() * 4, 2 + r.random() * 4, (0.35, 0.34, 0.32), op=50))
        for _ in range(8):
            x = r.random() * w
            L.append(d.line([(x, 0), (x + (r.random() - 0.5) * 10, h * 0.6)], (0.32, 0.30, 0.28), 6 + r.random() * 12, op=22, effects=[d.blur(8)]))
        L += grime(d, w, h, 45)
    elif name == "wire":  # NYC litter basket: green-painted diamond mesh (alpha)
        c = (0.12, 0.32, 0.20)
        for k in range(-256, 512, 22):
            L.append(d.line([(k, 0), (k + 256, 256)], c, 3.4))
            L.append(d.line([(k, 256), (k + 256, 0)], c, 3.4))
        for y in (0, 64, 128, 192):
            L.append(d.rect(0, y, w, 7, mul(c, 0.8)))
        L.append(d.rect(0, h - 14, w, 14, mul(c, 0.8)))
        L += chips(d, w, h, 25, (0.45, 0.30, 0.18), op=80, s=3)
    elif name == "bag":
        base = (0.05, 0.05, 0.06)
        L.append(d.rect(0, 0, w, h, base))
        for _ in range(16):
            x = r.random() * w
            L.append(d.line([(x, 0), (x + (r.random() - 0.5) * 50, h)], (0.32, 0.32, 0.36), 4 + r.random() * 6, op=40, effects=[d.blur(5)]))
        # stuff poking out the top: a cup, newspaper, leaves
        L.append(d.rect(30, 6, 40, 30, (0.9, 0.9, 0.86), op=90, rot=-8))
        L.append(d.rect(120, 4, 70, 24, (0.78, 0.76, 0.70), op=90, rot=6))
        L.append(d.ellipse(210, 18, 26, 16, (0.55, 0.30, 0.10), op=85))
    elif name == "plywood":   # sidewalk shed parapet: green-painted plywood sheets, POST NO BILLS, a permit sign
        base = (0.10, 0.34, 0.20)
        L.append(d.rect(0, 0, w, h, base))
        for x in range(0, w + 1, 128):   # sheet joints (4 ft)
            L.append(d.line([(x, 0), (x, h)], mul(base, 0.55), 3))
        for _ in range(40):
            y = r.random() * h
            L.append(d.line([(0, y), (w, y + (r.random() - 0.5) * 6)], mul(base, 0.85 + r.random() * 0.3), 1 + r.random() * 2, op=35))
        L.append(d.noise(w, h, op=25, scale=30))
        for x0 in (40, 300):
            L.append(d.text(x0 + 80, 70, "POST NO BILLS", 30, (0.92, 0.92, 0.88), font="impact", tracking=30, op=85))
        L.append(d.rect(204, 112, 96, 74, (0.96, 0.96, 0.94)))   # building permit
        L.append(d.rect(204, 112, 96, 16, (0.12, 0.2, 0.45)))
        for i in range(5):
            L.append(d.rect(212, 136 + i * 9, 60 + r.random() * 20, 4, (0.3, 0.3, 0.32)))
        L.append(d.rect(16, 120, 70, 90, (0.92, 0.88, 0.80), op=80, rot=-3))   # torn poster remains
        L.append(d.rect(20, 124, 62, 30, (0.85, 0.35, 0.25), op=70, rot=-3))
        L.append(d.line([(340, 150), (360, 130), (385, 160), (410, 128), (430, 156)], (0.85, 0.85, 0.85), 4, op=55, smooth=True))  # a tag
        L.append(d.line([(420, 210), (470, 190), (490, 215)], (0.9, 0.6, 0.15), 5, op=50, smooth=True))
        L.append(d.rect(0, h - 22, w, 22, mul(base, 0.6)))
        L += grime(d, w, h, 30, top=True)
    elif name == "deck":   # the shed's underside: plywood, joists, a fluorescent fixture
        base = (0.52, 0.42, 0.30)
        L.append(d.rect(0, 0, w, h, base))
        for _ in range(50):
            y = r.random() * h
            L.append(d.line([(0, y), (w, y + (r.random() - 0.5) * 10)], mul(base, 0.8 + r.random() * 0.4), 1 + r.random() * 2, op=45))
        for x in range(0, w + 1, 64):
            L.append(d.rect(x - 6, 0, 12, h, (0.30, 0.24, 0.18)))
        L.append(d.noise(w, h, op=30, scale=20))
        L.append(d.rect(0, 0, w, h, (0.2, 0.2, 0.22), op=35, blend="multiply"))
    elif name == "stack":  # Con Ed chimney: orange and white bands with reflective tape
        for i in range(8):
            c = (0.95, 0.42, 0.06) if i % 2 == 0 else (0.95, 0.94, 0.90)
            L.append(d.rect(0, i * 32, w, 32, c))
            L.append(d.rect(0, i * 32 + 13, w, 6, mul(c, 1.1), op=60))
        L.append(d.noise(w, h, op=25, scale=20))
        L += grime(d, w, h, 50)
        L += scratches(d, w, h, 40, (0.3, 0.3, 0.3), 35)
    elif name == "soil":   # a planter's top in November: dark soil, dead leaves, a few dry stalks
        L.append(d.rect(0, 0, w, h, (0.20, 0.15, 0.11)))
        L.append(d.noise(w, h, op=45, scale=6, kind="turbulentSmooth"))
        for _ in range(70):
            c = r.choice([(0.55, 0.30, 0.10), (0.45, 0.22, 0.08), (0.62, 0.45, 0.18), (0.35, 0.20, 0.10)])
            L.append(d.poly(d.blob(r.random() * w, r.random() * h, 6 + r.random() * 9, 3 + r.random() * 5, n=7, rot=r.random() * 3), c, op=90))
        for _ in range(10):
            x, y = r.random() * w, r.random() * h
            L.append(d.line([(x, y), (x + (r.random() - 0.5) * 40, y + (r.random() - 0.5) * 40)], (0.6, 0.52, 0.36), 2, op=80))
        for _ in range(4):   # a cigarette butt or two
            L.append(d.rect(r.random() * w, r.random() * h, 10, 3, (0.92, 0.88, 0.8), rot=r.random() * 180))
    elif name == "sigbody":  # signal housing: dark painted aluminium, a little dusty
        base = (0.14, 0.15, 0.15)
        L.append(d.rect(0, 0, w, h, base, grad=d.lin(0, 0, w, 0, [(0, mul(base, 0.7)), (0.4, mul(base, 1.6)), (1, mul(base, 0.7))])))
        L.append(d.noise(w, h, op=25, scale=14, kind="turbulentSmooth"))
        L += grime(d, w, h, 25, top=True)
    elif name.startswith("ad_"):   # illuminated bus-shelter posters (invented brands, a bit of humour)
        L += ad_layers(d, name, w, h)
    elif name == "kiosk_screen":   # a city wi-fi kiosk (invented "CITYWAVE")
        L.append(d.rect(0, 0, w, h, (0.05, 0.07, 0.12)))
        L.append(d.rect(0, 0, w, h * 0.62, (0.1, 0.2, 0.4), grad=d.lin(0, 0, 0, h * 0.62, [(0, (0.16, 0.36, 0.70)), (1, (0.06, 0.12, 0.30))])))
        L.append(d.text(w / 2, 46, "CITYWAVE", 34, WHITE, font="bahn", tracking=40))
        L.append(d.text(w / 2, 72, "free wi-fi  ·  calls  ·  charging", 13, (0.75, 0.85, 1.0), font="arial"))
        L.append(d.text(w / 2, 170, "38°", 86, WHITE, font="bahn"))
        L.append(d.text(w / 2, 200, "CLOUDY  ·  WIND NW 18 MPH", 14, (0.8, 0.88, 1.0), font="arial"))
        # a little map
        L.append(d.rect(20, 220, w - 40, 160, (0.88, 0.88, 0.84), round_=6))
        for i in range(7):
            L.append(d.line([(20 + i * 36, 220), (20 + i * 36 + 30, 380)], (1, 1, 1), 5))
        for i in range(5):
            L.append(d.line([(20, 236 + i * 34), (w - 20, 236 + i * 34)], (1, 1, 1), 4))
        L.append(d.line([(40, 380), (w - 30, 220)], (0.98, 0.84, 0.3), 6))   # Broadway
        L.append(d.ellipse(w / 2, 300, 16, 16, (0.9, 0.2, 0.2)))
        L.append(d.text(w / 2, 420, "YOU ARE HERE", 16, (0.85, 0.9, 1.0), font="arial", tracking=60))
        L.append(d.rect(0, h - 64, w, 64, (0.08, 0.12, 0.2)))
        L.append(d.text(w / 2, h - 26, "911  ·  311  ·  CHARGE", 18, (0.95, 0.75, 0.25), font="arial"))
    elif name == "bike_kiosk":   # bike share pay kiosk (invented "BORO BIKE")
        base = (0.06, 0.45, 0.50)
        L.append(d.rect(0, 0, w, h, base))
        L.append(d.noise(w, h, op=18, scale=20))
        L.append(d.rect(16, 18, w - 32, 70, WHITE, round_=8))
        L.append(d.text(w / 2, 66, "BORO BIKE", 34, base, font="bahn", tracking=20))
        L.append(d.rect(40, 110, w - 80, 120, (0.05, 0.07, 0.08), round_=6))
        L.append(d.text(w / 2, 165, "TAP · RIDE", 22, (0.4, 0.9, 0.85), font="bahn"))
        L.append(d.text(w / 2, 200, "12 bikes  ·  4 docks", 14, (0.75, 0.9, 0.9), font="arial"))
        for i in range(3):   # keypad
            for j in range(3):
                L.append(d.rect(70 + j * 42, 250 + i * 36, 32, 28, (0.82, 0.84, 0.84), round_=4))
        L.append(d.rect(40, 370, w - 80, 110, (0.92, 0.92, 0.88), round_=4))
        for i in range(5):
            L.append(d.line([(48, 388 + i * 18), (w - 48, 388 + i * 18 + (r.random() - 0.5) * 6)], (0.55, 0.6, 0.62), 2))
        L.append(d.rect(0, h - 24, w, 24, mul(base, 0.6)))
        L += grime(d, w, h, 30)
    elif name == "news_front":   # newsstand's open front: magazines, papers, candy, a coffee urn
        L.append(d.rect(0, 0, w, h, (0.15, 0.13, 0.11)))
        for row in range(3):
            y = 14 + row * 62
            x = 8
            while x < w - 30:
                mw = 26 + r.random() * 24
                c = r.choice([(0.85, 0.2, 0.2), (0.95, 0.85, 0.2), (0.2, 0.45, 0.8), (0.95, 0.95, 0.92), (0.2, 0.7, 0.4), (0.9, 0.5, 0.15), (0.6, 0.2, 0.6)])
                L.append(d.rect(x, y, mw - 3, 54, c))
                L.append(d.rect(x + 3, y + 4, mw - 9, 8, mul(c, 0.4)))
                L.append(d.rect(x + 4, y + 20, mw - 12, 22, mix(c, (0.9, 0.85, 0.75), 0.5), op=70))
                x += mw
        L.append(d.rect(0, 200, w, 56, (0.40, 0.30, 0.20)))   # counter with papers and candy
        for i in range(14):
            c = r.choice([(0.9, 0.9, 0.86), (0.8, 0.2, 0.2), (0.95, 0.7, 0.1), (0.3, 0.2, 0.15), (0.2, 0.5, 0.25)])
            L.append(d.rect(10 + i * 35, 206, 30, 18, c))
        L.append(d.text(w / 2, 248, "THE DAILY PIGEON   ·   COFFEE $1.50   ·   LOTTO", 15, (0.95, 0.9, 0.7), font="arial"))
    elif name == "news_sign":
        L.append(d.rect(0, 0, w, h, (0.06, 0.30, 0.18)))
        L.append(d.rect(0, 0, w, 10, (0.9, 0.75, 0.2)))
        L.append(d.rect(0, h - 10, w, 10, (0.9, 0.75, 0.2)))
        L.append(d.text(w / 2, 82, "NEWS  ·  CANDY  ·  COFFEE", 34, WHITE, font="bahn", tracking=10))
    elif name == "news_side":
        L.append(d.rect(0, 0, w, h, (0.06, 0.30, 0.18)))
        L.append(d.rect(14, 12, 230, h - 24, (0.95, 0.92, 0.85)))
        L.append(d.text(129, 60, "HOT COFFEE", 30, (0.55, 0.25, 0.1), font="impact"))
        L.append(d.text(129, 94, "& BAGELS", 24, (0.55, 0.25, 0.1), font="impact"))
        L.append(d.rect(268, 12, 230, h - 24, (0.95, 0.85, 0.2)))
        L.append(d.text(383, 64, "LOTTO", 40, (0.8, 0.1, 0.1), font="impact"))
        L.append(d.text(383, 96, "TODAY'S JACKPOT", 16, BLACK, font="arial"))
        L += grime(d, w, h, 30)
    elif name == "munimeter":   # pay station face
        base = (0.12, 0.13, 0.14)
        L.append(d.rect(0, 0, w, h, base))
        L.append(d.rect(20, 14, w - 40, 36, (0.95, 0.75, 0.15), round_=4))
        L.append(d.text(w / 2, 40, "PAY HERE", 24, BLACK, font="arial", tracking=40))
        L.append(d.rect(48, 64, w - 96, 50, (0.30, 0.50, 0.40), round_=3))
        L.append(d.text(w / 2, 96, "$4.50 / HR", 18, (0.85, 1.0, 0.85), font="bahn"))
        for i in range(3):
            for j in range(4):
                L.append(d.rect(48 + j * 42, 128 + i * 26, 32, 18, (0.75, 0.76, 0.78), round_=3))
        L.append(d.rect(80, 210, 96, 12, (0.02, 0.02, 0.02), round_=4))
        L.append(d.text(w / 2, 245, "DISPLAY RECEIPT ON DASHBOARD", 11, (0.9, 0.9, 0.9), font="arial"))
        L += grime(d, w, h, 30)
    elif name == "bus_info":   # route map box on the bus stop pole
        L.append(d.rect(0, 0, w, h, (0.92, 0.92, 0.90)))
        L.append(d.rect(0, 0, w, 40, (0.10, 0.30, 0.62)))
        L.append(d.text(w / 2, 28, "BUS TIMES", 22, WHITE, font="arial", tracking=40))
        for i in range(9):
            L.append(d.rect(16, 54 + i * 20, 140 + r.random() * 70, 7, (0.35, 0.36, 0.40)))
        L.append(d.line([(30, 240), (90, 210), (150, 225), (230, 200)], (0.9, 0.2, 0.2), 5))
        L += grime(d, w, h, 25)
    elif name in ("oneway_r", "oneway_l"):   # black plate, white arrow, ONE WAY in black on it
        L.append(d.rect(0, 0, w, h, BLACK))
        L.append(d.rect(4, 4, w - 8, h - 8, (0.96, 0.96, 0.94), round_=4, op=0))
        arrow = [(30, 42), (276, 42), (276, 14), (360, 64), (276, 114), (276, 86), (30, 86)]
        if name == "oneway_l":
            arrow = [(w - x, y) for x, y in arrow]
        L.append(d.poly(arrow, (0.97, 0.97, 0.95)))
        L.append(d.text(w / 2 + (-20 if name == "oneway_r" else 20), 78, "ONE WAY", 34, BLACK, font="arial", tracking=40))
        L += scratches(d, w, h, 12, (0.5, 0.5, 0.5), 30)
    elif name in ("noparking", "nostanding", "sweep", "loading"):
        L += rule_sign(d, name, w, h)
    elif name == "bus_sign":   # bus stop flag (invented: no agency marks)
        L.append(d.rect(0, 0, w, h, (0.96, 0.96, 0.94)))
        L.append(d.rect(0, 0, w, 96, (0.08, 0.30, 0.65)))
        L.append(d.text(w / 2, 66, "BUS", 54, WHITE, font="arial", tracking=60))
        # a little bus pictogram
        L.append(d.rect(52, 116, 120, 62, (0.08, 0.30, 0.65), round_=12))
        L.append(d.rect(62, 126, 100, 24, WHITE, round_=4))
        L.append(d.ellipse(78, 180, 20, 20, BLACK))
        L.append(d.ellipse(146, 180, 20, 20, BLACK))
        y = 214
        for rt, c in (("M55", (0.08, 0.30, 0.65)), ("M7", (0.08, 0.30, 0.65)), ("X27", (0.18, 0.55, 0.30))):
            L.append(d.rect(24, y, w - 48, 24, c, round_=4))
            L.append(d.text(w / 2, y + 19, rt, 20, WHITE, font="arial"))
            y += 28
        L += grime(d, w, h, 20)
    elif name == "walk":   # the walking figure (white), on black: an emissive mask
        L.append(d.rect(0, 0, w, h, (0, 0, 0)))
        c = (1, 1, 1)
        L.append(d.ellipse(66, 22, 18, 18, c))
        L.append(d.line([(64, 34), (58, 72)], c, 13))                      # body
        L.append(d.line([(60, 44), (42, 62), (36, 76)], c, 8))             # back arm
        L.append(d.line([(62, 44), (80, 58), (90, 70)], c, 8))             # front arm
        L.append(d.line([(58, 72), (44, 96), (36, 116)], c, 10))           # back leg
        L.append(d.line([(58, 72), (74, 94), (88, 114)], c, 10))           # front leg
    elif name == "hand":   # the raised hand (white mask; tinted orange at runtime)
        L.append(d.rect(0, 0, w, h, (0, 0, 0)))
        c = (1, 1, 1)
        L.append(d.rect(38, 56, 56, 52, c, round_=16))                      # palm
        for i, (x, top) in enumerate(((40, 26), (54, 16), (68, 18), (82, 28))):
            L.append(d.rect(x, top, 11, 50, c, round_=5))                   # fingers
        L.append(d.poly([(36, 76), (20, 58), (16, 64), (34, 92)], c, smooth=False))   # thumb
    elif name == "lens":   # a signal lens: bright centre, ribbed fresnel rings
        L.append(d.rect(0, 0, w, h, (0, 0, 0)))
        L.append(d.ellipse(64, 64, 120, 120, (1, 1, 1), grad=d.rad(64, 64, 60, [(0, (1, 1, 1)), (0.7, (0.85, 0.85, 0.85)), (1, (0.55, 0.55, 0.55))])))
        for k in range(1, 6):
            L.append(d.ellipse(64, 64, k * 22, k * 22, (0, 0, 0), op=0))
            L.append(d.poly([(64 + math.cos(a / 20 * math.tau) * k * 11, 64 + math.sin(a / 20 * math.tau) * k * 11) for a in range(20)], None, stroke=((0.6, 0.6, 0.6), 1.5, 50)))
    elif name == "lamp":   # a street lamp's refractor seen from below
        L.append(d.rect(0, 0, w, h, (1.0, 0.82, 0.55)))
        L.append(d.rect(0, 0, w, h, (1, 1, 1), grad=d.rad(64, 64, 70, [(0, (1.0, 0.98, 0.9)), (0.6, (1.0, 0.86, 0.6)), (1, (0.85, 0.62, 0.35))])))
        for k in range(0, 128, 10):
            L.append(d.line([(k, 0), (k, h)], (0.9, 0.7, 0.45), 1.5, op=35))
    elif name == "white":
        L.append(d.rect(0, 0, w, h, (1, 1, 1)))
    elif name == "plate_back":
        base = (0.62, 0.63, 0.62)
        L.append(d.rect(0, 0, w, h, base))
        L.append(d.noise(w, h, op=30, scale=10, kind="turbulentSmooth"))
        L += stickers(d, w, h, 2)
        L += scratches(d, w, h, 15, (0.8, 0.8, 0.8), 40)
    elif name == "rubber":
        L.append(d.rect(0, 0, w, h, (0.05, 0.05, 0.05)))
        L.append(d.noise(w, h, op=20, scale=8))
    elif name == "glass":
        L.append(d.rect(0, 0, w, h, (0.55, 0.62, 0.66)))
        L.append(d.rect(0, 0, w, h, (1, 1, 1), op=20, grad=d.lin(0, 0, w, h, [(0, (1, 1, 1)), (0.5, (0.6, 0.6, 0.6)), (1, (1, 1, 1))])))
        L += scratches(d, w, h, 20, (0.9, 0.9, 0.9), 30)
    elif name == "bike_brand":   # bike frame / basket panel of the bike share
        base = (0.06, 0.45, 0.50)
        L.append(d.rect(0, 0, w, h, base))
        L.append(d.rect(0, 0, w, h, (1, 1, 1), op=25, grad=d.lin(0, 0, 0, h, [(0, (1, 1, 1)), (0.4, (0.3, 0.3, 0.3)), (1, (0, 0, 0))])))
        L.append(d.text(w / 2, 82, "BORO BIKE", 40, WHITE, font="bahn", tracking=20))
    elif name == "blank_blade":
        L.append(d.rect(0, 0, w, h, NYGREEN))
        L.append(d.rect(3, 3, w - 6, h - 6, WHITE, op=0))
    elif name == "cart_sign":   # a halal cart's light-box menu (invented vendor)
        L.append(d.rect(0, 0, w, h, (0.98, 0.95, 0.85)))
        L.append(d.rect(0, 0, w, 70, (0.12, 0.45, 0.25)))
        L.append(d.text(w / 2, 52, "SAMI'S HALAL", 44, (1, 0.95, 0.75), font="impact", tracking=20))
        items = [("CHICKEN OVER RICE", "$9"), ("LAMB GYRO", "$8"), ("FALAFEL", "$7"), ("HOT DOG", "$3"), ("SODA", "$2")]
        for i, (a, p) in enumerate(items):
            L.append(d.text(30, 104 + i * 30, a, 22, (0.2, 0.15, 0.1), font="arial", just="left"))
            L.append(d.text(w - 30, 104 + i * 30, p, 22, (0.75, 0.15, 0.1), font="arial", just="right"))
        # food photos
        for i in range(3):
            L.append(d.ellipse(370 + (i % 2) * 70, 120 + i * 40, 60, 40, (0.85, 0.65, 0.25)))
            L.append(d.ellipse(370 + (i % 2) * 70, 116 + i * 40, 40, 20, (0.75, 0.35, 0.15)))
        L += grime(d, w, h, 25)
    elif name == "umbrella":   # a cart umbrella, blue and yellow, stripes running round it
        a, b = (0.15, 0.32, 0.70), (0.98, 0.84, 0.25)
        for i in range(8):
            L.append(d.rect(i * 32, 0, 32, h, a if i % 2 == 0 else b))
        L.append(d.rect(0, 0, w, h, (0, 0, 0), op=100, blend="multiply",
                        grad=d.lin(0, 0, 0, h, [(0, (1, 1, 1)), (0.8, (0.86, 0.86, 0.86)), (1, (0.6, 0.6, 0.6))])))
        L.append(d.noise(w, h, op=12, scale=30))
    elif name == "dock":   # a bike share dock post
        base = (0.75, 0.77, 0.78)
        L.append(d.rect(0, 0, w, h, base, grad=d.lin(0, 0, w, 0, [(0, mul(base, 0.8)), (0.4, mul(base, 1.15)), (1, mul(base, 0.8))])))
        L.append(d.rect(20, 30, w - 40, 60, (0.06, 0.45, 0.50), round_=6))
        L.append(d.ellipse(w / 2, 60, 18, 18, (0.3, 0.95, 0.5)))
        L.append(d.rect(30, 110, w - 60, 20, (0.1, 0.1, 0.1), round_=4))
        L += grime(d, w, h, 40)
    elif name == "jersey":   # concrete Jersey barrier: stained, chipped, a stencilled number
        base = (0.70, 0.69, 0.66)
        L.append(d.rect(0, 0, w, h, base))
        L.append(d.noise(w, h, op=40, scale=12, kind="turbulentSmooth"))
        L += chips(d, w, h, 40, (0.45, 0.44, 0.42), op=70, s=6)
        L.append(d.text(w * 0.3, h * 0.5, "D-217", 26, (0.2, 0.2, 0.22), font="arial", op=60))
        L.append(d.rect(0, h * 0.5, w, h * 0.12, (0.95, 0.55, 0.1), op=0))
        L += grime(d, w, h, 55)
        for _ in range(6):   # tyre scuffs
            x = r.random() * w
            L.append(d.line([(x, h * 0.85), (x + 40 + r.random() * 60, h * 0.8)], (0.1, 0.1, 0.1), 6, op=40))
    elif name == "shed_end":   # the shed's end wall (plywood with a fire-exit sign)
        base = (0.10, 0.34, 0.20)
        L.append(d.rect(0, 0, w, h, base))
        L.append(d.noise(w, h, op=25, scale=30))
        for x in range(0, w + 1, 128):
            L.append(d.line([(x, 0), (x, h)], mul(base, 0.55), 3))
        L.append(d.rect(140, 70, 104, 60, WHITE))
        L.append(d.text(192, 108, "NO", 22, RED, font="impact"))
        L.append(d.text(192, 126, "STANDING", 12, RED, font="arial"))
        L += grime(d, w, h, 25, top=True)
    elif name == "bench_seat":
        base = (0.08, 0.09, 0.10)
        L.append(d.rect(0, 0, w, h, base))
        for x in range(0, w, 12):
            L.append(d.rect(x, 0, 6, h, (0.2, 0.21, 0.22)))
    elif name == "news_roof":
        L.append(d.rect(0, 0, w, h, (0.06, 0.30, 0.18)))
        L.append(d.noise(w, h, op=30, scale=20))
        L += grime(d, w, h, 30, top=True)
    elif name == "cobra":   # the cobra-head luminaire housing: grey-white enamel, weathered
        base = (0.70, 0.71, 0.70)
        L.append(d.rect(0, 0, w, h, base, grad=d.lin(0, 0, 0, h, [(0, mul(base, 1.2)), (1, mul(base, 0.75))])))
        L.append(d.noise(w, h, op=25, scale=14, kind="turbulentSmooth"))
        L += grime(d, w, h, 30, top=True)
    return L


def ad_layers(d, name, w, h):
    L = []
    if name == "ad_soup":
        L.append(d.rect(0, 0, w, h, (0.85, 0.25, 0.12), grad=d.lin(0, 0, 0, h, [(0, (0.95, 0.45, 0.15)), (1, (0.65, 0.12, 0.08))])))
        L.append(d.text(w / 2, 70, "IT'S", 40, WHITE, font="impact"))
        L.append(d.text(w / 2, 130, "SOUP", 72, (1, 0.92, 0.6), font="impact"))
        L.append(d.text(w / 2, 180, "WEATHER", 44, WHITE, font="impact"))
        L.append(d.ellipse(w / 2, 320, 170, 90, (0.95, 0.93, 0.88)))
        L.append(d.ellipse(w / 2, 312, 140, 54, (0.85, 0.45, 0.12)))
        for i in range(3):
            L.append(d.line([(w / 2 - 30 + i * 30, 270), (w / 2 - 40 + i * 30, 230), (w / 2 - 25 + i * 30, 200)], (1, 1, 1), 5, op=70, smooth=True))
        L.append(d.text(w / 2, 440, "MUG & LADLE", 26, WHITE, font="bahn", tracking=40))
        L.append(d.text(w / 2, 470, "soups since forever", 15, (1, 0.85, 0.7), font="arial"))
    elif name == "ad_pigeon":
        L.append(d.rect(0, 0, w, h, (0.88, 0.90, 0.92)))
        L.append(d.text(w / 2, 64, "PIGEON", 50, (0.2, 0.25, 0.35), font="impact"))
        L.append(d.text(w / 2, 108, "INSURANCE", 34, (0.2, 0.25, 0.35), font="impact"))
        L.append(d.ellipse(w / 2, 250, 130, 100, (0.55, 0.57, 0.62)))        # a pigeon
        L.append(d.ellipse(w / 2 + 50, 200, 56, 52, (0.45, 0.47, 0.52)))
        L.append(d.ellipse(w / 2 + 60, 214, 30, 20, (0.35, 0.55, 0.45), op=80))
        L.append(d.ellipse(w / 2 + 62, 194, 9, 9, (0.95, 0.6, 0.1)))
        L.append(d.poly([(w / 2 + 76, 200), (w / 2 + 92, 206), (w / 2 + 76, 210)], (0.3, 0.3, 0.3)))
        L.append(d.line([(w / 2 - 10, 300), (w / 2 - 14, 330)], (0.85, 0.4, 0.4), 4))
        L.append(d.line([(w / 2 + 14, 300), (w / 2 + 18, 330)], (0.85, 0.4, 0.4), 4))
        L.append(d.text(w / 2, 390, "Because statues", 20, (0.2, 0.25, 0.35), font="arial"))
        L.append(d.text(w / 2, 416, "can't sue.", 20, (0.2, 0.25, 0.35), font="arial"))
        L.append(d.rect(0, h - 50, w, 50, (0.2, 0.25, 0.35)))
        L.append(d.text(w / 2, h - 18, "COO-VERAGE FOR ALL", 18, WHITE, font="bahn", tracking=30))
    elif name == "ad_leaf":
        L.append(d.rect(0, 0, w, h, (0.10, 0.12, 0.18), grad=d.lin(0, 0, 0, h, [(0, (0.15, 0.2, 0.32)), (1, (0.05, 0.05, 0.08))])))
        L.append(d.text(w / 2, 70, "HAVE YOU SEEN", 26, (0.9, 0.9, 0.95), font="bahn", tracking=20))
        L.append(d.text(w / 2, 104, "THIS LEAF?", 34, (1, 0.8, 0.35), font="bahn", tracking=20))
        pts = [(w / 2, 150), (w / 2 + 50, 200), (w / 2 + 62, 260), (w / 2 + 30, 320), (w / 2, 350), (w / 2 - 30, 320), (w / 2 - 62, 260), (w / 2 - 50, 200)]
        L.append(d.poly(pts, (0.88, 0.45, 0.12), smooth=True))
        L.append(d.line([(w / 2, 160), (w / 2, 370)], (0.6, 0.25, 0.06), 4))
        for k in (200, 240, 280):
            L.append(d.line([(w / 2, k), (w / 2 + 40, k - 25)], (0.6, 0.25, 0.06), 3))
            L.append(d.line([(w / 2, k), (w / 2 - 40, k - 25)], (0.6, 0.25, 0.06), 3))
        L.append(d.text(w / 2, 420, "Last seen: Battery Park.", 16, (0.85, 0.85, 0.9), font="arial"))
        L.append(d.text(w / 2, 444, "Heading uptown, fast.", 16, (0.85, 0.85, 0.9), font="arial"))
    elif name == "ad_cider":
        L.append(d.rect(0, 0, w, h, (0.45, 0.18, 0.08), grad=d.lin(0, 0, 0, h, [(0, (0.62, 0.28, 0.1)), (1, (0.3, 0.1, 0.05))])))
        L.append(d.text(w / 2, 80, "HOT", 50, (1, 0.9, 0.6), font="impact"))
        L.append(d.text(w / 2, 140, "APPLE CIDER", 34, WHITE, font="impact"))
        L.append(d.rect(w / 2 - 50, 200, 100, 140, (0.95, 0.93, 0.88), round_=10))
        L.append(d.rect(w / 2 - 44, 216, 88, 40, (0.75, 0.35, 0.1)))
        L.append(d.poly([(w / 2 + 50, 230), (w / 2 + 80, 240), (w / 2 + 80, 300), (w / 2 + 50, 310)], None, stroke=((0.95, 0.93, 0.88), 8)))
        L.append(d.text(w / 2, 410, "ORCHARD & SONS", 22, (1, 0.85, 0.6), font="bahn", tracking=30))
        L.append(d.text(w / 2, 440, "Warm hands. Warm heart.", 15, WHITE, font="arial"))
    L.append(d.noise(w, h, op=8, scale=40))
    return L


def rule_sign(d, name, w, h):
    """NYC-style parking rule signs (white plate, red or green text), invented wording"""
    L = [d.rect(0, 0, w, h, (0.96, 0.96, 0.94)), d.rect(4, 4, w - 8, h - 8, (0.96, 0.96, 0.94))]
    cx = w / 2
    if name == "sweep":   # the red P with a broom through it: alternate side parking
        L.append(d.ellipse(cx, 70, 88, 88, (0.96, 0.96, 0.94)))
        L.append(d.text(cx, 100, "P", 82, RED, font="arial"))
        L.append(d.ellipse(cx, 70, 92, 92, RED, op=0))
        L.append(d.poly([(cx + 44 * math.cos(a / 24 * math.tau), 70 + 44 * math.sin(a / 24 * math.tau)) for a in range(24)], None, stroke=(RED, 7)))
        L.append(d.line([(cx - 34, 104), (cx + 34, 36)], RED, 6))
        L.append(d.poly([(cx + 26, 40), (cx + 44, 26), (cx + 52, 34), (cx + 36, 52)], RED))
        for i, s in enumerate(["NO PARKING", "8:30AM - 10AM", "TUESDAY"]):
            L.append(d.text(cx, 160 + i * 34, s, 22 if i else 20, RED, font="arial"))
        L.append(d.poly([(cx - 70, 268), (cx - 40, 256), (cx - 40, 280)], RED))
        L.append(d.poly([(cx + 70, 268), (cx + 40, 256), (cx + 40, 280)], RED))
        L.append(d.line([(cx - 40, 268), (cx + 40, 268)], RED, 6))
    elif name == "noparking":
        L.append(d.text(cx, 52, "NO", 44, RED, font="arial"))
        L.append(d.text(cx, 96, "PARKING", 30, RED, font="arial"))
        L.append(d.text(cx, 150, "8AM-6PM", 28, BLACK, font="arial"))
        L.append(d.text(cx, 186, "EXCEPT", 18, BLACK, font="arial"))
        L.append(d.text(cx, 214, "SUNDAY", 22, BLACK, font="arial"))
        L.append(d.line([(cx - 60, 255), (cx + 60, 255)], RED, 6))
        L.append(d.poly([(cx - 74, 255), (cx - 48, 243), (cx - 48, 267)], RED))
    elif name == "nostanding":
        L.append(d.text(cx, 52, "NO", 44, RED, font="arial"))
        L.append(d.text(cx, 96, "STANDING", 28, RED, font="arial"))
        L.append(d.text(cx, 150, "ANYTIME", 28, BLACK, font="arial"))
        L.append(d.poly([(cx + 74, 230), (cx + 48, 218), (cx + 48, 242)], RED))
        L.append(d.poly([(cx - 74, 230), (cx - 48, 218), (cx - 48, 242)], RED))
        L.append(d.line([(cx - 50, 230), (cx + 50, 230)], RED, 6))
    elif name == "loading":
        L.append(d.text(cx, 56, "TRUCK", 40, (0.1, 0.45, 0.2), font="arial"))
        L.append(d.text(cx, 100, "LOADING", 32, (0.1, 0.45, 0.2), font="arial"))
        L.append(d.text(cx, 136, "ONLY", 30, (0.1, 0.45, 0.2), font="arial"))
        L.append(d.text(cx, 186, "7AM-10AM", 26, BLACK, font="arial"))
        L.append(d.text(cx, 220, "MON-FRI", 22, BLACK, font="arial"))
    L += scratches(d, w, h, 10, (0.6, 0.6, 0.6), 30)
    L.append(d.rect(0, 0, w, h, (0.3, 0.28, 0.25), op=10, blend="multiply"))
    return L


def atlas_doc(fonts):
    d = Doc(1729, fonts)
    layers = [d.rect(0, 0, AW, AH, (0.5, 0.5, 0.5), op=0, name="clear")]
    for name, (x, y, w, h) in R.items():
        layers.append(d.group("cell_" + name, x, y, w, h, cell_layers(d, name, w, h)))
    return AW, AH, (0, 0, 0, 0), layers, d


def names_doc(fonts):
    d = Doc(57, fonts)
    names, cells = names_layout()
    layers = [d.rect(0, 0, AW, AH, NYGREEN, name="green")]
    for n in names:
        x, y, w, h = cells[n]
        s = pretty(n)
        size = 30 if len(s) <= 12 else 26 if len(s) <= 16 else 21
        g = [d.rect(0, 0, w, h, NYGREEN, grad=d.lin(0, 0, 0, h, [(0, (0.02, 0.48, 0.29)), (1, (0.0, 0.36, 0.21))])),
             d.rect(3, 3, w - 6, 2.5, WHITE), d.rect(3, h - 5.5, w - 6, 2.5, WHITE),
             d.rect(3, 3, 2.5, h - 6, WHITE), d.rect(w - 5.5, 3, 2.5, h - 6, WHITE),
             d.text(w / 2, h / 2 + size * 0.36, s, size, WHITE, font="blade", tracking=10),
             d.noise(w, h, op=10, scale=12)]
        layers.append(d.group("blade", x, y, w, h, g))
    return AW, AH, NYGREEN + (1,), layers, d


# --------------------------------------------------------------------------------- basketball courts

COURT_M = (30.0, 16.0)   # the Court texture covers 30 x 16 m: a 28 x 15 m court with run-off


def court_doc(fonts):
    """an NYC park court in late November: worn green paint, red keys, faded white lines, cracks, leaves"""
    d = Doc(4242, fonts)
    r = d.rng
    W, H = 1024, 512
    sx, sy = W / COURT_M[0], H / COURT_M[1]
    X = lambda m: W / 2 + m * sx      # metres from the centre along the court
    Y = lambda m: H / 2 + m * sy      # metres across
    L = [d.rect(0, 0, W, H, (0.30, 0.30, 0.30), name="asphalt"), d.noise(W, H, op=45, scale=5, kind="turbulentSmooth", contrast=60)]
    green, red, white = (0.20, 0.36, 0.28), (0.52, 0.20, 0.16), (0.88, 0.87, 0.82)
    L.append(d.rect(X(-14), Y(-7.5), 28 * sx, 15 * sy, green, op=88))
    for side in (-1, 1):   # the keys
        x0 = X(side * 14) if side < 0 else X(14 - 5.8)
        L.append(d.rect(x0, Y(-2.45), 5.8 * sx, 4.9 * sy, red, op=90))
    L.append(d.ellipse(X(0), Y(0), 3.6 * sx, 3.6 * sy, red, op=85))
    L.append(d.noise(W, H, op=35, scale=9, kind="turbulentSmooth", seed=4, contrast=55))
    lw = 0.06 * sx
    def ln(pts, op=80):
        L.append(d.line(pts, white, lw, op=op))
    ln([(X(-14), Y(-7.5)), (X(14), Y(-7.5)), (X(14), Y(7.5)), (X(-14), Y(7.5)), (X(-14), Y(-7.5))])
    ln([(X(0), Y(-7.5)), (X(0), Y(7.5))])
    circ = lambda cx, cy, rr, a0, a1, n=40: [(X(cx + math.cos(a0 + (a1 - a0) * k / n) * rr), Y(cy + math.sin(a0 + (a1 - a0) * k / n) * rr)) for k in range(n + 1)]
    ln(circ(0, 0, 1.8, 0, math.tau))
    for side in (-1, 1):
        bx = side * 14
        hx = bx - side * 1.575
        ln([(X(bx), Y(-2.45)), (X(bx - side * 5.8), Y(-2.45)), (X(bx - side * 5.8), Y(2.45)), (X(bx), Y(2.45))])
        a = math.pi if side > 0 else 0.0
        ln(circ(bx - side * 5.8, 0, 1.8, a - math.pi / 2, a + math.pi / 2))
        # the three-point line: straight from the baseline, then the arc
        ex = hx - side * math.sqrt(6.75 ** 2 - 6.6 ** 2)
        ln([(X(bx), Y(-6.6)), (X(ex), Y(-6.6))])
        ln([(X(bx), Y(6.6)), (X(ex), Y(6.6))])
        t = math.asin(6.6 / 6.75)
        ln(circ(hx, 0, 6.75, a - t, a + t, 50) if side > 0 else circ(hx, 0, 6.75, -t, t, 50))
    for _ in range(26):   # cracks
        x, y = r.random() * W, r.random() * H
        pts = [(x, y)]
        for k in range(5):
            pts.append((pts[-1][0] + (r.random() - 0.5) * 70, pts[-1][1] + (r.random() - 0.5) * 50))
        L.append(d.line(pts, (0.10, 0.10, 0.10), 1.0 + r.random() * 1.2, op=38))
    for _ in range(9):   # patches
        L.append(d.poly(d.blob(r.random() * W, r.random() * H, 20 + r.random() * 40, 14 + r.random() * 30), (0.24, 0.24, 0.24), op=40))
    for _ in range(90):  # dead leaves blown against the fence and in the corners
        x = r.choice([r.random() * W, r.random() * 40, W - r.random() * 40])
        y = r.choice([r.random() * H, r.random() * 30, H - r.random() * 30])
        c = r.choice([(0.55, 0.30, 0.10), (0.45, 0.22, 0.08), (0.62, 0.45, 0.18)])
        L.append(d.poly(d.blob(x, y, 4 + r.random() * 5, 2 + r.random() * 3, n=6, rot=r.random() * 3), c, op=85))
    L.append(d.rect(0, 0, W, H, (0.5, 0.5, 0.5), op=6, effects=[d.grain(8)]))
    return W, H, (0.3, 0.3, 0.3, 1), L, d


def fence_doc(fonts):
    """alpha textures: galvanised chain-link (left 256) and a chain basketball net (right 256)"""
    d = Doc(77, fonts)
    W, H = 512, 256
    L = [d.rect(0, 0, W, H, (0.5, 0.5, 0.5), op=0, name="clear")]
    c = (0.62, 0.64, 0.64)
    g = []
    for k in range(-256, 512, 16):
        g.append(d.line([(k, 0), (k + 256, 256)], c, 2.0))
        g.append(d.line([(k, 256), (k + 256, 0)], mul(c, 0.8), 2.0))
    L.append(d.group("chainlink", 0, 0, 256, 256, g))
    n = []
    for k in range(-256, 512, 28):
        n.append(d.line([(k, 0), (k + 256, 256)], (0.78, 0.78, 0.76), 3.0))
        n.append(d.line([(k, 256), (k + 256, 0)], (0.70, 0.70, 0.68), 3.0))
    n.append(d.rect(0, 0, 256, 10, (0.8, 0.8, 0.78)))
    L.append(d.group("net", 256, 0, 256, 256, n))
    return W, H, (0, 0, 0, 0), L, d


DOCS = {"Atlas": atlas_doc, "Names": names_doc, "Court": court_doc, "Fence": fence_doc}
FONT_FILES = {"arial": "arialbd.ttf", "bahn": "bahnschrift.ttf", "impact": "impact.ttf"}
FONT_STYLE = {"arial": ("Arial", "Bold"), "bahn": ("Bahnschrift", "SemiBold"), "impact": ("Impact", "Regular"),
              "blade": ("Bahnschrift", "SemiBold SemiCondensed")}


def build_doc(name):
    W, H, bg, layers, d = DOCS[name](FONT_STYLE)
    layers = list(reversed(layers))   # layers[0] is frontmost
    return {"$schema": "https://jerboa.dev/schemas/fx-composition/editable/v1/document.schema.json", "formatVersion": 1,
            "dimensions": {"width": W, "height": H}, "duration": 3.0, "backgroundColor": list(bg),
            "composition": {"id": "main", "name": "Street " + name, "layers": layers}}
