"""Far From the Tree - building facade textures, authored as editable Tesseract compositions.

Imported by build_buildings.py (system Python, no dependencies). Every texture-array layer the
building shader samples is one design, drawn four times from the same feature list so the
channels line up exactly:

    albedo  colour (walls painted light and neutral: the shader tints them per building)
    height  relief (0.5 = wall plane): post.mjs turns it into a normal map
    rough   roughness
    mask    R = glass (1 clear: the shader shows a room behind it, 0.5 covered: blinds, displays)
            G = tinted wall with a procedural pattern (brick / ashlar laid by post.mjs)
            B = tinted wall, painted as drawn (brick arches, painted panels)
            black = untinted trim (stone, iron, frames, signs)

-> src/<Layer>/<channel>.tsrct (open in Tesseract to tweak, or edit this file and rebuild).

Each layer is a whole number of bays wide and floors tall (world/facades.ts places AC units,
cats and balconies by TILES[style].bayW / floorH, so window centres stay on the bay centres and
sills sit 0.85-0.9 m above each floor line). Storefront layers are two 4.5 m shops wide and span
the ground floor. All lettering is drawn with a built-in stroke font: no font files embedded,
and every shop name is invented.
"""
import math, random

PX = 1024

# --------------------------------------------------------------------------------------- tiles
# style -> (bayW, floorH): must match web/src/render/facades.ts TILES (and so world/facades.ts)
BAY = {"tenement": (2.6, 3.2), "castiron": (3.7, 4.3), "prewar": (3.0, 3.4), "deco": (3.2, 3.7),
       "modern": (1.6, 3.7), "glass": (1.5, 4.0), "brick": (2.8, 2.95), "civic": (3.6, 4.6)}
SHOP_W, SHOP_H = 9.0, 4.6


# --------------------------------------------------------------------------------------- doc

class Doc:
    AR = {"start": 0, "duration": 3000}

    def __init__(self, seed):
        self.next_id = 1
        self.next_fx = 1
        self.rng = random.Random(seed)

    def lid(self):
        self.next_id += 1
        return self.next_id

    def fx(self, effect):
        self.next_fx += 1
        return {"id": self.next_fx, "effect": effect}

    @staticmethod
    def tf(x=0.0, y=0.0, rot=0.0, op=100, sx=100, sy=100):
        return {"anchorPoint": [0, 0], "position": [x, y], "scale": [sx, sy], "rotation": rot, "opacity": op}

    @staticmethod
    def col(c):
        c = list(c)
        if len(c) == 1:
            c = c * 3
        return c + ([1.0] if len(c) == 3 else [])

    def rect(self, x, y, w, h, c, op=100, blend="normal", effects=None, name="rect", grad=None, round_=0.0):
        r = {"size": [w, h], "fillColor": self.col(c), "roundness": round_}
        if grad:
            r["fillPaint"] = grad
        return {"type": "Rect", "id": self.lid(), "name": name, "blendMode": blend, "activeRange": self.AR,
                "transform": self.tf(x, y, 0, op), "rect": r, "effects": effects or []}

    def _fill(self, c, op=100, grad=None):
        paint = grad or {"type": "solid", "color": self.col(c)}
        return [{"paint": paint, "fillRule": "nonZeroWinding", "blendMode": "normal", "opacity": op / 100.0}]

    def ellipse(self, cx, cy, w, h, c, op=100, blend="normal", name="ellipse", grad=None):
        return {"type": "Shape", "id": self.lid(), "name": name, "blendMode": blend, "activeRange": self.AR,
                "transform": self.tf(cx, cy), "effects": [],
                "shape": {"path": {"commands": []}, "ellipse": {"size": [w, h]}, "fills": self._fill(c, op, grad)}}

    def poly(self, pts, c, op=100, blend="normal", name="poly", stroke=None, closed=True, grad=None, effects=None):
        cmds = [{"type": "moveTo", "x": pts[0][0], "y": pts[0][1]}]
        cmds += [{"type": "lineTo", "x": p[0], "y": p[1]} for p in pts[1:]]
        if closed:
            cmds.append({"type": "close"})
        shape = {"path": {"commands": cmds}, "fills": self._fill(c, op, grad) if c is not None else []}
        if stroke:
            sc, sw = stroke[0], stroke[1]
            shape["strokes"] = [{"paint": {"type": "solid", "color": self.col(sc)}, "width": sw, "cap": stroke[2] if len(stroke) > 2 else "round",
                                 "join": "round", "miterLimit": 4, "blendMode": "normal", "opacity": op / 100.0}]
        return {"type": "Shape", "id": self.lid(), "name": name, "blendMode": blend, "activeRange": self.AR,
                "transform": self.tf(0, 0), "shape": shape, "effects": effects or []}

    def group(self, name, w, h, layers, effects=None, blend="normal"):
        return {"type": "Group", "id": self.lid(), "name": name, "blendMode": blend,
                "playback": {"type": "windowed", "inputRange": dict(self.AR),
                             "mapping": {"type": "linear", "input": dict(self.AR), "output": dict(self.AR)}, "inputOffsetMs": 0},
                "transform": self.tf(0, 0), "layers": list(reversed(layers)), "effects": effects or [],
                "masks": [{"id": self.lid(), "mode": "add", "opacity": 100, "path": {"commands": [
                    {"type": "moveTo", "x": 0, "y": 0}, {"type": "lineTo", "x": w, "y": 0}, {"type": "lineTo", "x": w, "y": h},
                    {"type": "lineTo", "x": 0, "y": h}, {"type": "close"}]}}]}

    def lin(self, x0, y0, x1, y1, stops):
        return {"type": "gradient", "gradientType": "linear", "start": [x0, y0], "end": [x1, y1],
                "stops": [{"offset": o, "color": self.col(c)} for o, c in stops]}

    def noise(self, x, y, w, h, op=20, scale=40, blend="overlay", kind="cloudy", seed=0.0, contrast=120, cx=4):
        return self.rect(x, y, w, h, (0.5,), op=op, blend=blend, name="noise",
                         effects=[self.fx({"type": "turbulentNoise", "scale": scale, "fractalType": kind, "evolution": seed,
                                           "contrast": contrast, "complexity": cx})])

    def blur(self, b):
        return self.fx({"type": "gaussianBlur", "blurriness": b, "repeatEdgePixels": True})


def mul(c, k):
    return tuple(max(0.0, min(1.0, v * k)) for v in c)


def mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


# --------------------------------------------------------------------------------------- stroke font

_O = [(1, 0), (3, 0), (4, 1), (4, 5), (3, 6), (1, 6), (0, 5), (0, 1), (1, 0)]
_P = [(0, 6), (0, 0), (3, 0), (4, 1), (4, 2), (3, 3), (0, 3)]
GLYPH = {
    "A": [[(0, 6), (2, 0), (4, 6)], [(0.8, 4), (3.2, 4)]],
    "B": [[(0, 3), (0, 0), (3, 0), (4, 0.8), (4, 2.2), (3, 3), (0, 3), (0, 6), (3, 6), (4, 5.2), (4, 3.8), (3, 3)]],
    "C": [[(4, 1), (3, 0), (1, 0), (0, 1), (0, 5), (1, 6), (3, 6), (4, 5)]],
    "D": [[(0, 0), (0, 6), (2.5, 6), (4, 4.5), (4, 1.5), (2.5, 0), (0, 0)]],
    "E": [[(4, 0), (0, 0), (0, 6), (4, 6)], [(0, 3), (3, 3)]],
    "F": [[(4, 0), (0, 0), (0, 6)], [(0, 3), (3, 3)]],
    "G": [[(4, 1), (3, 0), (1, 0), (0, 1), (0, 5), (1, 6), (3, 6), (4, 5), (4, 3.2), (2.2, 3.2)]],
    "H": [[(0, 0), (0, 6)], [(4, 0), (4, 6)], [(0, 3), (4, 3)]],
    "I": [[(1, 0), (3, 0)], [(2, 0), (2, 6)], [(1, 6), (3, 6)]],
    "J": [[(4, 0), (4, 5), (3, 6), (1, 6), (0, 5)]],
    "K": [[(0, 0), (0, 6)], [(4, 0), (0, 3.6)], [(1.4, 2.6), (4, 6)]],
    "L": [[(0, 0), (0, 6), (4, 6)]],
    "M": [[(0, 6), (0, 0), (2, 3.4), (4, 0), (4, 6)]],
    "N": [[(0, 6), (0, 0), (4, 6), (4, 0)]],
    "O": [_O],
    "P": [_P],
    "Q": [_O, [(2.6, 4.4), (4.2, 6.4)]],
    "R": [_P, [(2, 3), (4, 6)]],
    "S": [[(4, 1), (3, 0), (1, 0), (0, 1), (0, 2), (1, 3), (3, 3), (4, 4), (4, 5), (3, 6), (1, 6), (0, 5)]],
    "T": [[(0, 0), (4, 0)], [(2, 0), (2, 6)]],
    "U": [[(0, 0), (0, 5), (1, 6), (3, 6), (4, 5), (4, 0)]],
    "V": [[(0, 0), (2, 6), (4, 0)]],
    "W": [[(0, 0), (1, 6), (2, 2.6), (3, 6), (4, 0)]],
    "X": [[(0, 0), (4, 6)], [(4, 0), (0, 6)]],
    "Y": [[(0, 0), (2, 3), (4, 0)], [(2, 3), (2, 6)]],
    "Z": [[(0, 0), (4, 0), (0, 6), (4, 6)]],
    "0": [_O, [(0.6, 5.2), (3.4, 0.8)]],
    "1": [[(1, 1), (2, 0), (2, 6)], [(1, 6), (3, 6)]],
    "2": [[(0, 1), (1, 0), (3, 0), (4, 1), (4, 2.2), (0, 6), (4, 6)]],
    "3": [[(0, 1), (1, 0), (3, 0), (4, 1), (4, 2), (3, 3), (1.5, 3)], [(3, 3), (4, 4), (4, 5), (3, 6), (1, 6), (0, 5)]],
    "4": [[(3, 6), (3, 0), (0, 4), (4, 4)]],
    "5": [[(4, 0), (0, 0), (0, 3), (3, 3), (4, 4), (4, 5), (3, 6), (0, 6)]],
    "6": [[(3.5, 0), (1, 0), (0, 1), (0, 5), (1, 6), (3, 6), (4, 5), (4, 4), (3, 3), (0, 3)]],
    "7": [[(0, 0), (4, 0), (1.5, 6)]],
    "8": [[(1, 3), (0, 2), (0, 1), (1, 0), (3, 0), (4, 1), (4, 2), (3, 3), (1, 3), (0, 4), (0, 5), (1, 6), (3, 6), (4, 5), (4, 4), (3, 3)]],
    "9": [[(0.5, 6), (3, 6), (4, 5), (4, 1), (3, 0), (1, 0), (0, 1), (0, 2), (1, 3), (4, 3)]],
    "&": [[(4, 6), (0.6, 2), (0.6, 0.8), (1.4, 0), (2.4, 0), (3, 0.8), (3, 1.6), (0, 4), (0, 5.2), (1, 6), (2.4, 6), (4, 3.6)]],
    "'": [[(2, 0), (1.6, 1.6)]],
    "-": [[(0.8, 3), (3.2, 3)]],
    ".": [[(1.8, 5.6), (2.2, 6)]],
    "$": [[(4, 1), (3, 0.4), (1, 0.4), (0, 1.2), (0, 2.2), (1, 3), (3, 3), (4, 3.8), (4, 4.8), (3, 5.6), (1, 5.6), (0, 5)], [(2, -0.4), (2, 6.4)]],
}
# a dozen real, simple hanzi drawn stroke by stroke (6 x 6 grid)
HANZI = {
    "大": [[(0.4, 2), (5.6, 2)], [(3, 0), (3, 2.2), (2, 4.4), (0.3, 6)], [(3, 2.2), (4, 4.4), (5.8, 6)]],
    "中": [[(0.8, 1.6), (5.2, 1.6), (5.2, 4), (0.8, 4), (0.8, 1.6)], [(3, 0), (3, 6)]],
    "日": [[(1.3, 0.4), (4.7, 0.4), (4.7, 5.6), (1.3, 5.6), (1.3, 0.4)], [(1.3, 3), (4.7, 3)]],
    "王": [[(0.8, 0.8), (5.2, 0.8)], [(1.2, 3), (4.8, 3)], [(0.3, 5.4), (5.7, 5.4)], [(3, 0.8), (3, 5.4)]],
    "山": [[(3, 0.3), (3, 5.3)], [(0.8, 2), (0.8, 5.3), (5.2, 5.3), (5.2, 2)]],
    "人": [[(3.2, 0.3), (2.5, 3), (0.3, 5.8)], [(2.8, 2.2), (4, 4.2), (5.8, 5.8)]],
    "天": [[(1, 0.6), (5, 0.6)], [(0.4, 2.4), (5.6, 2.4)], [(3, 0.6), (3, 2.6), (2, 4.5), (0.3, 6)], [(3, 2.6), (4, 4.5), (5.8, 6)]],
    "金": [[(3, 0), (0.3, 2.6)], [(3, 0), (5.7, 2.6)], [(1.5, 2.7), (4.5, 2.7)], [(1, 4), (5, 4)], [(3, 2.7), (3, 5.6)],
          [(1.6, 4.6), (2.1, 5.2)], [(4.4, 4.6), (3.9, 5.2)], [(0.4, 5.6), (5.6, 5.6)]],
    "木": [[(0.4, 1.8), (5.6, 1.8)], [(3, 0), (3, 6)], [(3, 2), (0.4, 5)], [(3, 2), (5.6, 5)]],
    "本": [[(0.4, 1.8), (5.6, 1.8)], [(3, 0), (3, 6)], [(3, 2), (0.4, 5)], [(3, 2), (5.6, 5)], [(1.8, 4.4), (4.2, 4.4)]],
    "正": [[(0.8, 0.7), (5.2, 0.7)], [(3, 0.7), (3, 5.5)], [(3, 3), (4.8, 3)], [(1.3, 2.8), (1.3, 5.5)], [(0.3, 5.5), (5.7, 5.5)]],
    "田": [[(1, 1), (5, 1), (5, 5), (1, 5), (1, 1)], [(3, 1), (3, 5)], [(1, 3), (5, 3)]],
    "上": [[(2.5, 0.3), (2.5, 5.4)], [(2.5, 2.6), (4.8, 2.6)], [(0.3, 5.4), (5.7, 5.4)]],
}
CN_NAMES = ["金山", "大中", "中山", "天山", "金田", "大王", "山王", "日日", "金本", "正大", "天天", "上海"[:1] + "王"]


def stroke_text(P, text, x, y, h, col, width=0.12, ch="a", align="center", maxw=None, op=100, extra=None):
    """Lettering at (x, y) = baseline-centre (metres), cap height h. Returns the drawn width."""
    hanzi = any(c in HANZI for c in text)
    unit = h / 6.0
    adv = 7.0 if hanzi else 5.2
    w = len(text) * adv * unit - (adv - (6 if hanzi else 4)) * unit
    k = 1.0
    if maxw and w > maxw:
        k = maxw / w
    w *= k
    x0 = x - w / 2 if align == "center" else x
    for i, c in enumerate(text):
        strokes = HANZI.get(c) or GLYPH.get(c.upper())
        if not strokes:
            continue
        ox = x0 + i * adv * unit * k
        for s in strokes:
            pts = [(ox + px * unit * k, y - h + py * unit) for px, py in s]
            P.line(pts, col, width, ch=ch, op=op, extra=extra)
    return w


# --------------------------------------------------------------------------------------- painter

MASK_WALL = (0, 1, 0)      # procedural tinted wall
MASK_TINT = (0, 0, 1)      # tinted, painted as drawn
MASK_TRIM = (0, 0, 0)      # untinted
MASK_COVER = (0.5, 0, 0)   # covered glass (blinds, curtains, shop displays)
MASK_GLASS = (1, 0, 0)     # clear glass: the room behind shows


class Layer:
    """One texture-array layer: W x H metres into PX x PX pixels, four channel lists."""

    def __init__(self, name, seed, W, H, wall=None, bays=1, floors=1, base=(0.8, 0.8, 0.8)):
        self.name, self.d = name, Doc(seed)
        self.rng = self.d.rng
        self.W, self.H = W, H
        self.sx, self.sy = PX / W, PX / H
        self.L = {c: [] for c in "ahrm"}
        self.wall = wall or {"kind": "none"}
        self.bays, self.floors = bays, floors
        self.base = base
        for c, v in (("a", base), ("h", (0.5,)), ("r", (0.86,)), ("m", MASK_WALL if self.wall["kind"] != "none" else MASK_TRIM)):
            self.L[c].append(self.d.rect(0, 0, PX, PX, v, name="base"))

    # wrapped copies of a box in metres
    def _copies(self, x, y, w, h):
        for dx in (-self.W, 0, self.W):
            if x + w + dx <= 0 or x + dx >= self.W:
                continue
            for dy in (-self.H, 0, self.H):
                if y + h + dy <= 0 or y + dy >= self.H:
                    continue
                yield dx, dy

    def box(self, x, y, w, h, a=None, ht=None, r=None, m=None, op=100, va=None, vh=None, ha=None, blend="normal", round_=0.0, name="rect"):
        """A rectangle in metres (y down from the tile top). va / vh: vertical gradients (top, bottom) for albedo / height;
        ha: horizontal albedo gradient (left, right)."""
        for dx, dy in self._copies(x, y, w, h):
            X, Y, Wp, Hp = (x + dx) * self.sx, (y + dy) * self.sy, w * self.sx, h * self.sy
            R = round_ * self.sx
            if a is not None or va is not None or ha is not None:
                g = None
                # (top, bottom) colour pairs, or explicit [(offset, colour), ...] stop lists
                stops = lambda s: s if isinstance(s, list) else [(0, s[0]), (1, s[1])]
                if va:
                    g = self.d.lin(X, Y, X, Y + Hp, stops(va))
                elif ha:
                    g = self.d.lin(X, Y, X + Wp, Y, stops(ha))
                self.L["a"].append(self.d.rect(X, Y, Wp, Hp, a or (1, 1, 1), op=op, grad=g, blend=blend, round_=R, name=name))
            if ht is not None or vh is not None:
                g = self.d.lin(X, Y, X, Y + Hp, [(0, (vh[0],)), (1, (vh[1],))]) if vh else None
                self.L["h"].append(self.d.rect(X, Y, Wp, Hp, (ht if ht is not None else 0.5,), op=op if blend == "normal" else 100, grad=g, round_=R, name=name))
            if r is not None:
                self.L["r"].append(self.d.rect(X, Y, Wp, Hp, (r,), round_=R, name=name))
            if m is not None:
                self.L["m"].append(self.d.rect(X, Y, Wp, Hp, m, round_=R, name=name))

    def polygon(self, pts, a=None, ht=None, r=None, m=None, op=100, blend="normal"):
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        for dx, dy in self._copies(min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)):
            P = [((px + dx) * self.sx, (py + dy) * self.sy) for px, py in pts]
            for ch, v in (("a", a), ("h", None if ht is None else (ht,)), ("r", None if r is None else (r,)), ("m", m)):
                if v is not None:
                    self.L[ch].append(self.d.poly(P, v, op=op if ch == "a" else 100, blend=blend if ch == "a" else "normal"))

    def line(self, pts, col, width, ch="a", op=100, extra=None, cap="round"):
        """A stroked polyline (width in metres, measured vertically). extra: {ch: value} to also draw in other channels."""
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        chans = {ch: col}
        if extra:
            chans.update(extra)
        for dx, dy in self._copies(min(xs) - width, min(ys) - width, max(xs) - min(xs) + 2 * width, max(ys) - min(ys) + 2 * width):
            P = [((px + dx) * self.sx, (py + dy) * self.sy) for px, py in pts]
            for c, v in chans.items():
                vv = v if isinstance(v, tuple) else (v,)
                self.L[c].append(self.d.poly(P, None, stroke=(vv, width * self.sy, cap), closed=False, op=op if c == "a" else 100))

    def ellipse(self, cx, cy, w, h, a=None, ht=None, r=None, m=None, op=100):
        for dx, dy in self._copies(cx - w / 2, cy - h / 2, w, h):
            X, Y = (cx + dx) * self.sx, (cy + dy) * self.sy
            for ch, v in (("a", a), ("h", None if ht is None else (ht,)), ("r", None if r is None else (r,)), ("m", m)):
                if v is not None:
                    self.L[ch].append(self.d.ellipse(X, Y, w * self.sx, h * self.sy, v, op=op if ch == "a" else 100))

    def shade(self, x, y, w, h, k=0.55, up=False, op=100):
        """Soft multiply darkening (ambient occlusion, soot), strongest at the top (or bottom with up=True)."""
        d = (k, k, k)
        self.box(x, y, w, h, va=((1, 1, 1), d) if up else (d, (1, 1, 1)), blend="multiply", op=op)

    def noise(self, ch, op, scale, seed, blend="overlay", kind="cloudy", contrast=120):
        self.L[ch].append(self.d.noise(0, 0, PX, PX, op=op, scale=scale, seed=seed, blend=blend, kind=kind, contrast=contrast))

    def streaks(self, xs, y, length=1.6, k=0.6, width=(0.12, 0.35), op=60):
        """Rain-washed dirt running down the wall from sills and ledges (albedo, multiply, softened)."""
        out = []
        for x in xs:
            ww = self.rng.uniform(*width)
            ln = length * self.rng.uniform(0.6, 1.2)
            X0, Y0, Wp, Hp = x * self.sx, y * self.sy, ww * self.sx, ln * self.sy
            dark = (k, k * 0.97, k * 0.93)
            pts = [(X0, Y0), (X0 + Wp, Y0), (X0 + Wp * 0.7, Y0 + Hp), (X0 + Wp * 0.3, Y0 + Hp)]
            out.append(self.d.poly(pts, dark, op=self.rng.uniform(op * 0.5, op), grad=self.d.lin(X0, Y0, X0, Y0 + Hp, [(0, dark), (1, (1, 1, 1))])))
        if out:
            bg = self.d.rect(0, 0, PX, PX, (1, 1, 1))
            grp = self.d.group("streaks", PX, PX, [bg] + out, effects=[self.d.blur(3)], blend="multiply")
            self.L["a"].append(grp)

    def doc(self, ch):
        label = {"a": "albedo", "h": "height", "r": "rough", "m": "mask"}[ch]
        panel = self.d.group("%s %s" % (self.name, label), PX, PX, self.L[ch])
        return {"$schema": "https://jerboa.dev/schemas/fx-composition/editable/v1/document.schema.json", "formatVersion": 1,
                "dimensions": {"width": PX, "height": PX}, "duration": 3.0, "backgroundColor": [0.5, 0.5, 0.5, 1.0],
                "composition": {"id": "main", "name": "%s %s" % (self.name, label), "layers": [panel]}}

    def meta(self):
        return {"name": self.name, "W": self.W, "H": self.H, "wall": self.wall, "bays": self.bays, "floors": self.floors}


# --------------------------------------------------------------------------------------- window kit

GLASS_TOP = (0.36, 0.42, 0.48)
GLASS_BOT = (0.10, 0.12, 0.14)
FRAME_WHITE = (0.86, 0.85, 0.80)
FRAME_BLACK = (0.10, 0.10, 0.10)
FRAME_GREEN = (0.13, 0.22, 0.17)
FRAME_BROWN = (0.30, 0.20, 0.13)
FRAME_ALU = (0.62, 0.63, 0.62)
STONE = (0.83, 0.80, 0.73)
STONE_BROWN = (0.50, 0.38, 0.29)   # brownstone
IRON_BLACK = (0.08, 0.08, 0.085)

SHADE_COLS = [(0.90, 0.86, 0.76), (0.86, 0.82, 0.70), (0.93, 0.92, 0.88), (0.80, 0.74, 0.62), (0.72, 0.76, 0.78)]
CURTAIN_COLS = [(0.55, 0.16, 0.13), (0.40, 0.33, 0.25), (0.22, 0.33, 0.40), (0.62, 0.48, 0.22), (0.30, 0.38, 0.26),
                (0.85, 0.80, 0.70), (0.45, 0.20, 0.35)]


def pane(P, x, y, w, h, state=None):
    """One glazed sash: clear glass with a sky reflection, then whatever's behind it."""
    rng = P.rng
    tilt = rng.uniform(-0.04, 0.06)
    P.box(x, y, w, h, va=(mul(GLASS_TOP, 1 + tilt), GLASS_BOT), ht=0.22, r=0.05, m=MASK_GLASS)
    # a soft diagonal reflection
    if rng.random() < 0.5:
        x0 = x + w * rng.uniform(0.1, 0.6)
        P.polygon([(x0, y), (x0 + w * 0.18, y), (x0 - w * 0.1, y + h), (x0 - w * 0.28, y + h)], a=(0.7, 0.75, 0.8), op=rng.uniform(6, 14), blend="screen")
    s = state if state is not None else rng.random()
    if s < 0.28:      # roller shade / blind down part way
        c = rng.choice(SHADE_COLS)
        sh = h * rng.uniform(0.25, 1.0)
        P.box(x, y, w, sh, va=(mul(c, 0.92), c), ht=0.24, r=0.8, m=MASK_COVER)
        P.box(x + w * 0.45, y + sh - 0.04, w * 0.1, 0.03, a=(0.3, 0.28, 0.25), m=MASK_COVER)
        if rng.random() < 0.5:   # venetian slats
            yy = y + 0.06
            while yy < y + sh - 0.02:
                P.box(x, yy, w, 0.012, a=mul(c, 0.78), m=MASK_COVER)
                yy += 0.07
    elif s < 0.42:    # curtains drawn to the sides
        c = rng.choice(CURTAIN_COLS)
        cw = w * rng.uniform(0.2, 0.42)
        P.box(x, y, cw, h, ha=(mul(c, 0.9), mul(c, 0.7)), ht=0.24, r=0.9, m=MASK_COVER)
        P.box(x + w - cw, y, cw, h, ha=(mul(c, 0.7), mul(c, 0.9)), ht=0.24, r=0.9, m=MASK_COVER)
        for k in range(3):
            P.box(x + cw * (k + 0.5) / 3.5, y, 0.015, h, a=mul(c, 0.6), m=MASK_COVER)
    elif s < 0.5:     # net curtain across the whole sash
        P.box(x, y, w, h, a=(0.86, 0.85, 0.80), op=70, m=MASK_COVER, r=0.85)
    elif s < 0.55:    # a pot plant and a cat ornament on the inside sill
        P.ellipse(x + w * 0.3, y + h - 0.12, 0.18, 0.12, a=(0.55, 0.30, 0.18), m=MASK_COVER)
        P.ellipse(x + w * 0.3, y + h - 0.3, 0.32, 0.3, a=(0.18, 0.32, 0.16), m=MASK_COVER)
    elif s < 0.6:     # string lights (it's Thanksgiving week)
        n = int(w / 0.08)
        for k in range(n):
            t = k / max(1, n - 1)
            yy = y + 0.05 + math.sin(t * math.pi) * 0.1
            P.ellipse(x + w * t, yy, 0.04, 0.04, a=rng.choice([(1, 0.85, 0.4), (1, 0.4, 0.3), (0.4, 0.9, 0.5), (0.5, 0.7, 1)]), m=MASK_COVER)
    elif s < 0.64:    # cardboard / foil: someone's spare room
        P.box(x, y, w, h, a=(0.62, 0.50, 0.34), m=MASK_COVER, r=0.9)
        P.box(x + w * 0.1, y + h * 0.1, w * 0.3, h * 0.25, a=(0.5, 0.4, 0.28), m=MASK_COVER)


def sash_window(P, cx, y, w, h, frame=FRAME_WHITE, split=True, muntins=0, guard=False, states=None, depth=0.06):
    """A double-hung window centred at cx, top at y (metres). Returns (x, y, w, h)."""
    x = cx - w / 2
    # the reveal: shadowed brick return at the top and left (sun from the upper left)
    P.box(x - depth, y - depth, w + depth * 2, h + depth * 2, a=(0.32, 0.30, 0.28), ht=0.36, m=MASK_TRIM, r=0.9)
    P.box(x - depth, y - depth, w + depth * 2, depth * 1.6, a=(0.18, 0.17, 0.16), m=MASK_TRIM)
    # frame
    P.box(x, y, w, h, a=frame, ht=0.42, r=0.55, m=MASK_TRIM)
    f = 0.055
    if split:
        hh = (h - f * 3) / 2
        s1 = states[0] if states else None
        s2 = states[1] if states else None
        pane(P, x + f, y + f, w - 2 * f, hh, s1)
        pane(P, x + f, y + f * 2 + hh, w - 2 * f, hh, s2 if s2 is not None else (s1 if s1 is not None and s1 < 0.5 else None))
        P.box(x, y + f + hh - 0.01, w, f + 0.02, a=mul(frame, 0.92), ht=0.46, m=MASK_TRIM, r=0.55)   # meeting rail
        for k in range(1, muntins + 1):   # 2-over-2 / 6-over-6 glazing bars
            mx = x + f + (w - 2 * f) * k / (muntins + 1)
            P.box(mx - 0.012, y + f, 0.024, h - 2 * f, a=frame, ht=0.43, m=MASK_TRIM)
    else:
        pane(P, x + f, y + f, w - 2 * f, h - 2 * f, states[0] if states else None)
    if guard:   # child window guard on the lower sash
        gy = y + h * 0.62
        P.box(x + f, gy, w - 2 * f, 0.025, a=FRAME_WHITE, m=MASK_TRIM, ht=0.55)
        for k in range(6):
            P.box(x + f + (w - 2 * f) * k / 5 - 0.01, gy, 0.02, h * 0.36, a=FRAME_WHITE, m=MASK_TRIM, ht=0.55)
    return x, y, w, h


def sill(P, x, y, w, col=STONE, h=0.1, proud=0.8, corbels=False):
    P.box(x, y, w, h, va=(mix(col, (1, 1, 1), 0.15), mul(col, 0.85)), ht=proud, r=0.8, m=MASK_TRIM)
    P.shade(x - 0.02, y + h, w + 0.04, 0.16, k=0.55)
    if corbels:
        for cx in (x + 0.06, x + w - 0.14):
            P.box(cx, y + h, 0.08, 0.12, a=mul(col, 0.9), ht=proud - 0.1, m=MASK_TRIM)


def lintel(P, x, y, w, h, kind="flat", col=STONE):
    """A window head ending at y (its bottom), h tall."""
    top = y - h
    if kind == "flat":
        P.box(x, top, w, h, va=(mix(col, (1, 1, 1), 0.1), mul(col, 0.88)), ht=0.68, r=0.8, m=MASK_TRIM)
        P.box(x, top, w, 0.025, a=mix(col, (1, 1, 1), 0.3), ht=0.72, m=MASK_TRIM)
    elif kind == "capped":   # Italianate: a lintel with a projecting cap moulding
        P.box(x + 0.04, top + 0.07, w - 0.08, h - 0.07, va=(col, mul(col, 0.88)), ht=0.66, r=0.8, m=MASK_TRIM)
        P.box(x - 0.04, top, w + 0.08, 0.08, va=(mix(col, (1, 1, 1), 0.2), mul(col, 0.8)), ht=0.85, r=0.8, m=MASK_TRIM)
        P.shade(x - 0.04, top + 0.08, w + 0.08, 0.08, k=0.6)
    elif kind == "keystone":
        P.box(x, top, w, h, va=(col, mul(col, 0.9)), ht=0.66, r=0.8, m=MASK_TRIM)
        kx = x + w / 2
        P.polygon([(kx - 0.1, top - 0.04), (kx + 0.1, top - 0.04), (kx + 0.07, y + 0.02), (kx - 0.07, y + 0.02)], a=mix(col, (1, 1, 1), 0.2), ht=0.8, m=MASK_TRIM)
        for k in range(1, 6):   # voussoir joints
            jx = x + w * k / 6
            P.box(jx, top, 0.012, h, a=mul(col, 0.75), ht=0.6, m=MASK_TRIM)
    elif kind == "pediment":   # a little triangular hood on brackets
        P.box(x, top + h * 0.45, w, h * 0.55, a=col, ht=0.66, m=MASK_TRIM)
        P.polygon([(x - 0.08, top + h * 0.45), (x + w / 2, top - h * 0.25), (x + w + 0.08, top + h * 0.45)], a=mix(col, (1, 1, 1), 0.15), ht=0.85, m=MASK_TRIM)
        P.polygon([(x + 0.04, top + h * 0.42), (x + w / 2, top - h * 0.1), (x + w - 0.04, top + h * 0.42)], a=mul(col, 0.88), ht=0.75, m=MASK_TRIM)
    elif kind == "arch":     # segmental brick arch (tinted brick, laid as soldiers)
        n = 13
        cx, rr = x + w / 2, w * 0.62
        cy = y + rr * 0.55
        pts_o, pts_i = [], []
        for k in range(n + 1):
            a = math.pi + (math.pi * 0.27) + (math.pi * 0.46) * k / n
            pts_o.append((cx + math.cos(a) * (rr + h), cy + math.sin(a) * (rr + h)))
            pts_i.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
        P.polygon(pts_o + list(reversed(pts_i)), a=(0.74, 0.72, 0.70), ht=0.56, m=MASK_TINT)
        for k in range(1, n):
            P.line([pts_i[k], pts_o[k]], (0.9, 0.88, 0.84), 0.012, extra={"h": (0.42,), "m": MASK_TRIM})


def ac_sleeve(P, cx, y, w=0.7, h=0.42):
    """A through-wall AC sleeve grille (postwar brick)."""
    x = cx - w / 2
    P.box(x - 0.03, y - 0.03, w + 0.06, h + 0.06, a=(0.42, 0.42, 0.40), ht=0.45, m=MASK_TRIM)
    P.box(x, y, w, h, a=(0.72, 0.71, 0.66), ht=0.55, m=MASK_TRIM, r=0.6)
    for k in range(9):
        P.box(x + 0.03, y + 0.04 + k * (h - 0.08) / 9, w - 0.06, 0.012, a=(0.35, 0.35, 0.33), ht=0.48, m=MASK_TRIM)
    P.streaks([cx - 0.15, cx + 0.1], y + h, length=1.2, k=0.55, op=50)


def belt(P, y, h=0.18, col=STONE, proud=0.75, dentils=False):
    P.box(0, y, P.W, h, va=(mix(col, (1, 1, 1), 0.2), mul(col, 0.85)), ht=proud, r=0.8, m=MASK_TRIM)
    P.shade(0, y + h, P.W, 0.18, k=0.62)
    if dentils:
        n = int(P.W / 0.16)
        for k in range(n):
            P.box(k * P.W / n, y + h, P.W / n * 0.55, 0.07, a=mul(col, 0.9), ht=proud - 0.1, m=MASK_TRIM)


def window_states(P, n):
    """Per-window states with neighbours that tend to match (one flat, one set of blinds)."""
    out = []
    flat = P.rng.random()
    for _ in range(n):
        out.append(flat if P.rng.random() < 0.45 else P.rng.random())
    return out


# --------------------------------------------------------------------------------------- styles

def tenement(name, seed, variant):
    bw, fh = BAY["tenement"]
    bays, floors = 4, 4
    brick = {"kind": "brick", "bond": "running" if variant != "c" else "common", "mortar": (0.80, 0.78, 0.74) if variant != "d" else (0.55, 0.53, 0.5),
             "vary": 0.1 if variant != "c" else 0.05, "painted": variant == "c"}
    P = Layer(name, seed, bays * bw, floors * fh, wall=brick, bays=bays, floors=floors)
    rng = P.rng
    frame = {"a": FRAME_WHITE, "b": FRAME_BLACK, "c": FRAME_ALU, "d": FRAME_GREEN}[variant]
    head = {"a": "capped", "b": "arch", "c": "flat", "d": "pediment"}[variant]
    col = STONE if variant != "d" else STONE_BROWN
    P.noise("a", 16, 70, seed, blend="overlay")
    if variant == "b":
        # a sill course every floor
        pass
    for f in range(floors):
        y0 = f * fh
        if variant in ("b", "d"):
            belt(P, y0 + fh - 0.9 + 0.0, 0.11, col=col, proud=0.7)  # continuous sill course
        states = window_states(P, bays * 2)
        for b in range(bays):
            cx = (b + 0.5) * bw
            ww, wh = (1.0, 1.62) if variant != "c" else (1.05, 1.55)
            wy = fh - 0.9 - wh   # sill at 0.9 m above the floor line
            frame_b = frame if rng.random() > 0.15 else rng.choice([FRAME_WHITE, FRAME_ALU, FRAME_BLACK])
            guard = f >= 2 and rng.random() < 0.35
            sash_window(P, cx, y0 + wy, ww, wh, frame=frame_b, muntins=1 if (variant == "a" and rng.random() < 0.6) else 0,
                        guard=guard, states=states[b * 2:b * 2 + 2])
            lintel(P, cx - ww / 2 - 0.1, y0 + wy - 0.06, ww + 0.2, 0.26 if head != "arch" else 0.2, kind=head, col=col)
            if variant not in ("b", "d"):
                sill(P, cx - ww / 2 - 0.1, y0 + wy + wh + 0.06, ww + 0.2, col=col, corbels=variant == "a")
            P.streaks([cx - ww / 2 + rng.uniform(0, 0.2), cx + ww / 2 - rng.uniform(0.1, 0.4)], y0 + wy + wh + 0.18, length=1.4, k=0.55, op=55)
        if variant == "a" and f == 0:
            pass
    if variant == "c":   # painted brick: patchy repaint and peeling
        for _ in range(10):
            x, y = rng.uniform(0, P.W), rng.uniform(0, P.H)
            P.box(x, y, rng.uniform(0.4, 1.6), rng.uniform(0.2, 0.8), a=(0.72, 0.72, 0.72), op=rng.uniform(15, 35), blend="multiply")
    if variant == "a":   # an old ghost of a painted wall sign? just soot under the lintels
        pass
    P.noise("a", 5, 8, seed + 3, blend="overlay", kind="rocky")
    P.noise("h", 8, 6, seed + 4, blend="normal", kind="rocky")
    return P


def prewar(name, seed, variant):
    bw, fh = BAY["prewar"]
    bays, floors = 4, 4
    brick = {"kind": "brick", "bond": "flemish" if variant == "a" else "running", "mortar": (0.82, 0.80, 0.76), "vary": 0.09 if variant != "b" else 0.14}
    P = Layer(name, seed, bays * bw, floors * fh, wall=brick, bays=bays, floors=floors)
    rng = P.rng
    stone = STONE if variant != "c" else (0.88, 0.86, 0.80)
    P.noise("a", 14, 80, seed)
    for f in range(floors):
        y0 = f * fh
        states = window_states(P, bays * 2)
        if variant == "c" and f % 2 == 0:
            belt(P, y0 + fh - 0.22, 0.22, col=stone, dentils=True)
        for b in range(bays):
            cx = (b + 0.5) * bw
            ww, wh = 1.12, 1.72
            wy = fh - 0.88 - wh
            if variant == "a":   # limestone surround, six-over-six
                P.box(cx - ww / 2 - 0.16, y0 + wy - 0.16, ww + 0.32, wh + 0.3, va=(stone, mul(stone, 0.9)), ht=0.62, m=MASK_TRIM, r=0.8)
                P.box(cx - ww / 2 - 0.16, y0 + wy - 0.16, ww + 0.32, 0.04, a=mix(stone, (1, 1, 1), 0.3), ht=0.7, m=MASK_TRIM)
                sash_window(P, cx, y0 + wy, ww, wh, frame=FRAME_WHITE, muntins=2, states=states[b * 2:b * 2 + 2], guard=rng.random() < 0.15)
                sill(P, cx - ww / 2 - 0.2, y0 + wy + wh + 0.12, ww + 0.4, col=stone, h=0.09)
            elif variant == "b":   # red brick, quoined openings, keystones
                sash_window(P, cx, y0 + wy, ww, wh, frame=rng.choice([FRAME_WHITE, FRAME_WHITE, FRAME_BLACK]), muntins=0, states=states[b * 2:b * 2 + 2])
                lintel(P, cx - ww / 2 - 0.12, y0 + wy - 0.06, ww + 0.24, 0.32, kind="keystone", col=stone)
                for k in range(4):   # quoins down the jambs
                    yy = y0 + wy + k * wh / 4
                    for sx, qw in ((cx - ww / 2 - 0.2, 0.2 if k % 2 == 0 else 0.13), (cx + ww / 2, 0.2 if k % 2 == 0 else 0.13)):
                        xx = sx if sx < cx else sx
                        P.box(xx + (0.2 - qw if sx < cx else 0), yy + 0.02, qw, wh / 4 - 0.04, a=stone, ht=0.62, m=MASK_TRIM)
                sill(P, cx - ww / 2 - 0.15, y0 + wy + wh + 0.06, ww + 0.3, col=stone)
            else:   # light brick, steel casements replacing the sash, stone spandrel panels
                sash_window(P, cx, y0 + wy, ww, wh, frame=FRAME_ALU, split=True, states=states[b * 2:b * 2 + 2])
                P.box(cx - ww / 2, y0 + wy + wh + 0.12, ww, 0.6, a=mul(stone, 0.95), ht=0.55, m=MASK_TRIM)
                P.box(cx - ww / 2 + 0.1, y0 + wy + wh + 0.22, ww - 0.2, 0.4, a=mul(stone, 0.85), ht=0.5, m=MASK_TRIM)
                lintel(P, cx - ww / 2 - 0.06, y0 + wy - 0.04, ww + 0.12, 0.16, kind="flat", col=stone)
            P.streaks([cx - 0.4 + rng.uniform(0, 0.3), cx + 0.3], y0 + wy + wh + 0.2, length=1.5, k=0.6, op=45)
    P.noise("a", 5, 8, seed + 3, kind="rocky")
    P.noise("h", 8, 6, seed + 4, blend="normal", kind="rocky")
    return P


def castiron(name, seed, variant):
    bw, fh = BAY["castiron"]
    bays, floors = 3, 3
    P = Layer(name, seed, bays * bw, floors * fh, wall={"kind": "none"}, bays=bays, floors=floors,
              base=(0.92, 0.90, 0.85))
    rng = P.rng
    # cast iron is painted: the tinted panels carry the building's paint colour
    paint = (0.92, 0.91, 0.88)
    P.box(0, 0, P.W, P.H, a=paint, m=MASK_TINT, ht=0.55, r=0.55)
    P.noise("a", 10, 60, seed)
    for f in range(floors):
        y0 = f * fh
        # entablature at the top of each floor: cornice band, frieze, dentils
        P.box(0, y0, P.W, 0.12, va=(mix(paint, (1, 1, 1), 0.4), mul(paint, 0.82)), ht=0.85, m=MASK_TINT, r=0.5)
        P.box(0, y0 + 0.12, P.W, 0.3, a=mul(paint, 0.95), ht=0.68, m=MASK_TINT, r=0.5)
        P.shade(0, y0 + 0.12, P.W, 0.12, k=0.7)
        for k in range(int(P.W / 0.22)):
            P.box(k * 0.22 + 0.05, y0 + 0.42, 0.12, 0.08, a=mul(paint, 0.9), ht=0.7, m=MASK_TINT)
        P.shade(0, y0 + 0.5, P.W, 0.14, k=0.6)
        states = window_states(P, bays * 2)
        for b in range(bays):
            x = b * bw
            # column (a Corinthian half-column on a pier) centred on the bay boundary
            for half, xx in ((1, x - 0.32), (0, x)):
                pass
            P.box(x - 0.34, y0 + 0.5, 0.68, fh - 0.5, ha=(mul(paint, 0.82), mix(paint, (1, 1, 1), 0.3), mul(paint, 0.8)) if False else None,
                  a=paint, ht=0.72, m=MASK_TINT, r=0.5)
            # round column shaft: a horizontal gradient for the curve, flutes
            P.box(x - 0.2, y0 + 0.8, 0.4, fh - 1.05, ha=[(0, mul(paint, 0.7)), (0.35, mix(paint, (1, 1, 1), 0.35)), (1, mul(paint, 0.62))],
                  vh=(0.9, 0.9), m=MASK_TINT, r=0.45)
            if variant != "b":
                for k in range(5):
                    P.box(x - 0.17 + k * 0.08, y0 + 0.85, 0.012, fh - 1.15, a=mul(paint, 0.72), ht=0.84, m=MASK_TINT)
            # capital and base
            P.box(x - 0.3, y0 + 0.55, 0.6, 0.25, va=(mix(paint, (1, 1, 1), 0.3), mul(paint, 0.75)), ht=0.95, m=MASK_TINT)
            if variant == "a":
                for k in range(3):   # acanthus suggestion
                    P.ellipse(x - 0.18 + k * 0.18, y0 + 0.7, 0.14, 0.16, a=mul(paint, 0.8), ht=0.98, m=MASK_TINT)
            P.box(x - 0.28, y0 + fh - 0.25, 0.56, 0.25, va=(paint, mul(paint, 0.78)), ht=0.9, m=MASK_TINT)
            # the window: tall, arched (a) or square-headed (b, c), two-over-two with a transom
            wx, ww = x + 0.5, bw - 1.0
            wy, wh = y0 + 0.75, fh - 1.05
            P.box(wx - 0.06, wy - 0.06, ww + 0.12, wh + 0.12, a=(0.25, 0.24, 0.22), ht=0.35, m=MASK_TRIM)
            frame = (0.85, 0.84, 0.80) if variant != "c" else (0.12, 0.12, 0.12)
            P.box(wx, wy, ww, wh, a=frame, ht=0.42, m=MASK_TRIM, r=0.5)
            f_ = 0.06
            mid = wx + ww / 2
            th = 0.55   # transom
            pane(P, wx + f_, wy + f_, ww / 2 - f_ * 1.5, th - f_, states[b * 2] if rng.random() < 0.3 else 0.9)
            pane(P, mid + f_ / 2, wy + f_, ww / 2 - f_ * 1.5, th - f_, 0.9)
            pane(P, wx + f_, wy + th + f_, ww / 2 - f_ * 1.5, wh - th - f_ * 2, states[b * 2])
            pane(P, mid + f_ / 2, wy + th + f_, ww / 2 - f_ * 1.5, wh - th - f_ * 2, states[b * 2 + 1])
            if variant == "a":   # arched head filling the top corners
                for side in (0, 1):
                    xs = wx if side == 0 else wx + ww
                    sgn = 1 if side == 0 else -1
                    pts = [(xs, wy - 0.01), (xs + sgn * ww * 0.5, wy - 0.01)]
                    for k in range(9):
                        a = (k / 8) * math.pi / 2
                        pts.append((xs + sgn * (ww * 0.5 - math.sin(a) * ww * 0.5), wy + (1 - math.cos(a)) * 0.0 + math.sin(a) * 0 + (1 - math.cos(a)) * 0.45))
                    pts = [(xs, wy - 0.01), (xs + sgn * ww * 0.5, wy - 0.01)] + [(xs + sgn * ww * 0.5 * (1 - math.sin(k / 8 * math.pi / 2)), wy + 0.45 * (1 - math.cos(k / 8 * math.pi / 2))) for k in range(9)]
                    P.polygon(pts, a=paint, ht=0.7, m=MASK_TINT)
                P.ellipse(mid, wy + 0.1, 0.16, 0.2, a=mix(paint, (1, 1, 1), 0.3), ht=0.92, m=MASK_TINT)  # keystone boss
            P.box(mid - 0.035, wy, 0.07, wh, a=frame, ht=0.45, m=MASK_TRIM)
            P.box(wx, wy + th - 0.03, ww, 0.06, a=frame, ht=0.45, m=MASK_TRIM)
            P.box(wx, wy + (wh + th) / 2, ww, 0.05, a=frame, ht=0.44, m=MASK_TRIM)
            # sill on brackets
            P.box(wx - 0.1, wy + wh, ww + 0.2, 0.1, va=(mix(paint, (1, 1, 1), 0.3), mul(paint, 0.8)), ht=0.86, m=MASK_TINT)
            P.shade(wx - 0.1, wy + wh + 0.1, ww + 0.2, 0.12, k=0.6)
        # paint failing to rust where the water runs
        for _ in range(6):
            x = rng.uniform(0, P.W)
            P.streaks([x], y0 + rng.uniform(0.5, 1.0), length=rng.uniform(1.0, 2.5), k=0.62, op=45)
    for _ in range(14):
        P.ellipse(rng.uniform(0, P.W), rng.uniform(0, P.H), rng.uniform(0.04, 0.15), rng.uniform(0.04, 0.2), a=(0.45, 0.26, 0.14), op=rng.uniform(25, 60))
    P.noise("a", 5, 7, seed + 2, kind="rocky")
    return P


def deco(name, seed, variant):
    bw, fh = BAY["deco"]
    bays, floors = 3, 4
    wall = {"kind": "stone", "course": 0.62, "block": 1.6, "mortar": (0.78, 0.76, 0.70), "vary": 0.05} if variant == "a" else \
           {"kind": "brick", "bond": "running", "mortar": (0.70, 0.66, 0.60), "vary": 0.08}
    P = Layer(name, seed, bays * bw, floors * fh, wall=wall, bays=bays, floors=floors)
    rng = P.rng
    gold = (0.70, 0.56, 0.30)
    spandrel = (0.30, 0.27, 0.24) if variant == "a" else (0.42, 0.22, 0.16)
    P.noise("a", 12, 90, seed)
    for b in range(bays):
        x = b * bw
        # the continuous vertical pier that makes the building soar
        pier = (0.90, 0.87, 0.80)
        P.box(x - 0.35, 0, 0.7, P.H, ha=[(0, mul(pier, 0.8)), (0.3, pier), (1, mul(pier, 0.86))], ht=0.75, m=MASK_TINT if variant == "b" else MASK_TRIM, r=0.75)
        P.box(x + 0.27, 0, 0.08, P.H, a=mul(pier, 0.7), ht=0.6, m=MASK_TRIM)
        wx, ww = x + 0.6, bw - 1.2
        for f in range(floors):
            y0 = f * fh
            wy, wh = y0 + 0.45, fh - 1.4
            P.box(wx - 0.05, wy - 0.05, ww + 0.1, wh + 0.1, a=(0.2, 0.19, 0.18), ht=0.3, m=MASK_TRIM)
            st = window_states(P, 2)
            P.box(wx, wy, ww, wh, a=(0.18, 0.2, 0.2), ht=0.36, m=MASK_TRIM)
            pane(P, wx + 0.05, wy + 0.05, ww / 2 - 0.075, wh - 0.1, st[0])
            pane(P, wx + ww / 2 + 0.025, wy + 0.05, ww / 2 - 0.075, wh - 0.1, st[1])
            P.box(wx, wy + wh * 0.68, ww, 0.04, a=(0.18, 0.2, 0.2), ht=0.38, m=MASK_TRIM)
            # dark spandrel panel with a chevron / sunburst in metal
            sy = wy + wh + 0.05
            sh = fh - (wh + 0.45) - 0.1
            P.box(wx, sy, ww, sh, a=spandrel, ht=0.4, m=MASK_TRIM, r=0.5)
            if variant == "a":
                for k in range(4):
                    px = wx + ww * k / 4
                    P.line([(px + 0.04, sy + sh * 0.8), (px + ww / 8, sy + sh * 0.25), (px + ww / 4 - 0.04, sy + sh * 0.8)], gold, 0.05,
                           extra={"h": (0.55,), "m": MASK_TRIM, "r": (0.35,)})
            else:
                cx = wx + ww / 2
                for k in range(7):
                    a = math.pi + math.pi * (k + 0.5) / 7
                    P.line([(cx, sy + sh * 0.95), (cx + math.cos(a) * ww * 0.45, sy + sh * 0.95 + math.sin(a) * sh * 0.85)], gold, 0.035,
                           extra={"h": (0.55,), "m": MASK_TRIM, "r": (0.35,)})
            P.streaks([wx + 0.2, wx + ww - 0.3], sy + sh, length=1.2, k=0.6, op=40)
    P.noise("a", 4, 7, seed + 2, kind="rocky")
    return P


def modern(name, seed, variant):
    bw, fh = BAY["modern"]
    bays, floors = 6, 4
    if variant == "a":   # 1960s: ribbon windows and enamel spandrel panels
        P = Layer(name, seed, bays * bw, floors * fh, wall={"kind": "none"}, bays=bays, floors=floors)
        panel = (0.86, 0.87, 0.85)
        P.box(0, 0, P.W, P.H, a=panel, m=MASK_TINT, ht=0.55, r=0.4)
        for f in range(floors):
            y0 = f * fh
            st = window_states(P, bays)
            for b in range(bays):
                x = b * bw
                pane(P, x + 0.04, y0 + 0.1, bw - 0.08, fh * 0.56, st[b])
            P.box(0, y0 + 0.1 + fh * 0.56, P.W, fh * 0.44 - 0.1, va=(mul(panel, 1.0), mul(panel, 0.92)), m=MASK_TINT, ht=0.55, r=0.35)
            for k in range(int(P.W / 0.8)):
                P.box(k * 0.8, y0 + 0.1 + fh * 0.56, 0.01, fh * 0.44 - 0.1, a=mul(panel, 0.8), m=MASK_TRIM, ht=0.5)
            P.streaks([P.rng.uniform(0, P.W) for _ in range(5)], y0 + 0.1 + fh * 0.56 + 0.05, length=1.3, k=0.7, op=35)
        for b in range(bays + 1):
            P.box(b * bw - 0.05, 0, 0.1, P.H, ha=[(0, (0.5, 0.52, 0.53)), (0.5, (0.78, 0.8, 0.8)), (1, (0.45, 0.47, 0.48))], ht=0.7, m=MASK_TRIM, r=0.3)
    else:                # 1970s: brown brick with punched aluminium windows (a wider brick grid)
        P = Layer(name, seed, bays * bw, floors * fh, wall={"kind": "brick", "bond": "running", "mortar": (0.6, 0.57, 0.52), "vary": 0.07},
                  bays=bays, floors=floors)
        for f in range(floors):
            y0 = f * fh
            st = window_states(P, bays // 2)
            for b in range(0, bays, 2):
                cx = (b + 1) * bw
                x, y, w, h = sash_window(P, cx, y0 + 0.75, 2.3, 1.6, frame=FRAME_ALU, split=False, states=[st[b // 2]], depth=0.1)
                P.box(cx - 0.02, y0 + 0.75, 0.04, 1.6, a=FRAME_ALU, m=MASK_TRIM, ht=0.45)
                P.box(cx - 1.25, y0 + 0.75 + 1.6, 2.5, 0.08, a=(0.55, 0.55, 0.53), ht=0.7, m=MASK_TRIM)
                P.streaks([cx - 0.9, cx + 0.6], y0 + 0.75 + 1.68, length=1.4, k=0.6, op=50)
    P.noise("a", 8, 60, seed)
    return P


def glass(name, seed, variant):
    bw, fh = BAY["glass"]
    bays, floors = 6, 3
    P = Layer(name, seed, bays * bw, floors * fh, wall={"kind": "none"}, bays=bays, floors=floors)
    rng = P.rng
    tone = {"a": ((0.36, 0.50, 0.56), (0.12, 0.20, 0.24)), "b": ((0.28, 0.31, 0.34), (0.06, 0.07, 0.08)),
            "c": ((0.52, 0.58, 0.62), (0.22, 0.27, 0.30))}[variant]
    mull = {"a": (0.55, 0.60, 0.62), "b": (0.12, 0.12, 0.13), "c": (0.75, 0.77, 0.78)}[variant]
    for f in range(floors):
        y0 = f * fh
        for b in range(bays):
            x = b * bw
            # vision glass
            k = rng.uniform(0.92, 1.06)
            P.box(x, y0, bw, fh - 0.7, va=(mul(tone[0], k), mul(tone[1], k)), ht=0.45, r=0.04, m=MASK_GLASS)
            if rng.random() < 0.14:
                c = rng.choice([(0.85, 0.84, 0.80), (0.70, 0.72, 0.72), (0.55, 0.56, 0.55)])
                P.box(x, y0, bw, (fh - 0.7) * rng.uniform(0.2, 0.9), a=mix(c, tone[1], 0.45), m=MASK_COVER, ht=0.45, r=0.1)
            # spandrel: opaque fritted glass at the slab edge
            P.box(x, y0 + fh - 0.7, bw, 0.7, va=(mix(tone[0], mull, 0.4), mix(tone[1], mull, 0.3)), ht=0.47, r=0.1, m=MASK_TRIM)
            P.polygon([(x + bw * 0.2, y0), (x + bw * 0.45, y0), (x + bw * 0.05, y0 + fh), (x - bw * 0.2, y0 + fh)], a=(0.8, 0.86, 0.9), op=8, blend="screen")
        P.box(0, y0 + fh - 0.72, P.W, 0.05, a=mull, ht=0.62, m=MASK_TRIM, r=0.3)
        P.box(0, y0 - 0.025, P.W, 0.05, a=mull, ht=0.62, m=MASK_TRIM, r=0.3)
    for b in range(bays + 1):
        w = 0.07 if variant != "c" else 0.12
        P.box(b * bw - w / 2, 0, w, P.H, ha=[(0, mul(mull, 0.7)), (0.5, mix(mull, (1, 1, 1), 0.3)), (1, mul(mull, 0.6))], ht=0.7 if variant != "c" else 0.85, m=MASK_TRIM, r=0.25)
    return P


def brick_postwar(name, seed, variant):
    bw, fh = BAY["brick"]
    bays, floors = 4, 4
    P = Layer(name, seed, bays * bw, floors * fh, wall={"kind": "brick", "bond": "running", "mortar": (0.78, 0.76, 0.72) if variant == "a" else (0.85, 0.84, 0.8),
                                                         "vary": 0.12 if variant == "a" else 0.05}, bays=bays, floors=floors)
    rng = P.rng
    P.noise("a", 12, 70, seed)
    for f in range(floors):
        y0 = f * fh
        st = window_states(P, bays * 2)
        for b in range(bays):
            cx = (b + 0.5) * bw
            ww, wh = (1.7, 1.35) if variant == "a" else (1.5, 1.4)
            wy = fh - 0.9 - wh
            P.box(cx - ww / 2 - 0.05, y0 + wy - 0.05, ww + 0.1, wh + 0.1, a=(0.3, 0.3, 0.3), ht=0.38, m=MASK_TRIM)
            P.box(cx - ww / 2, y0 + wy, ww, wh, a=FRAME_ALU if variant == "a" else (0.15, 0.15, 0.15), ht=0.42, m=MASK_TRIM)
            pane(P, cx - ww / 2 + 0.05, y0 + wy + 0.05, ww / 2 - 0.07, wh - 0.1, st[b * 2])
            pane(P, cx + 0.02, y0 + wy + 0.05, ww / 2 - 0.07, wh - 0.1, st[b * 2 + 1])
            P.box(cx - ww / 2, y0 + wy + wh * 0.3, ww, 0.04, a=FRAME_ALU, ht=0.44, m=MASK_TRIM)
            P.box(cx - ww / 2 - 0.08, y0 + wy + wh + 0.05, ww + 0.16, 0.1, a=(0.72, 0.70, 0.66), ht=0.72, m=MASK_TRIM)
            P.shade(cx - ww / 2 - 0.08, y0 + wy + wh + 0.15, ww + 0.16, 0.12, k=0.6)
            if rng.random() < 0.3:
                ac_sleeve(P, cx, y0 + wy + wh + 0.3)
            else:
                P.streaks([cx - 0.5, cx + 0.4], y0 + wy + wh + 0.15, length=1.0, k=0.62, op=40)
    return P


def civic(name, seed, variant):
    bw, fh = BAY["civic"]
    bays, floors = 3, 3
    P = Layer(name, seed, bays * bw, floors * fh, wall={"kind": "stone", "course": 0.55, "block": 1.35, "mortar": (0.84, 0.82, 0.76), "vary": 0.04},
              bays=bays, floors=floors)
    P.noise("a", 10, 90, seed)
    stone = (0.93, 0.91, 0.86)
    for b in range(bays):
        x = b * bw
        P.box(x - 0.3, 0, 0.6, P.H, ha=[(0, mul(stone, 0.82)), (0.4, stone), (1, mul(stone, 0.85))], ht=0.75, m=MASK_TRIM, r=0.8)  # pilaster
        for f in range(floors):
            y0 = f * fh
            wx, ww = x + 0.95, bw - 1.9
            wy, wh = y0 + 0.9, fh - 1.75
            P.box(wx - 0.18, wy - 0.18, ww + 0.36, wh + 0.36, va=(stone, mul(stone, 0.9)), ht=0.62, m=MASK_TRIM)
            sash_window(P, wx + ww / 2, wy, ww, wh, frame=(0.2, 0.22, 0.2), muntins=1, states=window_states(P, 2), depth=0.1)
            lintel(P, wx - 0.3, wy - 0.18, ww + 0.6, 0.3, kind="pediment" if f % 2 else "capped", col=stone)
            sill(P, wx - 0.25, wy + wh + 0.18, ww + 0.5, col=stone, corbels=True)
            P.streaks([wx + 0.1, wx + ww - 0.2], wy + wh + 0.3, length=1.6, k=0.66, op=40)
    return P


# --------------------------------------------------------------------------------------- storefronts

SHOP_WORDS = ["DELI", "BAKERY", "NAILS", "PHARMACY", "PIZZA", "CAFE", "LAUNDROMAT", "BAGELS", "HARDWARE", "GROCERY",
              "FLOWERS", "SHOES", "NEWS", "DINER", "BOOKS", "TAILOR", "LIQUORS", "BARBER", "TACOS", "NOODLES",
              "OPTICAL", "CLEANERS", "LOCKSMITH", "FRUIT & VEG", "HOT BAGELS", "99 CENTS", "GIFTS", "JEWELRY",
              "SAL'S PIZZA", "JOE & SONS", "LUCKY DELI", "CORNER CAFE", "BODEGA", "SHOE REPAIR", "WINES", "TOYS"]
SIGN_COLS = [(0.16, 0.27, 0.45), (0.50, 0.12, 0.10), (0.15, 0.38, 0.25), (0.90, 0.88, 0.82), (0.78, 0.60, 0.12),
             (0.18, 0.18, 0.18), (0.08, 0.30, 0.42), (0.58, 0.20, 0.36)]
GOODS = [(0.70, 0.25, 0.20), (0.85, 0.70, 0.25), (0.90, 0.88, 0.80), (0.25, 0.45, 0.60), (0.40, 0.55, 0.25), (0.80, 0.48, 0.20),
         (0.60, 0.30, 0.50)]


def text_col(bg):
    return (0.08, 0.08, 0.08) if sum(bg) > 1.9 else (0.97, 0.95, 0.88)


def display(P, x, y, w, h, kind):
    """What's lit behind a shop window (covered glass: it glows, no room parallax)."""
    rng = P.rng
    warm = (0.55, 0.44, 0.30) if kind != "lobby" else (0.62, 0.60, 0.55)
    P.box(x, y, w, h, va=(mul(warm, 1.15), mul(warm, 0.55)), ht=0.25, r=0.06, m=MASK_COVER)
    if kind in ("deli", "generic", "chinatown"):
        for s in range(3):   # shelves of goods
            sy = y + h * (0.3 + s * 0.24)
            P.box(x, sy, w, 0.04, a=(0.15, 0.12, 0.1), m=MASK_COVER)
            xx = x + 0.03
            while xx < x + w - 0.1:
                bw_ = rng.uniform(0.06, 0.18)
                bh = rng.uniform(0.08, 0.2)
                P.box(xx, sy - bh, bw_, bh, a=rng.choice(GOODS), m=MASK_COVER)
                xx += bw_ + rng.uniform(0.0, 0.05)
    elif kind == "boutique":   # mannequins and a few hung garments
        for k in range(rng.randint(1, 3)):
            mx = x + w * (k + 0.5) / 3
            c = rng.choice(CURTAIN_COLS)
            P.ellipse(mx, y + h * 0.25, 0.16, 0.2, a=(0.85, 0.82, 0.78), m=MASK_COVER)
            P.polygon([(mx - 0.2, y + h * 0.33), (mx + 0.2, y + h * 0.33), (mx + 0.28, y + h * 0.85), (mx - 0.28, y + h * 0.85)], a=c, m=MASK_COVER)
    elif kind == "cafe":       # pendant lights, a counter, people's shapes
        for k in range(3):
            lx = x + w * (k + 0.5) / 3
            P.line([(lx, y), (lx, y + h * 0.25)], (0.1, 0.1, 0.1), 0.015, ch="a", extra={"m": MASK_COVER})
            P.ellipse(lx, y + h * 0.28, 0.2, 0.1, a=(1.0, 0.86, 0.55), m=MASK_COVER)
        P.box(x, y + h * 0.7, w, h * 0.3, a=(0.3, 0.2, 0.14), m=MASK_COVER)
        for k in range(rng.randint(1, 3)):
            px = x + rng.uniform(0.2, w - 0.3)
            P.ellipse(px, y + h * 0.5, 0.16, 0.2, a=(0.2, 0.16, 0.14), m=MASK_COVER)
            P.polygon([(px - 0.18, y + h * 0.58), (px + 0.18, y + h * 0.58), (px + 0.22, y + h * 0.9), (px - 0.22, y + h * 0.9)], a=rng.choice(CURTAIN_COLS), m=MASK_COVER)
    if rng.random() < 0.45:   # neon OPEN sign
        nx, ny = x + rng.uniform(0.2, max(0.25, w - 0.9)), y + h * 0.2
        c = rng.choice([(1.0, 0.25, 0.25), (0.3, 0.9, 1.0), (1.0, 0.4, 0.8)])
        stroke_text(P, "OPEN", nx + 0.35, ny + 0.22, 0.2, c, width=0.035, ch="a", extra={"m": MASK_COVER})
    # the reflection of the street across the glass
    P.polygon([(x, y + h), (x + w * 0.35, y), (x + w * 0.5, y), (x + w * 0.15, y + h)], a=(0.8, 0.82, 0.85), op=10, blend="screen")
    P.box(x, y + h * 0.75, w, h * 0.25, va=((1, 1, 1), (0.75, 0.75, 0.75)), blend="multiply")


def shopfront(P, x0, kind, rng, H=SHOP_H):
    """One 4.5 m shop: pier, fascia sign, window(s), door, stall riser; sometimes a roll-down gate."""
    W = 4.5
    pier = {"generic": rng.choice([(0.42, 0.36, 0.30), (0.30, 0.28, 0.27), (0.50, 0.44, 0.36), (0.38, 0.34, 0.34)]),
            "chinatown": rng.choice([(0.55, 0.50, 0.45), (0.40, 0.36, 0.33), (0.62, 0.58, 0.52)]),
            "soho": (0.13, 0.13, 0.14), "midtown": rng.choice([(0.55, 0.53, 0.50), (0.25, 0.25, 0.26), (0.62, 0.58, 0.50)]),
            "lobby": (0.62, 0.62, 0.60), "residential": STONE}[kind]
    # piers at both ends (half piers so tiles chain)
    pw = 0.32 if kind != "soho" else 0.42
    P.box(x0, 0, W, H, a=pier, ht=0.55, r=0.7, m=MASK_TRIM)
    if kind == "soho":   # cast-iron columns, fluted
        for xx in (x0, x0 + W):
            P.box(xx - pw / 2, 0.55, pw, H - 0.55, ha=[(0, (0.06, 0.06, 0.07)), (0.4, (0.32, 0.32, 0.34)), (1, (0.05, 0.05, 0.06))], ht=0.85, m=MASK_TRIM, r=0.35)
            for k in range(4):
                P.box(xx - pw / 2 + 0.06 + k * 0.09, 0.7, 0.012, H - 0.9, a=(0.03, 0.03, 0.03), ht=0.8, m=MASK_TRIM)
    else:
        for xx in (x0, x0 + W):
            P.box(xx - pw / 2, 0, pw, H, ha=[(0, mul(pier, 0.75)), (0.5, mul(pier, 1.08)), (1, mul(pier, 0.72))], ht=0.7, m=MASK_TRIM, r=0.7)
    if kind == "lobby":
        # bronze-framed glass entrance, revolving door suggestion, a name in metal letters
        P.box(x0 + 0.3, 0.55, W - 0.6, H - 0.55, a=(0.30, 0.24, 0.16), ht=0.42, m=MASK_TRIM, r=0.35)
        display(P, x0 + 0.38, 0.65, W - 0.76, H - 0.75, "lobby")
        for k in range(1, 4):
            P.box(x0 + 0.3 + (W - 0.6) * k / 4 - 0.03, 0.55, 0.06, H - 0.55, a=(0.42, 0.33, 0.2), ht=0.48, m=MASK_TRIM, r=0.3)
        P.box(x0 + 0.3, 0.3, W - 0.6, 0.25, a=(0.42, 0.33, 0.2), ht=0.6, m=MASK_TRIM, r=0.3)
        num = str(rng.choice([1, 2, 5, 7, 10, 11, 15, 20, 25, 30, 40, 55, 60, 75, 99, 100, 101, 110, 120, 150, 200, 250, 300, 350, 400, 500, 600, 1001]))
        stroke_text(P, num, x0 + W / 2, 0.5, 0.17, (0.85, 0.72, 0.4), width=0.03, extra={"h": (0.62,)})
        return
    if kind == "residential":
        # a stoop entrance: a panelled door under a hood, basement windows behind railings
        P.box(x0 + 0.3, 0, W - 0.6, H, a=mul(STONE, 0.92), ht=0.6, m=MASK_TRIM)
        for yy in range(int(H / 0.35)):   # rustication
            P.box(x0 + 0.3, yy * 0.35 + 0.33, W - 0.6, 0.025, a=mul(STONE, 0.7), ht=0.45, m=MASK_TRIM)
        dx = x0 + 1.4
        P.box(dx - 0.1, 0.9, 1.3, H - 0.9, a=(0.2, 0.18, 0.16), ht=0.3, m=MASK_TRIM)
        door = rng.choice([(0.30, 0.18, 0.10), (0.12, 0.22, 0.16), (0.08, 0.08, 0.08), (0.45, 0.10, 0.08)])
        P.box(dx, 1.5, 1.1, H - 1.5, a=door, ht=0.38, m=MASK_TRIM, r=0.45)
        for k in range(2):
            for j in range(3):
                P.box(dx + 0.1 + k * 0.5, 1.65 + j * 0.85, 0.4, 0.7, a=mul(door, 1.3), ht=0.42, m=MASK_TRIM)
        pane(P, dx + 0.1, 1.0, 0.9, 0.42, 0.9)   # transom
        P.box(dx - 0.25, 0.75, 1.6, 0.2, va=(mix(STONE, (1, 1, 1), 0.2), mul(STONE, 0.8)), ht=0.85, m=MASK_TRIM)
        stroke_text(P, str(rng.randint(10, 299)), dx + 0.55, 1.36, 0.16, (0.9, 0.85, 0.6), width=0.025)
        for bx in (x0 + 0.5, x0 + 3.1):   # windows either side, with security bars
            sash_window(P, bx + 0.45, 1.0, 0.85, 1.5, frame=FRAME_WHITE, states=[P.rng.random(), P.rng.random()])
            for k in range(6):
                P.box(bx + 0.05 + k * 0.16, 0.95, 0.025, 1.6, a=IRON_BLACK, ht=0.75, m=MASK_TRIM)
        P.box(x0 + 0.3, H - 0.55, W - 0.6, 0.55, a=mul(STONE, 0.78), ht=0.62, m=MASK_TRIM)
        return
    # fascia sign
    sign_h = 0.95 if kind == "chinatown" else 0.8
    bg = rng.choice([(0.72, 0.10, 0.08), (0.85, 0.66, 0.10), (0.62, 0.08, 0.14), (0.10, 0.40, 0.22), (0.08, 0.20, 0.45)]) if kind == "chinatown" else \
        (0.06, 0.06, 0.07) if kind == "soho" and rng.random() < 0.6 else rng.choice(SIGN_COLS)
    sx, sw = x0 + pw / 2 + 0.05, W - pw - 0.1
    P.box(sx, 0.25, sw, sign_h, va=(mix(bg, (1, 1, 1), 0.08), mul(bg, 0.85)), ht=0.72, r=0.45, m=MASK_TRIM)
    P.box(sx, 0.25 + sign_h - 0.05, sw, 0.05, a=mul(bg, 0.6), ht=0.7, m=MASK_TRIM)
    tc = text_col(bg)
    if kind == "chinatown":
        if bg == (0.85, 0.66, 0.10):
            tc = (0.65, 0.05, 0.05)
        name = rng.choice(CN_NAMES)
        w1 = stroke_text(P, name, sx + sw * 0.36, 0.25 + sign_h * 0.82, sign_h * 0.62, tc, width=0.07, maxw=sw * 0.62, extra={"h": (0.8,)})
        word = rng.choice(["NOODLES", "BAKERY", "SEAFOOD", "TEA", "DUMPLINGS", "GIFTS", "HERBS", "RESTAURANT", "MARKET", "JEWELRY"])
        stroke_text(P, word, sx + sw * 0.36 + w1 / 2 + (sw - (sw * 0.36 + w1 / 2)) / 2, 0.25 + sign_h * 0.68, sign_h * 0.22, tc, width=0.03,
                    maxw=sw - (sw * 0.36 + w1 / 2) - 0.2)
    else:
        word = rng.choice(SHOP_WORDS)
        stroke_text(P, word, sx + sw / 2, 0.25 + sign_h * 0.75, sign_h * 0.48, tc, width=0.065 if kind != "soho" else 0.045, maxw=sw - 0.3,
                    extra={"h": (0.78,)})
    top = 0.25 + sign_h + 0.12
    # roll-down gate (down on a closed shop, or half-up)
    gate = rng.random() < (0.22 if kind == "chinatown" else 0.12)
    if gate:
        gy = top
        P.box(sx, gy, sw, H - gy, a=(0.56, 0.57, 0.57), ht=0.5, r=0.5, m=MASK_TRIM)
        yy = gy
        while yy < H:
            P.box(sx, yy, sw, 0.025, a=(0.36, 0.37, 0.37), ht=0.4, m=MASK_TRIM)
            yy += 0.085
        if rng.random() < 0.7:   # tags
            c = rng.choice([(0.85, 0.2, 0.2), (0.2, 0.5, 0.9), (0.95, 0.85, 0.2), (0.1, 0.1, 0.1), (0.9, 0.9, 0.9)])
            pts = [(sx + rng.uniform(0.3, 1.2), top + rng.uniform(1.0, 2.2))]
            for _ in range(8):
                pts.append((pts[-1][0] + rng.uniform(0.1, 0.35), pts[-1][1] + rng.uniform(-0.35, 0.35)))
            P.line(pts, c, 0.06)
        P.box(sx, H - 0.3, sw, 0.3, va=((1, 1, 1), (0.6, 0.6, 0.6)), blend="multiply")
        return
    # window | door | window, or window | door
    door_w = 1.0
    layout = rng.choice(["wd", "dw", "wdw"])
    riser = 0.55
    frame = (0.12, 0.12, 0.12) if kind in ("soho", "midtown") or rng.random() < 0.5 else rng.choice([(0.55, 0.40, 0.24), (0.7, 0.7, 0.68), (0.2, 0.3, 0.25)])
    P.box(sx, top, sw, H - top, a=frame, ht=0.45, m=MASK_TRIM, r=0.45)
    disp = rng.choice(["deli", "generic", "boutique", "cafe"]) if kind != "chinatown" else rng.choice(["chinatown", "chinatown", "cafe"])
    cur = sx + 0.08
    parts = {"wd": ["w", "d"], "dw": ["d", "w"], "wdw": ["w", "d", "w"]}[layout]
    win_w = (sw - 0.16 - door_w - 0.08 * (len(parts) - 1)) / (len(parts) - 1)
    for p in parts:
        if p == "w":
            display(P, cur, top + 0.08, win_w, H - top - riser - 0.08, disp)
            P.box(cur, H - riser, win_w, riser, a=mul(pier, 0.9), ht=0.55, m=MASK_TRIM, r=0.7)   # stall riser
            P.box(cur, H - riser, win_w, 0.05, a=frame, ht=0.6, m=MASK_TRIM)
            if rng.random() < 0.5:   # window lettering
                stroke_text(P, rng.choice(["OPEN 24 HRS", "FRESH", "SALE", "ATM", "COFFEE", "EST 1962", "WE DELIVER", "HOT FOOD"]),
                            cur + win_w / 2, top + 0.55, 0.13, (0.95, 0.9, 0.75), width=0.022, maxw=win_w - 0.2, extra={"m": MASK_TRIM})
            cur += win_w + 0.08
        else:
            P.box(cur - 0.04, top, door_w + 0.08, H - top, a=(0.08, 0.08, 0.08), ht=0.25, m=MASK_TRIM)
            pane(P, cur + 0.08, top + 0.35, door_w - 0.16, H - top - 0.6, 0.95)
            display(P, cur + 0.08, top + 0.35, door_w - 0.16, H - top - 0.6, disp)
            P.box(cur, top, door_w, 0.3, a=frame, m=MASK_TRIM, ht=0.45)
            P.box(cur + door_w - 0.2, top + 1.6, 0.04, 0.25, a=(0.75, 0.7, 0.55), m=MASK_TRIM, ht=0.6)   # handle
            P.box(cur, H - 0.12, door_w, 0.12, a=(0.55, 0.5, 0.42), m=MASK_TRIM, ht=0.5)                   # kick plate
            cur += door_w + 0.08
    # grime at the foot, a sticker or two
    P.box(x0, H - 0.6, W, 0.6, va=((1, 1, 1), (0.62, 0.6, 0.58)), blend="multiply")


def storefront(name, seed, kind):
    P = Layer(name, seed, SHOP_W, SHOP_H, wall={"kind": "none"}, bays=2, floors=1)
    rng = P.rng
    shopfront(P, 0.0, kind, rng)
    shopfront(P, 4.5, kind, rng)
    # the cornice over the shops (the bottom of the first floor) and grime
    P.box(0, 0, P.W, 0.25, va=((0.35, 0.33, 0.30), (0.22, 0.21, 0.2)), ht=0.85, m=MASK_TRIM, r=0.7)
    P.shade(0, 0.25, P.W, 0.25, k=0.45)
    P.noise("a", 12, 30, seed)
    P.noise("a", 4, 6, seed + 5, kind="rocky")
    return P


# --------------------------------------------------------------------------------------- roofs

def roof(name, seed, kind):
    """8 x 8 m roof surfaces: tar with patches and seams, gravel ballast, white membrane."""
    P = Layer(name, seed, 8.0, 8.0, wall={"kind": "none"})
    rng = P.rng
    if kind == "tar":
        base = (0.24, 0.23, 0.22)
        P.box(0, 0, 8, 8, a=base, ht=0.5, r=0.9, m=MASK_TINT)
        P.noise("a", 30, 25, seed)
        P.noise("h", 30, 10, seed + 1, blend="normal")
        for k in range(9):   # rolled roofing seams, slightly raised, lapped
            y = k * 8 / 9
            P.box(0, y, 8, 0.05, a=mul(base, 0.75), ht=0.62, m=MASK_TINT)
            P.box(0, y + 0.05, 8, 0.06, a=mul(base, 1.2), ht=0.56, m=MASK_TINT)
        for _ in range(8):   # patches of newer tar, silver paint
            x, y = rng.uniform(0, 7), rng.uniform(0, 7)
            c = rng.choice([(0.16, 0.16, 0.16), (0.40, 0.40, 0.39), (0.30, 0.28, 0.25)])
            P.box(x, y, rng.uniform(0.6, 2.2), rng.uniform(0.5, 1.8), a=c, op=rng.uniform(35, 65), ht=0.55, r=0.8 if c[0] < 0.5 else 0.5, m=MASK_TRIM)
        for _ in range(16):   # puddle stains and leaves
            P.ellipse(rng.uniform(0, 8), rng.uniform(0, 8), rng.uniform(0.3, 1.5), rng.uniform(0.2, 0.9), a=(0.15, 0.15, 0.15), op=40, r=0.3)
        for _ in range(30):
            P.ellipse(rng.uniform(0, 8), rng.uniform(0, 8), 0.1, 0.06, a=rng.choice([(0.45, 0.28, 0.12), (0.35, 0.22, 0.1)]), m=MASK_TRIM, ht=0.55)
    elif kind == "gravel":
        P.box(0, 0, 8, 8, a=(0.52, 0.50, 0.47), ht=0.5, r=0.95, m=MASK_TINT)
        P.noise("a", 60, 2, seed, kind="rocky", contrast=160)
        P.noise("a", 25, 30, seed + 2)
        P.noise("h", 70, 2, seed + 3, kind="rocky", blend="normal", contrast=170)
        for _ in range(12):
            P.ellipse(rng.uniform(0, 8), rng.uniform(0, 8), rng.uniform(0.6, 2.0), rng.uniform(0.5, 1.4), a=(0.3, 0.29, 0.27), op=35)
        for _ in range(4):   # walkway pavers
            x = rng.uniform(0, 7)
            for k in range(8):
                P.box(x, k * 1.0 + 0.05, 0.6, 0.6, a=(0.62, 0.61, 0.58), ht=0.62, r=0.8, m=MASK_TRIM)
    else:   # membrane
        P.box(0, 0, 8, 8, a=(0.86, 0.86, 0.84), ht=0.5, r=0.55, m=MASK_TINT)
        P.noise("a", 18, 40, seed)
        for k in range(4):
            x = k * 2.0
            P.box(x, 0, 0.05, 8, a=(0.7, 0.7, 0.68), ht=0.6, m=MASK_TINT)
        for _ in range(10):
            P.ellipse(rng.uniform(0, 8), rng.uniform(0, 8), rng.uniform(0.5, 2.0), rng.uniform(0.3, 1.0), a=(0.55, 0.53, 0.5), op=30)
        P.noise("h", 12, 20, seed + 1, blend="normal")
    return P


# --------------------------------------------------------------------------------------- party walls

GHOST_WORDS = ["UNEEDA", "FURNITURE", "STORAGE", "PIANOS", "COAL & ICE", "HATS", "CIGARS", "BAKING CO", "MOVING", "FUR CO", "SHIRTS"]


def party(name, seed, kind):
    """Blank lot-line walls, seen above the lower neighbours: common-bond brick with a faded
    painted ad and the scars of a demolished neighbour, or grey cement parging."""
    W, H = 12.0, 12.0
    if kind == "brick":
        P = Layer(name, seed, W, H, wall={"kind": "brick", "bond": "common", "mortar": (0.74, 0.72, 0.68), "vary": 0.14}, bays=4, floors=4)
        rng = P.rng
        P.noise("a", 18, 90, seed)
        # the ghost of an old painted ad
        x0, y0, w, h = rng.uniform(0.5, 2.0), rng.uniform(1.0, 3.0), rng.uniform(7.0, 9.5), rng.uniform(3.5, 5.0)
        bg = rng.choice([(0.86, 0.84, 0.76), (0.32, 0.38, 0.30), (0.40, 0.18, 0.14)])
        P.box(x0, y0, w, h, a=bg, op=10, blend="normal", m=MASK_TINT)
        tc = (0.95, 0.93, 0.85) if sum(bg) < 1.5 else (0.25, 0.16, 0.12)
        stroke_text(P, rng.choice(GHOST_WORDS), x0 + w / 2, y0 + h * 0.45, h * 0.28, tc, width=0.12, maxw=w - 0.6, op=14)
        stroke_text(P, rng.choice(["SINCE 1898", "EST 1904", "BROADWAY", "ALL SIZES", "WHOLESALE"]), x0 + w / 2, y0 + h * 0.8, h * 0.12, tc, width=0.07, maxw=w - 1, op=12)
        # the outline of a gone neighbour: a stepped roofline and old flue stains
        for fx_ in (2.0, 6.5, 10.0):
            P.box(fx_, 2.0, 0.45, 7.5, va=((0.6, 0.58, 0.56), (1, 1, 1)), blend="multiply", op=25)
    else:
        P = Layer(name, seed, W, H, wall={"kind": "none"}, bays=4, floors=4)
        rng = P.rng
        P.box(0, 0, W, H, a=(0.74, 0.73, 0.70), m=MASK_TINT, ht=0.5, r=0.9)
        P.noise("a", 30, 60, seed)
        P.noise("h", 30, 4, seed + 1, blend="normal", kind="rocky")
        for _ in range(12):   # patched parging, darker cement
            x, y = rng.uniform(0, W - 1), rng.uniform(0, H - 1)
            P.box(x, y, rng.uniform(0.8, 3.0), rng.uniform(0.6, 2.5), a=rng.choice([(0.62, 0.61, 0.58), (0.80, 0.79, 0.76)]), op=rng.uniform(50, 90), m=MASK_TINT, ht=0.52)
        for _ in range(6):    # cracks
            x, y = rng.uniform(0, W), rng.uniform(0, H)
            pts = [(x, y)]
            for _ in range(6):
                pts.append((pts[-1][0] + rng.uniform(-0.4, 0.4), pts[-1][1] + rng.uniform(0.2, 0.6)))
            P.line(pts, (0.3, 0.3, 0.3), 0.02, extra={"h": (0.38,)})
        for y in (3.0, 6.0, 9.0):   # where the old floors were
            P.box(0, y, W, 0.25, a=(0.6, 0.58, 0.55), op=30, blend="multiply")
    P.streaks([rng.uniform(0, W) for _ in range(10)], 0.2, length=6.0, k=0.62, width=(0.2, 0.6), op=35)
    return P


# --------------------------------------------------------------------------------------- the layer list

def all_layers():
    """Order = texture-array layer index (web/src/render/facades.ts FACADE_LAYERS must match)."""
    L = []
    for v in "abcd":
        L.append(tenement("tenement_" + v, 100 + ord(v), v))
    for v in "abc":
        L.append(castiron("castiron_" + v, 200 + ord(v), v))
    for v in "abc":
        L.append(prewar("prewar_" + v, 300 + ord(v), v))
    for v in "ab":
        L.append(deco("deco_" + v, 400 + ord(v), v))
    for v in "ab":
        L.append(modern("modern_" + v, 500 + ord(v), v))
    for v in "abc":
        L.append(glass("glass_" + v, 600 + ord(v), v))
    for v in "ab":
        L.append(brick_postwar("brick_" + v, 700 + ord(v), v))
    L.append(civic("civic_a", 801, "a"))
    for kind, n in (("generic", 3), ("chinatown", 2), ("soho", 2), ("midtown", 2), ("lobby", 2), ("residential", 1)):
        for k in range(n):
            L.append(storefront("shop_%s_%d" % (kind, k), 900 + 37 * k + len(kind) * 101, kind))
    for kind in ("tar", "gravel", "membrane"):
        L.append(roof("roof_" + kind, 1300 + len(kind), kind))
    for kind in ("brick", "parge"):
        L.append(party("party_" + kind, 1400 + len(kind), kind))
    return L


if __name__ == "__main__":
    import json
    for l in all_layers():
        print(l.name, {c: len(json.dumps(l.doc(c))) for c in "ahrm"})
