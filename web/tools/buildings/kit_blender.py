"""
Far From the Tree - the architecture kit, modelled in code (headless Blender 5.2).

    blender -b -t 8 --factory-startup --python kit_blender.py -- <models dir> <work dir> <preview dir> [--no-previews]

Writes <models dir>/buildings_kit.glb: one object per kit piece (geometry + named material slots,
no embedded images: the game maps buildings_kit.webp onto every slot; layout from kit_layout.json).

Modelling space is the game's (three.js): +Y up. Facade pieces: +X along the wall, +Z out of the
wall, origin on the wall face (fire escapes: at the landing's floor level; brackets: at the cornice
soffit; awnings: at their top edge; blade signs: at the bracket centre). Roof and street pieces:
origin at the centre of their footprint on the ground / roof.

Material slots: atlas (painted / masonry, rough), metal (steel, a little shine), glow (emissive faces),
cutout (alpha-tested: chain-link, netting, grating, lattice), cloth (double-sided fabric).
"""
import bpy, bmesh, math, os, sys, json, random
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT, WORK, PREV = argv[0], argv[1], argv[2]
FLAGS = argv[3:]
LAYOUT = json.load(open(os.path.join(WORK, "kit_layout.json")))
RECTS = LAYOUT["rects"]
AW, AH = LAYOUT["size"]
SWATCH = set(LAYOUT["swatches"])
MATS = ["atlas", "metal", "glow", "cutout", "cloth"]
MI = {n: i for i, n in enumerate(MATS)}
rng = random.Random(11)


def V(*a):
    return Vector(a[0] if len(a) == 1 else a)


def uv_of(rect, s, t):
    x, y, w, h = RECTS[rect]
    if rect in SWATCH:
        s, t = 0.5, 0.5
    s = min(1.0, max(0.0, s))
    t = min(1.0, max(0.0, t))
    u = (x + 1 + s * (w - 2)) / AW
    v = 1 - (y + 1 + (1 - t) * (h - 2)) / AH
    return (u, v)


class Builder:
    def __init__(self):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")

    @staticmethod
    def conv(p):
        return Vector((p[0], -p[2], p[1]))

    def face(self, pts, mat, rect, st=None, out=None, smooth=False):
        pts = [V(p) for p in pts]
        if out is not None and len(pts) >= 3:
            n = (pts[1] - pts[0]).cross(pts[2] - pts[0])
            if n.length < 1e-12 and len(pts) > 3:
                n = (pts[2] - pts[0]).cross(pts[3] - pts[0])
            if n.dot(V(out)) < 0:
                pts = pts[::-1]
                if st:
                    st = st[::-1]
        vs = [self.bm.verts.new(self.conv(p)) for p in pts]
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            return None
        f.material_index = MI[mat]
        f.smooth = smooth
        st = st or [(0.5, 0.5)] * len(vs)
        for lp, (s, t) in zip(f.loops, st):
            lp[self.uv].uv = uv_of(rect, s, t)
        return f

    def quad(self, a, b, c, d, mat, rect, st=((0, 0), (1, 0), (1, 1), (0, 1)), out=None, both=False):
        self.face([a, b, c, d], mat, rect, list(st), out)
        if both and out is not None:
            self.face([a, b, c, d], mat, rect, list(st), tuple(-x for x in out))

    def tris(self):
        return sum(len(f.verts) - 2 for f in self.bm.faces)


def proj_st(p, n, lo, hi):
    ax = max(range(3), key=lambda i: abs(n[i]))
    if ax == 1:
        si, ti = 0, 2
    else:
        si, ti = (2 if ax == 0 else 0), 1
    s = (p[si] - lo[si]) / max(1e-6, hi[si] - lo[si])
    t = (p[ti] - lo[ti]) / max(1e-6, hi[ti] - lo[ti])
    if (ax == 0 and n[0] > 0) or (ax == 2 and n[2] < 0):
        s = 1 - s
    return (s, t)


def box(B, c, size, mat="atlas", rect="sw_grey", M=None, skip=(), rects=None, mats=None):
    """box centred at c (then turned by M about its centre); rects/mats per face: px nx py ny pz nz"""
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    lo, hi = (-hx, -hy, -hz), (hx, hy, hz)
    faces = {
        "px": ([(hx, -hy, -hz), (hx, hy, -hz), (hx, hy, hz), (hx, -hy, hz)], (1, 0, 0)),
        "nx": ([(-hx, -hy, -hz), (-hx, -hy, hz), (-hx, hy, hz), (-hx, hy, -hz)], (-1, 0, 0)),
        "py": ([(-hx, hy, -hz), (-hx, hy, hz), (hx, hy, hz), (hx, hy, -hz)], (0, 1, 0)),
        "ny": ([(-hx, -hy, -hz), (hx, -hy, -hz), (hx, -hy, hz), (-hx, -hy, hz)], (0, -1, 0)),
        "pz": ([(-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)], (0, 0, 1)),
        "nz": ([(-hx, -hy, -hz), (-hx, hy, -hz), (hx, hy, -hz), (hx, -hy, -hz)], (0, 0, -1)),
    }
    Mm = M or Matrix.Identity(3)
    C = V(c)
    for k, (pts, n) in faces.items():
        if k in skip:
            continue
        r = (rects or {}).get(k, rect)
        m = (mats or {}).get(k, mat)
        st = [proj_st(p, n, lo, hi) for p in pts]
        B.face([C + Mm @ V(p) for p in pts], m, r, st, out=Mm @ V(n))


def bar(B, a, b, w, mat="metal", rect="sw_black", up=(0, 1, 0)):
    """a square bar from a to b (w thick)"""
    a, b = V(a), V(b)
    d = (b - a)
    L = d.length
    d.normalize()
    upv = V(up)
    if abs(d.dot(upv)) > 0.95:
        upv = V(1, 0, 0) if abs(d.x) < 0.9 else V(0, 0, 1)
    s = d.cross(upv).normalized()
    u = s.cross(d).normalized()
    M = Matrix((s, u, d)).transposed()
    box(B, tuple((a + b) / 2), (w, w, L), mat, rect, M=M)


def frame_axes(d):
    d = d.normalized()
    up = V(0, 1, 0) if abs(d.y) < 0.9 else V(1, 0, 0)
    s = d.cross(up).normalized()
    u = s.cross(d).normalized()
    return d, s, u


def cyl(B, a, b, r, segs=8, mat="atlas", rect="sw_grey", caps=True, r2=None, smooth=True, cap_rect=None):
    a, b = V(a), V(b)
    d, s, u = frame_axes(b - a)
    r2 = r if r2 is None else r2
    ra, rb = [], []
    for i in range(segs + 1):
        ang = 2 * math.pi * i / segs
        off = s * math.cos(ang) + u * math.sin(ang)
        ra.append(a + off * r)
        rb.append(b + off * r2)
    for i in range(segs):
        st = [(i / segs, 0), (i / segs, 1), ((i + 1) / segs, 1), ((i + 1) / segs, 0)]
        mid = (ra[i] + rb[i + 1]) / 2
        outv = mid - (a + d * d.dot(mid - a))
        B.face([ra[i], rb[i], rb[i + 1], ra[i + 1]], mat, rect, st, out=outv, smooth=smooth)
    if caps:
        for ring, n, rr in ((ra, -d, r), (rb, d, r2)):
            if rr <= 1e-4:
                continue
            pts = ring[:-1]
            st = [(0.5 + 0.5 * math.cos(2 * math.pi * i / segs), 0.5 + 0.5 * math.sin(2 * math.pi * i / segs)) for i in range(segs)]
            B.face(pts, mat, cap_rect or rect, st, out=n)


def tube(B, a, b, r, rect="sw_grey", segs=6, mat="metal"):
    cyl(B, a, b, r, segs, mat, rect, caps=False)


def ring(B, y, r, h, segs=16, rect="sw_black", mat="metal"):
    cyl(B, (0, y, 0), (0, y + h, 0), r, segs, mat, rect, caps=False)


def disc(B, c, r, rect, mat="atlas", segs=12, up=True):
    c = V(c)
    pts = [c + V(math.cos(2 * math.pi * i / segs) * r, 0, math.sin(2 * math.pi * i / segs) * r) for i in range(segs)]
    st = [(0.5 + 0.5 * math.cos(2 * math.pi * i / segs), 0.5 + 0.5 * math.sin(2 * math.pi * i / segs)) for i in range(segs)]
    B.face(pts, mat, rect, st, out=(0, 1 if up else -1, 0))


def ladder(B, x0, z0, y0, y1, w=0.42, step=0.3, axis="x", rect="sw_black"):
    """two rails and rungs; the rungs run along `axis`"""
    for k in (-1, 1):
        o = (k * w / 2, 0) if axis == "x" else (0, k * w / 2)
        bar(B, (x0 + o[0], y0, z0 + o[1]), (x0 + o[0], y1, z0 + o[1]), 0.035, rect=rect)
    y = y0 + step / 2
    while y < y1:
        a = (x0 - w / 2, y, z0) if axis == "x" else (x0, y, z0 - w / 2)
        b = (x0 + w / 2, y, z0) if axis == "x" else (x0, y, z0 + w / 2)
        bar(B, a, b, 0.022, rect=rect)
        y += step


# ============================================================ roof pieces

def water_tower(lod=0):
    B = Builder()
    segs = 16 if lod == 0 else 8
    legs = [(math.cos(a) * 0.78, math.sin(a) * 0.78) for a in (math.pi / 4, 3 * math.pi / 4, 5 * math.pi / 4, 7 * math.pi / 4)]
    for x, z in legs:   # steel legs splayed slightly
        bar(B, (x * 1.12, 0, z * 1.12), (x, 2.5, z), 0.13 if lod == 0 else 0.16, rect="steel_rust")
        if lod == 0:
            box(B, (x * 1.12, 0.06, z * 1.12), (0.4, 0.12, 0.4), "metal", "steel_black")
    if lod == 0:   # cross bracing
        for i in range(4):
            (x0, z0), (x1, z1) = legs[i], legs[(i + 1) % 4]
            bar(B, (x0 * 1.1, 0.25, z0 * 1.1), (x1 * 1.02, 2.3, z1 * 1.02), 0.035, rect="steel_black")
            bar(B, (x1 * 1.1, 0.25, z1 * 1.1), (x0 * 1.02, 2.3, z0 * 1.02), 0.035, rect="steel_black")
            bar(B, (x0 * 1.06, 1.3, z0 * 1.06), (x1 * 1.06, 1.3, z1 * 1.06), 0.06, rect="steel_rust")
        # timber platform and the beams under the tank
        for k in (-0.5, 0, 0.5):
            box(B, (k, 2.55, 0), (0.14, 0.14, 2.1), "atlas", "sw_dark")
        disc(B, (0, 2.62, 0), 1.18, "grating", "cutout", 16)
        disc(B, (0, 2.62, 0), 1.18, "grating", "cutout", 16, up=False)
    # the tank: cedar staves, a little narrower at the top
    cyl(B, (0, 2.62, 0), (0, 6.2, 0), 1.0, segs, "atlas", "staves", caps=False, r2=0.95)
    if lod == 0:
        for y in (2.9, 3.5, 4.1, 4.7, 5.25, 5.8):   # iron hoops
            rr = 1.0 - (y - 2.62) / 3.58 * 0.05 + 0.012
            ring(B, y, rr, 0.045, segs, "sw_black")
    # conical roof with a finial
    cyl(B, (0, 6.2, 0), (0, 7.15, 0), 1.05, segs, "atlas", "tank_roof", caps=True, r2=0.0)
    if lod == 0:
        cyl(B, (0, 6.15, 0), (0, 6.24, 0), 1.06, segs, "atlas", "sw_dark", caps=False)
        tube(B, (0, 7.1, 0), (0, 7.4, 0), 0.03, "sw_black")
        cyl(B, (0, 7.38, 0), (0, 7.5, 0), 0.07, 6, "metal", "sw_black")
        ladder(B, 1.08, 0, 0.0, 6.4, axis="z", rect="sw_black")
        tube(B, (0.0, 0.0, 0.0), (0.0, 2.62, 0.0), 0.12, "steel_rust", 8)   # riser pipe
        cyl(B, (0.35, 6.5, 0.35), (0.35, 6.85, 0.35), 0.18, 6, "metal", "galv", r2=0.08)   # vent
    return B


def steel_tank():
    B = Builder()
    box(B, (0, 0.5, 0), (2.6, 1.0, 2.6), "metal", "steel_black")
    cyl(B, (0, 1.0, 0), (0, 5.2, 0), 1.4, 18, "metal", "galv", caps=True)
    ring(B, 3.0, 1.42, 0.05, 18, "sw_grey")
    ladder(B, 1.47, 0, 1.0, 5.4, axis="z", rect="sw_grey")
    for a in range(4):
        x, z = math.cos(a * math.pi / 2 + 0.4) * 1.0, math.sin(a * math.pi / 2 + 0.4) * 1.0
        bar(B, (x, 0, z), (x, 1.0, z), 0.1, rect="steel_black")
    return B


def bulkhead():
    """stair bulkhead 3.0 x 2.6 x 3.4 (the game scales it to fit): stucco walls, steel door on +z, tar-paper roof"""
    B = Builder()
    w, h, d = 3.0, 2.6, 3.4
    box(B, (0, h / 2, 0), (w, h, d), "atlas", "stucco", rects={"py": "tar_paper"})
    box(B, (0, h + 0.08, 0), (w + 0.2, 0.16, d + 0.2), "atlas", "sw_dark", rects={"py": "tar_paper"})
    box(B, (0.6, 1.05, d / 2 + 0.03), (0.95, 2.1, 0.06), "metal", "door_metal")
    box(B, (0.6, 2.25, d / 2 + 0.14), (0.25, 0.12, 0.25), "glow", "sw_lamp")
    cyl(B, (-0.8, h + 0.16, -0.8), (-0.8, h + 0.7, -0.8), 0.1, 6, "metal", "galv")
    return B


def elevator():
    """elevator penthouse 5 x 4.5 x 5: brick-faced with a louvre and a tar roof"""
    B = Builder()
    w, h, d = 5.0, 4.5, 5.0
    box(B, (0, h / 2, 0), (w, h, d), "atlas", "stucco", rects={"py": "tar_paper", "px": "chimney_brick"})
    box(B, (0, h + 0.1, 0), (w + 0.25, 0.2, d + 0.25), "atlas", "sw_cream", rects={"py": "tar_paper"})
    box(B, (0, h * 0.62, d / 2 + 0.04), (1.6, 1.2, 0.08), "metal", "hvac_side")
    box(B, (-1.4, h * 0.62, -d / 2 - 0.04), (1.2, 0.9, 0.08), "metal", "hvac_side")
    return B


def hatch():
    B = Builder()
    box(B, (0, 0.25, 0), (0.9, 0.5, 0.9), "metal", "galv", rects={"py": "steel_black"})
    box(B, (0, 0.54, 0), (1.0, 0.08, 1.0), "metal", "galv")
    return B


def hvac():
    """packaged rooftop unit on a steel curb"""
    B = Builder()
    box(B, (0, 0.12, 0), (4.8, 0.24, 2.0), "metal", "steel_black")
    box(B, (0, 0.24 + 0.7, 0), (4.6, 1.4, 1.8), "metal", "galv", rects={"pz": "hvac_side", "nz": "hvac_side", "py": "galv"})
    for x in (-1.3, 0.9):
        box(B, (x, 1.66, 0), (1.5, 0.04, 1.5), "metal", "hvac_top", rects={"px": "galv", "nx": "galv", "pz": "galv", "nz": "galv"})
    tube(B, (2.3, 0.6, 0.5), (3.2, 0.6, 0.5), 0.2, "galv", 8)
    box(B, (3.3, 0.35, 0.5), (0.6, 0.7, 0.6), "metal", "galv")
    return B


def condenser():
    B = Builder()
    box(B, (0, 0.05, 0), (1.1, 0.1, 1.1), "metal", "sw_dark")
    box(B, (0, 0.55, 0), (1.0, 0.9, 1.0), "metal", "hvac_side", rects={"py": "hvac_top"})
    tube(B, (0.5, 0.2, 0.2), (0.9, 0.2, 0.2), 0.03, "sw_black")
    return B


def chimney():
    B = Builder()
    box(B, (0, 1.2, 0), (0.9, 2.4, 0.7), "atlas", "chimney_brick", rects={"py": "sw_dark"})
    box(B, (0, 2.46, 0), (1.02, 0.12, 0.82), "atlas", "concrete")
    for x in (-0.2, 0.2):
        cyl(B, (x, 2.52, 0), (x, 2.95 if x < 0 else 2.85, 0), 0.13, 8, "atlas", "sw_terracotta", caps=True, r2=0.11)
    return B


def vent():
    B = Builder()
    tube(B, (0, 0, 0), (0, 0.8, 0), 0.1, "galv", 8)
    pts = [(0, 0.8 + math.sin(a) * 0.22, 0.22 - math.cos(a) * 0.22) for a in [k * math.pi / 6 for k in range(7)]]
    for a, b in zip(pts, pts[1:]):
        tube(B, a, b, 0.1, "galv", 8)
    return B


def fan():
    B = Builder()
    box(B, (0, 0.15, 0), (0.8, 0.3, 0.8), "metal", "galv")
    cyl(B, (0, 0.3, 0), (0, 0.65, 0), 0.32, 12, "metal", "galv", caps=False)
    cyl(B, (0, 0.65, 0), (0, 0.95, 0), 0.5, 12, "metal", "galv", r2=0.08)
    return B


def dish():
    B = Builder()
    tube(B, (0, 0, 0), (0, 1.0, 0), 0.03, "sw_grey")
    # a shallow dish facing south-ish and up
    segs = 12
    c = V(0, 1.05, 0.05)
    n = V(0, 0.55, 1).normalized()
    d_, s, u = frame_axes(n)
    rim = [c + (s * math.cos(2 * math.pi * i / segs) + u * math.sin(2 * math.pi * i / segs)) * 0.4 for i in range(segs)]
    back = c - n * 0.12
    for i in range(segs):
        B.face([back, rim[i], rim[(i + 1) % segs]], "atlas", "sw_white", out=tuple(n))
        B.face([back, rim[i], rim[(i + 1) % segs]], "atlas", "sw_white", out=tuple(-n))
    bar(B, tuple(c - n * 0.05), tuple(c + n * 0.45), 0.02, rect="sw_grey")
    return B


def skylight():
    B = Builder()
    box(B, (0, 0.2, 0), (2.4, 0.4, 1.6), "atlas", "sw_dark")
    pts = [(-1.15, 0.4, -0.75), (1.15, 0.4, -0.75), (1.15, 0.4, 0.75), (-1.15, 0.4, 0.75)]
    ridge = [(-0.7, 1.05, 0), (0.7, 1.05, 0)]
    B.face([pts[0], pts[1], ridge[1], ridge[0]], "metal", "skylight", [(0, 0), (1, 0), (0.8, 1), (0.2, 1)], out=(0, 1, -1))
    B.face([pts[2], pts[3], ridge[0], ridge[1]], "metal", "skylight", [(0, 0), (1, 0), (0.8, 1), (0.2, 1)], out=(0, 1, 1))
    B.face([pts[1], pts[2], ridge[1]], "metal", "skylight", [(0, 0), (1, 0), (0.5, 1)], out=(1, 1, 0))
    B.face([pts[3], pts[0], ridge[0]], "metal", "skylight", [(0, 0), (1, 0), (0.5, 1)], out=(-1, 1, 0))
    return B


def mast():
    B = Builder()
    for k in range(3):
        a = k * 2 * math.pi / 3
        x, z = math.cos(a) * 0.18, math.sin(a) * 0.18
        bar(B, (x, 0, z), (x * 0.4, 9, z * 0.4), 0.04, rect="sw_grey")
    for y in range(1, 9):
        for k in range(3):
            a0, a1 = k * 2 * math.pi / 3, (k + 1) * 2 * math.pi / 3
            f = 0.18 * (1 - y / 9 * 0.6)
            bar(B, (math.cos(a0) * f, y, math.sin(a0) * f), (math.cos(a1) * f, y, math.sin(a1) * f), 0.02, rect="sw_grey")
    for y in (4.0, 6.5):
        bar(B, (-0.6, y, 0), (0.6, y, 0), 0.03, rect="sw_grey")
        box(B, (0.6, y - 0.3, 0), (0.12, 0.6, 0.12), "atlas", "sw_white")
    box(B, (0, 9.1, 0), (0.16, 0.16, 0.16), "glow", "sw_red_lamp")
    return B


def solar():
    B = Builder()
    for x in (-1.4, 0, 1.4):
        M = Matrix.Rotation(-0.45, 3, "X")
        box(B, (x, 0.65, 0), (1.25, 0.05, 2.0), "metal", "solar", M=M, rects={"ny": "galv"})
    for z in (-0.75, 0.75):
        box(B, (0, 0.2 if z < 0 else 0.55, z), (4.2, 0.4 if z < 0 else 1.1, 0.1), "metal", "galv")
    return B


def billboard(k):
    B = Builder()
    for x in (-3.0, 3.0):
        box(B, (x, 3.0, -0.4), (0.3, 6.0, 0.3), "metal", "steel_black")
        bar(B, (x, 0.3, -2.0), (x, 5.5, -0.5), 0.12, rect="steel_black")
    box(B, (0, 8.15, 0), (9.4, 4.4, 0.25), "metal", "steel_black", rects={"pz": "billboard_%d" % k}, mats={"pz": "glow"})
    box(B, (0, 5.85, 0.5), (9.0, 0.06, 1.0), "cutout", "grating")
    for x in (-3, 0, 3):
        bar(B, (x, 5.9, 0.9), (x, 6.6, 1.6), 0.05, rect="sw_black")
        box(B, (x, 6.6, 1.6), (0.4, 0.15, 0.25), "glow", "sw_lamp")
    return B


def coop():
    B = Builder()
    for x in (-1.0, 1.0):
        for z in (-0.6, 0.6):
            bar(B, (x, 0, z), (x, 0.4, z), 0.08, rect="sw_dark")
    box(B, (0, 1.2, 0), (2.4, 1.6, 1.6), "atlas", "coop", rects={"py": "tar_paper", "ny": "plywood"})
    B.face([(-1.3, 2.0, -0.9), (1.3, 2.0, -0.9), (1.3, 2.3, 0), (-1.3, 2.3, 0)], "atlas", "tar_paper", out=(0, 1, -0.4))
    B.face([(-1.3, 2.3, 0), (1.3, 2.3, 0), (1.3, 2.0, 0.9), (-1.3, 2.0, 0.9)], "atlas", "tar_paper", out=(0, 1, 0.4))
    box(B, (0, 0.42, 0.9), (2.4, 0.04, 0.4), "atlas", "plywood")   # landing board
    return B


def laundry():
    B = Builder()
    for x in (-2, 2):
        tube(B, (x, 0, 0), (x, 2.0, 0), 0.04, "sw_grey")
        bar(B, (x, 1.9, -0.25), (x, 1.9, 0.25), 0.04, rect="sw_grey")
    for z in (-0.2, 0.2):
        bar(B, (-2, 1.9, z), (2, 1.85, z), 0.008, rect="sw_white")
    cols = 8
    x = -1.7
    for i in range(7):
        w = rng.uniform(0.35, 0.6)
        h = rng.uniform(0.5, 0.9)
        k = rng.randrange(cols)
        z = -0.2 if i % 2 else 0.2
        st = [(k / cols, 0), ((k + 1) / cols, 0), ((k + 1) / cols, 1), (k / cols, 1)]
        B.face([(x, 1.88 - h, z), (x + w, 1.88 - h, z), (x + w, 1.88, z), (x, 1.88, z)], "cloth", "cloth", st, out=(0, 0, 1))
        x += w + 0.08
        if x > 1.6:
            break
    return B


def deck():
    B = Builder()
    box(B, (0, 0.06, 0), (5.5, 0.12, 4.0), "atlas", "wood_deck")
    box(B, (0.0, 0.74, 0.2), (0.8, 0.04, 0.8), "metal", "sw_black")
    tube(B, (0.0, 0.12, 0.2), (0.0, 0.72, 0.2), 0.03, "sw_black")
    for x in (-0.8, 0.8):
        box(B, (x, 0.5, 0.25), (0.45, 0.05, 0.45), "metal", "sw_white")
        box(B, (x, 0.75, 0.48 if x < 0 else 0.48), (0.45, 0.45, 0.04), "metal", "sw_white")
        for dx in (-0.2, 0.2):
            for dz in (0.05, 0.45):
                tube(B, (x + dx, 0.12, dz), (x + dx, 0.5, dz), 0.012, "sw_black")
    for x in (-2.7, 2.7):   # string-light poles and the lights between them
        tube(B, (x, 0.12, 1.9), (x, 2.5, 1.9), 0.03, "sw_black")
    for k in range(9):
        x = -2.6 + k * 0.65
        box(B, (x, 2.35 - math.sin(k / 8 * math.pi) * 0.25, 1.9), (0.06, 0.08, 0.06), "glow", "sw_lamp")
    box(B, (2.2, 0.32, -1.4), (0.6, 0.4, 0.6), "metal", "sw_black")   # a grill
    return B


def roof_rail():
    B = Builder()
    tube(B, (-0.5, 0, 0), (-0.5, 1.07, 0), 0.025, "galv")
    bar(B, (-0.5, 1.05, 0), (0.5, 1.05, 0), 0.04, rect="galv")
    bar(B, (-0.5, 0.55, 0), (0.5, 0.55, 0), 0.03, rect="galv")
    return B


# ============================================================ facade pieces

FE_W, FE_D, FE_H = 4.6, 1.1, 3.2


def fe_landing(B):
    """grated landing, its frame, railing panels and the brackets back to the wall"""
    hw = FE_W / 2
    # grating floor (double-sided cut-out)
    B.quad((-hw, 0, 0.05), (hw, 0, 0.05), (hw, 0, FE_D), (-hw, 0, FE_D), "cutout", "grating", out=(0, 1, 0), both=True)
    bar(B, (-hw, -0.03, FE_D), (hw, -0.03, FE_D), 0.06)
    bar(B, (-hw, -0.03, 0.05), (hw, -0.03, 0.05), 0.06)
    for x in (-hw, hw):
        bar(B, (x, -0.03, 0.05), (x, -0.03, FE_D), 0.06)
    # railing: top rail, posts, a bar-panel (cut-out) on the front and both ends
    for x in (-hw, -hw / 2, 0, hw / 2, hw):
        bar(B, (x, 0, FE_D), (x, 0.98, FE_D), 0.04)
    bar(B, (-hw, 0.98, FE_D), (hw, 0.98, FE_D), 0.05)
    for x in (-hw, hw):
        bar(B, (x, 0.98, 0.05), (x, 0.98, FE_D), 0.04)
        bar(B, (x, 0, 0.05), (x, 0.98, 0.05), 0.04)
    st = ((0, 0), (8, 0), (8, 1), (0, 1))
    B.quad((-hw, 0.05, FE_D), (hw, 0.05, FE_D), (hw, 0.95, FE_D), (-hw, 0.95, FE_D), "cutout", "grating", out=(0, 0, 1), both=True)
    for x in (-hw, hw):
        B.quad((x, 0.05, 0.05), (x, 0.05, FE_D), (x, 0.95, FE_D), (x, 0.95, 0.05), "cutout", "grating", out=(1 if x > 0 else -1, 0, 0), both=True)
    for x in (-hw + 0.3, hw - 0.3):   # diagonal brackets
        bar(B, (x, -0.9, 0.02), (x, -0.05, FE_D - 0.05), 0.05)


def fe_stair(B, drop=FE_H):
    """the stair down to the landing below, in the outer half of the landing"""
    z0, z1 = 0.5, 1.02
    xa, xb = -1.55, 1.15   # top of the stair (at this landing) -> bottom (at the next landing down)
    for z in (z0, z1):
        bar(B, (xa, 0, z), (xb, -drop, z), 0.06, rect="sw_black")
    n = 11
    for k in range(1, n):
        t = k / n
        x = xa + (xb - xa) * t
        y = -drop * t
        box(B, (x, y, (z0 + z1) / 2), (0.2, 0.03, z1 - z0), "cutout", "grating")
    # handrail
    bar(B, (xa, 0.9, z1), (xb, -drop + 0.9, z1), 0.035)
    bar(B, (xb, -drop + 0.9, z1), (xb, -drop, z1), 0.035)


def fire_escape():
    B = Builder()
    fe_landing(B)
    fe_stair(B)
    return B


def fire_escape_top():
    B = Builder()
    fe_landing(B)
    fe_stair(B)
    # gooseneck ladder up over the parapet to the roof
    x, z = 1.75, 0.82
    for k in (-0.22, 0.22):
        bar(B, (x + k, 0.0, z), (x + k, 3.9, z), 0.04)
        bar(B, (x + k, 3.9, z), (x + k, 4.4, z - 0.45), 0.04)
        bar(B, (x + k, 4.4, z - 0.45), (x + k, 4.4, -0.9), 0.04)
        bar(B, (x + k, 4.4, -0.9), (x + k, 3.6, -1.1), 0.04)
    y = 0.3
    while y < 3.9:
        bar(B, (x - 0.22, y, z), (x + 0.22, y, z), 0.025)
        y += 0.3
    return B


def fire_escape_bottom():
    B = Builder()
    fe_landing(B)
    # the counterweighted drop ladder, hanging folded under the stair opening
    x, z = 1.15, 0.78
    for k in (-0.22, 0.22):
        bar(B, (x + k, 0.4, z), (x + k, -2.4, z), 0.045)
    y = -2.3
    while y < 0.3:
        bar(B, (x - 0.22, y, z), (x + 0.22, y, z), 0.025)
        y += 0.3
    bar(B, (x, 0.0, z), (x - 1.4, 0.9, z), 0.03)
    box(B, (x - 1.45, 0.9, z), (0.12, 0.3, 0.12), "metal", "sw_black")   # counterweight
    return B


def bracket():
    """a scrolled cornice bracket under the soffit: 0.16 wide, 0.6 out, 0.55 down"""
    B = Builder()
    prof = [(0.0, 0.0), (0.6, 0.0), (0.6, -0.08), (0.52, -0.1), (0.42, -0.14), (0.33, -0.2), (0.26, -0.3), (0.2, -0.42), (0.16, -0.5),
            (0.1, -0.55), (0.0, -0.55)]
    hw = 0.08
    for x, n in ((-hw, -1), (hw, 1)):
        pts = [(x, y, z) for z, y in prof]
        st = [(z / 0.6, 1 + y / 0.55) for z, y in prof]
        B.face(pts, "atlas", "sw_cream", st, out=(n, 0, 0))
    for (z0, y0), (z1, y1) in zip(prof, prof[1:]):
        dz, dy = z1 - z0, y1 - y0
        if (z0 + z1) / 2 < 0.01:
            continue
        B.face([(-hw, y0, z0), (hw, y0, z0), (hw, y1, z1), (-hw, y1, z1)], "atlas", "sw_cream", out=(0, dz, -dy))
    # an acanthus leaf on the scroll and the dentil under it
    box(B, (0, -0.12, 0.45), (0.12, 0.08, 0.1), "atlas", "sw_cream")
    return B


def awning():
    """a shop awning 1 m wide (the game stretches it to the shop): sloped canvas, cheeks, valance, steel arms"""
    B = Builder()
    hw, D, drop = 0.5, 1.25, 0.5
    top, front = (0, 0, 0.02), (0, -drop, D)
    B.quad((-hw, 0, 0.02), (hw, 0, 0.02), (hw, -drop, D), (-hw, -drop, D), "cloth", "awning", [(0, 1), (1, 1), (1, 0.22), (0, 0.22)], out=(0, 1, 0.4), both=True)
    for x in (-hw, hw):
        B.face([(x, 0, 0.02), (x, -drop, D), (x, -drop - 0.32, D)], "cloth", "awning", [(0, 1), (1, 0.22), (1, 0)], out=(x, 0, 0), )
        B.face([(x, 0, 0.02), (x, -drop, D), (x, -drop - 0.32, D)], "cloth", "awning", [(0, 1), (1, 0.22), (1, 0)], out=(-x, 0, 0))
    B.quad((-hw, -drop - 0.32, D), (hw, -drop - 0.32, D), (hw, -drop, D), (-hw, -drop, D), "cloth", "awning", [(0, 0), (1, 0), (1, 0.22), (0, 0.22)], out=(0, 0, 1), both=True)
    for x in (-hw * 0.96, hw * 0.96):
        bar(B, (x, -0.65, 0.02), (x, -drop - 0.05, D - 0.05), 0.025, rect="sw_black")
    return B


def canopy():
    """apartment-lobby canopy out to the kerb, 3.4 wide x 4.2 deep, on brass poles"""
    B = Builder()
    w, d, h = 3.4, 4.2, 0.4
    box(B, (0, 0, d / 2), (w, h, d), "cloth", "canopy", rects={"ny": "sw_dark"}, skip=("nz",))
    for x in (-1.0, 0, 1.0):
        for z in (1.0, 2.5, 3.8):
            box(B, (x, -h / 2 - 0.02, z), (0.25, 0.04, 0.25), "glow", "sw_lamp")
    for x in (-w / 2 + 0.1, w / 2 - 0.1):
        tube(B, (x, -3.3, d - 0.1), (x, -h / 2, d - 0.1), 0.045, "sw_bronze", 8)
        cyl(B, (x, -3.3, d - 0.1), (x, -3.15, d - 0.1), 0.1, 8, "metal", "sw_bronze")
    return B


def blade_sign(k):
    B = Builder()
    w, h, d = 0.12, 2.4, 1.0
    box(B, (0, 0, 0.25 + d / 2), (w, h, d), "atlas", "sw_black", rects={"px": "blade_%d" % k, "nx": "blade_%d" % k}, mats={"px": "glow", "nx": "glow"})
    for y in (h / 2 - 0.15, -h / 2 + 0.15):
        bar(B, (0, y, 0), (0, y, 0.3), 0.06, rect="sw_black")
    return B


# ============================================================ street / lot pieces

def scaffold():
    """one bay of tube-and-coupler scaffolding, 2.5 along x 2.0 tall x 1.2 out from the wall (+z)"""
    B = Builder()
    W, H, D = 2.5, 2.0, 1.2
    for x in (-W / 2, W / 2):
        for z in (0.15, D):
            tube(B, (x, 0, z), (x, H, z), 0.024, "galv")
    for z in (0.15, D):
        bar(B, (-W / 2, H - 0.05, z), (W / 2, H - 0.05, z), 0.045, rect="galv")
        bar(B, (-W / 2, 1.0, z), (W / 2, 1.0, z), 0.04, rect="galv")
    for x in (-W / 2, W / 2):
        bar(B, (x, H - 0.05, 0.15), (x, H - 0.05, D), 0.04, rect="galv")
    bar(B, (-W / 2, 0.05, D), (W / 2, H - 0.1, D), 0.035, rect="galv")   # brace
    box(B, (0, H - 0.0, (D + 0.15) / 2), (W, 0.05, D - 0.1), "atlas", "plank")
    box(B, (0, H + 0.08, D - 0.02), (W, 0.15, 0.03), "atlas", "plank")
    # debris netting on the outside
    B.quad((-W / 2, 0, D + 0.04), (W / 2, 0, D + 0.04), (W / 2, H + 0.1, D + 0.04), (-W / 2, H + 0.1, D + 0.04), "cutout", "netting", out=(0, 0, 1), both=True)
    return B


def shed():
    """a 3 m module of sidewalk shed (along x), 3.2 tall, 3 deep (+z out over the sidewalk)"""
    B = Builder()
    L, H, D = 3.0, 3.2, 3.0
    for x in (-L / 2 + 0.06, L / 2 - 0.06):
        for z in (0.3, D - 0.15):
            box(B, (x, H / 2, z), (0.1, H, 0.1), "metal", "sw_green")
    box(B, (0, H + 0.12, D / 2), (L, 0.24, D), "atlas", "shed", rects={"py": "plywood", "ny": "plywood"})
    box(B, (0, H + 0.24 + 0.5, D - 0.05), (L, 1.0, 0.06), "atlas", "shed")   # the parapet, painted
    for z in (0.6, 2.4):   # beams
        box(B, (0, H - 0.1, z), (L, 0.2, 0.12), "metal", "sw_green")
    box(B, (0, H - 0.25, D / 2), (0.15, 0.06, 1.2), "glow", "sw_lamp")
    return B


def hoarding(k):
    """2.4 m of plywood construction fence, 2.6 tall, posters on the street side (+z)"""
    B = Builder()
    W, H = 2.4, 2.6
    box(B, (0, H / 2, 0), (W, H, 0.04), "atlas", "plywood", rects={"pz": "hoarding_%d" % k})
    for x in (-W / 2 + 0.1, W / 2 - 0.1):
        box(B, (x, H / 2, -0.1), (0.09, H, 0.14), "atlas", "plywood")
    box(B, (0, 1.3, -0.1), (W, 0.09, 0.09), "atlas", "plywood")
    return B


def chainlink():
    """3 m of chain-link fence (2.4 tall) with its post at -x"""
    B = Builder()
    W, H = 3.0, 2.4
    B.quad((-W / 2, 0.05, 0), (W / 2, 0.05, 0), (W / 2, H, 0), (-W / 2, H, 0), "cutout", "chainlink", [(0, 0), (6, 0), (6, 5), (0, 5)], out=(0, 0, 1), both=True)
    tube(B, (-W / 2, 0, 0), (-W / 2, H + 0.05, 0), 0.04, "galv", 8)
    tube(B, (-W / 2, H, 0), (W / 2, H, 0), 0.025, "galv", 6)
    for k in range(-2, 3):   # a twist of barbed wire on top
        bar(B, (k * 0.6 - 0.3, H + 0.15, 0), (k * 0.6 + 0.3, H + 0.1, 0), 0.008, rect="galv")
    return B


def lattice_box(B, x0, x1, y0, y1, z0, z1, rect="lattice"):
    """a lattice girder: four cut-out faces (double-sided) and corner chords"""
    for (a, b, c, d, n) in (
        ((x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1), (0, 0, 1)),
        ((x1, y0, z0), (x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (0, 0, -1)),
        ((x1, y0, z1), (x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (1, 0, 0)),
        ((x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0), (-1, 0, 0)),
    ):
        long_ = max(abs(b[0] - a[0]), abs(b[2] - a[2]), abs(c[1] - b[1]))
        reps = max(1, round(long_ / 2.0))
        horiz = abs(c[1] - b[1]) < max(abs(b[0] - a[0]), abs(b[2] - a[2]))
        st = [(0, 0), (reps, 0), (reps, 1), (0, 1)] if horiz else [(0, 0), (1, 0), (1, reps), (0, reps)]
        B.quad(a, b, c, d, "cutout", rect, st, out=n, both=True)


def crane_mast():
    B = Builder()
    lattice_box(B, -1, 1, 0, 6, -1, 1)
    for x in (-1, 1):
        for z in (-1, 1):
            bar(B, (x, 0, z), (x, 6, z), 0.14, rect="yellow_steel")
    return B


def crane_top():
    """slewing unit, cab, A-frame, 60 m jib (+z), counter-jib with weights, trolley and hook"""
    B = Builder()
    box(B, (0, 0.6, 0), (2.4, 1.2, 2.4), "metal", "yellow_steel")
    box(B, (1.8, 0.2, 1.0), (1.6, 2.2, 2.0), "metal", "yellow_steel", rects={"px": "sw_glass", "pz": "sw_glass"})
    # A-frame peak
    for x in (-0.9, 0.9):
        bar(B, (x, 1.2, -0.9), (0, 9.0, 0), 0.16, rect="yellow_steel")
        bar(B, (x, 1.2, 0.9), (0, 9.0, 0), 0.16, rect="yellow_steel")
    box(B, (0, 9.1, 0), (0.3, 0.3, 0.3), "glow", "sw_red_lamp")
    # jib: a triangular-ish lattice, here a slim box
    lattice_box(B, -0.7, 0.7, 1.2, 2.6, 1.2, 60.0)
    for x in (-0.7, 0.7):
        bar(B, (x, 1.2, 1.2), (x, 1.2, 60), 0.12, rect="yellow_steel")
    bar(B, (0, 2.6, 1.2), (0, 2.6, 60), 0.12, rect="yellow_steel")
    bar(B, (0, 9.0, 0), (0, 2.6, 30), 0.05, rect="sw_grey")     # pendants
    bar(B, (0, 9.0, 0), (0, 2.6, -14), 0.05, rect="sw_grey")
    # counter-jib with concrete counterweights
    lattice_box(B, -0.8, 0.8, 1.2, 2.2, -16, -1.2)
    for z in (-12.5, -14.0, -15.5):
        box(B, (0, 0.6, z), (2.6, 2.4, 1.3), "atlas", "concrete")
    box(B, (0, 2.6, -8.0), (1.4, 1.2, 2.0), "metal", "yellow_steel")   # winch house
    # trolley, cable, hook block, a bundle of steel on the hook
    box(B, (0, 1.0, 34.0), (1.6, 0.5, 1.6), "metal", "yellow_steel")
    for x in (-0.15, 0.15):
        bar(B, (x, 0.8, 34.0), (x, -22.0, 34.0), 0.02, rect="sw_black")
    box(B, (0, -22.5, 34.0), (0.6, 1.0, 0.4), "metal", "yellow_steel")
    for x in (-0.6, 0.6):
        bar(B, (0, -23.0, 34.0), (x * 3, -25.5, 34.0), 0.02, rect="sw_black")
    box(B, (0, -26.0, 34.0), (6.5, 0.4, 0.5), "metal", "steel_rust")
    return B


def dumpster():
    B = Builder()
    box(B, (0, 0.8, 0), (6.0, 1.6, 2.4), "metal", "dumpster", rects={"px": "steel_rust", "nx": "steel_rust", "ny": "steel_rust"}, skip=("py",))
    box(B, (0, 0.75, 0), (5.8, 0.08, 2.2), "atlas", "plywood")   # the rubble level
    for k in range(6):
        box(B, (rng.uniform(-2.4, 2.4), 0.9 + rng.uniform(0, 0.4), rng.uniform(-0.8, 0.8)), (rng.uniform(0.5, 1.6), 0.15, rng.uniform(0.2, 0.6)),
            "atlas", rng.choice(["plywood", "concrete", "sw_grey"]), M=Matrix.Rotation(rng.uniform(-0.5, 0.5), 3, "Y"))
    return B


def toilet():
    B = Builder()
    box(B, (0, 1.15, 0), (1.15, 2.3, 1.15), "atlas", "toilet", rects={"py": "sw_white", "nx": "sw_blue", "px": "sw_blue", "nz": "sw_blue"})
    box(B, (0, 2.35, 0), (1.2, 0.1, 1.2), "atlas", "sw_white")
    return B


def booth():
    B = Builder()
    box(B, (0, 1.2, 0), (1.8, 2.4, 1.6), "atlas", "booth", rects={"py": "tar_paper", "nx": "sw_cream", "px": "sw_cream", "nz": "sw_cream"})
    box(B, (0, 2.5, 0), (2.1, 0.15, 1.9), "metal", "sw_dark")
    # the PARKING sign on a pole beside it
    tube(B, (1.3, 0, 0.6), (1.3, 3.6, 0.6), 0.05, "sw_grey")
    box(B, (1.3, 3.8, 0.6), (2.4, 1.2, 0.08), "atlas", "parking_sign", rects={"nz": "parking_sign"})
    return B


def jersey():
    B = Builder()
    L = 3.0
    prof = [(-0.3, 0), (0.3, 0), (0.28, 0.08), (0.12, 0.3), (0.08, 0.81), (-0.08, 0.81), (-0.12, 0.3), (-0.28, 0.08)]
    for x, n in ((-L / 2, -1), (L / 2, 1)):
        B.face([(x, y, z) for z, y in prof], "atlas", "concrete", [(0.5 + z, y) for z, y in prof], out=(n, 0, 0))
    for (z0, y0), (z1, y1) in zip(prof, prof[1:] + prof[:1]):
        if y0 == 0 and y1 == 0:
            continue
        B.face([(-L / 2, y0, z0), (L / 2, y0, z0), (L / 2, y1, z1), (-L / 2, y1, z1)], "atlas", "concrete", [(0, y0), (1, y0), (1, y1), (0, y1)],
               out=(0, -(z1 - z0), y1 - y0))
    return B


def wheel_stop():
    B = Builder()
    box(B, (0, 0.07, 0), (1.8, 0.14, 0.22), "atlas", "concrete", rects={"pz": "sw_yellow"})
    return B


def lot_light():
    B = Builder()
    tube(B, (0, 0, 0), (0, 7.2, 0), 0.09, "galv", 8)
    bar(B, (0, 7.0, 0), (0.9, 7.2, 0), 0.06, rect="galv")
    box(B, (1.1, 7.15, 0), (0.7, 0.18, 0.35), "metal", "galv", rects={"ny": "sw_lamp"}, mats={"ny": "glow"})
    box(B, (0, 0.3, 0), (0.4, 0.6, 0.4), "atlas", "concrete")
    return B


def pipes():
    B = Builder()
    for i in range(6):
        y = 0.3 + (0.52 if i > 2 else 0) + (0.5 if i > 4 else 0)
        z = -0.62 + (i % 3) * 0.62 + (0.31 if i > 2 else 0)
        if i == 5:
            z = 0
        cyl(B, (-3, y, z), (3, y, z), 0.3, 10, "metal", "steel_rust", cap_rect="sw_dark")
    for x in (-2, 2):
        box(B, (x, 0.08, 0), (0.15, 0.15, 2.2), "atlas", "plywood")
    return B


def pallets():
    B = Builder()
    for (x, z) in ((0, 0), (1.3, 0.1), (0.6, 1.2)):
        box(B, (x, 0.07, z), (1.2, 0.14, 1.0), "atlas", "plywood")
        box(B, (x, 0.6, z), (1.1, 0.9, 0.95), "atlas", "chimney_brick")
    return B


def excavator():
    B = Builder()
    for z in (-1.0, 1.0):
        box(B, (0, 0.45, z), (3.6, 0.9, 0.6), "metal", "sw_black")
    box(B, (0, 1.2, 0), (2.8, 0.6, 2.4), "metal", "yellow_steel")
    box(B, (-0.4, 1.9, 0), (2.4, 0.9, 2.2), "metal", "yellow_steel")
    box(B, (0.6, 2.6, 0.55), (1.0, 1.3, 1.0), "metal", "yellow_steel", rects={"px": "sw_glass", "pz": "sw_glass", "nz": "sw_glass"})
    bar(B, (1.0, 1.8, -0.4), (3.6, 4.2, -0.4), 0.35, rect="yellow_steel")
    bar(B, (3.6, 4.2, -0.4), (5.0, 1.0, -0.4), 0.28, rect="yellow_steel")
    box(B, (5.1, 0.6, -0.4), (0.8, 0.7, 1.0), "metal", "sw_dark")
    return B


def ac_unit():
    """window AC, 0.76 x 0.48 x 0.6, centred (as world/facades.ts places it), the grille facing out (+z)"""
    B = Builder()
    box(B, (0, 0, 0), (0.76, 0.48, 0.6), "atlas", "ac_side", rects={"pz": "ac_front", "py": "ac_side", "ny": "sw_dark"})
    box(B, (0, -0.27, -0.05), (0.8, 0.04, 0.5), "metal", "steel_rust")
    for x in (-0.32, 0.32):
        bar(B, (x, -0.27, 0.18), (x, -0.62, -0.3), 0.025, rect="steel_rust")
    box(B, (0, 0.27, -0.25), (0.86, 0.06, 0.12), "atlas", "plywood")   # the board that fills the sash gap
    return B


def balcony():
    """concrete balcony slab 2.8 x 1.5 (centred), bar railing, a bistro table and two chairs"""
    B = Builder()
    box(B, (0, 0, 0), (2.8, 0.14, 1.5), "atlas", "concrete")
    hw, hz = 1.38, 0.73
    for (a, b, n) in (((-hw, hz), (hw, hz), (0, 0, 1)), ((-hw, -hz), (-hw, hz), (-1, 0, 0)), ((hw, -hz), (hw, hz), (1, 0, 0))):
        B.quad((a[0], 0.07, a[1]), (b[0], 0.07, b[1]), (b[0], 0.95, b[1]), (a[0], 0.95, a[1]), "cutout", "grating", out=n, both=True)
        bar(B, (a[0], 0.97, a[1]), (b[0], 0.97, b[1]), 0.05)
    for x in (-hw, hw):
        bar(B, (x, 0.07, hz), (x, 0.97, hz), 0.04)
    box(B, (0.5, 0.75, 0.05), (0.6, 0.04, 0.6), "metal", "sw_black")
    tube(B, (0.5, 0.07, 0.05), (0.5, 0.74, 0.05), 0.025, "sw_black")
    for (x, z, r) in ((0.0, 0.15, 0.0), (1.0, 0.0, 1.57)):
        M = Matrix.Rotation(r, 3, "Y")
        box(B, (x, 0.48, z), (0.38, 0.05, 0.38), "metal", "sw_green", M=M)
        box(B, (x + (0 if r == 0 else 0.17), 0.72, z - (0.17 if r == 0 else 0)), (0.38 if r == 0 else 0.04, 0.42, 0.04 if r == 0 else 0.38), "metal", "sw_green")
    cyl(B, (-1.0, 0.07, 0.4), (-1.0, 0.4, 0.4), 0.16, 8, "atlas", "sw_terracotta", r2=0.2)   # an empty pot: it's November
    return B


BUILDERS = [
    ("water_tower", lambda: water_tower(0)), ("water_tower_far", lambda: water_tower(1)), ("steel_tank", steel_tank),
    ("bulkhead", bulkhead), ("elevator", elevator), ("hatch", hatch), ("hvac", hvac), ("condenser", condenser),
    ("chimney", chimney), ("vent", vent), ("fan", fan), ("dish", dish), ("skylight", skylight), ("mast", mast), ("solar", solar),
    ("coop", coop), ("laundry", laundry), ("deck", deck), ("roof_rail", roof_rail),
    ("fire_escape", fire_escape), ("fire_escape_top", fire_escape_top), ("fire_escape_bottom", fire_escape_bottom),
    ("bracket", bracket), ("awning", awning), ("canopy", canopy),
    ("scaffold", scaffold), ("shed", shed), ("chainlink", chainlink), ("crane_mast", crane_mast), ("crane_top", crane_top),
    ("dumpster", dumpster), ("toilet", toilet), ("booth", booth), ("jersey", jersey), ("wheel_stop", wheel_stop),
    ("lot_light", lot_light), ("pipes", pipes), ("pallets", pallets), ("excavator", excavator), ("ac_unit", ac_unit), ("balcony", balcony),
] + [("billboard_%d" % k, (lambda k=k: billboard(k))) for k in range(4)] + [("blade_sign_%d" % k, (lambda k=k: blade_sign(k))) for k in range(6)] \
  + [("hoarding_%d" % k, (lambda k=k: hoarding(k))) for k in range(4)]


# ============================================================ materials, export, previews

def make_materials(img=None):
    def mat(name, rough, metal, emit=0.0):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = metal
        if img:
            tex = m.node_tree.nodes.new("ShaderNodeTexImage")
            tex.image = img
            tex.interpolation = "Linear"
            m.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
            if name == "cutout":
                m.node_tree.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
                m.blend_method = "CLIP" if hasattr(m, "blend_method") else None
            if emit:
                m.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
                bsdf.inputs["Emission Strength"].default_value = emit
        return m
    return {"atlas": mat("atlas", 0.82, 0.0), "metal": mat("metal", 0.5, 0.45), "glow": mat("glow", 0.5, 0.0, emit=1.5),
            "cutout": mat("cutout", 0.6, 0.3), "cloth": mat("cloth", 0.9, 0.0)}


def finish(name, B, mats):
    me = bpy.data.meshes.new(name)
    B.bm.to_mesh(me)
    B.bm.free()
    for mn in MATS:
        me.materials.append(mats[mn])
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def export(objs):
    for ob in objs:
        ob.location = (0, 0, 0)
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    path = os.path.join(OUT, "buildings_kit.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True,
                              export_apply=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_image_format="NONE", export_animations=False)
    return path


def previews(objs):
    s = bpy.context.scene
    s.render.engine = "BLENDER_EEVEE"
    s.render.threads_mode = "FIXED"
    s.render.threads = 8
    s.render.image_settings.file_format = "JPEG"
    s.render.resolution_x, s.render.resolution_y = 1600, 1000
    s.view_settings.view_transform = "AgX"
    world = bpy.data.worlds.new("sky")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.6, 0.68, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
    s.world = world
    bpy.ops.object.light_add(type="SUN", rotation=(math.radians(55), 0, math.radians(-35)))
    bpy.context.object.data.energy = 3.0
    by = {ob.name: ob for ob in objs}
    groups = {
        "kit_roof": ["water_tower", "water_tower_far", "steel_tank", "bulkhead", "elevator", "hvac", "condenser", "chimney", "vent", "fan", "dish",
                     "skylight", "mast", "solar", "coop", "laundry", "deck", "hatch", "billboard_0"],
        "kit_facade": ["fire_escape_bottom", "fire_escape", "fire_escape_top", "bracket", "awning", "canopy", "blade_sign_0", "blade_sign_3", "ac_unit", "balcony"],
        "kit_street": ["scaffold", "shed", "chainlink", "hoarding_0", "hoarding_1", "dumpster", "toilet", "booth", "jersey", "wheel_stop", "lot_light",
                       "pipes", "pallets", "excavator", "crane_mast"],
    }
    for gname, names in groups.items():
        for ob in objs:
            ob.hide_render = True
        x = 0.0
        shown = []
        for n in names:
            ob = by.get(n)
            if not ob:
                continue
            ob.hide_render = False
            dims = ob.dimensions
            ob.location = (x + dims.x / 2, 0, 0)
            x += dims.x + 1.2
            shown.append(ob)
        if gname == "kit_facade":   # stack the fire escape the way the game does
            fe = [by["fire_escape_bottom"], by["fire_escape"], by["fire_escape_top"]]
            for i, ob in enumerate(fe):
                ob.location = (0, 0, i * 3.2)
        cx = x / 2
        bpy.ops.object.camera_add(location=(cx, -max(14, x * 0.75), max(6, x * 0.25)), rotation=(math.radians(72), 0, 0))
        cam = bpy.context.object
        cam.data.lens = 35
        s.camera = cam
        s.render.filepath = os.path.join(PREV, gname + ".jpg")
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(cam, do_unlink=True)
        for ob in shown:
            ob.location = (0, 0, 0)


def main():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    img = None
    p = os.path.join(WORK, "kit_rgba.png")
    if os.path.exists(p):
        img = bpy.data.images.load(p)
    mats = make_materials(img)
    objs = []
    total = 0
    for name, fn in BUILDERS:
        B = fn()
        n = B.tris()
        total += n
        print("%-20s %6d tris" % (name, n))
        objs.append(finish(name, B, mats))
    print("total", total)
    if "--no-previews" not in FLAGS:
        previews(objs)
    # previews leave objects spread out: export them at the origin with no image data
    export(objs)


main()
