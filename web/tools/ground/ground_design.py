"""Far From the Tree - street surface textures, authored as editable Tesseract compositions.

Imported by build_ground.py (system Python, no dependencies). Every texture is a set of
.tsrct compositions, one per PANEL (channel) of the same design:

    albedo, height, roughness [, alpha]      -> src/<Name>/<channel>.tsrct

Each panel is drawn from the same feature list (slabs, joints, cracks, gum, stains, leaves...)
so the channels line up exactly. post.mjs splits the panels, makes them seamless (the panels
are drawn M px larger than the tile and every feature is drawn with wrapped copies, so the
overlap cross-fade only touches the noise), turns height into a normal map and packs
roughness/alpha. Edit the .tsrct in Tesseract or edit this file and rebuild.

World scale of each tile (used by src/render/groundArt.ts):
    walk_a, walk_b   6 m x 6 m   (4 x 4 NYC flags of 1.5 m)
    road_a           8 m         road_b 11 m (blended by a macro mask, different periods)
    lawn_a           5 m         lawn_b (leaf litter) 4 m
    strips           4 m along u; rows: kerb face | kerb cap | gutter | hex pavers
    paint            3 m along u (worn thermoplastic line)
    decals           4 x 4 atlas of 256 px cells (manholes, plates, grates, pads, text...)
    macro            64 m (wet / grime / leaf drift masks)
"""
import json, math, random

S = 1024          # tile size in px
M = 128           # overlap margin for seamless cross-fade


# ---------------------------------------------------------------------------------- Tesseract doc

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

    def rect(self, x, y, w, h, c, op=100, blend="normal", effects=None, name=None, grad=None, rot=0.0):
        r = {"size": [w, h], "fillColor": self.col(c), "roundness": 0.0}
        if grad:
            r["fillPaint"] = grad
        return {"type": "Rect", "id": self.lid(), "name": name or "rect", "blendMode": blend, "activeRange": self.AR,
                "transform": self.tf(x, y, rot, op), "rect": r, "effects": effects or []}

    def _fill(self, c, op=100, grad=None):
        paint = grad or {"type": "solid", "color": self.col(c)}
        return [{"paint": paint, "fillRule": "nonZeroWinding", "blendMode": "normal", "opacity": op / 100.0}]

    def ellipse(self, cx, cy, w, h, c, op=100, blend="normal", name=None, grad=None, effects=None, rot=0.0):
        return {"type": "Shape", "id": self.lid(), "name": name or "ellipse", "blendMode": blend, "activeRange": self.AR,
                "transform": self.tf(cx, cy, rot), "effects": effects or [],
                "shape": {"path": {"commands": []}, "ellipse": {"size": [w, h]}, "fills": self._fill(c, op, grad)}}

    def poly(self, pts, c, op=100, blend="normal", name=None, smooth=False, stroke=None, effects=None, closed=True):
        cmds = [{"type": "moveTo", "x": pts[0][0], "y": pts[0][1]}]
        if smooth and len(pts) > 2:
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
            sc, sw = stroke[0], stroke[1]
            sop = stroke[2] if len(stroke) > 2 else 100
            shape["strokes"] = [{"paint": {"type": "solid", "color": self.col(sc)}, "width": sw, "cap": "round",
                                 "join": "round", "miterLimit": 4, "blendMode": "normal", "opacity": sop / 100.0}]
        return {"type": "Shape", "id": self.lid(), "name": name or "poly", "blendMode": blend, "activeRange": self.AR,
                "transform": self.tf(0, 0), "shape": shape, "effects": effects or []}

    def line(self, pts, c, width, op=100, blend="normal", name=None, effects=None):
        return self.poly(pts, None, name=name or "line", stroke=(c, width, op), closed=False, blend=blend, effects=effects)

    def group(self, name, x, y, w, h, layers, effects=None):
        return {"type": "Group", "id": self.lid(), "name": name, "blendMode": "normal",
                "playback": {"type": "windowed", "inputRange": dict(self.AR),
                             "mapping": {"type": "linear", "input": dict(self.AR), "output": dict(self.AR)}, "inputOffsetMs": 0},
                "transform": self.tf(x, y), "layers": list(reversed(layers)), "effects": effects or [],
                "masks": [{"id": self.lid(), "mode": "add", "opacity": 100, "path": {"commands": [
                    {"type": "moveTo", "x": 0, "y": 0}, {"type": "lineTo", "x": w, "y": 0}, {"type": "lineTo", "x": w, "y": h},
                    {"type": "lineTo", "x": 0, "y": h}, {"type": "close"}]}}]}

    def lin(self, x0, y0, x1, y1, stops):
        return {"type": "gradient", "gradientType": "linear", "start": [x0, y0], "end": [x1, y1],
                "stops": [{"offset": o, "color": self.col(c)} for o, c in stops]}

    def rad(self, cx, cy, r, stops):
        return {"type": "gradient", "gradientType": "radial", "start": [cx, cy], "end": [cx + r, cy],
                "stops": [{"offset": o, "color": self.col(c)} for o, c in stops]}

    # effects -------------------------------------------------------------------------------
    def noise(self, x, y, w, h, op=20, scale=40, blend="overlay", kind="cloudy", seed=0.0, contrast=120, bright=0, cx=4):
        return self.rect(x, y, w, h, (0.5,), op=op, blend=blend, name="noise",
                         effects=[self.fx({"type": "turbulentNoise", "scale": scale, "fractalType": kind, "evolution": seed,
                                           "contrast": contrast, "brightness": bright, "complexity": cx})])

    def grain(self, amount=5, size=1.0):
        return [self.fx({"type": "grain", "amount": amount, "size": size, "softness": 0.3}),
                self.fx({"type": "hueSaturation", "hue": 0, "saturation": -100, "lightness": 0})]

    def blur(self, b):
        return [self.fx({"type": "gaussianBlur", "blurriness": b})]


def mul(c, k):
    return tuple(max(0.0, min(1.0, v * k)) for v in c)


def mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


# ---------------------------------------------------------------------------------- feature model
#
# A feature is fn(d, ch, dx, dy) -> [layers] for channel ch in "ahrm" (albedo, height, rough, mask),
# plus a bbox in tile space. Features are drawn at every periodic copy that touches the panel.

class Tex:
    def __init__(self, name, seed, w=S, h=S, wrap_x=True, wrap_y=True, channels="ahr", margin=M, bg=None):
        self.name, self.d = name, Doc(seed)
        self.rng = self.d.rng
        self.w, self.h = w, h
        self.wrap_x, self.wrap_y = wrap_x, wrap_y
        self.mx = margin if wrap_x else 0
        self.my = margin if wrap_y else 0
        self.pw, self.ph = w + self.mx, h + self.my
        self.channels = channels
        self.bg = bg or {}
        self.feats = []      # (fn, bbox)
        self.post = {}       # ch -> (grain amount, overlay opacity)

    def add(self, fn, bbox):
        self.feats.append((fn, bbox))

    def copies(self, bbox):
        x0, y0, x1, y1 = bbox
        xs = [-1, 0, 1] if self.wrap_x else [0]
        ys = [-1, 0, 1] if self.wrap_y else [0]
        for i in xs:
            for j in ys:
                dx, dy = i * self.w, j * self.h
                if x1 + dx >= 0 and x0 + dx <= self.pw and y1 + dy >= 0 and y0 + dy <= self.ph:
                    yield dx, dy

    def doc(self, ch):
        """One panel (channel) as its own composition: the renderer has a per-frame command budget."""
        d = self.d
        L = []
        for fn, bbox in self.feats:
            for dx, dy in self.copies(bbox):
                L += fn(d, ch, dx, dy) or []
        if ch in self.post:   # film-grain grit over the whole panel (grey, overlay)
            amount, op = self.post[ch]
            L.append(d.rect(0, 0, self.pw, self.ph, (0.5,), op=op, blend="overlay", name="grit", effects=d.grain(amount, 1.0)))
        label = {"a": "albedo", "h": "height", "r": "rough", "m": "alpha"}[ch]
        panel = d.group("%s_%s" % (self.name, label), 0, 0, self.pw, self.ph, L)
        return {"$schema": "https://jerboa.dev/schemas/fx-composition/editable/v1/document.schema.json", "formatVersion": 1,
                "dimensions": {"width": self.pw, "height": self.ph}, "duration": 3.0,
                "backgroundColor": [0.5, 0.5, 0.5, 1.0],
                "composition": {"id": "main", "name": "%s %s" % (self.name, label), "layers": [panel]}}

    def meta(self):
        return {"name": self.name, "w": self.w, "h": self.h, "mx": self.mx, "my": self.my,
                "pw": self.pw, "ph": self.ph, "channels": self.channels}


def by(ch, **kw):
    """Pick a per-channel value: by(ch, a=..., h=..., r=..., m=...)."""
    return kw.get(ch)


def fill_panel(t, a=None, h=None, r=None, m=None, noise=()):
    """Background colour per channel plus noise layers [(ch, op, scale, kind, blend, seed)]."""
    def fn(d, ch, dx, dy):
        c = by(ch, a=a, h=h, r=r, m=m)
        out = [] if c is None else [d.rect(0, 0, t.pw, t.ph, c, name="base")]
        for (nch, op, sc, kind, blend, sd) in noise:
            if nch == ch:
                out.append(d.noise(0, 0, t.pw, t.ph, op=op, scale=sc, kind=kind, blend=blend, seed=sd))
        return out
    t.feats.insert(0, (fn, (0, 0, 0, 0)))
    # the base is drawn exactly once
    t.feats[0] = (fn, None)


def _copies_patch(t):
    orig = t.copies

    def copies(bbox):
        if bbox is None:
            yield 0, 0
            return
        yield from orig(bbox)
    t.copies = copies


def crack_path(rng, x, y, n, step, wander=0.6, ang=None):
    a = rng.uniform(0, math.tau) if ang is None else ang
    pts = [(x, y)]
    for _ in range(n):
        a += rng.uniform(-wander, wander)
        x += math.cos(a) * step * rng.uniform(0.6, 1.3)
        y += math.sin(a) * step * rng.uniform(0.6, 1.3)
        pts.append((x, y))
    return pts


def bbox_of(pts, pad=4):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad)


def leaf_shape(rng, cx, cy, size, ang, kind=None, ys=1.0):
    """A fallen leaf outline: plane-tree / oak / simple lens, flattened by ys (for anisotropic rows)."""
    kind = kind or rng.choice(["lens", "lens", "plane", "oak"])
    pts = []
    if kind == "lens":
        for k in range(10):
            t = k / 10 * math.tau
            r = size * (0.5 * abs(math.sin(t)) ** 0.8 + 0.06) if True else 0
            px, py = math.cos(t) * size, math.sin(t) * size * 0.42 * (1 - 0.3 * math.cos(t))
            pts.append((px, py))
    elif kind == "plane":   # London plane: five pointed lobes, the NYC street leaf
        for k in range(15):
            t = k / 15 * math.tau
            lobe = 1.0 if k % 3 == 0 else (0.78 if k % 3 == 1 else 0.82)
            pts.append((math.cos(t) * size * lobe * 0.8, math.sin(t) * size * lobe * 0.8))
    else:                   # oak: wavy elongated
        for k in range(14):
            t = k / 14 * math.tau
            w = 0.42 + 0.12 * math.cos(t * 4)
            pts.append((math.cos(t) * size, math.sin(t) * size * w))
    ca, sa = math.cos(ang), math.sin(ang)
    out = [(cx + px * ca - py * sa, cy + (px * sa + py * ca) * ys) for px, py in pts]
    stem = [(cx - size * ca, cy - size * sa * ys), (cx - size * 1.35 * ca, cy - size * 1.35 * sa * ys)]
    return out, stem, kind


LEAF_COLS = [(0.42, 0.25, 0.11), (0.50, 0.33, 0.14), (0.36, 0.22, 0.10), (0.56, 0.40, 0.18),
             (0.30, 0.19, 0.10), (0.47, 0.20, 0.09), (0.60, 0.46, 0.24), (0.26, 0.17, 0.09)]


def add_leaf(t, cx, cy, size, ys=1.0, h_lift=0.0, wet=None, dark=1.0):
    rng = t.rng
    ang = rng.uniform(0, math.tau)
    pts, stem, kind = leaf_shape(rng, cx, cy, size, ang, ys=ys)
    c = mul(rng.choice(LEAF_COLS), dark * rng.uniform(0.85, 1.1))
    g = sum(c) / 3
    c = mix(c, (g, g, g), 0.18)   # November-dull, not October-bright
    wet = rng.random() < 0.35 if wet is None else wet
    if wet:
        c = mul(c, 0.62)
    hv = min(1.0, 0.64 + h_lift + rng.uniform(-0.04, 0.08))
    rv = 0.42 if wet else rng.uniform(0.7, 0.85)
    curl = rng.random() < 0.5

    def fn(d, ch, dx, dy, pts=pts, stem=stem, c=c):
        P = [(x + dx, y + dy) for x, y in pts]
        st = [(x + dx, y + dy) for x, y in stem]
        if ch == "a":
            out = [d.poly(P, c, smooth=True, name="leaf")]
            out.append(d.line([P[0], ((P[0][0] + P[len(P) // 2][0]) / 2, (P[0][1] + P[len(P) // 2][1]) / 2)], mul(c, 0.7), 1.2, op=70))
            out.append(d.line(st, mul(c, 0.6), 1.4))
            if curl:   # a curled leaf catches light on one half
                out.append(d.poly(P[: len(P) // 2 + 1], mul(c, 1.25), op=45, smooth=True))
            return out
        if ch == "h":
            out = [d.poly(P, (hv,), smooth=True)]
            if curl:
                out.append(d.poly(P[: len(P) // 2 + 1], (min(1, hv + 0.08),), op=70, smooth=True))
            return out
        if ch == "r":
            return [d.poly(P, (rv,), smooth=True)]
        if ch == "m":
            return [d.poly(P, (1.0,), smooth=True)]
    t.add(fn, bbox_of(pts + stem, 6))


# ---------------------------------------------------------------------------------- sidewalks

def walk(name, seed, variant):
    t = Tex(name, seed)
    _copies_patch(t)
    rng, d = t.rng, t.d
    SL = S // 4  # 256 px slab = 1.5 m
    joint = (0.27, 0.26, 0.245)
    fill_panel(t, a=joint, h=(0.18,), r=(0.95,))
    tones = []
    for j in range(4):
        for i in range(4):
            k = rng.random()
            if k < 0.15:
                base = (0.66, 0.655, 0.64)      # newer, lighter, cooler slab
            elif k < 0.38:
                base = (0.565, 0.55, 0.52)      # old, yellowed
            else:
                base = (0.61, 0.60, 0.575)
            base = mul(base, rng.uniform(0.86, 0.95))
            tilt = rng.uniform(0.0, 0.12) if rng.random() < 0.55 else 0.0   # heaved slabs catch the low sun
            ang = rng.uniform(0, math.tau)
            tones.append((base, tilt, ang, rng.uniform(0, 100), rng.uniform(0.82, 0.92)))

    patched = set() if variant == "a" else {rng.randrange(16)}
    pit = 9 if variant == "b" else -1

    for j in range(5):
        for i in range(5):
            idx = (j % 4) * 4 + (i % 4)
            base, tilt, ang, sd, rough = tones[idx]
            x0, y0, w = i * SL + 3, j * SL + 3, SL - 6
            if idx in patched or idx == pit:
                continue

            def slab(d, ch, dx, dy, x0=x0, y0=y0, w=w, base=base, tilt=tilt, ang=ang, sd=sd, rough=rough):
                if ch == "a":
                    return [d.rect(x0, y0, w, w, base, name="slab"),
                            d.noise(x0, y0, w, w, op=26, scale=30 + (sd % 30), seed=sd, blend="overlay"),
                            d.noise(x0, y0, w, w, op=10, scale=2, kind="rocky", seed=sd + 3, blend="overlay"),
                            # trowelled margin: the smooth band round each flag
                            d.poly([(x0 + 7, y0 + 7), (x0 + w - 7, y0 + 7), (x0 + w - 7, y0 + w - 7), (x0 + 7, y0 + w - 7)], None,
                                   stroke=(mul(base, 1.07), 9, 55))]
                if ch == "h":
                    cx, cy = x0 + w / 2, y0 + w / 2
                    ex, ey = math.cos(ang) * w / 2, math.sin(ang) * w / 2
                    g = d.lin(cx - ex, cy - ey, cx + ex, cy + ey, [(0, (0.56 - tilt / 2,)), (1, (0.56 + tilt / 2,))])
                    return [d.rect(x0, y0, w, w, (0.56,), grad=g, name="slab"),
                            d.noise(x0, y0, w, w, op=12, scale=2, kind="rocky", seed=sd + 7, blend="normal"),
                            d.noise(x0, y0, w, w, op=10, scale=40, seed=sd + 9, blend="normal"),
                            d.poly([(x0 + 2, y0 + 2), (x0 + w - 2, y0 + 2), (x0 + w - 2, y0 + w - 2), (x0 + 2, y0 + w - 2)], None,
                                   stroke=((0.42,), 4, 80))]
                if ch == "r":
                    return [d.rect(x0, y0, w, w, (rough,)),
                            d.poly([(x0 + 7, y0 + 7), (x0 + w - 7, y0 + 7), (x0 + w - 7, y0 + w - 7), (x0 + 7, y0 + w - 7)], None,
                                   stroke=((rough - 0.08,), 9, 70))]
            t.add(slab, (x0, y0, x0 + w, y0 + w))

    # asphalt patches where a flag broke and the city filled it in
    for idx in patched:
        i, j = idx % 4, idx // 4
        x0, y0 = i * SL, j * SL
        pts = [(x0 + 2 + rng.uniform(-3, 8), y0 + 2 + rng.uniform(-3, 8)), (x0 + SL * 0.5, y0 + rng.uniform(0, 8)),
               (x0 + SL - 2 - rng.uniform(0, 8), y0 + 2), (x0 + SL - rng.uniform(0, 10), y0 + SL * 0.5),
               (x0 + SL - 2, y0 + SL - 2 - rng.uniform(0, 8)), (x0 + SL * 0.5, y0 + SL - rng.uniform(0, 6)),
               (x0 + rng.uniform(0, 8), y0 + SL - 2), (x0 + rng.uniform(0, 6), y0 + SL * 0.5)]
        sd = rng.uniform(0, 100)

        def patch(d, ch, dx, dy, pts=pts, sd=sd, x0=x0, y0=y0):
            P = [(x + dx, y + dy) for x, y in pts]
            if ch == "a":
                return [d.poly(P, (0.36, 0.355, 0.35), name="asphalt patch"),
                        d.noise(x0 + dx, y0 + dy, SL, SL, op=40, scale=3, kind="rocky", seed=sd, blend="overlay"),
                        d.poly(P, None, stroke=((0.12,), 5, 80))]
            if ch == "h":
                return [d.poly(P, (0.47,)), d.noise(x0 + dx, y0 + dy, SL, SL, op=45, scale=3, kind="rocky", seed=sd + 1, blend="normal")]
            if ch == "r":
                return [d.poly(P, (0.9,)), d.poly(P, None, stroke=((0.45,), 5, 90))]
        t.add(patch, (x0, y0, x0 + SL, y0 + SL))

    if pit >= 0:
        # an old tree pit, filled with newer concrete (there are no street trees any more)
        i, j = pit % 4, pit // 4
        x0, y0 = i * SL + 3, j * SL + 3

        def pitf(d, ch, dx, dy, x0=x0, y0=y0):
            X, Y, w = x0 + dx, y0 + dy, SL - 6
            if ch == "a":
                return [d.rect(X, Y, w, w, (0.66, 0.655, 0.64)), d.noise(X, Y, w, w, op=20, scale=40, seed=31),
                        d.rect(X + 30, Y + 30, w - 60, w - 60, (0.58, 0.57, 0.55)),
                        d.noise(X + 30, Y + 30, w - 60, w - 60, op=35, scale=4, kind="rocky", seed=32),
                        d.poly([(X + 30, Y + 30), (X + w - 30, Y + 30), (X + w - 30, Y + w - 30), (X + 30, Y + w - 30)], None,
                               stroke=((0.22, 0.2, 0.18), 6, 90))]
            if ch == "h":
                return [d.rect(X, Y, w, w, (0.56,)), d.rect(X + 30, Y + 30, w - 60, w - 60, (0.5,)),
                        d.noise(X + 30, Y + 30, w - 60, w - 60, op=50, scale=4, kind="rocky", seed=33, blend="normal"),
                        d.poly([(X + 30, Y + 30), (X + w - 30, Y + 30), (X + w - 30, Y + w - 30), (X + 30, Y + w - 30)], None,
                               stroke=((0.3,), 6, 100))]
            if ch == "r":
                return [d.rect(X, Y, w, w, (0.86,)), d.rect(X + 30, Y + 30, w - 60, w - 60, (0.95,))]
        t.add(pitf, (x0, y0, x0 + SL, y0 + SL))

        # a little water-valve box in the next flag
        bx, by_ = 2 * SL + 150, 1 * SL + 60

        def valve(d, ch, dx, dy):
            X, Y = bx + dx, by_ + dy
            if ch == "a":
                out = [d.rect(X, Y, 34, 34, (0.26, 0.25, 0.24)), d.rect(X + 4, Y + 4, 26, 26, (0.36, 0.33, 0.30))]
                for k in range(4):
                    out.append(d.line([(X + 6, Y + 8 + k * 6), (X + 28, Y + 8 + k * 6)], (0.22,), 1.5, op=80))
                return out
            if ch == "h":
                return [d.rect(X, Y, 34, 34, (0.5,)), d.rect(X + 4, Y + 4, 26, 26, (0.6,))]
            if ch == "r":
                return [d.rect(X, Y, 34, 34, (0.45,))]
        t.add(valve, (bx, by_, bx + 34, by_ + 34))

    # cracks
    for _ in range(4 if variant == "a" else 8):
        pts = crack_path(rng, rng.uniform(0, S), rng.uniform(0, S), rng.randint(8, 16), 16)
        br = crack_path(rng, *pts[len(pts) // 2], rng.randint(3, 6), 12)
        w = rng.uniform(1.6, 2.6)

        def crack(d, ch, dx, dy, pts=pts, br=br, w=w):
            P = [(x + dx, y + dy) for x, y in pts]
            B = [(x + dx, y + dy) for x, y in br]
            c = by(ch, a=(0.16, 0.15, 0.14), h=(0.22,), r=(0.97,))
            out = [d.line(P, c, w, op=85), d.line(B, c, w * 0.7, op=75)]
            if ch == "a":   # spalled lighter lip along the crack
                out.insert(0, d.line(P, (0.72, 0.71, 0.69), w * 3, op=25))
            return out
        t.add(crack, bbox_of(pts + br, 8))

    # chipped corners where slabs meet
    for _ in range(10):
        cx, cy = rng.randrange(4) * SL + rng.uniform(-6, 6), rng.randrange(4) * SL + rng.uniform(-6, 6)
        pts = [(cx + math.cos(a) * r, cy + math.sin(a) * r) for a, r in
               [(k / 7 * math.tau, rng.uniform(5, 18)) for k in range(7)]]

        def chip(d, ch, dx, dy, pts=pts):
            P = [(x + dx, y + dy) for x, y in pts]
            return [d.poly(P, by(ch, a=(0.40, 0.39, 0.37), h=(0.3,), r=(0.95,)), op=90)]
        t.add(chip, bbox_of(pts))

    # stains: coffee, oil, rust, something best not thought about
    for _ in range(14 if variant == "a" else 20):
        cx, cy = rng.uniform(0, S), rng.uniform(0, S)
        w, h = rng.uniform(30, 180), rng.uniform(20, 120)
        kind = rng.choice(["coffee", "oil", "oil", "rust", "damp", "damp"])
        c = {"coffee": (0.33, 0.25, 0.16), "oil": (0.13, 0.13, 0.13), "rust": (0.52, 0.30, 0.15), "damp": (0.30, 0.30, 0.30)}[kind]
        op = {"coffee": 22, "oil": 26, "rust": 18, "damp": 22}[kind]
        rv = {"coffee": 0.7, "oil": 0.45, "rust": 0.85, "damp": 0.55}[kind]
        rot = rng.uniform(0, 180)
        bl = rng.uniform(8, 16)

        def stain(d, ch, dx, dy, cx=cx, cy=cy, w=w, h=h, c=c, op=op, rv=rv, rot=rot, bl=bl):
            if ch == "a":
                return [d.ellipse(cx + dx, cy + dy, w, h, c, op=op, rot=rot, effects=d.blur(bl))]
            if ch == "r":
                return [d.ellipse(cx + dx, cy + dy, w, h, (rv,), op=35, rot=rot, effects=d.blur(bl))]
        t.add(stain, (cx - w, cy - w, cx + w, cy + w))

    # chewing gum: the black polka dots of every New York pavement
    for _ in range(110 if variant == "a" else 150):
        cx, cy = rng.uniform(0, S), rng.uniform(0, S)
        w = rng.uniform(4, 11)
        g = rng.uniform(0.14, 0.34) if rng.random() < 0.8 else rng.uniform(0.45, 0.6)

        def gum(d, ch, dx, dy, cx=cx, cy=cy, w=w, g=g):
            return [d.ellipse(cx + dx, cy + dy, w, w * 0.85, by(ch, a=(g, g * 0.98, g * 0.95), h=(0.62,), r=(0.5,)), op=88)]
        t.add(gum, (cx - w, cy - w, cx + w, cy + w))

    # a few fallen leaves blown into the joints
    for _ in range(6):
        jx = rng.randrange(4) * SL
        add_leaf(t, jx + rng.uniform(-6, 6), rng.uniform(0, S), rng.uniform(14, 24))
    for _ in range(3):
        add_leaf(t, rng.uniform(0, S), rng.uniform(0, S), rng.uniform(14, 22))

    t.post = {"a": (4, 70), "h": (6, 70)}
    return t


# ---------------------------------------------------------------------------------- asphalt

def road(name, seed, variant):
    t = Tex(name, seed)
    _copies_patch(t)
    rng, d = t.rng, t.d
    base = (0.335, 0.33, 0.325) if variant == "a" else (0.31, 0.305, 0.30)
    fill_panel(t, a=base, h=(0.5,), r=(0.86,), noise=[
        ("a", 30, 160, "cloudy", "overlay", 3), ("a", 8, 2, "rocky", "overlay", 4), ("a", 18, 26, "cloudy", "overlay", 5),
        ("h", 18, 2, "rocky", "normal", 6), ("h", 14, 40, "cloudy", "normal", 7),
        ("r", 25, 30, "cloudy", "normal", 8)])

    if variant == "b":
        # utility cuts: Con Ed and DEP trench patches, newer darker asphalt with tar-sealed edges
        for _ in range(4):
            w, h = rng.uniform(90, 380), rng.uniform(60, 220)
            x, y = rng.uniform(0, S), rng.uniform(0, S)
            rot = rng.choice([0, 0, 90, rng.uniform(-6, 6)])
            sd = rng.uniform(0, 99)
            dark = rng.uniform(0.62, 0.8)

            def cut(d, ch, dx, dy, x=x, y=y, w=w, h=h, rot=rot, sd=sd, dark=dark):
                X, Y = x + dx, y + dy
                pts = [(X, Y), (X + w, Y), (X + w, Y + h), (X, Y + h)]
                if rot:
                    c, s = math.cos(math.radians(rot)), math.sin(math.radians(rot))
                    pts = [(X + (px - X) * c - (py - Y) * s, Y + (px - X) * s + (py - Y) * c) for px, py in pts]
                if ch == "a":
                    return [d.poly(pts, mul(base, dark)), d.poly(pts, None, stroke=((0.08,), 7, 92))]
                if ch == "h":
                    return [d.poly(pts, (0.47,)), d.poly(pts, None, stroke=((0.58,), 7, 90))]
                if ch == "r":
                    return [d.poly(pts, (0.8,)), d.poly(pts, None, stroke=((0.32,), 7, 95))]
            t.add(cut, (x - 400, y - 400, x + 400, y + 400))

        # alligator cracking in a wheel path
        ax, ay = rng.uniform(100, 900), rng.uniform(100, 900)
        for _ in range(26):
            pts = crack_path(rng, ax + rng.uniform(-110, 110), ay + rng.uniform(-60, 60), 4, 14, wander=1.4)

            def ac(d, ch, dx, dy, pts=pts):
                return [d.line([(x + dx, y + dy) for x, y in pts], by(ch, a=(0.12,), h=(0.3,), r=(0.95,)), 1.6, op=80)]
            t.add(ac, bbox_of(pts))

        # a filled pothole
        cx, cy = rng.uniform(0, S), rng.uniform(0, S)
        pts = [(cx + math.cos(k / 9 * math.tau) * rng.uniform(26, 50), cy + math.sin(k / 9 * math.tau) * rng.uniform(22, 44)) for k in range(9)]

        def hole(d, ch, dx, dy, pts=pts):
            P = [(x + dx, y + dy) for x, y in pts]
            return [d.poly(P, by(ch, a=(0.19, 0.19, 0.2), h=(0.44,), r=(0.7,)), smooth=True)]
        t.add(hole, bbox_of(pts))

    # sealed cracks: glossy black tar squiggles, the NYC road signature
    for _ in range(3 if variant == "a" else 5):
        pts = crack_path(rng, rng.uniform(0, S), rng.uniform(0, S), rng.randint(10, 22), 22, wander=0.22,
                         ang=rng.choice([0, math.pi / 2, math.pi / 2, rng.uniform(0, math.tau)]))
        w = rng.uniform(4, 7)

        def tar(d, ch, dx, dy, pts=pts, w=w):
            P = [(x + dx, y + dy) for x, y in pts]
            return [d.line(P, by(ch, a=(0.09, 0.09, 0.095), h=(0.58,), r=(0.32,)), w, op=78)]
        t.add(tar, bbox_of(pts, 14))

    # hairline cracks
    for _ in range(8):
        pts = crack_path(rng, rng.uniform(0, S), rng.uniform(0, S), rng.randint(6, 14), 14)

        def hl(d, ch, dx, dy, pts=pts):
            return [d.line([(x + dx, y + dy) for x, y in pts], by(ch, a=(0.14,), h=(0.32,), r=(0.95,)), 1.5, op=70)]
        t.add(hl, bbox_of(pts))

    # the odd ravelled spot (loose aggregate) and gum
    for _ in range(10):
        cx, cy, w = rng.uniform(0, S), rng.uniform(0, S), rng.uniform(20, 60)

        def rav(d, ch, dx, dy, cx=cx, cy=cy, w=w):
            if ch == "a":
                return [d.ellipse(cx + dx, cy + dy, w, w * 0.7, (0.45, 0.44, 0.42), op=25, effects=d.blur(6))]
            if ch == "h":
                return [d.ellipse(cx + dx, cy + dy, w, w * 0.7, (0.44,), op=50, effects=d.blur(4))]
        t.add(rav, (cx - w, cy - w, cx + w, cy + w))
    for _ in range(25):
        cx, cy, w = rng.uniform(0, S), rng.uniform(0, S), rng.uniform(3, 7)

        def gum(d, ch, dx, dy, cx=cx, cy=cy, w=w):
            return [d.ellipse(cx + dx, cy + dy, w, w, by(ch, a=(0.16,), h=(0.56,), r=(0.55,)), op=80)]
        t.add(gum, (cx - w, cy - w, cx + w, cy + w))

    t.post = {"a": (10, 95), "h": (16, 100)}
    return t


# ---------------------------------------------------------------------------------- lawns

def lawn(name, seed, variant):
    t = Tex(name, seed)
    _copies_patch(t)
    rng, d = t.rng, t.d
    if variant == "a":
        # tired November turf: olive, straw and mud
        fill_panel(t, a=(0.40, 0.40, 0.24), h=(0.5,), r=(0.95,), noise=[
            ("a", 50, 3, "turbulentSharp", "overlay", 1), ("a", 34, 70, "cloudy", "overlay", 2), ("a", 26, 12, "cloudy", "overlay", 3),
            ("h", 70, 3, "turbulentSharp", "normal", 4), ("h", 20, 40, "cloudy", "normal", 5)])
        # straw-coloured dead patches and greener tufts
        for _ in range(26):
            cx, cy, w = rng.uniform(0, S), rng.uniform(0, S), rng.uniform(60, 240)
            c = rng.choice([(0.56, 0.51, 0.33), (0.30, 0.37, 0.18), (0.49, 0.45, 0.28)])

            def patch(d, ch, dx, dy, cx=cx, cy=cy, w=w, c=c):
                if ch == "a":
                    return [d.ellipse(cx + dx, cy + dy, w, w * 0.7, c, op=40, effects=d.blur(22))]
            t.add(patch, (cx - w, cy - w, cx + w, cy + w))
        # worn mud where people cut the corner
        for _ in range(5):
            cx, cy = rng.uniform(0, S), rng.uniform(0, S)
            pts = [(cx + math.cos(k / 10 * math.tau) * rng.uniform(30, 90), cy + math.sin(k / 10 * math.tau) * rng.uniform(20, 60)) for k in range(10)]

            def mud(d, ch, dx, dy, pts=pts):
                P = [(x + dx, y + dy) for x, y in pts]
                if ch == "a":
                    return [d.poly(P, (0.34, 0.27, 0.18), op=70, smooth=True, effects=d.blur(8))]
                if ch == "h":
                    return [d.poly(P, (0.42,), op=80, smooth=True, effects=d.blur(6))]
                if ch == "r":
                    return [d.poly(P, (0.6,), op=80, smooth=True, effects=d.blur(6))]
            t.add(mud, bbox_of(pts, 20))
        # blades: short strokes of straw and green
        for _ in range(900):
            x, y = rng.uniform(0, S), rng.uniform(0, S)
            a = rng.uniform(0, math.tau)
            L = rng.uniform(5, 14)
            c = rng.choice([(0.62, 0.58, 0.38), (0.32, 0.40, 0.19), (0.47, 0.47, 0.27), (0.25, 0.30, 0.15)])
            pts = [(x, y), (x + math.cos(a) * L, y + math.sin(a) * L)]

            def blade(d, ch, dx, dy, pts=pts, c=c):
                P = [(px + dx, py + dy) for px, py in pts]
                if ch == "a":
                    return [d.line(P, c, 1.6, op=70)]
                if ch == "h":
                    return [d.line(P, (0.62,), 1.6, op=60)]
            t.add(blade, bbox_of(pts))
        for _ in range(70):
            add_leaf(t, rng.uniform(0, S), rng.uniform(0, S), rng.uniform(16, 30))
        t.post = {"a": (4, 70), "h": (10, 70)}
    else:
        # leaf litter: every other leaf in the city, raked into drifts and left
        fill_panel(t, a=(0.27, 0.2, 0.13), h=(0.35,), r=(0.8,), noise=[
            ("a", 30, 20, "cloudy", "overlay", 11), ("h", 40, 6, "rocky", "normal", 12)])
        for k in range(1100):
            add_leaf(t, rng.uniform(0, S), rng.uniform(0, S), rng.uniform(16, 34), h_lift=k / 1100 * 0.25,
                     dark=0.9 + 0.22 * k / 1100)
        t.post = {"a": (3, 70)}
    return t


# ---------------------------------------------------------------------------------- kerb / gutter / hex strips

ROWS = {"face": (0, 160), "cap": (160, 384), "gutter": (384, 768), "hex": (768, 1024)}
# metres each row covers across its v extent (u is always 4 m over 1024 px = 256 px/m)
ROW_M = {"face": 0.15, "cap": 0.3, "gutter": 0.6, "hex": 1.0}


def strips():
    t = Tex("strips", 4401, wrap_y=False, channels="ahrm")
    _copies_patch(t)
    rng, d = t.rng, t.d
    fill_panel(t, a=(0.5,), h=(0.5,), r=(0.9,), m=(1.0,))

    # --- kerb face (top = kerb top, bottom = road): concrete with a steel curb angle on top
    y0, y1 = ROWS["face"]

    def face(d, ch, dx, dy, y0=y0, y1=y1):
        W = t.pw
        if ch == "a":
            g = d.lin(0, y0, 0, y1, [(0, (0.56, 0.55, 0.53)), (0.6, (0.46, 0.45, 0.43)), (1, (0.25, 0.24, 0.23))])
            out = [d.rect(0, y0, W, y1 - y0, (0.5,), grad=g), d.noise(0, y0, W, y1 - y0, op=30, scale=4, kind="rocky", seed=21),
                   d.noise(0, y0, W, y1 - y0, op=25, scale=30, seed=22),
                   d.rect(0, y0, W, 20, (0.27, 0.25, 0.23)), d.noise(0, y0, W, 20, op=40, scale=6, seed=23),
                   d.rect(0, y0 + 17, W, 3, (0.42, 0.41, 0.4), op=70)]
            return out
        if ch == "h":
            return [d.rect(0, y0, W, y1 - y0, (0.5,)), d.noise(0, y0, W, y1 - y0, op=50, scale=4, kind="rocky", seed=24, blend="normal"),
                    d.rect(0, y0, W, 20, (0.62,)), d.rect(0, y0 + 18, W, 3, (0.35,))]
        if ch == "r":
            return [d.rect(0, y0, W, y1 - y0, (0.9,)), d.rect(0, y0, W, 20, (0.5,))]
    t.add(face, None)
    for k in range(3):   # rust runs from the steel angle
        x = rng.uniform(0, S)
        w = rng.uniform(4, 14)
        rl = rng.uniform(30, 80)

        def rust(d, ch, dx, dy, x=x, w=w, rl=rl, y0=y0, y1=y1):
            if ch == "a":
                return [d.rect(x + dx, y0 + 16, w, rl, (0.48, 0.27, 0.13), op=45, effects=d.blur(3))]
        t.add(rust, (x - 20, y0, x + 40, y1))
    for k in range(2):   # expansion joints every 2 m
        x = k * 512 + 200

        def jt(d, ch, dx, dy, x=x, y0=y0, y1=y1):
            return [d.rect(x + dx, y0, 5, y1 - y0, by(ch, a=(0.18,), h=(0.3,), r=(0.95,), m=(1.0,)))]
        t.add(jt, (x - 8, y0, x + 8, y1))
    for k in range(18):  # scuffs where tyres rub the steel
        x, w = rng.uniform(0, S), rng.uniform(20, 120)

        def sc(d, ch, dx, dy, x=x, w=w, y0=y0, y1=y1):
            if ch == "a":
                return [d.rect(x + dx, y0 + 4, w, 9, (0.55, 0.54, 0.52), op=35)]
            if ch == "r":
                return [d.rect(x + dx, y0 + 4, w, 9, (0.3,), op=80)]
        t.add(sc, (x, y0, x + w, y1))

    # --- kerb cap (v from road edge down to the flags): steel nosing then concrete
    y0, y1 = ROWS["cap"]

    def cap(d, ch, dx, dy, y0=y0, y1=y1):
        W = t.pw
        if ch == "a":
            return [d.rect(0, y0, W, y1 - y0, (0.60, 0.59, 0.57)), d.noise(0, y0, W, y1 - y0, op=28, scale=4, kind="rocky", seed=31),
                    d.noise(0, y0, W, y1 - y0, op=22, scale=40, seed=32),
                    d.rect(0, y0, W, 26, (0.30, 0.28, 0.26)), d.rect(0, y0 + 4, W, 6, (0.52, 0.51, 0.49), op=60),
                    d.rect(0, y1 - 10, W, 10, (0.28, 0.27, 0.25))]
        if ch == "h":
            return [d.rect(0, y0, W, y1 - y0, (0.55,)), d.noise(0, y0, W, y1 - y0, op=40, scale=4, kind="rocky", seed=33, blend="normal"),
                    d.rect(0, y0, W, 26, (0.6,)), d.rect(0, y1 - 10, W, 10, (0.3,))]
        if ch == "r":
            return [d.rect(0, y0, W, y1 - y0, (0.85,)), d.rect(0, y0, W, 26, (0.42,))]
    t.add(cap, None)
    for k in range(2):
        x = k * 512 + 200

        def jt2(d, ch, dx, dy, x=x, y0=y0, y1=y1):
            return [d.rect(x + dx, y0 + 26, 6, y1 - y0 - 26, by(ch, a=(0.22,), h=(0.3,), r=(0.95,), m=(1.0,)))]
        t.add(jt2, (x - 8, y0, x + 8, y1))
    for _ in range(30):
        cx, cy, w = rng.uniform(0, S), rng.uniform(y0 + 30, y1 - 10), rng.uniform(4, 9)

        def gum(d, ch, dx, dy, cx=cx, cy=cy, w=w, y0=y0, y1=y1):
            return [d.ellipse(cx + dx, cy + dy, w, w * 2.5, by(ch, a=(0.2,), h=(0.6,), r=(0.5,), m=(1.0,)), op=85)]
        t.add(gum, (cx - w, cy - 30, cx + w, cy + 30))

    # --- gutter (v from the kerb out into the road, 0.6 m over 384 px: ys = 2.5 squash)
    y0, y1 = ROWS["gutter"]
    YS = 384 / 0.6 / 256

    def gut(d, ch, dx, dy, y0=y0, y1=y1):
        W = t.pw
        if ch == "a":
            g = d.lin(0, y0, 0, y1, [(0, (0.15, 0.145, 0.14)), (0.25, (0.24, 0.235, 0.23)), (1, (0.31, 0.305, 0.30))])
            return [d.rect(0, y0, W, y1 - y0, (0.3,), grad=g), d.noise(0, y0, W, y1 - y0, op=40, scale=3, kind="rocky", seed=41),
                    d.noise(0, y0, W, y1 - y0, op=35, scale=30, seed=42)]
        if ch == "h":
            return [d.rect(0, y0, W, y1 - y0, (0.5,)), d.noise(0, y0, W, y1 - y0, op=50, scale=3, kind="rocky", seed=43, blend="normal")]
        if ch == "r":
            g = d.lin(0, y0, 0, y1, [(0, (0.35,)), (0.35, (0.55,)), (1, (0.85,))])
            return [d.rect(0, y0, W, y1 - y0, (0.6,), grad=g), d.noise(0, y0, W, y1 - y0, op=40, scale=20, seed=44, blend="normal")]
        if ch == "m":
            g = d.lin(0, y0, 0, y1, [(0, (1.0,)), (0.62, (1.0,)), (1, (0.0,))])
            return [d.rect(0, y0, W, y1 - y0, (1.0,), grad=g), d.noise(0, y0 + 200, W, y1 - y0 - 200, op=40, scale=14, seed=45, blend="multiply")]
    t.add(gut, None)
    # sand and grit washed against the kerb, and a wet streak
    for _ in range(8):
        x, w = rng.uniform(0, S), rng.uniform(80, 300)
        h = rng.uniform(20, 70)

        def sand(d, ch, dx, dy, x=x, w=w, h=h, y0=y0, y1=y1):
            if ch == "a":
                return [d.ellipse(x + dx, y0 + 30 + dy, w, h, (0.45, 0.42, 0.37), op=35, effects=d.blur(10))]
        t.add(sand, (x - w, y0, x + w, y1))
    for _ in range(5):
        x, w = rng.uniform(0, S), rng.uniform(150, 420)
        h = rng.uniform(60, 160)

        def wet(d, ch, dx, dy, x=x, w=w, h=h, y0=y0, y1=y1):
            if ch == "a":
                return [d.ellipse(x + dx, y0 + 40 + dy, w, h, (0.10, 0.10, 0.11), op=35, effects=d.blur(16))]
            if ch == "r":
                return [d.ellipse(x + dx, y0 + 40 + dy, w, h, (0.12,), op=85, effects=d.blur(16))]
        t.add(wet, (x - w, y0, x + w, y1))
    # the other leaves, dead and brown, caught against the kerb
    for k in range(85):
        x = rng.uniform(0, S)
        y = y0 + abs(rng.gauss(0, 70)) + 12
        if y > y1 - 40:
            continue
        add_leaf(t, x, y, rng.uniform(16, 30), ys=YS, h_lift=0.1)
    # litter: cigarette butts and bottle caps
    for _ in range(14):
        x, y = rng.uniform(0, S), rng.uniform(y0 + 10, y0 + 200)
        a = rng.uniform(0, math.tau)
        L = 9
        pts = [(x, y), (x + math.cos(a) * L, y + math.sin(a) * L * YS)]

        def butt(d, ch, dx, dy, pts=pts, y0=y0, y1=y1):
            P = [(px + dx, py + dy) for px, py in pts]
            mid = ((P[0][0] * 0.6 + P[1][0] * 0.4), (P[0][1] * 0.6 + P[1][1] * 0.4))
            if ch == "a":
                return [d.line(P, (0.85, 0.83, 0.78), 3.2), d.line([P[0], mid], (0.75, 0.5, 0.25), 3.4)]
            if ch == "h":
                return [d.line(P, (0.7,), 3.2)]
        t.add(butt, bbox_of(pts))
    for _ in range(5):
        x, y = rng.uniform(0, S), rng.uniform(y0 + 10, y0 + 250)
        c = rng.choice([(0.7, 0.15, 0.1), (0.75, 0.72, 0.65), (0.15, 0.3, 0.6)])

        def capf(d, ch, dx, dy, x=x, y=y, c=c, y0=y0, y1=y1):
            return [d.ellipse(x + dx, y + dy, 7, 7 * YS, by(ch, a=c, h=(0.68,), r=(0.35,), m=(1.0,)))]
        t.add(capf, (x - 8, y - 20, x + 8, y + 20))

    # --- hexagonal asphalt pavers, the Central Park path edge (1 m over 256 px, isotropic)
    y0, y1 = ROWS["hex"]
    r = S / 48.0   # flat-topped hexes, period 3r divides the tile

    def hexbase(d, ch, dx, dy, y0=y0, y1=y1):
        return [d.rect(0, y0, t.pw, y1 - y0, by(ch, a=(0.42, 0.41, 0.38), h=(0.3,), r=(0.95,), m=(1.0,)))]
    t.add(hexbase, None)
    col = 0
    cx = 0.0
    while cx < S + 3 * r:
        cy = y0 + (r * math.sqrt(3) / 2 if col % 2 else 0) - r
        while cy < y1 + r:
            tone = rng.uniform(0.82, 1.12)
            missing = rng.random() < 0.025
            pts = [(cx + math.cos(k * math.pi / 3) * (r - 2.2), cy + math.sin(k * math.pi / 3) * (r - 2.2)) for k in range(6)]
            tilt = rng.uniform(-0.05, 0.05)

            def hx(d, ch, dx, dy, pts=pts, tone=tone, missing=missing, tilt=tilt, y0=y0, y1=y1):
                P = [(x + dx, max(y0, min(y1, y))) for x, y in pts]
                if missing:
                    return [d.poly(P, by(ch, a=(0.2, 0.2, 0.2), h=(0.4,), r=(0.85,), m=(1.0,)))]
                return [d.poly(P, by(ch, a=mul((0.27, 0.285, 0.27), tone), h=(0.56 + tilt,), r=(0.82,), m=(1.0,)))]
            t.add(hx, bbox_of(pts))
            cy += r * math.sqrt(3)
        cx += 1.5 * r
        col += 1

    t.post = {"a": (4, 70), "h": (8, 70)}
    return t


# ---------------------------------------------------------------------------------- road paint

def paint():
    """Worn thermoplastic: rows 0..256, 3 m along u. Tinted per vertex (white / yellow / bus red)."""
    t = Tex("paint", 5501, h=256, wrap_y=False, channels="ahrm")
    _copies_patch(t)
    rng, d = t.rng, t.d
    fill_panel(t, a=(0.93, 0.925, 0.9), h=(0.62,), r=(0.62,), m=(1.0,), noise=[
        ("a", 30, 30, "cloudy", "multiply", 1), ("a", 25, 3, "rocky", "overlay", 2),
        ("h", 40, 3, "rocky", "normal", 3),
        # wear: the alpha panel's noise is thresholded in post.mjs into worn-through holes
        ("m", 100, 22, "cloudy", "normal", 4)])
    # tyre-blackened streaks across the line
    for _ in range(12):
        x, w = rng.uniform(0, S), rng.uniform(20, 90)

        def tyre(d, ch, dx, dy, x=x, w=w):
            if ch == "a":
                return [d.rect(x + dx, 0, w, t.ph, (0.35, 0.34, 0.33), op=22, effects=d.blur(8))]
            if ch == "m":
                return [d.rect(x + dx, 0, w * 0.5, t.ph, (0.25,), op=40, effects=d.blur(8))]
        t.add(tyre, (x - 40, 0, x + w + 40, t.ph))
    # transverse cracks through the thermoplastic
    for _ in range(9):
        x = rng.uniform(0, S)
        pts = crack_path(rng, x, 0, 10, 28, wander=0.35, ang=math.pi / 2)

        def cr(d, ch, dx, dy, pts=pts):
            P = [(px + dx, py + dy) for px, py in pts]
            return [d.line(P, by(ch, a=(0.3,), h=(0.35,), r=(0.9,), m=(0.0,)), 3.0, op=90)]
        t.add(cr, bbox_of(pts))
    # ragged edges
    for side in (0, 1):
        pts = [(x * 16.0, (0 if side == 0 else t.ph) + (1 if side == 0 else -1) * abs(rng.gauss(0, 10))) for x in range(0, (t.pw // 16) + 2)]
        pts = [(-10, -20 if side == 0 else t.ph + 20)] + pts + [(t.pw + 10, -20 if side == 0 else t.ph + 20)]

        def edge(d, ch, dx, dy, pts=pts):
            if ch == "m":
                return [d.poly(pts, (0.0,))]
        t.add(edge, None)
    t.post = {"a": (3, 70)}
    return t


# ---------------------------------------------------------------------------------- decals atlas

CELLS = {  # name -> (x, y, w, h) in px
    "sewer": (0, 0, 256, 256), "coned": (256, 0, 256, 256), "valves": (512, 0, 256, 256), "oil_a": (768, 0, 256, 256),
    "plate": (0, 256, 256, 256), "cut": (256, 256, 256, 256), "oil_b": (512, 256, 256, 256), "leaves": (768, 256, 256, 256),
    "grate": (0, 512, 512, 256), "cellar": (512, 512, 256, 256), "tactile": (768, 512, 256, 256),
    "busonly": (0, 768, 512, 256), "polish": (512, 768, 256, 256), "drain": (768, 768, 256, 256),
}


def decals():
    t = Tex("decals", 6601, wrap_x=False, wrap_y=False, channels="ahrm")
    _copies_patch(t)
    rng, d = t.rng, t.d
    fill_panel(t, a=(0.3,), h=(0.5,), r=(0.8,), m=(0.0,))
    iron = (0.21, 0.20, 0.19)
    worn = (0.40, 0.39, 0.37)

    def cell(name):
        return CELLS[name]

    def add(fn):
        t.add(fn, None)

    # --- round covers: sewer (waffle) and Con Ed (radial)
    for name, style in (("sewer", "waffle"), ("coned", "radial")):
        x, y, w, h = cell(name)
        cx, cy, R = x + 128, y + 128, 104

        def cover(d, ch, dx, dy, cx=cx, cy=cy, R=R, style=style, x=x, y=y, w=w, h=h):
            out = []
            # tar-sealed asphalt collar (alpha fades out)
            out.append(d.ellipse(cx, cy, 2 * R + 34, 2 * R + 34, by(ch, a=(0.12, 0.12, 0.12), h=(0.48,), r=(0.4,), m=(0.75,)),
                                 effects=d.blur(5)))
            out.append(d.ellipse(cx, cy, 2 * R + 8, 2 * R + 8, by(ch, a=(0.17, 0.165, 0.16), h=(0.45,), r=(0.5,), m=(1.0,))))
            out.append(d.ellipse(cx, cy, 2 * R, 2 * R, by(ch, a=iron, h=(0.55,), r=(0.55,), m=(1.0,))))
            if style == "waffle":
                s = 13
                for gx in range(-8, 9):
                    for gy in range(-8, 9):
                        px, py = cx + gx * s, cy + gy * s
                        if math.hypot(px - cx, py - cy) < R - 18 and math.hypot(px - cx, py - cy) > 30:
                            out.append(d.rect(px - 4, py - 4, 8, 8, by(ch, a=worn, h=(0.72,), r=(0.32,), m=(1.0,))))
                out.append(d.ellipse(cx, cy, 58, 58, by(ch, a=mul(worn, 0.9), h=(0.66,), r=(0.35,), m=(1.0,))))
                # NYC SEWER lettering band, abstracted as raised bars
                for k in range(9):
                    a = k / 9 * math.pi + math.pi * 1.05
                    out.append(d.rect(cx + math.cos(a) * (R - 10) - 3, cy + math.sin(a) * (R - 10) - 3, 6, 6,
                                      by(ch, a=worn, h=(0.7,), r=(0.35,), m=(1.0,))))
            else:
                for k in range(24):
                    a = k / 24 * math.tau
                    p0 = (cx + math.cos(a) * 26, cy + math.sin(a) * 26)
                    p1 = (cx + math.cos(a) * (R - 12), cy + math.sin(a) * (R - 12))
                    out.append(d.line([p0, p1], by(ch, a=worn, h=(0.72,), r=(0.35,), m=(1.0,)), 5))
                for rr in (48, 76):
                    out.append(d.poly([(cx + math.cos(k / 48 * math.tau) * rr, cy + math.sin(k / 48 * math.tau) * rr) for k in range(48)],
                                      None, stroke=(by(ch, a=worn, h=(0.7,), r=(0.35,), m=(1.0,)), 4)))
                out.append(d.ellipse(cx, cy, 40, 40, by(ch, a=mul(worn, 0.95), h=(0.68,), r=(0.35,), m=(1.0,))))
            # outer worn rim
            out.append(d.poly([(cx + math.cos(k / 64 * math.tau) * (R - 5), cy + math.sin(k / 64 * math.tau) * (R - 5)) for k in range(64)],
                              None, stroke=(by(ch, a=(0.46, 0.45, 0.43), h=(0.68,), r=(0.28,), m=(1.0,)), 7)))
            if ch == "a":
                out.append(d.ellipse(cx, cy, 2 * R, 2 * R, (0.3, 0.2, 0.12), op=18, blend="overlay"))
            return out
        add(cover)

    # --- small valve covers (4 in one cell)
    x, y, w, h = cell("valves")
    for k in range(4):
        cx, cy = x + 64 + (k % 2) * 128, y + 64 + (k // 2) * 128

        def valve(d, ch, dx, dy, cx=cx, cy=cy, k=k, x=x, y=y, w=w, h=h):
            out = [d.ellipse(cx, cy, 104, 104, by(ch, a=(0.14,), h=(0.48,), r=(0.45,), m=(0.8,)), effects=d.blur(3))]
            if k % 2 == 0:
                out.append(d.ellipse(cx, cy, 86, 86, by(ch, a=iron, h=(0.56,), r=(0.5,), m=(1.0,))))
                out.append(d.ellipse(cx, cy, 70, 70, by(ch, a=worn, h=(0.62,), r=(0.35,), m=(1.0,)), op=60))
                out.append(d.rect(cx - 18, cy - 4, 36, 8, by(ch, a=(0.18,), h=(0.5,), r=(0.5,), m=(1.0,))))
            else:
                out.append(d.rect(cx - 40, cy - 40, 80, 80, by(ch, a=iron, h=(0.56,), r=(0.5,), m=(1.0,))))
                for j in range(5):
                    out.append(d.rect(cx - 32, cy - 30 + j * 13, 64, 6, by(ch, a=worn, h=(0.66,), r=(0.35,), m=(1.0,))))
            return out
        add(valve)

    # --- oil stains
    for name in ("oil_a", "oil_b"):
        x, y, w, h = cell(name)
        blobs = []
        if name == "oil_a":
            for _ in range(7):
                blobs.append((x + 128 + rng.gauss(0, 30), y + 128 + rng.gauss(0, 34), rng.uniform(40, 120), rng.uniform(30, 90)))
        else:   # drips along where a car sat
            for k in range(14):
                blobs.append((x + 128 + rng.gauss(0, 14), y + 30 + k * 14 + rng.uniform(-4, 4), rng.uniform(10, 34), rng.uniform(8, 26)))

        def oil(d, ch, dx, dy, blobs=blobs, name=name, x=x, y=y, w=w, h=h):
            out = []
            for (bx, b_y, bw, bh) in blobs:
                out.append(d.ellipse(bx, b_y, bw, bh, by(ch, a=(0.06, 0.06, 0.065), h=(0.5,), r=(0.22,), m=(0.55,)), op=100,
                                     effects=d.blur(9 if name == "oil_a" else 4)))
            if ch == "a":
                out.append(d.ellipse(blobs[0][0], blobs[0][1], 50, 30, (0.25, 0.2, 0.35), op=12, effects=d.blur(12)))
            return out
        add(oil)

    # --- steel road plate (diamond plate) with cold-patch ramps
    x, y, w, h = cell("plate")

    def plate(d, ch, dx, dy, x=x, y=y, w=w, h=h):
        out = [d.rect(x + 8, y + 8, 240, 240, by(ch, a=(0.13,), h=(0.46,), r=(0.5,), m=(0.85,)), effects=d.blur(4)),
               d.rect(x + 20, y + 20, 216, 216, by(ch, a=(0.27, 0.25, 0.23), h=(0.6,), r=(0.45,), m=(1.0,)))]
        for gy in range(14):
            for gx in range(14):
                px, py = x + 28 + gx * 15 + (7 if gy % 2 else 0), y + 28 + gy * 15
                if px > x + 228:
                    continue
                rot = 45 if (gx + gy) % 2 else -45
                out.append(d.rect(px, py, 9, 3, by(ch, a=(0.42, 0.41, 0.39), h=(0.74,), r=(0.3,), m=(1.0,)), rot=rot))
        if ch == "a":
            out.append(d.rect(x + 20, y + 20, 216, 216, (0.45, 0.25, 0.12), op=25, blend="overlay",
                              effects=[d.fx({"type": "turbulentNoise", "scale": 20, "fractalType": "cloudy", "evolution": 3,
                                             "contrast": 140, "complexity": 4})]))
        return out
    add(plate)

    # --- square asphalt cut
    x, y, w, h = cell("cut")

    def cut(d, ch, dx, dy, x=x, y=y, w=w, h=h):
        pts = [(x + 14, y + 18), (x + 240, y + 12), (x + 244, y + 236), (x + 18, y + 242)]
        out = [d.poly(pts, by(ch, a=(0.27, 0.27, 0.275), h=(0.47,), r=(0.82,), m=(1.0,))),
               d.poly(pts, None, stroke=(by(ch, a=(0.07,), h=(0.6,), r=(0.3,), m=(1.0,)), 9))]
        if ch == "a":
            out.append(d.noise(x + 14, y + 14, 230, 230, op=30, scale=3, kind="rocky", seed=8))
        if ch == "h":
            out.append(d.noise(x + 20, y + 20, 220, 220, op=40, scale=3, kind="rocky", seed=9, blend="normal"))
        return out
    add(cut)

    # --- leaf cluster
    x, y, w, h = cell("leaves")
    for k in range(34):
        a = rng.uniform(0, math.tau)
        rr = abs(rng.gauss(0, 50))
        add_leaf(t, x + 128 + math.cos(a) * rr, y + 128 + math.sin(a) * rr * 0.7, rng.uniform(14, 26), h_lift=k / 34 * 0.2)

    # --- subway ventilation grate (512 x 256): the leaf's updraft, in steel
    x, y, w, h = cell("grate")

    def grate(d, ch, dx, dy, x=x, y=y, w=w, h=h):
        out = [d.rect(x, y, w, h, by(ch, a=(0.25, 0.24, 0.23), h=(0.55,), r=(0.45,), m=(1.0,))),
               d.rect(x + 14, y + 14, w - 28, h - 28, by(ch, a=(0.02, 0.02, 0.02), h=(0.05,), r=(0.9,), m=(1.0,)))]
        for k in range(int((w - 28) / 9)):
            px = x + 16 + k * 9
            out.append(d.rect(px, y + 14, 4, h - 28, by(ch, a=(0.36, 0.35, 0.33), h=(0.6,), r=(0.35,), m=(1.0,))))
        for k in range(1, 4):
            out.append(d.rect(x + 14, y + k * 64 - 3, w - 28, 6, by(ch, a=(0.3, 0.29, 0.28), h=(0.58,), r=(0.4,), m=(1.0,))))
        if ch == "a":
            out.append(d.rect(x + 14, y + 14, w - 28, h - 28, (0.45, 0.25, 0.1), op=18, blend="overlay"))
        return out
    add(grate)

    # --- cellar doors: twin diamond-plate leaves
    x, y, w, h = cell("cellar")

    def cellar(d, ch, dx, dy, x=x, y=y, w=w, h=h):
        out = [d.rect(x + 6, y + 6, 244, 244, by(ch, a=(0.18,), h=(0.5,), r=(0.5,), m=(1.0,)))]
        for leafx in (x + 12, x + 130):
            out.append(d.rect(leafx, y + 12, 114, 232, by(ch, a=(0.30, 0.29, 0.27), h=(0.6,), r=(0.42,), m=(1.0,))))
            for gy in range(15):
                for gx in range(7):
                    px, py = leafx + 6 + gx * 15 + (7 if gy % 2 else 0), y + 18 + gy * 15
                    if px > leafx + 104:
                        continue
                    out.append(d.rect(px, py, 9, 3, by(ch, a=(0.46, 0.45, 0.42), h=(0.75,), r=(0.28,), m=(1.0,)),
                                      rot=45 if (gx + gy) % 2 else -45))
            out.append(d.rect(leafx + 50, y + 110, 14, 30, by(ch, a=(0.2,), h=(0.7,), r=(0.4,), m=(1.0,))))   # handle
        if ch == "a":
            out.append(d.rect(x + 6, y + 6, 244, 244, (0.25, 0.27, 0.32), op=20, blend="overlay"))  # old grey paint
        return out
    add(cellar)

    # --- tactile warning pad (cell maps to 1.5 m x 0.6 m; domes drawn 2.5:1 squashed)
    x, y, w, h = cell("tactile")

    def tactile(d, ch, dx, dy, x=x, y=y, w=w, h=h):
        out = [d.rect(x + 2, y + 2, 252, 252, by(ch, a=(0.83, 0.66, 0.12), h=(0.56,), r=(0.6,), m=(1.0,)))]
        for gy in range(10):
            for gx in range(12):
                px, py = x + 12 + gx * 20.5, y + 14 + gy * 25.5
                out.append(d.ellipse(px + 4, py + 4, 11, 15, by(ch, a=(0.9, 0.74, 0.18), h=(0.85,), r=(0.45,), m=(1.0,))))
        if ch == "a":
            out.append(d.noise(x, y, 256, 256, op=35, scale=25, seed=77, blend="multiply"))
        return out
    add(tactile)

    # --- BUS ONLY (512 x 256, u across the lane, v along it; letters stacked, ONLY far, BUS near)
    x, y, w, h = cell("busonly")
    WHITE = (0.93, 0.92, 0.89)

    def glyph(ch_, gx, gy, gw, gh, s):
        """Blocky road-stencil letters from rectangles. Returns [(x,y,w,h)]."""
        R = []
        if ch_ == "B":
            R = [(0, 0, s, gh), (0, 0, gw - s, s), (0, gh / 2 - s / 2, gw - s, s), (0, gh - s, gw - s, s),
                 (gw - s, s, s, gh / 2 - 1.5 * s), (gw - s, gh / 2 + s / 2, s, gh / 2 - 1.5 * s)]
        elif ch_ == "U":
            R = [(0, 0, s, gh), (gw - s, 0, s, gh), (0, gh - s, gw, s)]
        elif ch_ == "S":
            R = [(0, 0, gw, s), (0, 0, s, gh / 2), (0, gh / 2 - s / 2, gw, s), (gw - s, gh / 2, s, gh / 2), (0, gh - s, gw, s)]
        elif ch_ == "O":
            R = [(0, 0, gw, s), (0, gh - s, gw, s), (0, 0, s, gh), (gw - s, 0, s, gh)]
        elif ch_ == "N":
            R = [(0, 0, s, gh), (gw - s, 0, s, gh)]
        elif ch_ == "L":
            R = [(0, 0, s, gh), (0, gh - s, gw, s)]
        elif ch_ == "Y":
            R = [(0, 0, s, gh / 2), (gw - s, 0, s, gh / 2), (0, gh / 2 - s, gw, s), (gw / 2 - s / 2, gh / 2 - s, s, gh / 2 + s)]
        return [(gx + a, gy + b, c, e) for a, b, c, e in R]

    def word(text, top, gh):
        n = len(text)
        gw, gap = 84, 24
        total = n * gw + (n - 1) * gap
        x0 = x + (w - total) / 2
        out = []
        for i, c in enumerate(text):
            out += glyph(c, x0 + i * (gw + gap), top, gw, gh, 20)
        return out

    rects = word("ONLY", y + 14, 100) + word("BUS", y + 142, 100)

    def bus(d, ch, dx, dy, x=x, y=y, w=w, h=h):
        out = []
        for (rx, ry, rw, rh) in rects:
            out.append(d.rect(rx, ry, rw, rh, by(ch, a=WHITE, h=(0.64,), r=(0.6,), m=(1.0,))))
        if ch == "m":
            out.append(d.noise(x, y, w, h, op=45, scale=14, seed=91, blend="multiply"))
        return out
    add(bus)
    nx0 = x + (w - (4 * 84 + 3 * 24)) / 2 + (84 + 24) * 1   # the N in ONLY

    def ndiag(d, ch, dx, dy, x=x, y=y, w=w, h=h):
        pts = [(nx0, y + 14), (nx0 + 22, y + 14), (nx0 + 84, y + 114), (nx0 + 62, y + 114)]
        return [d.poly(pts, by(ch, a=WHITE, h=(0.64,), r=(0.6,), m=(1.0,)))]
    add(ndiag)

    # --- tyre polish: a soft dark band across v, constant along u (stretched along the lane)
    x, y, w, h = cell("polish")

    def polish(d, ch, dx, dy, x=x, y=y, w=w, h=h):
        g = d.lin(x, y, x, y + h, [(0, (0.0,)), (0.3, (0.75,)), (0.5, (1.0,)), (0.7, (0.75,)), (1, (0.0,))])
        if ch == "m":
            return [d.rect(x, y, w, h, (1,), grad=g)]
        return [d.rect(x, y, w, h, by(ch, a=(0.13, 0.13, 0.135), h=(0.5,), r=(0.38,)))]
    add(polish)

    # --- kerb storm drain (catch basin) grate
    x, y, w, h = cell("drain")

    def drain(d, ch, dx, dy, x=x, y=y, w=w, h=h):
        out = [d.rect(x + 8, y + 40, 240, 176, by(ch, a=(0.14,), h=(0.46,), r=(0.5,), m=(0.9,)), effects=d.blur(3)),
               d.rect(x + 18, y + 52, 220, 152, by(ch, a=iron, h=(0.55,), r=(0.5,), m=(1.0,)))]
        for k in range(10):
            out.append(d.rect(x + 28 + k * 21, y + 62, 10, 132, by(ch, a=(0.02,), h=(0.1,), r=(0.9,), m=(1.0,))))
        return out
    add(drain)

    t.post = {"a": (3, 70)}
    return t


# ---------------------------------------------------------------------------------- macro masks

def macro():
    """512 px = 64 m. R wet, G grime/variant, B leaf drift. Thresholds happen in the shader."""
    t = Tex("macro", 7701, w=512, h=512, margin=64, channels="ahr")
    _copies_patch(t)
    d = t.d

    def fn(d, ch, dx, dy):
        sd = {"a": 1.0, "h": 37.0, "r": 71.0}[ch]
        sc = {"a": 70, "h": 110, "r": 60}[ch]
        return [d.rect(0, 0, t.pw, t.ph, (0.5,)),
                d.noise(0, 0, t.pw, t.ph, op=100, scale=sc, kind="cloudy", seed=sd, blend="normal", contrast=150),
                d.noise(0, 0, t.pw, t.ph, op=35, scale=sc / 4, kind="cloudy", seed=sd + 5, blend="overlay")]
    t.add(fn, None)
    return t


def all_textures():
    return [walk("walk_a", 101, "a"), walk("walk_b", 202, "b"), road("road_a", 303, "a"), road("road_b", 404, "b"),
            lawn("lawn_a", 505, "a"), lawn("lawn_b", 606, "b"), strips(), paint(), decals(), macro()]


if __name__ == "__main__":
    for t in all_textures():
        for ch in t.channels:
            doc = t.doc(ch)
            print(t.name, ch, doc["dimensions"], len(doc["composition"]["layers"][0]["layers"]), "layers")
