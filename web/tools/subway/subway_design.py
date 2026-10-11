"""Far From the Tree - subway textures, authored as editable Tesseract compositions.

Imported by build_subway.py (system Python, no dependencies). Four documents:

  atlas/Atlas.tsrct        2048x2048  everything the subway.glb props and trains sample (named rects below)
  atlas/StationWall.tsrct   512x2048  station wall, tiles across 2 m, spans TUNNEL.floor .. stationCeiling (7.1 m)
  atlas/TunnelWall.tsrct   2048x512   tunnel wall, tiles across 26 m, spans TUNNEL.floor .. ceiling (6.9 m)
  atlas/Floor.tsrct         512x512   platform concrete, tiles every 4 m

All text is invented: no real brands, no official transit marks. Route bullets are plain
coloured circles with a letter.
"""
import json, math, random

AW = AH = 2048

# --------------------------------------------------------------------------------- atlas layout
# name -> (x, y, w, h) in pixels, origin top-left. UVs: u = x / 2048, v = 1 - y / 2048.
R = {
    # train
    "steel_flute": (0, 0, 512, 256),
    "steel_plain": (0, 256, 256, 256),
    "roof": (256, 256, 256, 256),
    "end_cab": (512, 0, 512, 512),
    "end_mid": (1024, 0, 512, 512),
    "door": (1536, 0, 256, 512),
    "under": (1792, 0, 256, 256),
    "tile_white": (1792, 256, 256, 256),
    "interior": (0, 512, 1024, 256),
    "dest_up": (1024, 512, 512, 64),
    "dest_dn": (1024, 576, 512, 64),
    "side_up": (1024, 640, 512, 64),
    "side_dn": (1024, 704, 512, 64),
    "reader_screen": (1536, 640, 128, 128),
    "booth_sign": (1664, 640, 384, 64),
    "fluor_tube": (1664, 704, 384, 64),
    # track
    "concrete_track": (0, 768, 512, 256),
    "tie_wood": (512, 768, 256, 128),
    "board": (512, 896, 512, 64),
    "cable": (512, 960, 256, 64),
    "tray": (768, 960, 256, 64),
    "rail_side": (768, 768, 128, 128),
    "rail_top": (896, 768, 128, 64),
    "pipe_rust": (896, 832, 128, 64),
    # station
    "tactile": (1024, 768, 256, 128),
    "plat_edge": (1024, 896, 256, 128),
    "stair_tread": (1280, 768, 256, 128),
    "bench_wood": (1280, 896, 256, 128),
    "trash": (1536, 768, 256, 128),
    "turnstile_top": (1536, 896, 256, 128),
    "emergency_sign": (1792, 768, 256, 128),
    "bluebox_face": (1792, 896, 256, 128),
    "ibeam_paint": (1024, 1024, 256, 256),
    "column_paint": (1280, 1024, 256, 256),
    "booth_interior": (1536, 1024, 256, 256),
    "plaque_leaf": (1792, 1024, 256, 256),
    "booth_front": (0, 1088, 512, 192),
    "map_poster": (512, 1088, 512, 192),
    "tablet_frame": (0, 1280, 1024, 256),
    "sign_uptown": (1024, 1280, 512, 128),
    "sign_downtown": (1536, 1280, 512, 128),
    "sign_exit": (1024, 1408, 512, 128),
    "sign_entrance": (1536, 1408, 512, 128),
    "hazard": (1536, 1920, 256, 128),
    "grime": (1792, 1920, 256, 128),
}
BULLETS = ["R", "W", "N", "Q", "4", "5"]
for i, b in enumerate(BULLETS):
    R["bullet_" + b] = (1536 + 64 * i, 512, 64, 64)
R["lamp_white"] = (1920, 512, 64, 64)
R["lamp_red"] = (1984, 512, 64, 64)
GLOWS = ["cab_glass", "glow_white", "glow_amber", "sig_red", "sig_green", "sig_yellow", "blue_lamp", "globe_green"]
for i, g in enumerate(GLOWS):
    R[g] = (1536 + 64 * i, 576, 64, 64)
SWATCHES = {
    "paint_grey": (0.42, 0.43, 0.42), "paint_green": (0.10, 0.24, 0.15), "paint_red": (0.62, 0.07, 0.05),
    "paint_yellow": (0.92, 0.68, 0.06), "paint_black": (0.05, 0.05, 0.05), "paint_blue": (0.16, 0.27, 0.42),
    "rubber": (0.03, 0.03, 0.03), "steel_dark": (0.22, 0.22, 0.23), "brass": (0.62, 0.48, 0.22),
    "white": (0.90, 0.90, 0.88), "booth_tan": (0.52, 0.40, 0.27), "heet_grey": (0.36, 0.38, 0.37),
    "concrete_light": (0.55, 0.54, 0.51), "wood_dark": (0.20, 0.13, 0.08), "glass_booth": (0.22, 0.27, 0.30),
    "orange": (0.85, 0.40, 0.08),
}
for i, k in enumerate(SWATCHES):
    R[k] = (64 * i, 1024, 64, 64)
ADS = ["ad_soup", "ad_movie", "ad_dental", "ad_kites", "ad_owl", "ad_pigeon", "ad_mattress", "ad_tree"]
for i, a in enumerate(ADS):
    R[a] = (256 * i, 1536, 256, 384)
# station life (added later, so appended: everything above keeps its place and its look)
R["fare_machine"] = (0, 1920, 128, 128)
R["busker_sign"] = (128, 1920, 128, 128)
R["newspaper"] = (256, 1920, 128, 128)
R["coat_tweed"] = (384, 1920, 128, 128)
# the station ceilings: the painted jack arches over the platforms, the sooty ones over the tracks, the cornice
R["vault_paint"] = (512, 1920, 256, 128)
R["vault_soot"] = (768, 1920, 256, 128)
R["cornice"] = (1024, 1920, 256, 64)
# where the runtime writes the station name into the mosaic tablet (inside tablet_frame)
TABLET_FIELD = (56, 56, 912, 144)


def layout_json():
    return {"size": [AW, AH], "rects": R, "tablet_field": TABLET_FIELD, "bullets": BULLETS, "ads": ADS,
            "swatches": list(SWATCHES)}


# --------------------------------------------------------------------------------- doc helpers

class Doc:
    def __init__(self, seed=1):
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
    def tf(x=0.0, y=0.0, rot=0.0, op=100):
        return {"anchorPoint": [0, 0], "position": [x, y], "scale": [100, 100], "rotation": rot, "opacity": op}

    AR = {"start": 0, "duration": 3000}

    @staticmethod
    def col(c):
        return list(c) + ([1.0] if len(c) == 3 else [])

    def rect(self, x, y, w, h, c, op=100, blend="normal", effects=None, round_=0.0, grad=None, rot=0.0, name="rect"):
        r = {"size": [w, h], "fillColor": self.col(c), "roundness": round_}
        if grad:
            r["fillPaint"] = grad
        return {"type": "Rect", "id": self.lid(), "name": name, "blendMode": blend, "activeRange": self.AR,
                "transform": self.tf(x, y, rot, op), "rect": r, "effects": effects or []}

    def _fill(self, c, op=100, grad=None):
        paint = grad or {"type": "solid", "color": self.col(c)}
        return [{"paint": paint, "fillRule": "nonZeroWinding", "blendMode": "normal", "opacity": op / 100.0}]

    def ellipse(self, cx, cy, w, h, c, op=100, blend="normal", grad=None, effects=None, rot=0.0, name="ellipse"):
        return {"type": "Shape", "id": self.lid(), "name": name, "blendMode": blend, "activeRange": self.AR,
                "transform": self.tf(cx, cy, rot), "effects": effects or [],
                "shape": {"path": {"commands": []}, "ellipse": {"size": [w, h]}, "fills": self._fill(c, op, grad)}}

    def poly(self, pts, c, op=100, blend="normal", stroke=None, effects=None, closed=True, name="poly", grad=None):
        cmds = [{"type": "moveTo", "x": pts[0][0], "y": pts[0][1]}]
        cmds += [{"type": "lineTo", "x": p[0], "y": p[1]} for p in pts[1:]]
        if closed:
            cmds.append({"type": "close"})
        shape = {"path": {"commands": cmds}, "fills": self._fill(c, op, grad) if c is not None else []}
        if stroke:
            sc, sw = stroke
            shape["strokes"] = [{"paint": {"type": "solid", "color": self.col(sc)}, "width": sw, "cap": "round",
                                 "join": "round", "miterLimit": 4, "blendMode": "normal", "opacity": op / 100.0}]
        return {"type": "Shape", "id": self.lid(), "name": name, "blendMode": blend, "activeRange": self.AR,
                "transform": self.tf(0, 0), "shape": shape, "effects": effects or []}

    def line(self, pts, c, width, op=100, blend="normal"):
        return self.poly(pts, None, op=op, blend=blend, stroke=(c, width), closed=False, name="line")

    def text(self, x, y, s, size, c, font=("Arial", "Bold"), just="center", op=100, rot=0.0, stroke=None,
             tracking=0.0, blend="normal"):
        st = {"text": s, "fontFamily": font[0], "fontStyle": font[1], "fontSize": size, "fillColor": self.col(c),
              "strokeWidth": 0, "justification": just, "tracking": tracking}
        if stroke:
            st["applyStroke"] = True
            st["strokeColor"] = self.col(stroke[0])
            st["strokeWidth"] = stroke[1]
            st["strokeOverFill"] = False
        return {"type": "Text", "id": self.lid(), "name": "text:" + s[:20], "blendMode": blend, "activeRange": self.AR,
                "transform": self.tf(x, y, rot, op), "effects": [], "sourceText": st}

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

    def noise(self, w, h, op=18, scale=40, blend="overlay", kind="cloudy", seed=0.0, contrast=120):
        return self.rect(0, 0, w, h, (0.5, 0.5, 0.5), op=op, blend=blend, name="noise",
                         effects=[self.fx({"type": "turbulentNoise", "scale": scale, "fractalType": kind, "evolution": seed,
                                           "contrast": contrast, "complexity": 4})])

    def blur(self, amount):
        return self.fx({"type": "gaussianBlur", "blurriness": amount, "repeatEdgePixels": True})

    def mosaic(self, hb, vb):
        return self.fx({"type": "mosaic", "horizontalBlocks": hb, "verticalBlocks": vb, "sharpColors": True})

    # grime helpers ---------------------------------------------------------------------
    def tess(self, x, y, s, c, var=0.08):
        """one mosaic tessera"""
        k = self.rng.uniform(1 - var, 1 + var * 0.5)
        return self.rect(x + 0.8, y + 0.8, s - 1.6, s - 1.6, mul(c, k), round_=1.2)

    def streaks(self, w, h, n, c=(0.55, 0.50, 0.44), op=(15, 35), top=(0.0, 0.4), width=(2, 14), length=(0.3, 1.0), light=False):
        """vertical runs fading out downward: multiply (dark) or screen (light) gradients, softened"""
        out = []
        for _ in range(n):
            x = self.rng.uniform(0, w)
            y0 = self.rng.uniform(*top) * h
            ln = self.rng.uniform(*length) * h
            ww = self.rng.uniform(*width)
            o = min(100, self.rng.uniform(*op) * 2.2)
            end = (0, 0, 0) if light else (1, 1, 1)
            # a tapering drip, fading downward
            pts = [(x, y0), (x + ww, y0), (x + ww * 0.62, y0 + ln), (x + ww * 0.38, y0 + ln)]
            out.append(self.poly(pts, c, op=o, grad=self.lin(x, y0, x, y0 + ln, [(0, c), (0.6, mix(c, end, 0.6)), (1, end)])))
        if not out:
            return out
        # drawn on white (or black) inside a blurred group that multiplies (or screens) onto the surface
        bg = self.rect(0, 0, w, h, end)
        grp = self.group("streaks", 0, 0, w, h, [bg] + out, effects=[self.blur(2.5)])
        grp["blendMode"] = "screen" if light else "multiply"
        return [grp]

    def vfade(self, x, y, w, h, c, a, up=False):
        """multiply a darkening that grows toward the bottom (or toward the top with up=True)"""
        k = tuple(1 - (1 - v) * a for v in c)
        stops = [(0, (1, 1, 1)), (1, k)] if not up else [(0, k), (1, (1, 1, 1))]
        return self.rect(x, y, w, h, c, blend="multiply", grad=self.lin(0, 0, 0, h, stops))

    def dirt_bottom(self, w, h, frac=0.35, c=(0.16, 0.12, 0.09), a=0.6):
        y0 = h * (1 - frac)
        return self.vfade(0, y0, w, h - y0, c, a)

    def spots(self, w, h, n, c, size=(2, 8), op=(30, 70)):
        return [self.ellipse(self.rng.uniform(0, w), self.rng.uniform(0, h), *(lambda s: (s, s * self.rng.uniform(0.6, 1.2)))(self.rng.uniform(*size)),
                             c, op=self.rng.uniform(*op)) for _ in range(n)]


def mul(c, k):
    return tuple(max(0.0, min(1.0, v * k)) for v in c)


def mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


BLACK = (0.02, 0.02, 0.02)
WHITE = (0.96, 0.96, 0.94)
YEL = (0.99, 0.78, 0.08)
GRN = (0.0, 0.58, 0.27)


def bullet(d, cx, cy, r, letter):
    green = letter in "456"
    c = GRN if green else YEL
    tc = WHITE if green else BLACK
    return [d.ellipse(cx, cy, r * 2, r * 2, c), d.text(cx, cy + r * 0.52, letter, r * 1.45, tc)]


# --------------------------------------------------------------------------------- painters: train

def steel_base(d, w, h, base=(0.60, 0.61, 0.63)):
    L = [d.rect(0, 0, w, h, base)]
    for _ in range(int(h / 3)):
        y = d.rng.uniform(0, h)
        L.append(d.rect(0, y, w, d.rng.uniform(0.6, 1.6), mul(base, d.rng.choice([0.85, 1.15])), op=d.rng.uniform(15, 35)))
    L.append(d.noise(w, h, op=14, scale=25, seed=d.rng.uniform(0, 50)))
    return L


def p_steel_flute(d, w, h):
    L = [d.rect(0, 0, w, h, (0.6, 0.61, 0.63))]
    for x in range(0, w, 16):
        L.append(d.rect(x, 0, 16, h, (1, 1, 1), grad=d.lin(0, 0, 16, 0, [
            (0.0, (0.80, 0.81, 0.83)), (0.3, (0.68, 0.69, 0.71)), (0.75, (0.44, 0.45, 0.47)), (1.0, (0.58, 0.59, 0.61))])))
    L.append(d.noise(w, h, op=12, scale=30))
    L += d.streaks(w, h, 14, op=(10, 25))
    L.append(d.dirt_bottom(w, h, 0.45, a=0.5))
    return L


def p_steel_plain(d, w, h):
    L = steel_base(d, w, h)
    L += d.streaks(w, h, 10, op=(8, 20))
    L.append(d.dirt_bottom(w, h, 0.3, a=0.3))
    return L


def p_roof(d, w, h):
    L = [d.rect(0, 0, w, h, (0.30, 0.30, 0.31)), d.noise(w, h, op=35, scale=20)]
    L += d.spots(w, h, 30, (0.08, 0.07, 0.06), size=(6, 30), op=(15, 40))
    L += d.spots(w, h, 12, (0.35, 0.18, 0.08), size=(4, 14), op=(20, 45))
    for x in range(0, w, 32):   # ribbed roof sheet
        L.append(d.rect(x, 0, 3, h, (0.45, 0.45, 0.46), op=40))
    return L


def p_under(d, w, h):
    L = [d.rect(0, 0, w, h, (0.09, 0.09, 0.10)), d.noise(w, h, op=40, scale=18)]
    for _ in range(14):
        x, y = d.rng.uniform(0, w - 40), d.rng.uniform(0, h - 30)
        L.append(d.poly([(x, y), (x + d.rng.uniform(20, 80), y), (x + d.rng.uniform(20, 80), y + d.rng.uniform(10, 40)), (x, y + 30)], None,
                        stroke=((0.25, 0.24, 0.23), 1.5), op=60))
    L += d.spots(w, h, 25, (0.30, 0.17, 0.07), size=(4, 18), op=(20, 45))
    return L


def p_tile_white(d, w, h, tw=64, th=32):
    L = [d.rect(0, 0, w, h, (0.50, 0.48, 0.44))]
    for r in range(int(h / th) + 1):
        off = (r % 2) * tw / 2
        for k in range(-1, int(w / tw) + 1):
            v = d.rng.uniform(0.84, 0.93)
            L.append(d.rect(k * tw + off + 2, r * th + 2, tw - 4, th - 4, (v, v * 0.99, v * 0.95), round_=2))
    L.append(d.noise(w, h, op=12, scale=40))
    L += d.streaks(w, h, 6, op=(8, 18))
    return L


def end_map(w, h):
    X = lambda m: (m + 1.5) / 3.0 * w
    Y = lambda z: (3.7 - z) / 3.7 * h
    return X, Y


def p_end_cab(d, w, h):
    X, Y = end_map(w, h)
    L = steel_base(d, w, h, (0.62, 0.63, 0.65))
    # black fibreglass mask around the windscreen
    L.append(d.rect(X(-1.45), Y(2.78), X(1.45) - X(-1.45), Y(1.62) - Y(2.78), (0.05, 0.05, 0.06), round_=14))
    # storm door
    L.append(d.rect(X(-0.40), Y(2.95), X(0.40) - X(-0.40), Y(0.72) - Y(2.95), (0.11, 0.11, 0.12), round_=4))
    L.append(d.poly([(X(-0.40), Y(2.95)), (X(0.40), Y(2.95)), (X(0.40), Y(0.72)), (X(-0.40), Y(0.72))], None, stroke=((0.02, 0.02, 0.02), 3)))
    # route sign box and marker light housings
    L.append(d.rect(X(-0.62), Y(3.30), X(0.62) - X(-0.62), Y(2.98) - Y(3.30), (0.03, 0.03, 0.03), round_=4))
    for s in (-1, 1):
        L.append(d.ellipse(X(s * 1.05), Y(3.12), 30, 30, (0.05, 0.05, 0.05)))
        L.append(d.ellipse(X(s * 1.05), Y(1.22), 46, 46, (0.05, 0.05, 0.05)))
        L.append(d.ellipse(X(s * 1.05), Y(1.22), 52, 52, (0.30, 0.30, 0.32), op=70))
    # anticlimber ribs
    for z in (0.62, 0.70, 0.78):
        L.append(d.rect(X(-1.4), Y(z), X(1.4) - X(-1.4), 4, (0.15, 0.15, 0.16)))
    # yellow edge of the step and the car number
    L.append(d.rect(X(-1.45), Y(0.92), X(1.45) - X(-1.45), 5, YEL, op=80))
    L.append(d.text(X(0.95), Y(1.62) + 22, "8713", 20, BLACK))
    L.append(d.text(X(-0.95), Y(1.62) + 22, "8713", 20, BLACK))
    L += d.streaks(w, h, 10, op=(10, 25), top=(0.5, 0.7), length=(0.2, 0.5))
    L.append(d.dirt_bottom(w, h, 0.3, a=0.5))
    return L


def p_end_mid(d, w, h):
    X, Y = end_map(w, h)
    L = steel_base(d, w, h, (0.60, 0.61, 0.63))
    L.append(d.rect(X(-0.42), Y(2.82), X(0.42) - X(-0.42), Y(0.80) - Y(2.82), (0.50, 0.51, 0.53), round_=4))
    L.append(d.poly([(X(-0.42), Y(2.82)), (X(0.42), Y(2.82)), (X(0.42), Y(0.80)), (X(-0.42), Y(0.80))], None, stroke=((0.08, 0.08, 0.08), 4)))
    L.append(d.rect(X(-0.28), Y(2.55), X(0.28) - X(-0.28), Y(1.75) - Y(2.55), (0.03, 0.03, 0.04), round_=8))
    for s in (-1, 1):
        L.append(d.rect(X(s * 1.1) - 30, Y(2.5), 60, Y(1.85) - Y(2.5), (0.04, 0.04, 0.05), round_=6))
        # grab rails and the safety-chain posts either side of the door
        L.append(d.rect(X(s * 0.55) - 3, Y(2.6), 6, Y(0.9) - Y(2.6), (0.85, 0.85, 0.86)))
    L.append(d.text(X(0.95), Y(1.4), "8714", 20, BLACK))
    L += d.streaks(w, h, 12, op=(10, 25))
    L.append(d.dirt_bottom(w, h, 0.35, a=0.55))
    return L


def p_door(d, w, h):
    # a door pair: 1.3 m wide, 2.0 m tall (z 0.8 .. 2.8 on the car)
    L = steel_base(d, w, h, (0.66, 0.67, 0.69))
    mx = lambda m: m / 1.3 * w
    my = lambda zr: (2.0 - zr) / 2.0 * h
    for x0 in (0.0, 0.65):
        L.append(d.poly([(mx(x0) + 2, 2), (mx(x0 + 0.65) - 2, 2), (mx(x0 + 0.65) - 2, h - 2), (mx(x0) + 2, h - 2)], None, stroke=((0.25, 0.25, 0.26), 3)))
        L.append(d.rect(mx(x0 + 0.12), my(1.75), mx(0.41), my(0.8) - my(1.75), (0.03, 0.03, 0.04), round_=8))
        L.append(d.rect(mx(x0 + 0.05), my(0.25), mx(0.55), my(0.0) - my(0.25) - 3, (0.50, 0.51, 0.52)))   # kick plate
        L.append(d.rect(mx(x0 + 0.47), my(0.72), 14, 18, YEL, op=85))   # do-not-lean sticker
        L.append(d.rect(mx(x0 + 0.47) + 3, my(0.72) + 4, 8, 8, BLACK, op=85))
    L.append(d.rect(w / 2 - 5, 0, 10, h, (0.03, 0.03, 0.03)))   # rubber seam
    L.append(d.dirt_bottom(w, h, 0.2, a=0.5))
    return L


def p_interior(d, w, h):
    # what you see through the windows: z 0.9 .. 3.1 across 8 m of car (bright: it's emissive)
    Y = lambda z: (3.1 - z) / 2.2 * h
    L = [d.rect(0, 0, w, h, (0.86, 0.84, 0.78))]
    L.append(d.rect(0, 0, w, Y(2.95), (1, 1, 1)))  # ceiling light strip
    L.append(d.rect(0, Y(2.95), w, Y(2.62) - Y(2.95), (0.92, 0.9, 0.84)))
    for x in range(0, w, 64):  # ad cards above the windows
        c = d.rng.choice([(0.85, 0.3, 0.2), (0.2, 0.45, 0.75), (0.95, 0.8, 0.3), (0.3, 0.6, 0.4), (0.9, 0.9, 0.9), (0.55, 0.3, 0.6)])
        L.append(d.rect(x + 3, Y(2.9), 58, Y(2.66) - Y(2.9), c))
        L.append(d.rect(x + 8, Y(2.8), 30, 3, (1, 1, 1), op=70))
    for x in range(40, w, 200):  # opposite windows: the dark tunnel
        L.append(d.rect(x, Y(2.55), 130, Y(1.75) - Y(2.55), (0.05, 0.05, 0.06), round_=6))
    L.append(d.rect(0, Y(2.6), w, 5, (0.75, 0.76, 0.78)))   # grab bar
    L.append(d.rect(0, Y(1.45), w, Y(0.9) - Y(1.45), (0.20, 0.30, 0.48)))  # bench seats
    for x in range(0, w, 30):
        L.append(d.rect(x, Y(1.45), 2, Y(0.9) - Y(1.45), (0.12, 0.2, 0.33)))
    L.append(d.rect(0, Y(1.0), w, Y(0.9) - Y(1.0), (0.35, 0.33, 0.30)))
    # passengers in winter coats, standing and sitting
    coats = [(0.12, 0.12, 0.14), (0.42, 0.12, 0.12), (0.16, 0.22, 0.38), (0.45, 0.38, 0.26), (0.25, 0.30, 0.22), (0.55, 0.52, 0.48), (0.7, 0.45, 0.15)]
    skins = [(0.93, 0.76, 0.64), (0.42, 0.27, 0.18), (0.72, 0.52, 0.38), (0.95, 0.80, 0.66), (0.62, 0.43, 0.30)]
    x = 20
    while x < w - 20:
        stand = d.rng.random() < 0.5
        c = d.rng.choice(coats)
        if stand:
            top = Y(d.rng.uniform(2.25, 2.45))
            L.append(d.rect(x - 22, top + 30, 44, h, c, round_=14))
            L.append(d.ellipse(x, top + 14, 26, 32, d.rng.choice(skins)))
            if d.rng.random() < 0.5:
                L.append(d.ellipse(x, top + 4, 30, 18, d.rng.choice(coats)))   # hat
        else:
            top = Y(1.95)
            L.append(d.rect(x - 22, top + 28, 44, Y(1.1) - top - 28, c, round_=12))
            L.append(d.ellipse(x, top + 13, 24, 30, d.rng.choice(skins)))
        x += d.rng.uniform(55, 150)
    for x in range(100, w, 200):  # stanchion poles
        L.append(d.rect(x, 0, 7, h, (0.92, 0.92, 0.94)))
        L.append(d.rect(x + 1, 0, 2, h, (1, 1, 1)))
    return [d.group("interior_art", 0, 0, w, h, L, effects=[d.blur(1.2)])]


def led_text(d, w, h, s, c=(1.0, 0.6, 0.08), x=None, size=40):
    L = [d.text(x if x is not None else w / 2, h * 0.5 + size * 0.36, s, size, c, just="center" if x is None else "left")]
    for gx in range(0, w, 4):
        L.append(d.rect(gx, 0, 1.4, h, (0, 0, 0), op=55))
    for gy in range(0, h, 4):
        L.append(d.rect(0, gy, w, 1.4, (0, 0, 0), op=55))
    return L


def p_dest(d, w, h, s):
    return [d.rect(0, 0, w, h, (0.01, 0.01, 0.01))] + led_text(d, w, h, s, size=32)


def p_side(d, w, h, s):
    L = [d.rect(0, 0, w, h, (0.01, 0.01, 0.01))]
    L += bullet(d, 34, h / 2, 26, "R")
    L += led_text(d, w, h, s, (1.0, 0.2, 0.08), x=78, size=38)
    return L


def p_bullet(d, w, h, letter):
    return [d.rect(0, 0, w, h, (0.02, 0.02, 0.02))] + bullet(d, w / 2, h / 2, w * 0.45, letter)


def p_glow(d, w, h, name):
    c = {"glow_white": (0.95, 0.97, 1.0), "glow_amber": (1.0, 0.72, 0.35), "sig_red": (1.0, 0.12, 0.06),
         "sig_green": (0.2, 1.0, 0.55), "sig_yellow": (1.0, 0.8, 0.1), "blue_lamp": (0.2, 0.45, 1.0),
         "globe_green": (0.45, 1.0, 0.55), "lamp_white": (1.0, 0.96, 0.85), "lamp_red": (1.0, 0.1, 0.05)}.get(name)
    if name == "cab_glass":
        return [d.rect(0, 0, w, h, (0.04, 0.05, 0.06)),
                d.poly([(10, h), (30, 0), (44, 0), (24, h)], (0.4, 0.45, 0.5), op=25)]
    return [d.rect(0, 0, w, h, mul(c, 0.75)),
            d.ellipse(w / 2, h / 2, w * 1.1, h * 1.1, c, grad=d.rad(w / 2, h / 2, w * 0.55, [(0, (1, 1, 1)), (0.45, c), (1, mul(c, 0.75))]))]


def p_reader(d, w, h):
    L = [d.rect(0, 0, w, h, (0.02, 0.02, 0.03)), d.rect(8, 8, w - 16, h - 16, (0.04, 0.06, 0.1), round_=6)]
    cx, cy = w / 2, h * 0.42
    for r in (14, 24, 34):   # contactless waves
        pts = [(cx - 18 + r * math.cos(a), cy + r * math.sin(a)) for a in [math.radians(t) for t in range(-50, 51, 10)]]
        L.append(d.line(pts, (0.85, 0.95, 1.0), 4))
    L.append(d.ellipse(cx - 18, cy, 8, 8, (0.85, 0.95, 1.0)))
    L.append(d.text(cx, h - 22, "TAP", 20, (0.85, 0.95, 1.0)))
    L.append(d.ellipse(w - 18, 18, 8, 8, (0.2, 1.0, 0.4)))
    return L


def p_booth_sign(d, w, h):
    return [d.rect(0, 0, w, h, (0.95, 0.95, 0.92)), d.rect(0, 0, w, 6, BLACK),
            d.text(w / 2, h * 0.5 + 13, "STATION AGENT", 34, BLACK, tracking=40)]


def p_tube(d, w, h):
    return [d.rect(0, 0, w, h, (0.8, 0.85, 0.9), grad=d.lin(0, 0, 0, h, [(0, (0.7, 0.75, 0.8)), (0.5, (1, 1, 1)), (1, (0.7, 0.75, 0.8))]))] + \
           [d.rect(x, 0, 1.5, h, (0.6, 0.65, 0.7), op=40) for x in range(0, w, 12)]


# --------------------------------------------------------------------------------- painters: track

def p_concrete_track(d, w, h):
    L = [d.rect(0, 0, w, h, (0.34, 0.33, 0.31)), d.noise(w, h, op=35, scale=22), d.noise(w, h, op=20, scale=90, seed=3)]
    L.append(d.rect(0, 74, w, 108, (0.10, 0.09, 0.08), blend="multiply", grad=d.lin(0, 0, 0, 108, [(0, (0.8, 0.8, 0.78)), (0.5, (0.25, 0.23, 0.2)), (1, (0.8, 0.8, 0.78))])))
    L.append(d.rect(0, 114, w, 28, (0.04, 0.04, 0.04)))     # drainage trough, wet
    for _ in range(10):
        x = d.rng.uniform(0, w)
        L.append(d.rect(x, 118, d.rng.uniform(20, 90), 2, (0.45, 0.48, 0.5), op=40))
    for y in (60, 182):   # rust dust either side of the rails
        L.append(d.rect(0, y, w, 14, (0.35, 0.18, 0.08), op=45))
    L += d.spots(w, h, 40, (0.05, 0.04, 0.03), size=(4, 20), op=(20, 50))
    for _ in range(14):   # litter
        c = d.rng.choice([(0.85, 0.84, 0.8), (0.7, 0.1, 0.08), (0.2, 0.35, 0.7), (0.8, 0.75, 0.5), (0.9, 0.9, 0.9)])
        L.append(d.rect(d.rng.uniform(0, w), d.rng.uniform(10, h - 10), d.rng.uniform(4, 14), d.rng.uniform(3, 9), c,
                        rot=d.rng.uniform(0, 90), op=75))
    return L


def p_tie(d, w, h):
    L = [d.rect(0, 0, w, h, (0.20, 0.13, 0.08))]
    for _ in range(40):
        y = d.rng.uniform(0, h)
        L.append(d.rect(0, y, w, d.rng.uniform(1, 3), d.rng.choice([(0.12, 0.08, 0.05), (0.3, 0.2, 0.12)]), op=d.rng.uniform(30, 70)))
    for _ in range(6):
        y = d.rng.uniform(10, h - 10)
        x = d.rng.uniform(0, w * 0.6)
        L.append(d.rect(x, y, d.rng.uniform(30, 100), 2, (0.04, 0.03, 0.02)))
    L.append(d.noise(w, h, op=25, scale=15))
    return L


def p_board(d, w, h):
    L = [d.rect(0, 0, w, h, (0.47, 0.42, 0.33))]
    for _ in range(30):
        L.append(d.rect(0, d.rng.uniform(0, h), w, d.rng.uniform(0.8, 2.2), (0.32, 0.27, 0.2), op=d.rng.uniform(30, 60)))
    L.append(d.rect(0, 0, w, 8, (0.85, 0.65, 0.1), op=55))
    L.append(d.noise(w, h, op=30, scale=18))
    L += d.spots(w, h, 20, (0.1, 0.08, 0.06), size=(4, 14), op=(30, 60))
    return L


def p_cable(d, w, h):
    L = []
    for i in range(4):  # four cables side by side
        y0 = i * 16
        L.append(d.rect(0, y0, w, 16, (0.05, 0.05, 0.05), grad=d.lin(0, y0, 0, y0 + 16, [(0, (0.03, 0.03, 0.03)), (0.35, (0.2, 0.2, 0.2)), (1, (0.03, 0.03, 0.03))])))
    L.append(d.noise(w, h, op=18, scale=10))
    return L


def p_tray(d, w, h):
    L = [d.rect(0, 0, w, h, (0.44, 0.45, 0.45)), d.noise(w, h, op=25, scale=14)]
    for x in range(8, w, 32):
        L.append(d.rect(x, 22, 18, 20, (0.08, 0.08, 0.08), round_=4))
    L += d.spots(w, h, 12, (0.4, 0.2, 0.08), size=(3, 10), op=(30, 60))
    return L


def p_rail_side(d, w, h):
    return [d.rect(0, 0, w, h, (0.28, 0.17, 0.10)), d.noise(w, h, op=40, scale=12)] + d.spots(w, h, 20, (0.1, 0.06, 0.04), size=(3, 10))


def p_rail_top(d, w, h):
    L = [d.rect(0, 0, w, h, (0.82, 0.82, 0.84))]
    for _ in range(25):
        L.append(d.rect(0, d.rng.uniform(0, h), w, 1, d.rng.choice([(0.95, 0.95, 0.97), (0.6, 0.6, 0.62)]), op=50))
    L.append(d.rect(0, 0, w, 8, (0.35, 0.22, 0.12), op=70))
    L.append(d.rect(0, h - 8, w, 8, (0.35, 0.22, 0.12), op=70))
    return L


def p_pipe(d, w, h):
    return [d.rect(0, 0, w, h, (0.36, 0.22, 0.14)), d.noise(w, h, op=40, scale=14)] + d.spots(w, h, 10, (0.55, 0.5, 0.4), size=(3, 8), op=(20, 40))


# --------------------------------------------------------------------------------- painters: station

def p_tactile(d, w, h):
    L = [d.rect(0, 0, w, h, (0.93, 0.70, 0.06))]
    for yy in range(8, h, 16):
        for xx in range(8 + (yy // 16 % 2) * 8, w, 16):
            L.append(d.ellipse(xx + 1.5, yy + 1.5, 11, 11, (0.55, 0.40, 0.02), op=70))
            L.append(d.ellipse(xx, yy, 10, 10, (1.0, 0.82, 0.25)))
    L.append(d.noise(w, h, op=30, scale=20, blend="multiply", contrast=60))
    L += d.spots(w, h, 15, (0.15, 0.12, 0.08), size=(4, 12), op=(25, 50))
    return L


def p_plat_edge(d, w, h):
    L = [d.rect(0, 0, w, h, (0.20, 0.19, 0.18)), d.noise(w, h, op=30, scale=20)]
    L.append(d.rect(0, 0, w, 22, (0.62, 0.61, 0.58)))
    L.append(d.rect(0, 22, w, 38, (0.06, 0.06, 0.06)))
    L += d.streaks(w, h, 10, c=(0.05, 0.04, 0.03), top=(0.45, 0.5), length=(0.2, 0.5))
    return L


def p_stair(d, w, h):
    L = [d.rect(0, 0, w, h, (0.48, 0.47, 0.45)), d.noise(w, h, op=30, scale=20)]
    L.append(d.rect(0, 0, w, 20, (0.92, 0.70, 0.08)))
    for y in range(3, 20, 5):
        L.append(d.rect(0, y, w, 1.5, (0.4, 0.3, 0.05), op=70))
    L.append(d.ellipse(w / 2, h * 0.6, w * 0.7, h * 0.6, (0.25, 0.24, 0.22), op=40))  # worn middle
    L += d.spots(w, h, 12, (0.08, 0.07, 0.06), size=(3, 8))
    return L


def p_bench(d, w, h):
    L = [d.rect(0, 0, w, h, (0.15, 0.09, 0.05))]
    for i in range(4):
        y0 = 4 + i * 31
        L.append(d.rect(0, y0, w, 27, (0.55, 0.36, 0.18), round_=3))
        for _ in range(6):
            L.append(d.rect(0, y0 + d.rng.uniform(2, 25), w, 1.2, (0.38, 0.23, 0.1), op=60))
    L.append(d.text(60, 70, "jj", 24, (0.2, 0.2, 0.25), font=("Impact", "Regular"), op=35, rot=-8))
    L.append(d.noise(w, h, op=18, scale=20))
    return L


def p_trash(d, w, h):
    L = [d.rect(0, 0, w, h, (0.12, 0.12, 0.13))]
    for x in range(0, w, 16):
        L.append(d.rect(x, 0, 4, h, (0.22, 0.22, 0.23)))
    L.append(d.noise(w, h, op=30, scale=16))
    L += d.spots(w, h, 12, (0.45, 0.42, 0.38), size=(2, 6), op=(20, 40))
    return L


def p_turnstile_top(d, w, h):
    L = steel_base(d, w, h, (0.66, 0.67, 0.69))
    L.append(d.rect(0, 52, w, 10, (0.02, 0.02, 0.02)))       # card swipe slot
    L.append(d.text(40, 40, "SWIPE", 18, BLACK, just="left"))
    L.append(d.poly([(150, 26), (170, 26), (160, 44)], YEL))
    L.append(d.rect(190, 80, 40, 24, (0.03, 0.03, 0.03), round_=3))
    L.append(d.text(210, 98, "GO", 16, (0.2, 1.0, 0.4)))
    return L


def p_emergency(d, w, h):
    return [d.rect(0, 0, w, h, (0.72, 0.07, 0.05)), d.rect(6, 6, w - 12, h - 12, (0, 0, 0), op=0),
            d.poly([(6, 6), (w - 6, 6), (w - 6, h - 6), (6, h - 6)], None, stroke=(WHITE, 3)),
            d.text(w / 2, 52, "EMERGENCY EXIT", 27, WHITE), d.text(w / 2, 92, "ALARM WILL SOUND", 20, WHITE),
            d.noise(w, h, op=12, scale=20)]


def p_bluebox(d, w, h):
    return [d.rect(0, 0, w, h, (0.07, 0.18, 0.58)), d.text(w / 2, 40, "EMERGENCY", 30, WHITE),
            d.text(w / 2, 72, "ALARM  ·  TELEPHONE", 17, WHITE), d.text(w / 2, 100, "POWER REMOVAL", 17, WHITE),
            d.noise(w, h, op=14, scale=20)]


def p_swatch(d, w, h, c):
    return [d.rect(0, 0, w, h, c), d.noise(w, h, op=18, scale=12, seed=d.rng.uniform(0, 30))]


def p_ibeam(d, w, h):
    L = [d.rect(0, 0, w, h, (0.07, 0.07, 0.075)), d.noise(w, h, op=30, scale=16)]
    L.append(d.rect(0, 196, w, 9, (0.86, 0.85, 0.80)))
    L.append(d.rect(0, 210, w, 9, (0.86, 0.85, 0.80)))
    L += d.spots(w, h, 25, (0.35, 0.2, 0.1), size=(2, 9), op=(30, 70))
    L += d.streaks(w, h, 8, c=(0.3, 0.16, 0.06), top=(0.6, 0.75), length=(0.1, 0.25), op=(25, 50), light=True)
    for y in range(8, h, 22):
        for x in (10, w - 10):
            L.append(d.ellipse(x, y, 7, 7, (0.18, 0.18, 0.19)))
    L.append(d.dirt_bottom(w, h, 0.25, a=0.6))
    return L


def p_column(d, w, h):
    base = (0.16, 0.30, 0.25)
    L = [d.rect(0, 0, w, h, base), d.noise(w, h, op=22, scale=16)]
    for y in range(8, h, 22):
        for x in (12, w - 12):
            L.append(d.ellipse(x, y, 8, 8, mul(base, 1.35)))
    L += d.spots(w, h, 18, (0.55, 0.55, 0.5), size=(2, 6), op=(25, 50))
    L.append(d.dirt_bottom(w, h, 0.2, a=0.6))
    return L


def p_booth_interior(d, w, h):
    L = [d.rect(0, 0, w, h, (0.95, 0.88, 0.7))]
    L.append(d.rect(0, 0, w, 18, (1, 1, 1)))
    L.append(d.rect(20, 40, 70, 50, (0.15, 0.15, 0.17)))
    L.append(d.rect(26, 46, 58, 38, (0.35, 0.55, 0.85)))
    L.append(d.ellipse(200, 50, 34, 34, (1, 1, 1)))
    L.append(d.ellipse(200, 50, 30, 30, (0.85, 0.84, 0.8)))
    L.append(d.line([(200, 50), (200, 38)], BLACK, 2))
    L.append(d.line([(200, 50), (208, 54)], BLACK, 2))
    L.append(d.rect(110, 120, 80, 100, (0.12, 0.16, 0.28), round_=24))    # the agent
    L.append(d.ellipse(150, 105, 34, 42, (0.55, 0.38, 0.27)))
    L.append(d.rect(0, 190, w, h - 190, (0.35, 0.3, 0.25)))
    L.append(d.rect(30, 175, 50, 16, (0.95, 0.95, 0.95), rot=-6))
    return L


def inpoly(pts, x, y):
    c = False
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c


def segdist(px, py, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0, min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - a[0] - dx * t, py - a[1] - dy * t)


LEAF = [(0, -82), (14, -50), (34, -60), (28, -22), (62, -38), (54, -14), (78, -2), (40, 18), (46, 40), (10, 30),
        (4, 64), (-4, 64), (-10, 30), (-46, 40), (-40, 18), (-78, -2), (-54, -14), (-62, -38), (-28, -22), (-34, -60), (-14, -50)]


def p_plaque(d, w, h):
    # a terracotta-and-mosaic plaque with the last leaf, set in tesserae
    n = 36
    s = w / n
    terra, cream, ochre, leaf, vein = (0.55, 0.24, 0.12), (0.90, 0.85, 0.72), (0.80, 0.66, 0.38), (0.82, 0.32, 0.08), (0.45, 0.14, 0.04)
    L = [d.rect(0, 0, w, h, (0.32, 0.29, 0.24))]
    cx, cy = w / 2, h / 2 + 6
    pts = [(cx + x * 1.15, cy + y * 1.15) for x, y in LEAF]
    veins = [((cx, cy + 70), (cx, cy - 80)), ((cx, cy + 12), (cx + 60, cy - 34)), ((cx, cy + 12), (cx - 60, cy - 34))]
    for j in range(n):
        for i in range(n):
            x, y = i * s + s / 2, j * s + s / 2
            ring = min(i, j, n - 1 - i, n - 1 - j)
            if ring < 3:
                c = terra if ring != 1 or (i + j) % 4 else ochre
            elif ring < 5:
                c = cream
            elif inpoly(pts, x, y):
                c = vein if min(segdist(x, y, a, b) for a, b in veins) < s * 0.6 else leaf
            else:
                c = ochre
            L.append(d.tess(i * s, j * s, s, c))
    L.append(d.noise(w, h, op=14, scale=30))
    return L


def p_booth_front(d, w, h):
    L = steel_base(d, w, h, (0.58, 0.59, 0.61))
    for y in range(10, h, 18):
        L.append(d.rect(0, y, w, 2, (0.4, 0.4, 0.42), op=60))
    L.append(d.rect(w / 2 - 70, 8, 140, 30, (0.05, 0.05, 0.06), round_=4))   # pass-through tray
    L.append(d.ellipse(w / 2 + 130, 40, 44, 44, (0.15, 0.15, 0.16)))           # speaker grille
    for i in range(-2, 3):
        L.append(d.rect(w / 2 + 112, 40 + i * 6, 36, 2, (0.5, 0.5, 0.52)))
    L.append(d.dirt_bottom(w, h, 0.4, a=0.6))
    return L


def p_map(d, w, h):
    L = [d.rect(0, 0, w, h, (0.95, 0.95, 0.93)), d.rect(10, 10, w - 20, h - 20, (0.88, 0.86, 0.78))]
    L.append(d.rect(10, 10, w - 20, 26, BLACK))
    L.append(d.text(22, 30, "Subway  ·  Lines & Stations", 17, WHITE, just="left"))
    L.append(d.poly([(60, 40), (110, 70), (120, 130), (90, h - 12), (10, h - 12), (10, 40)], (0.65, 0.78, 0.82), op=80))   # the water
    cols = [YEL, (0.9, 0.2, 0.15), GRN, (0.2, 0.4, 0.8), (0.95, 0.5, 0.1), (0.5, 0.5, 0.5)]
    for c in cols:
        x, y = d.rng.uniform(120, 200), d.rng.uniform(50, h - 20)
        pts = [(x, y)]
        for _ in range(6):
            x += d.rng.uniform(30, 60)
            y = max(45, min(h - 18, y + d.rng.uniform(-40, 40)))
            pts.append((x, y))
        L.append(d.line(pts, c, 5))
        for p in pts:
            L.append(d.ellipse(p[0], p[1], 7, 7, WHITE))
    L.append(d.noise(w, h, op=10, scale=30))
    return L


def p_tablet(d, w, h):
    # the classic mosaic name tablet: brown border, a band of diamonds, a cream field (the name goes in at runtime)
    brown, ochre, terra, blue, cream = (0.30, 0.17, 0.10), (0.80, 0.57, 0.18), (0.58, 0.24, 0.11), (0.14, 0.26, 0.48), (0.92, 0.88, 0.78)
    s = 8
    nx, ny = w // s, h // s
    L = [d.rect(0, 0, w, h, (0.30, 0.27, 0.22)), d.rect(0, 0, w, h, brown), d.rect(7 * s, 7 * s, w - 14 * s, h - 14 * s, cream)]
    for j in range(ny):
        for i in range(nx):
            ring = min(i, j, nx - 1 - i, ny - 1 - j)
            if 2 <= ring <= 5:
                k = ring - 2
                t = i if (j < 6 or j > ny - 7) else j
                m = abs((t % 8) - 3.5) + abs(k - 1.5)
                c = blue if m < 1.6 else ochre if m < 2.6 else terra
                L.append(d.tess(i * s, j * s, s, c))
            elif ring < 2 or ring == 6:
                if d.rng.random() < 0.3:
                    L.append(d.tess(i * s, j * s, s, brown, var=0.25))
            elif d.rng.random() < 0.12:
                L.append(d.tess(i * s, j * s, s, cream, var=0.12))
    for x in range(0, w + 1, s):
        L.append(d.rect(x - 0.6, 0, 1.2, h, (0.35, 0.31, 0.26), op=55))
    for y in range(0, h + 1, s):
        L.append(d.rect(0, y - 0.6, w, 1.2, (0.35, 0.31, 0.26), op=55))
    L.append(d.noise(w, h, op=12, scale=30))
    return L


def p_sign(d, w, h, title, bullets, arrow=None, size=44):
    L = [d.rect(0, 0, w, h, (0.03, 0.03, 0.03)), d.rect(0, 6, w, 3, WHITE)]
    x = 22
    if arrow:
        ax, ay = 52, h / 2 + 4
        L.append(d.poly([(ax, ay - 34), (ax + 26, ay - 6), (ax + 10, ay - 6), (ax + 10, ay + 30), (ax - 10, ay + 30), (ax - 10, ay - 6), (ax - 26, ay - 6)], WHITE))
        x = 96
    L.append(d.text(x, h / 2 + size * 0.36 + 4, title, size, WHITE, just="left"))
    bx = w - 28
    for b in reversed(bullets):
        L += bullet(d, bx, h / 2 + 4, 20, b)
        bx -= 44
    return L


def p_hazard(d, w, h):
    L = [d.rect(0, 0, w, h, YEL)]
    for x in range(-h, w + h, 48):
        L.append(d.poly([(x, h), (x + 24, h), (x + 24 + h, 0), (x + h, 0)], BLACK))
    L.append(d.noise(w, h, op=20, scale=20))
    return L


def p_grime(d, w, h):
    return [d.rect(0, 0, w, h, (0.12, 0.10, 0.08)), d.noise(w, h, op=45, scale=20)]


# --------------------------------------------------------------------------------- ad posters (all invented)

def poster_frame(d, w, h, L):
    L.append(d.noise(w, h, op=14, scale=30))
    L.append(d.dirt_bottom(w, h, 0.25, a=0.35))
    if d.rng.random() < 0.6:   # a torn corner
        c = d.rng.choice([(0, 0), (w, 0), (0, h), (w, h)])
        sx, sy = (1 if c[0] == 0 else -1), (1 if c[1] == 0 else -1)
        L.append(d.poly([c, (c[0] + sx * 40, c[1]), (c[0], c[1] + sy * 55)], (0.85, 0.84, 0.8)))
    if d.rng.random() < 0.5:   # a sticker / scrawl
        L.append(d.text(d.rng.uniform(60, w - 60), d.rng.uniform(h * 0.5, h - 30), d.rng.choice(["ZEPH", "OK!", "RATKNG"]), 26,
                        d.rng.choice([(0.1, 0.1, 0.1), (0.8, 0.1, 0.5)]), font=("Impact", "Regular"), rot=d.rng.uniform(-15, 15), op=80))
    return L


def p_ad(d, w, h, name):
    L = []
    if name == "ad_soup":
        L += [d.rect(0, 0, w, h, (0.85, 0.22, 0.12)), d.ellipse(w / 2, 200, 170, 70, (0.97, 0.93, 0.85)),
              d.poly([(w / 2 - 85, 200), (w / 2 + 85, 200), (w / 2 + 60, 260), (w / 2 - 60, 260)], (0.97, 0.93, 0.85)),
              d.ellipse(w / 2, 200, 150, 50, (0.95, 0.65, 0.2))]
        for i in (-1, 0, 1):
            L.append(d.line([(w / 2 + i * 35, 165), (w / 2 + i * 35 + 12, 140), (w / 2 + i * 35 - 6, 115), (w / 2 + i * 35 + 8, 90)], WHITE, 5, op=80))
        L += [d.text(w / 2, 50, "HALVORSEN'S", 28, WHITE), d.text(w / 2, 80, "HOT SOUP", 26, (1, 0.85, 0.4)),
              d.text(w / 2, 320, "Warm up,", 24, WHITE, font=("Georgia", "Bold")), d.text(w / 2, 350, "New York.", 24, WHITE, font=("Georgia", "Bold"))]
    elif name == "ad_movie":
        L += [d.rect(0, 0, w, h, (0.05, 0.05, 0.08), grad=d.lin(0, 0, 0, h, [(0, (0.08, 0.1, 0.2)), (1, (0.02, 0.02, 0.03))]))]
        pts = [(0, -60), (10, -36), (24, -42), (20, -16), (44, -26), (38, -10), (56, 0), (28, 12), (32, 28), (6, 22), (2, 46), (-2, 46), (-6, 22), (-32, 28), (-28, 12), (-56, 0), (-38, -10), (-44, -26), (-20, -16), (-24, -42), (-10, -36)]
        L.append(d.poly([(w / 2 + x * 1.3, 170 + y * 1.3) for x, y in pts], (0.9, 0.45, 0.08)))
        L += [d.text(w / 2, 300, "AUTUMN", 46, (0.95, 0.92, 0.85), font=("Georgia", "Bold"), tracking=60),
              d.text(w / 2, 338, "FALLS", 30, (0.9, 0.55, 0.15), font=("Georgia", "Bold"), tracking=200),
              d.text(w / 2, 368, "IN THEATERS THIS NOVEMBER", 11, (0.8, 0.8, 0.8))]
    elif name == "ad_dental":
        L += [d.rect(0, 0, w, h, (0.55, 0.82, 0.9)), d.ellipse(w / 2, 170, 150, 120, WHITE),
              d.poly([(w / 2 - 70, 180), (w / 2 - 45, 290), (w / 2 - 15, 220), (w / 2 + 15, 220), (w / 2 + 45, 290), (w / 2 + 70, 180)], WHITE),
              d.ellipse(w / 2 - 25, 160, 12, 16, BLACK), d.ellipse(w / 2 + 25, 160, 12, 16, BLACK),
              d.line([(w / 2 - 25, 195), (w / 2, 208), (w / 2 + 25, 195)], BLACK, 4),
              d.text(w / 2, 56, "BRIGHTSIDE", 32, (0.1, 0.25, 0.45)), d.text(w / 2, 84, "DENTAL", 22, (0.1, 0.25, 0.45), tracking=200),
              d.text(w / 2, 340, "Smile like you mean it.", 18, (0.1, 0.25, 0.45), font=("Georgia", "Bold"))]
    elif name == "ad_kites":
        L += [d.rect(0, 0, w, h, (0.98, 0.85, 0.3)),
              d.poly([(w / 2, 90), (w / 2 + 60, 170), (w / 2, 260), (w / 2 - 60, 170)], (0.85, 0.15, 0.2)),
              d.line([(w / 2, 90), (w / 2, 260)], (0.3, 0.05, 0.05), 3), d.line([(w / 2 - 60, 170), (w / 2 + 60, 170)], (0.3, 0.05, 0.05), 3),
              d.line([(w / 2, 260), (w / 2 - 20, 290), (w / 2 + 10, 310), (w / 2 - 15, 340)], BLACK, 2),
              d.text(w / 2, 50, "LEARN TO FLY", 30, BLACK), d.text(w / 2, 360, "Gusty's Kite School · Pier 3", 13, BLACK)]
    elif name == "ad_owl":
        L += [d.rect(0, 0, w, h, (0.15, 0.1, 0.3)), d.ellipse(w / 2, 190, 170, 190, (0.5, 0.35, 0.2)),
              d.ellipse(w / 2 - 38, 170, 64, 64, (1, 0.85, 0.2)), d.ellipse(w / 2 + 38, 170, 64, 64, (1, 0.85, 0.2)),
              d.ellipse(w / 2 - 38, 170, 26, 26, BLACK), d.ellipse(w / 2 + 38, 170, 26, 26, BLACK),
              d.poly([(w / 2 - 10, 205), (w / 2 + 10, 205), (w / 2, 225)], (0.9, 0.6, 0.1)),
              d.text(w / 2, 56, "NIGHT OWL", 34, (1, 0.85, 0.2)), d.text(w / 2, 330, "LIT FEST", 30, WHITE, tracking=150),
              d.text(w / 2, 360, "readings all night · free", 13, (0.8, 0.8, 0.9))]
    elif name == "ad_pigeon":
        L += [d.rect(0, 0, w, h, (0.92, 0.92, 0.9)), d.ellipse(w / 2, 200, 150, 100, (0.45, 0.47, 0.55)),
              d.ellipse(w / 2 + 60, 150, 60, 60, (0.4, 0.42, 0.5)), d.ellipse(w / 2 + 70, 145, 10, 10, (0.9, 0.4, 0.1)),
              d.poly([(w / 2 + 88, 150), (w / 2 + 108, 156), (w / 2 + 88, 160)], (0.3, 0.3, 0.3)),
              d.poly([(w / 2 - 70, 200), (w / 2 - 120, 180), (w / 2 - 110, 215)], (0.35, 0.37, 0.45)),
              d.text(w / 2, 56, "PIGEON EXPRESS", 26, (0.15, 0.15, 0.2)), d.text(w / 2, 310, "We know a shortcut.", 20, (0.15, 0.15, 0.2), font=("Georgia", "Bold")),
              d.text(w / 2, 345, "COURIERS · ALL 5 BOROS", 13, (0.85, 0.3, 0.1))]
    elif name == "ad_mattress":
        L += [d.rect(0, 0, w, h, (0.22, 0.32, 0.5)), d.rect(40, 200, w - 80, 60, (0.95, 0.95, 0.98), round_=16),
              d.ellipse(w / 2 - 30, 190, 110, 60, (0.45, 0.3, 0.2)), d.ellipse(w / 2 - 75, 168, 34, 34, (0.45, 0.3, 0.2)),
              d.text(w / 2 + 50, 160, "z z", 30, WHITE, font=("Georgia", "Bold")),
              d.text(w / 2, 60, "FERNWOOD", 34, WHITE), d.text(w / 2, 90, "MATTRESS CO.", 16, (0.8, 0.85, 0.95), tracking=150),
              d.text(w / 2, 320, "Sleep like a bear.", 22, WHITE, font=("Georgia", "Bold"))]
    else:   # ad_tree: a tourism poster for the last tree
        L += [d.rect(0, 0, w, h, (0.95, 0.9, 0.78)), d.ellipse(w / 2, 150, 200, 200, (0.95, 0.6, 0.3), op=60),
              d.rect(w / 2 - 8, 160, 16, 140, (0.25, 0.15, 0.08))]
        for a in (-50, -25, 25, 50):
            L.append(d.line([(w / 2, 200), (w / 2 + a, 130 + abs(a) * 0.6)], (0.25, 0.15, 0.08), 6))
        L.append(d.poly([(w / 2 + 50, 160), (w / 2 + 60, 150), (w / 2 + 64, 166)], (0.9, 0.3, 0.05)))
        L += [d.text(w / 2, 50, "VISIT THE", 18, (0.25, 0.15, 0.08), tracking=150), d.text(w / 2, 84, "LAST TREE", 34, (0.6, 0.2, 0.05), font=("Georgia", "Bold")),
              d.rect(0, 300, w, 84, (0.2, 0.35, 0.3)), d.text(w / 2, 340, "Battery Park", 22, WHITE, font=("Georgia", "Bold")),
              d.text(w / 2, 366, "while it lasts", 13, (0.85, 0.9, 0.85))]
    return poster_frame(d, w, h, L)


# --------------------------------------------------------------------------------- the documents

# --------------------------------------------------------------------------------- painters: station life

def p_fare_machine(d, w, h):
    """the front of a fare-card vending machine: screen, card slot, coin and bill slots, receipt tray"""
    L = steel_base(d, w, h, (0.12, 0.24, 0.52))
    L.append(d.rect(0, 0, w, 22, (0.03, 0.03, 0.04)))
    L.append(d.text(w / 2, 16, "MetroCard", 15, (0.99, 0.80, 0.10), font=("Arial", "Bold")))
    L.append(d.rect(0, 80, 10, h - 80, (0.03, 0.03, 0.04)))
    L.append(d.rect(w - 10, 80, 10, h - 80, (0.03, 0.03, 0.04)))
    L.append(d.rect(14, 28, 64, 46, (0.02, 0.02, 0.03), round_=3))                       # screen bezel
    L.append(d.rect(18, 32, 56, 38, (0.1, 0.35, 0.55), grad=d.lin(0, 32, 0, 70, [(0, (0.25, 0.55, 0.85)), (1, (0.06, 0.2, 0.4))])))
    for i, t in enumerate(("Buy", "Refill", "Tap")):
        L.append(d.rect(22, 36 + i * 11, 48, 8, (0.85, 0.9, 0.95), op=70, round_=2))
        L.append(d.text(46, 43 + i * 11, t, 7, (0.05, 0.15, 0.3)))
    L.append(d.rect(88, 30, 30, 10, (0.9, 0.62, 0.1), round_=2))                         # card slot (yellow)
    L.append(d.rect(92, 34, 22, 2, BLACK))
    L.append(d.rect(88, 48, 30, 10, (0.75, 0.76, 0.78), round_=2))                       # coins
    L.append(d.rect(92, 52, 22, 2, BLACK))
    L.append(d.rect(88, 64, 30, 12, (0.15, 0.6, 0.3), round_=2))                         # bills
    L.append(d.rect(91, 69, 24, 2, BLACK))
    L.append(d.rect(20, 88, 88, 26, (0.03, 0.03, 0.04), round_=4))                       # cards and change out
    L.append(d.rect(26, 94, 76, 4, (0.25, 0.25, 0.27)))
    L.append(d.noise(w, h, op=22, scale=14))
    L += d.spots(w, h, 10, (0.05, 0.05, 0.05), size=(2, 6), op=(20, 45))
    return L


def p_busker_sign(d, w, h):
    """a cardboard sign propped in a guitar case"""
    L = [d.rect(0, 0, w, h, (0.62, 0.48, 0.30)), d.noise(w, h, op=30, scale=10)]
    L.append(d.rect(4, 4, w - 8, h - 8, (0.68, 0.53, 0.34)))
    L.append(d.text(w / 2, 40, "SONGS", 26, (0.08, 0.06, 0.05), font=("Impact", "Regular")))
    L.append(d.text(w / 2, 66, "for the", 15, (0.08, 0.06, 0.05), font=("Georgia", "Bold")))
    L.append(d.text(w / 2, 96, "COLD", 28, (0.55, 0.08, 0.05), font=("Impact", "Regular")))
    L.append(d.text(w / 2, 118, "thank you :)", 12, (0.08, 0.06, 0.05), font=("Georgia", "Bold")))
    L += d.spots(w, h, 8, (0.35, 0.25, 0.14), size=(4, 12), op=(20, 40))
    return L


def p_newspaper(d, w, h):
    """newsprint: a masthead, a cold-weather headline, columns of grey text"""
    L = [d.rect(0, 0, w, h, (0.86, 0.84, 0.78)), d.noise(w, h, op=16, scale=8)]
    L.append(d.text(w / 2, 16, "The Evening Ledger", 12, BLACK, font=("Georgia", "Bold")))
    L.append(d.rect(6, 20, w - 12, 1.5, BLACK))
    L.append(d.text(w / 2, 40, "COLD SNAP", 22, BLACK, font=("Impact", "Regular")))
    L.append(d.text(w / 2, 52, "First frost in the park", 9, (0.2, 0.2, 0.2), font=("Georgia", "Bold")))
    L.append(d.rect(8, 58, 52, 34, (0.45, 0.44, 0.42)))                                 # photo
    L.append(d.ellipse(34, 80, 30, 14, (0.3, 0.3, 0.29)))
    for col, (x0, x1) in enumerate(((66, 120), (8, 60), (66, 120))):
        y0 = 60 if col == 0 else 96 if col == 1 else 96
        for y in range(int(y0), h - 6, 5):
            L.append(d.rect(x0, y, (x1 - x0) * d.rng.uniform(0.7, 1.0), 2, (0.35, 0.35, 0.34), op=80))
    return L


def p_vault(d, w, h, base, soot):
    """a shallow brick-and-concrete jack arch between two girders, painted long ago: u runs girder to girder"""
    L = [d.rect(0, 0, w, h, base), d.noise(w, h, op=26, scale=18)]
    # the arch's brick courses showing through the paint, faint
    for x in range(0, w, 8):
        L.append(d.rect(x, 0, 1.2, h, mul(base, 0.86), op=40))
    # darker toward the girders (the paint is newest at the crown), soot streaks along the arch
    L.append(d.rect(0, 0, w * 0.18, h, mul(base, 0.6), blend="multiply", grad=d.lin(0, 0, w * 0.18, 0, [(0, mul(base, 0.55)), (1, (1, 1, 1))])))
    L.append(d.rect(w * 0.82, 0, w * 0.18, h, mul(base, 0.6), blend="multiply", grad=d.lin(w * 0.82, 0, w, 0, [(0, (1, 1, 1)), (1, mul(base, 0.55))])))
    # water stains: rings of tide marks
    for _ in range(5 if not soot else 3):
        cx, cy, r = d.rng.uniform(20, w - 20), d.rng.uniform(15, h - 15), d.rng.uniform(10, 26)
        L.append(d.ellipse(cx, cy, r * 2, r * 1.5, (0.55, 0.45, 0.3), op=28))
        L.append(d.ellipse(cx, cy, r * 1.6, r * 1.1, base, op=55))
    # peeling paint: pale flakes with dark edges
    for _ in range(9 if not soot else 4):
        x, y = d.rng.uniform(0, w), d.rng.uniform(0, h)
        sz = d.rng.uniform(5, 14)
        pts = [(x + sz * math.cos(t) * d.rng.uniform(0.6, 1.2), y + sz * 0.7 * math.sin(t) * d.rng.uniform(0.6, 1.2)) for t in [k * 0.9 for k in range(7)]]
        L.append(d.poly(pts, mul(base, 0.55), op=60))
        L.append(d.poly([(px + 1.5, py - 1) for px, py in pts], (0.62, 0.6, 0.55), op=55))
    # drip marks
    L += d.streaks(w, h, 6 if not soot else 10, c=(0.25, 0.2, 0.14) if not soot else (0.05, 0.05, 0.05), op=(20, 40), top=(0.0, 0.6), length=(0.15, 0.4))
    if soot:
        L.append(d.noise(w, h, op=45, scale=10, blend="multiply", contrast=140))
    return L


def p_cornice(d, w, h):
    """a moulded plaster cornice: a cream band, an egg-and-dart run and a dark shadow line"""
    L = [d.rect(0, 0, w, h, (0.74, 0.70, 0.60)), d.noise(w, h, op=20, scale=10)]
    L.append(d.rect(0, 0, w, 8, (0.86, 0.83, 0.74)))
    L.append(d.rect(0, 8, w, 3, (0.45, 0.42, 0.36)))
    for x in range(0, w, 16):
        L.append(d.ellipse(x + 8, 26, 10, 14, (0.84, 0.80, 0.70)))
        L.append(d.ellipse(x + 8, 27, 6, 9, (0.55, 0.51, 0.44)))
        L.append(d.poly([(x + 15, 20), (x + 17, 20), (x + 16, 34)], (0.5, 0.46, 0.4)))
    L.append(d.rect(0, 40, w, 4, (0.45, 0.42, 0.36)))
    L.append(d.rect(0, 44, w, h - 44, (0.40, 0.26, 0.16), grad=d.lin(0, 44, 0, h, [(0, (0.46, 0.18, 0.12)), (1, (0.30, 0.12, 0.08))])))
    L += d.streaks(w, h, 8, c=(0.3, 0.25, 0.18), top=(0.0, 0.3), length=(0.3, 0.8), op=(20, 40))
    return L


def p_coat_tweed(d, w, h):
    """a worn winter coat's wool"""
    L = [d.rect(0, 0, w, h, (0.30, 0.24, 0.19))]
    for y in range(0, h, 6):
        L.append(d.rect(0, y, w, 2, (0.22, 0.17, 0.13), op=60))
    for x in range(0, w, 6):
        L.append(d.rect(x, 0, 2, h, (0.38, 0.31, 0.25), op=40))
    L.append(d.noise(w, h, op=30, scale=6))
    return L


def doc(w, h, layers, name, bg=(0.5, 0.5, 0.5)):
    return {"$schema": "https://jerboa.dev/schemas/fx-composition/editable/v1/document.schema.json", "formatVersion": 1,
            "dimensions": {"width": w, "height": h}, "duration": 3.0, "backgroundColor": list(bg) + [1.0],
            "composition": {"id": "main", "name": name, "layers": layers}}


def build_atlas_doc():
    d = Doc(2026)
    P = {
        "steel_flute": p_steel_flute, "steel_plain": p_steel_plain, "roof": p_roof, "under": p_under,
        "tile_white": p_tile_white, "end_cab": p_end_cab, "end_mid": p_end_mid, "door": p_door, "interior": p_interior,
        "dest_up": lambda d, w, h: p_dest(d, w, h, "UPTOWN  ·  57 ST"), "dest_dn": lambda d, w, h: p_dest(d, w, h, "DOWNTOWN  ·  WHITEHALL"),
        "side_up": lambda d, w, h: p_side(d, w, h, "Uptown"), "side_dn": lambda d, w, h: p_side(d, w, h, "Downtown"),
        "reader_screen": p_reader, "booth_sign": p_booth_sign, "fluor_tube": p_tube,
        "concrete_track": p_concrete_track, "tie_wood": p_tie, "board": p_board, "cable": p_cable, "tray": p_tray,
        "rail_side": p_rail_side, "rail_top": p_rail_top, "pipe_rust": p_pipe,
        "tactile": p_tactile, "plat_edge": p_plat_edge, "stair_tread": p_stair, "bench_wood": p_bench, "trash": p_trash,
        "turnstile_top": p_turnstile_top, "emergency_sign": p_emergency, "bluebox_face": p_bluebox,
        "ibeam_paint": p_ibeam, "column_paint": p_column, "booth_interior": p_booth_interior, "plaque_leaf": p_plaque,
        "booth_front": p_booth_front, "map_poster": p_map, "tablet_frame": p_tablet,
        "sign_uptown": lambda d, w, h: p_sign(d, w, h, "Uptown & Queens", ["N", "Q", "R", "W"], size=32),
        "sign_downtown": lambda d, w, h: p_sign(d, w, h, "Downtown & Brooklyn", ["R", "W"], size=32),
        "sign_exit": lambda d, w, h: p_sign(d, w, h, "Exit to Street", [], arrow=True),
        "sign_entrance": lambda d, w, h: p_sign(d, w, h, "Subway", ["N", "Q", "R", "W"], size=52),
        "hazard": p_hazard, "grime": p_grime,
        "fare_machine": p_fare_machine, "busker_sign": p_busker_sign, "newspaper": p_newspaper, "coat_tweed": p_coat_tweed, "vault_paint": lambda d, w, h: p_vault(d, w, h, (0.72, 0.68, 0.58), False), "vault_soot": lambda d, w, h: p_vault(d, w, h, (0.36, 0.34, 0.31), True), "cornice": p_cornice,
    }
    layers = []
    for name, (x, y, w, h) in R.items():
        if name in P:
            L = P[name](d, w, h)
        elif name.startswith("bullet_"):
            L = p_bullet(d, w, h, name[7:])
        elif name in SWATCHES:
            L = p_swatch(d, w, h, SWATCHES[name])
        elif name.startswith("ad_"):
            L = p_ad(d, w, h, name)
        else:
            L = p_glow(d, w, h, name)
        layers.append(d.group(name, x, y, w, h, L))
    layers.reverse()
    return doc(AW, AH, layers, "Subway atlas", bg=(0.12, 0.12, 0.12))


# ---- station wall: 512 px = 2 m across, 2048 px = 7.1 m up from TUNNEL.floor
SW_W, SW_H, SW_M = 512, 2048, 7.1


def build_station_wall_doc():
    d = Doc(77)
    W, H = SW_W, SW_H
    Y = lambda z: H - z / SW_M * H
    px = W / 2.0   # px per metre across
    L = [d.rect(0, 0, W, H, (0.28, 0.27, 0.25)), d.noise(W, H, op=25, scale=20)]

    def tiles(z0, z1, tw, th, base=(0.88, 0.87, 0.83), grout=(0.52, 0.50, 0.46), var=0.05):
        out = [d.rect(0, Y(z1), W, Y(z0) - Y(z1), grout)]
        rows = int(round((z1 - z0) / th))
        ty, tx = (Y(z0) - Y(z1)) / rows, tw * px
        for r in range(rows):
            off = (r % 2) * tx / 2
            y = Y(z1) + r * ty
            k = -1
            while k * tx + off < W:
                v = d.rng.uniform(1 - var, 1)
                out.append(d.rect(k * tx + off + 1.5, y + 1.5, tx - 3, ty - 3, mul(base, v), round_=1.5))
                k += 1
        return out

    L += tiles(1.1, 1.45, 0.30, 0.15, base=(0.36, 0.16, 0.10), grout=(0.2, 0.15, 0.12), var=0.12)   # glazed base course
    L.append(d.rect(0, Y(1.55), W, Y(1.45) - Y(1.55), (0.78, 0.56, 0.18)))
    L += tiles(1.55, 3.45, 0.152, 0.076)
    # mosaic trim band with a stepped meander, tiled every 0.5 m
    maroon, ochre, blue = (0.36, 0.16, 0.10), (0.80, 0.58, 0.20), (0.16, 0.30, 0.46)
    bh = Y(3.45) - Y(3.85)
    s = bh / 14
    band = [d.rect(0, 0, W, bh, (0.3, 0.26, 0.2)), d.rect(0, 0, W, bh, maroon)]
    for r in range(14):
        for c in range(64):   # 64 x 8 px = 512: tiles seamlessly
            if r in (0, 13):
                col = ochre
            elif r in (1, 12):
                col = None
            else:
                m = abs((c % 16) - 7.5) + abs(r - 6.5)
                col = ochre if 3.6 < m < 5.6 else blue if m < 2.1 else None
            if col:
                band.append(d.tess(c * 8, r * s, 8, col))
    band += [d.rect(x - 0.6, 0, 1.2, bh, (0.3, 0.26, 0.2), op=55) for x in range(0, W + 1, 8)]
    band += [d.rect(0, r * s - 0.6, W, 1.2, (0.3, 0.26, 0.2), op=55) for r in range(15)]
    L.append(d.group("trim_band", 0, Y(3.85), W, bh, band))
    L += tiles(3.85, 5.55, 0.152, 0.076)
    L.append(d.rect(0, Y(5.72), W, Y(5.55) - Y(5.72), (0.36, 0.16, 0.10)))
    L.append(d.rect(0, Y(5.75), W, 6, (0.78, 0.56, 0.18)))
    # above the tile: painted concrete up to the ceiling, soot-stained
    L.append(d.rect(0, 0, W, Y(5.75), (0.55, 0.53, 0.48)))
    L.append(d.noise(W, Y(5.75), op=30, scale=30))
    L.append(d.vfade(0, 0, W, Y(5.75), (0.1, 0.09, 0.08), 0.7, up=True))
    # leaks down the tile, dirt above the platform, the occasional missing tile
    L += d.streaks(W, H, 14, c=(0.62, 0.55, 0.42), op=(12, 30), top=(0.17, 0.25), length=(0.1, 0.45), width=(3, 16))
    L.append(d.vfade(0, Y(2.1), W, Y(1.1) - Y(2.1), (0.25, 0.2, 0.15), 0.55))
    for _ in range(5):
        L.append(d.rect(d.rng.uniform(20, W - 60), Y(d.rng.uniform(1.8, 5.2)), 37, 20, (0.42, 0.40, 0.36)))
    L.append(d.noise(W, H, op=10, scale=40))
    return doc(W, H, list(reversed(L)), "Station wall")


# ---- tunnel wall: 2048 px = 26 m along, 512 px = 6.9 m up from TUNNEL.floor
TW_W, TW_H, TW_M = 2048, 512, 6.9


def build_tunnel_wall_doc():
    d = Doc(31)
    W, H = TW_W, TW_H
    Y = lambda z: H - z / TW_M * H
    X = lambda m: m / 26.0 * W
    L = [d.rect(0, 0, W, H, (0.33, 0.31, 0.28)), d.noise(W, H, op=35, scale=18), d.noise(W, H, op=25, scale=120, seed=4)]
    for z in (1.4, 2.8, 4.2, 5.6):   # concrete pour lifts
        L.append(d.rect(0, Y(z), W, 2.5, (0.12, 0.11, 0.1), op=60))
        L.append(d.rect(0, Y(z) + 2.5, W, 1.5, (0.5, 0.48, 0.44), op=30))
    for m in range(0, 26, 3):        # formwork joints
        L.append(d.rect(X(m + 0.4), 0, 2, H, (0.12, 0.11, 0.1), op=40))
    # soot from a century of trains: dark toward the roof
    L.append(d.vfade(0, 0, W, Y(3.0), (0.1, 0.09, 0.08), 0.8, up=True))
    L.append(d.vfade(0, Y(0.6), W, Y(0) - Y(0.6), (0.1, 0.08, 0.06), 0.85))
    L += d.streaks(W, H, 40, c=(0.25, 0.22, 0.18), op=(25, 45), top=(0.0, 0.3), length=(0.3, 0.9), width=(4, 30))
    L += d.streaks(W, H, 16, c=(0.75, 0.42, 0.22), op=(25, 45), top=(0.15, 0.45), length=(0.15, 0.5), width=(3, 10))
    L += d.streaks(W, H, 8, c=(0.35, 0.34, 0.30), op=(10, 25), top=(0.3, 0.6), length=(0.1, 0.3), width=(10, 40), light=True)   # efflorescence
    # sparse invented graffiti
    tags = [("ZEPH", (0.85, 0.2, 0.2), 3.0), ("OKAY", (0.95, 0.85, 0.2), 10.5), ("RAT KING", (0.85, 0.85, 0.85), 17.0), ("LEAF", (0.3, 0.75, 0.95), 22.5)]
    for word, c, m in tags:
        z = d.rng.uniform(1.6, 2.6)
        L.append(d.text(X(m), Y(z), word, d.rng.uniform(60, 85), c, font=("Impact", "Regular"), just="left",
                        rot=d.rng.uniform(-6, 6), stroke=((0.05, 0.05, 0.05), 6), op=d.rng.uniform(70, 88)))
        L.append(d.line([(X(m) + 10, Y(z) + 8), (X(m) + 120, Y(z) + 4)], c, 3, op=60))
    # painted markers: a white chainage stencil and a refuge-niche stripe
    L.append(d.rect(X(7.0), Y(2.2), 70, 36, (0.85, 0.85, 0.8), op=85))
    L.append(d.text(X(7.0) + 35, Y(2.2) + 28, "E 214", 22, BLACK))
    L.append(d.rect(X(14.0), Y(2.4), 18, Y(0.4) - Y(2.4), (0.85, 0.85, 0.8), op=70))
    L.append(d.rect(X(14.0) + 26, Y(2.4), 18, Y(0.4) - Y(2.4), (0.85, 0.85, 0.8), op=70))
    return doc(W, H, list(reversed(L)), "Tunnel wall")


def build_floor_doc():
    d = Doc(5)
    W = H = 512
    L = [d.rect(0, 0, W, H, (0.47, 0.46, 0.43)), d.noise(W, H, op=30, scale=22), d.noise(W, H, op=25, scale=110, seed=8)]
    L.append(d.rect(0, 255, W, 2.5, (0.2, 0.19, 0.18)))
    L.append(d.rect(255, 0, 2.5, H, (0.2, 0.19, 0.18)))
    L += d.spots(W, H, 220, (0.12, 0.11, 0.1), size=(3, 7), op=(40, 80))      # chewing gum
    L += d.spots(W, H, 25, (0.22, 0.2, 0.17), size=(20, 70), op=(15, 30))     # stains
    L += d.spots(W, H, 15, (0.65, 0.63, 0.58), size=(10, 40), op=(10, 20))
    return doc(W, H, list(reversed(L)), "Platform floor")


DOCS = {"Atlas": build_atlas_doc, "StationWall": build_station_wall_doc, "TunnelWall": build_tunnel_wall_doc, "Floor": build_floor_doc}

if __name__ == "__main__":
    for k, f in DOCS.items():
        s = json.dumps(f())
        print(k, len(s))
