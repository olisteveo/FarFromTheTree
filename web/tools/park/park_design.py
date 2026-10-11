"""Far From the Tree - Central Park textures, authored as editable Tesseract compositions.

Imported by build_park.py (system Python, standard library only). Each entry in DOCS becomes
tools/park/tesseract/<Name>/<Name>.tsrct (the editable source) and a rendered <Name>.png.

  Trees   1024x1024 RGBA  three bark strips (256x1024: London plane, American elm, oak) and
                          four alpha twig cards (256x256 each, x 768..1024: elm, oak, plane, brush)
  Props   1024x1024 RGBA  4x4 cells of 256 (see PROPS): cast iron, bench wood, wire basket mesh,
                          bin liner, cart steel, cart sign, umbrella, lamp globe, gilded bronze,
                          granite, marble, rink boards
  Schist  1024 opaque     Manhattan schist outcrop: foliated grey, mica, quartz veins, rust,
                          grey-green lichen rosettes, rain streaks (mirrored-repeat tiling)
  Wall    512 opaque      coursed ashlar of the low park wall along 59th St and CPW (1 m x 1 m)
  Rubble  512 opaque      rough schist rubble of Gapstow Bridge (mirrored-repeat tiling)
  Ice     512 opaque      Wollman Rink ice: cloudy white-blue with skate-scratch arcs
"""
import math, random

TREES_LAYOUT = {
    "bark": {"plane": [0, 0, 256, 1024], "elm": [256, 0, 256, 1024], "oak": [512, 0, 256, 1024]},
    "twig": {"elm": [768, 0, 256, 256], "oak": [768, 256, 256, 256], "plane": [768, 512, 256, 256], "brush": [768, 768, 256, 256]},
}
PROPS = {  # name -> (col, row) of 256 px cells
    "iron": (0, 0), "wood": (1, 0), "wire": (2, 0), "bag": (3, 0),
    "steel": (0, 1), "sign": (1, 1), "umbrella": (2, 1), "globe": (3, 1),
    "gilded": (0, 2), "granite": (1, 2), "marble": (2, 2), "boards": (3, 2),
}
FONT = r"C:\Windows\Fonts\arialbd.ttf"
_FONT = [None]


class Doc:
    AR = {"start": 0, "duration": 3000}

    def __init__(self, seed):
        self.nid = 1
        self.rng = random.Random(seed)
        self.font = _FONT[0]   # (family, style) from import-font

    def lid(self):
        self.nid += 1
        return self.nid

    def fx(self, effect):
        return {"id": self.lid(), "effect": effect}

    @staticmethod
    def tf(x=0.0, y=0.0, rot=0.0, op=100):
        return {"anchorPoint": [0, 0], "position": [x, y], "scale": [100, 100], "rotation": rot, "opacity": op}

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

    def text(self, x, y, s, size, c, just="center", name="text", tracking=0.0):
        fam, sty = self.font
        return {"type": "Text", "id": self.lid(), "name": name, "blendMode": "normal", "activeRange": self.AR,
                "transform": self.tf(x, y), "effects": [],
                "sourceText": {"text": s, "fontFamily": fam, "fontStyle": sty, "fontSize": size, "fillColor": self.col(c),
                               "strokeWidth": 0, "justification": just, "tracking": tracking}}

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


# ================================================================================ Trees

def bark_plane(d, w, h):
    """London plane: the camouflage bark, flaking in jigsaw patches of olive, cream and grey."""
    r = d.rng
    L = [d.rect(0, 0, w, h, (0.56, 0.55, 0.44), name="base"), d.noise(w, h, op=30, scale=60, seed=1)]
    pal = [(0.44, 0.42, 0.34), (0.50, 0.51, 0.38), (0.60, 0.62, 0.50), (0.70, 0.69, 0.56), (0.80, 0.78, 0.65), (0.86, 0.84, 0.72)]
    for layer, cols in enumerate((pal[:2], pal[2:4], pal[4:])):
        for _ in range((70, 55, 40)[layer]):
            cx, cy = r.random() * w, r.random() * h
            rx = (14 + r.random() * 40) * (1.0 - layer * 0.2)
            ry = rx * (1.1 + r.random() * 1.2)
            c = r.choice(cols)
            pts = d.blob(cx, cy, rx, ry, n=10, jit=0.45, rot=(r.random() - 0.5) * 0.6)
            L.append(d.poly(pts, c, op=88, smooth=True, stroke=(mul(c, 0.8), 1.0, 25), name="flake", effects=[d.blur(1.2)]))
    L.append(d.noise(w, h, op=26, scale=9, kind="turbulentSmooth", seed=4, name="pores"))
    for _ in range(60):   # small dark lenticels
        x, y = r.random() * w, r.random() * h
        L.append(d.ellipse(x, y, 3 + r.random() * 4, 1.2, (0.30, 0.29, 0.24), op=30))
    return L


def bark_elm(d, w, h):
    """American elm: deep interlacing furrows, corky grey-brown ridges."""
    r = d.rng
    L = [d.rect(0, 0, w, h, (0.20, 0.17, 0.15), name="furrows")]
    cols = [(0.42, 0.38, 0.33), (0.47, 0.43, 0.38), (0.38, 0.34, 0.30)]
    for i in range(16):   # ridges wander and cross, making the elm's diamond weave
        x = (i + 0.5) * w / 15 + (r.random() - 0.5) * 10
        pts, y = [], -20
        while y < h + 40:
            pts.append((x, y))
            x += (r.random() - 0.5) * 34
            x = max(-10, min(w + 10, x))
            y += 40 + r.random() * 50
        c = r.choice(cols)
        wdt = 10 + r.random() * 9
        L.append(d.line(pts, mul(c, 0.8), wdt + 4, smooth=True, op=95))
        L.append(d.line(pts, c, wdt, smooth=True))
        L.append(d.line([(p[0] - wdt * 0.2, p[1]) for p in pts], mul(c, 1.25), wdt * 0.35, smooth=True, op=55))
    L.append(d.noise(w, h, op=40, scale=14, kind="rocky", seed=2, name="cork"))
    for _ in range(25):   # cross-checks in the ridges
        x, y = r.random() * w, r.random() * h
        L.append(d.line([(x - 6, y), (x + 6, y + 2)], (0.15, 0.13, 0.11), 2.2, op=70))
    for _ in range(12):   # a little grey-green lichen
        L.append(d.poly(d.blob(r.random() * w, r.random() * h, 8 + r.random() * 12, 6 + r.random() * 10), (0.62, 0.66, 0.58), op=45, smooth=True))
    return L


def bark_oak(d, w, h):
    """Red oak: long flat-topped pale ridges ('ski tracks') between dark fissures."""
    r = d.rng
    L = [d.rect(0, 0, w, h, (0.17, 0.16, 0.15), name="fissures")]
    x = -6
    while x < w:
        cw = 14 + r.random() * 16
        y = -r.random() * 200
        while y < h:
            ph = 90 + r.random() * 260
            c = mix((0.46, 0.45, 0.43), (0.58, 0.57, 0.54), r.random())
            n = 6
            left = [(x + 2 + r.random() * 4, y + ph * k / n) for k in range(n + 1)]
            right = [(x + cw - 2 - r.random() * 4, y + ph * k / n) for k in range(n, -1, -1)]
            L.append(d.poly(left + right, c, smooth=True, name="ridge"))
            L.append(d.line([(x + cw * 0.4, y + 4), (x + cw * 0.45, y + ph - 6)], mul(c, 1.15), cw * 0.25, op=40))
            y += ph
        x += cw
    L.append(d.noise(w, h, op=30, scale=12, kind="rocky", seed=3))
    L.append(d.rect(0, 0, w * 0.35, h, (0.30, 0.42, 0.26), op=12, name="algae", effects=[d.blur(30)]))
    return L


def twig_card(d, w, h, kind):
    """A spray of bare winter twigs on transparent ground, rooted at the bottom middle."""
    r = d.rng
    L = []
    dark, tip = (0.27, 0.23, 0.20), (0.46, 0.42, 0.39)
    balls = []
    P = {"elm": dict(depth=5, spread=0.48, len0=66, shrink=0.78, kids=(2, 3), wid0=3.8, droop=0.10, jag=0.12),
         "oak": dict(depth=5, spread=0.70, len0=62, shrink=0.74, kids=(2, 3), wid0=4.0, droop=-0.02, jag=0.45),
         "plane": dict(depth=5, spread=0.62, len0=64, shrink=0.75, kids=(2, 2), wid0=3.8, droop=0.04, jag=0.22),
         "brush": dict(depth=5, spread=0.62, len0=58, shrink=0.78, kids=(2, 3), wid0=4.0, droop=0.0, jag=0.25)}[kind]

    def grow(x, y, ang, ln, wd, depth):
        pts = [(x, y)]
        a = ang
        for _ in range(3):   # each twig kinks a little at its nodes
            a += (r.random() - 0.5) * P["jag"]
            a += P["droop"] * (1 - depth / P["depth"]) * (1 if math.sin(a) > 0 else -1)
            x += math.sin(a) * ln / 3
            y -= math.cos(a) * ln / 3
            pts.append((x, y))
        c = mix(dark, tip, 1 - depth / P["depth"])
        L.append(d.line(pts, c, max(1.3, wd), smooth=True))
        if depth <= 1:
            if kind == "plane" and r.random() < 0.18:
                balls.append((x, y))
            return
        n = r.randint(*P["kids"])
        for i in range(n):
            da = (i - (n - 1) / 2) * P["spread"] + (r.random() - 0.5) * 0.3
            grow(x, y, a + da, ln * (P["shrink"] + r.random() * 0.1), wd * 0.68, depth - 1)

    grow(w / 2, h - 2, (r.random() - 0.5) * 0.15, P["len0"], P["wid0"], P["depth"])
    for (x, y) in balls:   # London plane seed balls hang on through the winter
        L.append(d.line([(x, y), (x + 3, y + 14)], (0.25, 0.20, 0.16), 1.3))
        L.append(d.ellipse(x + 3 - 6, y + 14 - 6, 12, 12, (0.40, 0.29, 0.17), grad=d.rad(6, 6, 7, [(0, (0.52, 0.40, 0.25)), (1, (0.30, 0.21, 0.12))])))
    return L


def trees_doc():
    d = Doc(41)
    layers = []
    for name, fn in (("plane", bark_plane), ("elm", bark_elm), ("oak", bark_oak)):
        x, y, w, h = TREES_LAYOUT["bark"][name]
        layers.append(d.group("bark_" + name, x, y, w, h, fn(d, w, h)))
    for name in ("elm", "oak", "plane", "brush"):
        x, y, w, h = TREES_LAYOUT["twig"][name]
        layers.append(d.group("twig_" + name, x, y, w, h, twig_card(d, w, h, name)))
    return 1024, 1024, (0, 0, 0, 0), layers, d


# ================================================================================ Props

def cell(name):
    c, r = PROPS[name]
    return c * 256, r * 256, 256, 256


def props_layers(d, name, w=256, h=256):
    r = d.rng
    L = []
    if name == "iron":    # Central Park green-black cast iron, wrapped round posts (u) with a highlight band
        base = (0.09, 0.13, 0.10)
        L.append(d.rect(0, 0, w, h, base, grad=d.lin(0, 0, w, 0, [(0, mul(base, 0.7)), (0.3, mul(base, 1.9)), (0.42, mul(base, 1.2)), (0.7, mul(base, 0.8)), (1, mul(base, 0.7))])))
        L.append(d.noise(w, h, op=22, scale=20, kind="turbulentSmooth"))
        for _ in range(40):
            x, y = r.random() * w, r.random() * h
            L.append(d.ellipse(x, y, 2 + r.random() * 5, 1.5 + r.random() * 3, r.choice([(0.36, 0.22, 0.13), (0.22, 0.24, 0.22)]), op=60))
        L.append(d.rect(0, h - 40, w, 40, (0.18, 0.15, 0.12), op=40, effects=[d.blur(12)], name="grime"))
    elif name == "wood":  # weathered bench slats, grain along u
        base = (0.47, 0.35, 0.24)
        L.append(d.rect(0, 0, w, h, base))
        for i in range(60):
            y = r.random() * h
            pts = [(x, y + math.sin(x / (18 + r.random() * 30) + i) * 2.5) for x in range(-10, w + 20, 16)]
            L.append(d.line(pts, mul(base, 0.7 + r.random() * 0.6), 0.8 + r.random() * 1.6, op=55, smooth=True))
        for _ in range(3):
            x, y = r.random() * w, r.random() * h
            L.append(d.ellipse(x - 7, y - 4, 14, 8, (0.25, 0.17, 0.10), op=80))
        L.append(d.rect(0, 0, w, h, (0.62, 0.60, 0.56), op=28, name="silvered"))
        L.append(d.noise(w, h, op=20, scale=25))
    elif name == "wire":  # the wire basket's diamond mesh (alpha)
        c = (0.12, 0.12, 0.12)
        for k in range(-256, 512, 26):
            L.append(d.line([(k, 0), (k + 256, 256)], c, 3.2))
            L.append(d.line([(k, 256), (k + 256, 0)], c, 3.2))
        L.append(d.rect(0, 0, w, 10, c))
        L.append(d.rect(0, h - 12, w, 12, c))
        L.append(d.rect(0, h / 2 - 3, w, 6, c))
    elif name == "bag":
        base = (0.05, 0.05, 0.06)
        L.append(d.rect(0, 0, w, h, base))
        for _ in range(14):
            x = r.random() * w
            L.append(d.line([(x, 0), (x + (r.random() - 0.5) * 40, h)], (0.32, 0.32, 0.36), 4 + r.random() * 6, op=40, effects=[d.blur(5)]))
    elif name == "steel":  # brushed stainless cart body with panel seams and rivets
        base = (0.68, 0.70, 0.72)
        L.append(d.rect(0, 0, w, h, base, grad=d.lin(0, 0, 0, h, [(0, (0.80, 0.82, 0.84)), (0.5, base), (1, (0.52, 0.53, 0.55))])))
        for _ in range(110):
            y = r.random() * h
            L.append(d.line([(0, y), (w, y)], r.choice([(0.85, 0.86, 0.88), (0.55, 0.56, 0.58)]), 0.8, op=45))
        for x in (85, 170):
            L.append(d.line([(x, 0), (x, h)], (0.35, 0.36, 0.38), 2))
            for y in range(12, h, 28):
                L.append(d.ellipse(x - 6, y, 3.5, 3.5, (0.45, 0.46, 0.48)))
        L.append(d.rect(0, h - 50, w, 50, (0.30, 0.27, 0.24), op=35, effects=[d.blur(14)], name="road grime"))
    elif name == "sign":  # the cart's side panel: an invented vendor sign
        L.append(d.rect(0, 0, w, h, (0.96, 0.93, 0.85)))
        L.append(d.rect(0, 0, w, 92, (0.78, 0.13, 0.10)))
        L.append(d.rect(0, 92, w, 10, (0.98, 0.78, 0.12)))
        L.append(d.text(128, 52, "HOT DOGS", 40, (1, 0.97, 0.88)))
        L.append(d.text(128, 84, "PRETZELS  SODA", 21, (1, 0.86, 0.30), tracking=40))
        # a drawn hot dog and a pretzel
        L.append(d.rect(46, 140, 164, 44, (0.86, 0.62, 0.32), round_=22))
        L.append(d.rect(38, 150, 180, 22, (0.62, 0.22, 0.12), round_=11))
        L.append(d.line([(56, 160), (76, 154), (96, 164), (116, 154), (136, 164), (156, 154), (176, 164), (198, 156)], (0.98, 0.80, 0.10), 4, smooth=True))
        L.append(d.poly([(128, 232), (100, 204), (112, 194), (128, 214), (144, 194), (156, 204), (128, 232)], None, smooth=True, closed=False, stroke=((0.55, 0.32, 0.14), 8)))
        L.append(d.line([(112, 226), (144, 226)], (0.55, 0.32, 0.14), 8))
        L.append(d.rect(0, h - 14, w, 14, (0.78, 0.13, 0.10)))
    elif name == "umbrella":  # cart umbrella, stripes run round it (u)
        a, b = (0.80, 0.16, 0.12), (0.95, 0.90, 0.78)
        for i in range(8):
            L.append(d.rect(i * 32, 0, 32, h, a if i % 2 == 0 else b))
        L.append(d.rect(0, 0, w, h, (0, 0, 0), op=100, blend="multiply",
                        grad=d.lin(0, 0, 0, h, [(0, (1, 1, 1)), (0.8, (0.88, 0.88, 0.88)), (1, (0.62, 0.62, 0.62))])))
        L.append(d.rect(0, h - 12, w, 12, (0.25, 0.07, 0.06)))
        L.append(d.noise(w, h, op=10, scale=30))
    elif name == "globe":   # the lamp's glass: warm and bright in the middle
        L.append(d.rect(0, 0, w, h, (0.92, 0.80, 0.56)))
        L.append(d.rect(0, 0, w, h, (1, 1, 1), grad=d.rad(128, 128, 180, [(0, (1.0, 0.97, 0.86)), (0.6, (1.0, 0.88, 0.62)), (1, (0.90, 0.74, 0.48))])))
        for y in range(0, h, 32):
            L.append(d.line([(0, y), (w, y)], (0.80, 0.66, 0.44), 1.5, op=40))
    elif name == "gilded":  # Columbia's gilded bronze on the Maine monument
        base = (0.80, 0.60, 0.24)
        L.append(d.rect(0, 0, w, h, base))
        L.append(d.noise(w, h, op=60, scale=18, kind="turbulentSmooth", blend="overlay"))
        for _ in range(9):
            x = r.random() * w
            L.append(d.line([(x, 0), (x + (r.random() - 0.5) * 20, h)], (0.30, 0.46, 0.38), 6 + r.random() * 10, op=35, effects=[d.blur(6)]))
        L.append(d.ellipse(40, 30, 120, 90, (1, 0.92, 0.6), op=35, effects=[d.blur(30)]))
    elif name == "granite":
        base = (0.66, 0.65, 0.62)
        L.append(d.rect(0, 0, w, h, base))
        for _ in range(900):
            x, y = r.random() * w, r.random() * h
            c = r.choice([(0.18, 0.18, 0.19), (0.88, 0.87, 0.85), (0.70, 0.60, 0.56), (0.45, 0.45, 0.46)])
            L.append(d.rect(x, y, 1.5 + r.random() * 2.5, 1.5 + r.random() * 2.5, c, op=80))
        L.append(d.noise(w, h, op=18, scale=40))
        L.append(d.rect(0, 0, w, h, (0.25, 0.24, 0.22), op=30, blend="multiply",
                        grad=d.lin(0, 0, 0, h, [(0, (1, 1, 1)), (1, (0.75, 0.74, 0.72))])))
    elif name == "marble":
        base = (0.86, 0.84, 0.79)
        L.append(d.rect(0, 0, w, h, base))
        for _ in range(9):
            pts = [(r.random() * w, -10)]
            for k in range(6):
                pts.append((pts[-1][0] + (r.random() - 0.5) * 70, pts[-1][1] + h / 5))
            L.append(d.line(pts, (0.55, 0.55, 0.55), 1 + r.random() * 2, op=40, smooth=True))
        L.append(d.noise(w, h, op=20, scale=30))
        L.append(d.rect(0, 0, w, h, (0.40, 0.38, 0.33), op=35, blend="multiply", grad=d.lin(0, 0, 0, h, [(0, (1, 1, 1)), (0.6, (0.9, 0.9, 0.88)), (1, (0.62, 0.60, 0.56))])))
    elif name == "boards":  # rink dasher boards: blue rail, white boards, yellow kick plate, puck scuffs
        L.append(d.rect(0, 0, w, h, (0.93, 0.94, 0.95)))
        L.append(d.rect(0, 0, w, 34, (0.12, 0.30, 0.62)))
        L.append(d.rect(0, h - 30, w, 30, (0.95, 0.78, 0.18)))
        for x in range(0, w, 64):
            L.append(d.line([(x, 34), (x, h - 30)], (0.75, 0.77, 0.80), 1.5))
        for _ in range(30):
            x, y = r.random() * w, h - 30 - r.random() * 80
            L.append(d.ellipse(x, y, 4 + r.random() * 10, 2 + r.random() * 3, (0.15, 0.15, 0.16), op=40))
        L.append(d.noise(w, h, op=8, scale=40))
    return L


def props_doc():
    d = Doc(77)
    layers = []
    for name in PROPS:
        x, y, w, h = cell(name)
        layers.append(d.group("prop_" + name, x, y, w, h, props_layers(d, name)))
    return 1024, 1024, (0, 0, 0, 0), layers, d


# ================================================================================ Schist

def schist_doc():
    d = Doc(5)
    r = d.rng
    W = 1024
    L = [d.rect(0, 0, W, W, (0.42, 0.42, 0.41), name="base", grad=d.lin(0, 0, W, W, [(0, (0.46, 0.46, 0.45)), (1, (0.38, 0.38, 0.38))]))]
    # foliation: wavy, gently dipping bands of darker and silvery rock
    y = -40
    while y < W + 40:
        th = 6 + r.random() * 26
        pts = [(x, y + math.sin(x / 140 + y) * 14 + (r.random() - 0.5) * 6) for x in range(-40, W + 80, 48)]
        c = r.choice([(0.30, 0.30, 0.31), (0.52, 0.52, 0.50), (0.36, 0.35, 0.33), (0.58, 0.58, 0.56)])
        L.append(d.line(pts, c, th, op=55, smooth=True, name="band"))
        y += th * (0.8 + r.random())
    L.append(d.noise(W, W, op=45, scale=60, kind="rocky", seed=7, contrast=50, name="rock"))
    L.append(d.noise(W, W, op=20, scale=6, kind="turbulentSharp", seed=8, contrast=60, name="mica"))
    for _ in range(14):   # quartz lenses along the foliation
        x, y0 = r.random() * W, r.random() * W
        L.append(d.ellipse(x, y0, 40 + r.random() * 120, 4 + r.random() * 7, (0.80, 0.79, 0.76), op=40, rot=(r.random() - 0.5) * 12, effects=[d.blur(2.5)]))
    for _ in range(10):   # rust stains from the iron in it
        L.append(d.poly(d.blob(r.random() * W, r.random() * W, 40 + r.random() * 80, 25 + r.random() * 50), (0.55, 0.37, 0.22), op=24, smooth=True, effects=[d.blur(28)]))
    for _ in range(22):   # rain streaks running down
        x = r.random() * W
        y0 = r.random() * W * 0.7
        L.append(d.line([(x, y0), (x + (r.random() - 0.5) * 10, y0 + 120 + r.random() * 300)], (0.16, 0.16, 0.17), 4 + r.random() * 10, op=14, effects=[d.blur(7)]))
    for _ in range(70):   # lichen rosettes: pale grey-green, lighter rims, in colonies
        cx, cy = r.random() * W, r.random() * W
        for k in range(r.randint(1, 4)):
            rr = 5 + r.random() * 20
            x, y1 = cx + (r.random() - 0.5) * 60, cy + (r.random() - 0.5) * 60
            c = r.choice([(0.64, 0.67, 0.60), (0.70, 0.71, 0.66), (0.58, 0.62, 0.52), (0.68, 0.66, 0.54)])
            L.append(d.poly(d.blob(x, y1, rr, rr * (0.8 + r.random() * 0.4), n=14, jit=0.3), c, op=55, smooth=True, stroke=(mul(c, 1.1), 1.2, 45), effects=[d.blur(0.8)]))
            L.append(d.poly(d.blob(x, y1, rr * 0.5, rr * 0.45, n=8, jit=0.3), mul(c, 0.88), op=35, smooth=True))
    for _ in range(16):   # moss in the cracks
        x, y0 = r.random() * W, r.random() * W
        L.append(d.line([(x, y0), (x + 30 + r.random() * 90, y0 + (r.random() - 0.5) * 20)], (0.27, 0.33, 0.18), 4, op=40, smooth=True, effects=[d.blur(1.5)]))
    for _ in range(14):   # cracks along the foliation
        x, y0 = r.random() * W, r.random() * W
        pts = [(x, y0)]
        for k in range(6):
            pts.append((pts[-1][0] + 20 + r.random() * 40, pts[-1][1] + (r.random() - 0.5) * 14))
        L.append(d.line(pts, (0.12, 0.12, 0.12), 1.5 + r.random() * 2, op=55, smooth=True))
    return W, W, (0.4, 0.4, 0.4, 1), L, d


# ================================================================================ Wall, Rubble, Ice

def wall_doc():
    """1 m x 1 m of the park wall: four courses of ashlar, darker toward the ground."""
    d = Doc(9)
    r = d.rng
    W = 512
    L = [d.rect(0, 0, W, W, (0.40, 0.38, 0.35), name="mortar")]
    ch = W / 4
    for row in range(4):
        x = -r.random() * 120
        while x < W:
            bw = 130 + r.random() * 200
            c = mix((0.56, 0.53, 0.48), (0.68, 0.65, 0.59), r.random())
            c = mix(c, (0.62, 0.55, 0.45), r.random() * 0.4)
            L.append(d.rect(x + 3, row * ch + 3, bw - 6, ch - 6, c, round_=4,
                            grad=d.lin(0, row * ch, 0, row * ch + ch, [(0, mul(c, 1.1)), (0.7, c), (1, mul(c, 0.82))])))
            x += bw
    L.append(d.noise(W, W, op=35, scale=22, kind="rocky", seed=3, contrast=45))
    L.append(d.rect(0, W * 0.55, W, W * 0.45, (0.20, 0.18, 0.15), op=45, blend="multiply",
                    grad=d.lin(0, W * 0.55, 0, W, [(0, (1, 1, 1)), (1, (0.45, 0.42, 0.38))]), name="splash"))
    for _ in range(12):
        x = r.random() * W
        L.append(d.line([(x, 0), (x, 90 + r.random() * 200)], (0.18, 0.18, 0.18), 8 + r.random() * 10, op=20, effects=[d.blur(6)]))
    return W, W, (0.4, 0.4, 0.4, 1), L, d


def rubble_doc():
    d = Doc(13)
    r = d.rng
    W = 512
    L = [d.rect(0, 0, W, W, (0.50, 0.48, 0.44), name="mortar"), d.noise(W, W, op=30, scale=6, kind="turbulentSmooth")]
    # rough coursed rubble: rows of irregular stones
    y = 0
    while y < W:
        rh = 34 + r.random() * 30
        x = -r.random() * 40
        while x < W:
            sw = 40 + r.random() * 70
            c = r.choice([(0.30, 0.29, 0.28), (0.38, 0.36, 0.33), (0.45, 0.43, 0.40), (0.34, 0.31, 0.27), (0.50, 0.46, 0.40)])
            pts = [(x + 3 + r.random() * 5, y + 3 + r.random() * 5), (x + sw * 0.5, y + 1 + r.random() * 4), (x + sw - 3 - r.random() * 5, y + 3 + r.random() * 5),
                   (x + sw - 2 - r.random() * 4, y + rh * 0.5), (x + sw - 3 - r.random() * 5, y + rh - 3 - r.random() * 4),
                   (x + sw * 0.5, y + rh - 1 - r.random() * 4), (x + 3 + r.random() * 5, y + rh - 3 - r.random() * 5), (x + 2 + r.random() * 4, y + rh * 0.5)]
            L.append(d.poly(pts, c, smooth=True, stroke=(mul(c, 0.6), 2, 70)))
            L.append(d.poly([(p[0] * 0.8 + (x + sw / 2) * 0.2, p[1] * 0.8 + (y + rh / 2) * 0.2 - 2) for p in pts[:4]] + [(x + sw / 2, y + rh / 2)], mul(c, 1.25), op=35, smooth=True))
            x += sw
        y += rh
    L.append(d.noise(W, W, op=35, scale=16, kind="rocky", seed=5, contrast=45))
    for _ in range(30):
        L.append(d.ellipse(r.random() * W, r.random() * W, 8 + r.random() * 20, 6 + r.random() * 14, (0.66, 0.70, 0.60), op=40))
    return W, W, (0.45, 0.45, 0.45, 1), L, d


def ice_doc():
    d = Doc(17)
    r = d.rng
    W = 512
    L = [d.rect(0, 0, W, W, (0.82, 0.87, 0.91), name="ice"), d.noise(W, W, op=30, scale=70, seed=2, name="cloud")]
    for _ in range(12):   # slushy grey patches
        L.append(d.poly(d.blob(r.random() * W, r.random() * W, 30 + r.random() * 60, 20 + r.random() * 40), (0.70, 0.74, 0.78), op=35, smooth=True, effects=[d.blur(14)]))
    for _ in range(160):  # skate marks: long shallow arcs
        cx, cy = r.random() * W, r.random() * W
        rr = 60 + r.random() * 220
        a0 = r.random() * math.tau
        da = (40 + r.random() * 160) / rr
        pts = [(cx + math.cos(a0 + da * k / 6) * rr - math.cos(a0) * rr, cy + math.sin(a0 + da * k / 6) * rr - math.sin(a0) * rr) for k in range(7)]
        c = (0.98, 0.99, 1.0) if r.random() < 0.8 else (0.62, 0.68, 0.75)
        L.append(d.line(pts, c, 0.8 + r.random() * 1.2, op=25 + r.random() * 40, smooth=True))
    L.append(d.rect(0, 0, W, W, (0.5, 0.5, 0.5), op=6, effects=[d.grain(8)]))
    return W, W, (0.85, 0.9, 0.95, 1), L, d


def bridle_doc():
    """The bridle path: packed tan stone dust and grit, hoof prints, wet dark ruts (5 m per tile, mirrored)."""
    d = Doc(23)
    r = d.rng
    W = 512
    L = [d.rect(0, 0, W, W, (0.56, 0.49, 0.40), name="dust"),
         d.noise(W, W, op=45, scale=90, seed=3, contrast=40, name="patches"),
         d.noise(W, W, op=40, scale=5, kind="turbulentSmooth", seed=6, contrast=80, name="grain")]
    for _ in range(9):   # darker damp hollows
        L.append(d.poly(d.blob(r.random() * W, r.random() * W, 30 + r.random() * 70, 18 + r.random() * 40), (0.36, 0.31, 0.25), op=35, smooth=True, effects=[d.blur(18)]))
    for k in range(2):   # the trodden line down the middle, a little darker
        x = W * (0.35 + 0.3 * k)
        L.append(d.line([(x + (r.random() - 0.5) * 40, -10), (x + (r.random() - 0.5) * 40, W / 2), (x + (r.random() - 0.5) * 40, W + 10)], (0.45, 0.39, 0.31), 60, op=30, smooth=True, effects=[d.blur(16)]))
    for _ in range(22):  # hoof prints: little crescents
        x, y = r.random() * W, r.random() * W
        rot = r.random() * 0.6 - 0.3
        pts = [(x + math.sin(a) * 9, y - math.cos(a) * 11) for a in [(-1.2 + i * 0.3) for i in range(9)]]
        L.append(d.line(pts, (0.33, 0.28, 0.22), 2.5, op=28, smooth=True, effects=[d.blur(1.5)]))
    for _ in range(900):  # grit and pebbles
        c = r.choice([(0.70, 0.66, 0.58), (0.42, 0.38, 0.33), (0.62, 0.55, 0.46), (0.80, 0.77, 0.70)])
        sz = 1.5 + r.random() ** 3 * 7
        L.append(d.ellipse(r.random() * W, r.random() * W, sz, sz * (0.6 + r.random() * 0.5), c, op=70, rot=r.random() * 3))
    for _ in range(40):   # a few fallen leaves pressed in
        L.append(d.poly(d.blob(r.random() * W, r.random() * W, 6, 4, n=6), r.choice([(0.45, 0.25, 0.12), (0.55, 0.38, 0.15), (0.32, 0.22, 0.14)]), op=80, smooth=True))
    L.append(d.rect(0, 0, W, W, (0.5, 0.5, 0.5), op=8, effects=[d.grain(10)]))
    return W, W, (0.56, 0.49, 0.40, 1), L, d


DOCS = {"Trees": trees_doc, "Props": props_doc, "Schist": schist_doc, "Wall": wall_doc, "Rubble": rubble_doc, "Ice": ice_doc, "Bridle": bridle_doc}
NEEDS_FONT = {"Props"}


def build_doc(name, font=None):
    """name -> Tesseract document JSON. font: (family, style) from import-font, for docs with text."""
    _FONT[0] = font
    W, H, bg, layers, d = DOCS[name]()
    layers = list(reversed(layers))   # layers[0] is frontmost
    return {"$schema": "https://jerboa.dev/schemas/fx-composition/editable/v1/document.schema.json", "formatVersion": 1,
            "dimensions": {"width": W, "height": H}, "duration": 3.0, "backgroundColor": list(bg),
            "composition": {"id": "main", "name": "Central Park " + name, "layers": layers}}
