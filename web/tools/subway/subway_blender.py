"""
Far From the Tree - subway trains, track and props, modelled in code (headless Blender 5.2).

    blender -b -t 8 --factory-startup --python subway_blender.py -- <out_dir> <atlas_dir> <preview_dir> [--no-previews] [--prev name]

Writes <out_dir>/subway.glb (geometry + named material slots, no embedded images),
subway_atlas.jpg, subway_station_wall.jpg, subway_tunnel_wall.jpg, subway_floor.jpg and subway.json.

Modelling space is the game's (three.js) space; vertices are converted to Blender space on
the way in so the glTF Y-up export lands them back where they were written:
  +X  lateral (for wall props: away from the wall, into the tunnel; for track: the third-rail side)
  +Y  up
  +Z  along the line (trains: the cab end of car_front)
Origins: track / floor props at the floor; platform props at the platform top; car at rail top,
centre of the car; hanging signs at the ceiling attachment.

Material slots (every object, same order): atlas, metal, glow, lamp. The game samples one
texture atlas for all of them (layout in subway.json); `glow` is emissive, `lamp` is plain white
and tinted per instance (headlights white, tail lights red).
"""
import bpy, bmesh, math, os, sys, json, random
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT, ATLAS_DIR, PREV = argv[0], argv[1], argv[2]
FLAGS = argv[3:]
LAYOUT = json.load(open(os.path.join(ATLAS_DIR, "layout.json")))
RECTS = LAYOUT["rects"]
AW, AH = LAYOUT["size"]
SWATCH = set(LAYOUT["swatches"]) | {"cab_glass", "glow_white", "glow_amber", "sig_red", "sig_green", "sig_yellow", "blue_lamp",
                                    "globe_green", "lamp_white", "lamp_red"}
MATS = ["atlas", "metal", "glow", "lamp"]
MI = {n: i for i, n in enumerate(MATS)}

RAIL_TOP = 0.35          # rail head above the tunnel floor
CAR_L = 18.75            # one car slot (TRAIN.length / 8)
BODY_HL = 9.15           # half the body length
TRACK_L = 4.0            # track module length (= the subway polyline step)
PLATFORM_H = 1.1         # platform top above the floor (as subway.ts draws it)

rng = random.Random(7)


def V(*a):
    return Vector(a[0] if len(a) == 1 else a)


def uv_of(rect, s, t):
    x, y, w, h = RECTS[rect]
    if rect in SWATCH:
        s, t = 0.5, 0.5
    s = min(1.0, max(0.0, s))
    t = min(1.0, max(0.0, t))
    # keep half a texel in, so filtering doesn't pick up the neighbour cell
    u = (x + 0.5 + s * (w - 1)) / AW
    v = 1 - (y + 0.5 + (1 - t) * (h - 1)) / AH
    return (u, v)


# ============================================================ mesh builder (three.js space in)

class Builder:
    def __init__(self):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")

    @staticmethod
    def conv(p):
        return Vector((p[0], -p[2], p[1]))

    def v(self, p):
        return self.bm.verts.new(self.conv(p))

    def face(self, pts, mat, rect, st=None, out=None, smooth=False, verts=None):
        """pts in three space; st: per-point (s, t) inside the rect; out: hint for the outward normal"""
        pts = [V(p) for p in pts]
        if out is not None and len(pts) >= 3:
            n = (pts[1] - pts[0]).cross(pts[2] - pts[0])
            if n.length < 1e-12 and len(pts) > 3:
                n = (pts[2] - pts[0]).cross(pts[3] - pts[0])
            if n.dot(V(out)) < 0:
                pts = pts[::-1]
                if st:
                    st = st[::-1]
                if verts:
                    verts = verts[::-1]
        vs = verts or [self.v(p) for p in pts]
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

    def quad(self, a, b, c, d, mat, rect, st=((0, 0), (1, 0), (1, 1), (0, 1)), out=None):
        return self.face([a, b, c, d], mat, rect, list(st), out)

    def tris(self):
        return sum(len(f.verts) - 2 for f in self.bm.faces)


def proj_st(p, n, lo, hi, mode, span):
    """planar UV for a box face: t follows +Y on walls; s the horizontal axis in the face"""
    ax = max(range(3), key=lambda i: abs(n[i]))
    if ax == 1:
        si, ti = 0, 2
    else:
        si, ti = (2 if ax == 0 else 0), 1
    if mode == "fit":
        s = (p[si] - lo[si]) / max(1e-6, hi[si] - lo[si])
        t = (p[ti] - lo[ti]) / max(1e-6, hi[ti] - lo[ti])
    else:   # metres: span = (metres per rect width, metres per rect height)
        s = (p[si] - lo[si]) / span[0]
        t = (p[ti] - lo[ti]) / span[1]
    # read the right way round from outside
    if (ax == 0 and n[0] > 0) or (ax == 2 and n[2] < 0):
        s = 1 - s if mode == "fit" else (hi[si] - p[si]) / span[0]
    return (s, t)


def box(B, c, size, mat="atlas", rect="steel_dark", mode="fit", span=(1, 1), M=None, skip=(), rects=None, mats=None):
    """axis-aligned box (then transformed by M about its centre). rects/mats: per-face overrides
    keyed px nx py ny pz nz"""
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
        st = [proj_st(p, n, lo, hi, mode, span) for p in pts]
        wp = [C + Mm @ V(p) for p in pts]
        B.face(wp, m, r, st, out=Mm @ V(n))


def frame_axes(d):
    d = d.normalized()
    up = V(0, 1, 0) if abs(d.y) < 0.9 else V(1, 0, 0)
    s = d.cross(up).normalized()
    u = s.cross(d).normalized()
    return d, s, u


def cyl(B, a, b, r, segs=8, mat="atlas", rect="steel_dark", caps=True, r2=None, smooth=True, t_span=None):
    """cylinder / cone from a to b; s wraps around, t runs a->b"""
    a, b = V(a), V(b)
    d, s, u = frame_axes(b - a)
    r2 = r if r2 is None else r2
    ra, rb = [], []
    for i in range(segs + 1):
        ang = 2 * math.pi * i / segs
        off = s * math.cos(ang) + u * math.sin(ang)
        ra.append((B.v(a + off * r), a + off * r))
        rb.append((B.v(b + off * r2), b + off * r2))
    L = (b - a).length
    for i in range(segs):
        st = [(i / segs, 0), (i / segs, 1 if not t_span else L / t_span), ((i + 1) / segs, 1 if not t_span else L / t_span), ((i + 1) / segs, 0)]
        vs = [ra[i][0], rb[i][0], rb[i + 1][0], ra[i + 1][0]]
        mid = (ra[i][1] + rb[i + 1][1]) / 2
        outv = mid - (a + d * d.dot(mid - a))
        B.face([ra[i][1], rb[i][1], rb[i + 1][1], ra[i + 1][1]], mat, rect, st, out=outv, smooth=smooth, verts=vs)
    if caps:
        for ring, n, rr in ((ra, -d, r), (rb, d, r2)):
            if rr <= 1e-4:
                continue
            pts = [p for _, p in ring[:-1]]
            st = [(0.5 + 0.5 * math.cos(2 * math.pi * i / segs), 0.5 + 0.5 * math.sin(2 * math.pi * i / segs)) for i in range(segs)]
            B.face(pts, mat, rect, st, out=n)


def sphere(B, c, r, mat, rect, segs=12, rings=6):
    """a globe, built from stacked cone rings"""
    c = V(c)
    for i in range(rings):
        a0, a1 = math.pi * i / rings - math.pi / 2, math.pi * (i + 1) / rings - math.pi / 2
        cyl(B, tuple(c + V(0, math.sin(a0) * r, 0)), tuple(c + V(0, math.sin(a1) * r, 0)), max(1e-5, math.cos(a0) * r), segs, mat, rect,
            caps=False, r2=max(1e-5, math.cos(a1) * r))


def tube(B, a, b, r, mat="metal", rect="steel_dark", segs=6):
    cyl(B, a, b, r, segs, mat, rect, caps=False)


def disc(B, c, n, r, mat, rect, segs=10, along=None):
    """flat disc facing n"""
    c, n = V(c), V(n).normalized()
    _, s, u = frame_axes(n)
    pts = [c + (s * math.cos(2 * math.pi * i / segs) + u * math.sin(2 * math.pi * i / segs)) * r for i in range(segs)]
    st = [(0.5 + 0.5 * math.cos(2 * math.pi * i / segs), 0.5 + 0.5 * math.sin(2 * math.pi * i / segs)) for i in range(segs)]
    B.face(pts, mat, rect, st, out=n)


def plane(B, c, right, up, w, h, mat, rect, out=None, st=None):
    """rectangle centred at c spanning right*w and up*h, facing right x up (or out)"""
    c, R, U = V(c), V(right).normalized(), V(up).normalized()
    pts = [c - R * w / 2 - U * h / 2, c + R * w / 2 - U * h / 2, c + R * w / 2 + U * h / 2, c - R * w / 2 + U * h / 2]
    B.face(pts, mat, rect, list(st or [(0, 0), (1, 0), (1, 1), (0, 1)]), out=out if out is not None else R.cross(U))


def rot_y(a):
    return Matrix.Rotation(a, 3, "Z")  # placeholder (unused)


def RY(a):
    """rotation about the three.js Y axis (applied in three space)"""
    c, s = math.cos(a), math.sin(a)
    return Matrix(((c, 0, s), (0, 1, 0), (-s, 0, c)))


def RX(a):
    c, s = math.cos(a), math.sin(a)
    return Matrix(((1, 0, 0), (0, c, -s), (0, s, c)))


def RZ(a):
    c, s = math.cos(a), math.sin(a)
    return Matrix(((c, -s, 0), (s, c, 0), (0, 0, 1)))


# ============================================================ the subway car (R142 / R160 feel)

DOORS = [-6.95, -2.3, 2.3, 6.95]
DOOR_HW = 0.65
Y_SKIRT, Y_SIDE0, Y_WIN0, Y_WIN1, Y_SIDE1 = 0.62, 0.72, 1.85, 2.65, 3.05
Y_DOOR0, Y_DOOR1 = 0.95, 2.95
HW = 1.5


def car_windows():
    """window spans along z between the doors and at the ends"""
    wins = []
    for z0, z1 in [(-6.3, -2.95), (-1.65, 1.65), (2.95, 6.3)]:
        L = z1 - z0
        w = (L - 0.45) / 2
        wins += [(z0 + 0.15, z0 + 0.15 + w), (z1 - 0.15 - w, z1 - 0.15)]
    wins += [(-8.8, -7.85), (7.85, 8.8)]
    return sorted(wins)


INTERIOR_V = lambda y: (y - 0.9) / 2.2   # interior cell spans y 0.9 .. 3.1


def car_side(B, side):
    """one side wall at x = side*HW, normal side*X"""
    x = side * HW
    out = (side, 0, 0)
    wins = car_windows()
    # column breaks: body ends, doors, windows
    cols = []   # (z0, z1, kind)
    edges = [(-BODY_HL, "body")]
    marks = []
    for dz in DOORS:
        marks.append((dz - DOOR_HW, dz + DOOR_HW, "door"))
    for w0, w1 in wins:
        marks.append((w0, w1, "win"))
    marks.sort()
    z = -BODY_HL
    for z0, z1, k in marks:
        if z0 > z + 1e-6:
            cols.append((z, z0, "pier"))
        cols.append((z0, z1, k))
        z = z1
    if z < BODY_HL:
        cols.append((z, BODY_HL, "pier"))

    def wall(z0, z1, y0, y1, rect, span_s, inset=0.0, mat="metal"):
        xx = x - side * inset
        st = [(0, 0), (1, 0), (1, 1), (0, 1)]
        if span_s:
            st = [(0, 0), ((z1 - z0) / span_s, 0), ((z1 - z0) / span_s, 1), (0, 1)]
        B.quad((xx, y0, z0), (xx, y0, z1), (xx, y1, z1), (xx, y1, z0), mat, rect, st, out=out)

    win_i = 0
    for z0, z1, k in cols:
        if k == "door":
            wall(z0, z1, Y_SIDE0, Y_DOOR0, "steel_flute", 2.5)
            wall(z0, z1, Y_DOOR1, Y_SIDE1, "steel_plain", 1.5)
            ins = 0.035
            # the door pair, slightly recessed, with its jambs
            B.quad((x - side * ins, Y_DOOR0, z0), (x - side * ins, Y_DOOR0, z1), (x - side * ins, Y_DOOR1, z1), (x - side * ins, Y_DOOR1, z0),
                   "metal", "door", ((0, 0), (1, 0), (1, 1), (0, 1)) if side > 0 else ((1, 0), (0, 0), (0, 1), (1, 1)), out=out)
            for (a, b) in [((z0, Y_DOOR0), (z0, Y_DOOR1)), ((z1, Y_DOOR0), (z1, Y_DOOR1))]:
                B.quad((x, a[1], a[0]), (x, b[1], b[0]), (x - side * ins, b[1], b[0]), (x - side * ins, a[1], a[0]), "atlas", "rubber",
                       out=(0, 0, -1 if a[0] == z0 else 1))
            B.quad((x, Y_DOOR1, z0), (x, Y_DOOR1, z1), (x - side * ins, Y_DOOR1, z1), (x - side * ins, Y_DOOR1, z0), "atlas", "rubber", out=(0, -1, 0))
            # lit door windows (decals over the painted dark glass)
            for lz0 in (z0, z0 + 0.65):
                wz0, wz1 = lz0 + 0.12, lz0 + 0.53
                wy0, wy1 = Y_DOOR0 + 0.8, Y_DOOR0 + 1.75
                xx = x - side * (ins - 0.004)
                u0 = ((wz0 + 9.15) % 8) / 8
                st = [(u0, INTERIOR_V(wy0)), (u0 + 0.05, INTERIOR_V(wy0)), (u0 + 0.05, INTERIOR_V(wy1)), (u0, INTERIOR_V(wy1))]
                B.quad((xx, wy0, wz0), (xx, wy0, wz1), (xx, wy1, wz1), (xx, wy1, wz0), "glow", "interior", st, out=out)
        elif k == "win":
            wall(z0, z1, Y_SIDE0, Y_WIN0, "steel_flute", 2.5)
            wall(z0, z1, Y_WIN1, Y_SIDE1, "steel_plain", 1.5)
            ins = 0.07
            u0 = (((z0 + 9.15) * 0.37 + win_i * 0.29) % 0.85)
            win_i += 1
            du = (z1 - z0) / 8.0
            st = [(u0, INTERIOR_V(Y_WIN0)), (u0 + du, INTERIOR_V(Y_WIN0)), (u0 + du, INTERIOR_V(Y_WIN1)), (u0, INTERIOR_V(Y_WIN1))]
            if side < 0:
                st = [st[1], st[0], st[3], st[2]]
            xx = x - side * ins
            B.quad((xx, Y_WIN0, z0), (xx, Y_WIN0, z1), (xx, Y_WIN1, z1), (xx, Y_WIN1, z0), "glow", "interior", st, out=out)
            # jambs (rubber gasket)
            B.quad((x, Y_WIN0, z0), (x, Y_WIN0, z1), (xx, Y_WIN0, z1), (xx, Y_WIN0, z0), "atlas", "rubber", out=(0, 1, 0))
            B.quad((x, Y_WIN1, z0), (x, Y_WIN1, z1), (xx, Y_WIN1, z1), (xx, Y_WIN1, z0), "atlas", "rubber", out=(0, -1, 0))
            B.quad((x, Y_WIN0, z0), (x, Y_WIN1, z0), (xx, Y_WIN1, z0), (xx, Y_WIN0, z0), "atlas", "rubber", out=(0, 0, 1))
            B.quad((x, Y_WIN0, z1), (x, Y_WIN1, z1), (xx, Y_WIN1, z1), (xx, Y_WIN0, z1), "atlas", "rubber", out=(0, 0, -1))
        else:
            wall(z0, z1, Y_SIDE0, Y_WIN0, "steel_flute", 2.5)
            wall(z0, z1, Y_WIN0, Y_WIN1, "steel_plain", 1.5)
            wall(z0, z1, Y_WIN1, Y_SIDE1, "steel_plain", 1.5)
    # the LED side sign above the windows between the middle doors
    xx = x + side * 0.004
    sz0, sz1 = (3.05, 4.85) if side > 0 else (-4.85, -3.05)
    st = [(0, 0), (1, 0), (1, 1), (0, 1)] if side > 0 else [(1, 0), (0, 0), (0, 1), (1, 1)]
    # side>0: viewer at +x looks toward -x; their right is -z... map so text reads left-to-right
    st = [(1, 0), (0, 0), (0, 1), (1, 1)] if side > 0 else [(0, 0), (1, 0), (1, 1), (0, 1)]
    B.quad((xx, 2.71, sz0), (xx, 2.71, sz1), (xx, 2.94, sz1), (xx, 2.94, sz0), "glow", "side_up", st, out=out)
    # bottom chamfer and the rain gutter
    B.quad((side * 1.42, Y_SKIRT, -BODY_HL), (side * 1.42, Y_SKIRT, BODY_HL), (x, Y_SIDE0, BODY_HL), (x, Y_SIDE0, -BODY_HL), "metal", "steel_flute",
           ((0, 0), (7, 0), (7, 1), (0, 1)), out=(side, -1, 0))
    box(B, (side * 1.5, 3.07, 0), (0.05, 0.05, BODY_HL * 2), "metal", "steel_plain")
    # door-position stripe of grab handles: thin vertical bars next to each door
    for dz in DOORS:
        for e in (-1, 1):
            box(B, (side * 1.515, 1.9, dz + e * (DOOR_HW + 0.08)), (0.025, 0.7, 0.03), "metal", "steel_plain")


ROOF = [(1.5, Y_SIDE1), (1.43, 3.30), (1.15, 3.45), (0.6, 3.53), (0.0, 3.55)]


def car_roof(B):
    prof = [(-x, y) for x, y in reversed(ROOF[1:])] + ROOF
    prof = [(x, y) for x, y in ROOF][::-1]
    full = [(x, y) for x, y in ROOF] + [(-x, y) for x, y in reversed(ROOF[:-1])]
    for (x0, y0), (x1, y1) in zip(full, full[1:]):
        rect = "roof" if abs(x0) < 1.2 and abs(x1) < 1.2 else "steel_plain"
        nx, ny = (y1 - y0), -(x1 - x0)
        # outward: away from the car's centre line
        mid = ((x0 + x1) / 2, (y0 + y1) / 2 - 1.8)
        B.quad((x0, y0, -BODY_HL), (x1, y1, -BODY_HL), (x1, y1, BODY_HL), (x0, y0, BODY_HL), "metal" if rect != "roof" else "atlas", rect,
               ((0, 0), (0, 1), (6, 1), (6, 0)), out=(mid[0], mid[1], 0))
    # underside
    B.quad((-1.42, Y_SKIRT, -BODY_HL), (1.42, Y_SKIRT, -BODY_HL), (1.42, Y_SKIRT, BODY_HL), (-1.42, Y_SKIRT, BODY_HL), "atlas", "under",
           ((0, 0), (1, 0), (1, 6), (0, 6)), out=(0, -1, 0))
    # roof air-conditioning units and vents
    for zc in (-5.2, 5.2):
        box(B, (0, 3.6, zc), (1.9, 0.2, 3.3), "atlas", "roof", rects={"py": "under"})
        for k in range(4):
            box(B, (0, 3.71, zc - 1.2 + k * 0.8), (1.5, 0.02, 0.5), "atlas", "steel_dark")
    for zc in (-1.0, 1.0):
        box(B, (0.4, 3.58, zc), (0.5, 0.08, 0.7), "atlas", "roof")


END_PROFILE = [(-1.42, Y_SKIRT), (1.42, Y_SKIRT), (1.5, Y_SIDE0), (1.5, Y_SIDE1)] + ROOF[1:-1] + [(0.0, 3.55)] + [(-x, y) for x, y in reversed(ROOF[1:-1])] + [(-1.5, Y_SIDE1), (-1.5, Y_SIDE0)]


def end_st(x, y, facing):
    s = (x * facing + 1.5) / 3.0
    return (s, y / 3.7)


def car_end(B, facing, cab):
    """end wall at z = facing*BODY_HL"""
    z = facing * BODY_HL
    rect = "end_cab" if cab else "end_mid"
    pts = [(x, y, z) for x, y in END_PROFILE]
    B.face(pts, "metal", rect, [end_st(x, y, facing) for x, y in END_PROFILE], out=(0, 0, facing))
    zd = z + facing * 0.006

    def decal(x0, x1, y0, y1, mat, rect, st=None):
        a, b = (x0, x1) if facing > 0 else (x1, x0)
        B.quad((a, y0, zd), (b, y0, zd), (b, y1, zd), (a, y1, zd), mat, rect, st or ((0, 0), (1, 0), (1, 1), (0, 1)), out=(0, 0, facing))

    iv = lambda y: INTERIOR_V(y)
    if cab:
        # windscreen: storm-door window and the two side windows, lit from inside
        decal(-0.28, 0.28, 1.8, 2.6, "glow", "interior", ((0.40, iv(1.8)), (0.46, iv(1.8)), (0.46, iv(2.6)), (0.40, iv(2.6))))
        decal(0.55, 1.35, 1.8, 2.6, "glow", "interior", ((0.12, iv(1.8)), (0.22, iv(1.8)), (0.22, iv(2.6)), (0.12, iv(2.6))))
        decal(-1.35, -0.55, 1.8, 2.6, "glow", "cab_glass")
        decal(-0.6, 0.6, 3.06, 3.21, "glow", "dest_up")
        decal(-0.98, -0.66, 2.98, 3.28, "glow", "bullet_R")
        # headlights and marker lights (lamp: tinted per instance, white leading / red trailing)
        for sx in (-1, 1):
            cyl(B, (sx * 1.05, 1.22, z), (sx * 1.05, 1.22, z + facing * 0.05), 0.2, 12, "metal", "steel_dark", caps=False)
            disc(B, (sx * 1.05, 1.22, z + facing * 0.045), (0, 0, facing), 0.17, "lamp", "lamp_white", 12)
            cyl(B, (sx * 1.25, 3.12, z), (sx * 1.25, 3.12, z + facing * 0.03), 0.08, 8, "metal", "steel_dark", caps=False)
            disc(B, (sx * 1.25, 3.12, z + facing * 0.028), (0, 0, facing), 0.07, "lamp", "lamp_white", 8)
        # anticlimber, coupler, cab handrails, step
        box(B, (0, 0.74, z + facing * 0.08), (2.8, 0.22, 0.16), "metal", "steel_plain")
        for k in range(3):
            box(B, (0, 0.66 + k * 0.08, z + facing * 0.165), (2.7, 0.025, 0.02), "atlas", "steel_dark")
        box(B, (0, 0.5, z + facing * 0.32), (0.3, 0.2, 0.5), "atlas", "steel_dark")
        for sx in (-1, 1):
            tube(B, (sx * 0.5, 1.0, z + facing * 0.06), (sx * 0.5, 2.7, z + facing * 0.06), 0.02, "metal", "steel_plain")
        box(B, (0, Y_SKIRT - 0.02, z + facing * 0.08), (2.9, 0.04, 0.16), "atlas", "paint_yellow")
    else:
        decal(-0.28, 0.28, 1.75, 2.55, "glow", "interior", ((0.62, iv(1.75)), (0.69, iv(1.75)), (0.69, iv(2.55)), (0.62, iv(2.55))))
        for sx in (-1, 1):
            decal(min(sx * 0.92, sx * 1.28), max(sx * 0.92, sx * 1.28), 1.85, 2.5, "glow", "interior",
                  ((0.3, iv(1.85)), (0.34, iv(1.85)), (0.34, iv(2.5)), (0.3, iv(2.5))))
        # coupler, hoses and the end safety chains
        box(B, (0, 0.55, z + facing * 0.22), (0.28, 0.18, 0.44), "atlas", "steel_dark")
        for sx in (-1, 1):
            tube(B, (sx * 0.55, 1.4, z + facing * 0.05), (sx * 0.55, 1.4, z + facing * 0.19), 0.012, "atlas", "paint_yellow", 4)
            tube(B, (sx * 0.55, 1.05, z + facing * 0.05), (sx * 0.55, 1.05, z + facing * 0.19), 0.012, "atlas", "paint_yellow", 4)
        box(B, (0, Y_DOOR0 - 0.04, z + facing * 0.12), (0.9, 0.04, 0.24), "metal", "steel_plain")   # end-door threshold plate


def wheelset(B, z):
    for sx in (-1, 1):
        cyl(B, (sx * 0.68, 0.42, z), (sx * 0.81, 0.42, z), 0.42, 14, "metal", "steel_dark", caps=True)
        cyl(B, (sx * 0.81, 0.42, z), (sx * 0.84, 0.42, z), 0.18, 8, "atlas", "under", caps=True)
    tube(B, (-0.9, 0.42, z), (0.9, 0.42, z), 0.08, "atlas", "steel_dark", 6)


def truck(B, zc):
    for dz in (-1.05, 1.05):
        wheelset(B, zc + dz)
    for sx in (-1, 1):
        box(B, (sx * 0.98, 0.45, zc), (0.2, 0.26, 2.9), "atlas", "under", rects={"px": "steel_dark", "nx": "steel_dark"})
        for dz in (-1.05, 1.05):
            box(B, (sx * 0.98, 0.45, zc + dz), (0.3, 0.36, 0.4), "atlas", "steel_dark")   # journal box
            cyl(B, (sx * 0.98, 0.64, zc + dz * 0.55), (sx * 0.98, 0.8, zc + dz * 0.55), 0.09, 8, "atlas", "paint_yellow", caps=False)  # springs
        # third-rail collector shoe beam
        box(B, (sx * 1.38, 0.4, zc), (0.12, 0.08, 0.6), "atlas", "wood_dark")
        box(B, (sx * 1.47, 0.33, zc), (0.2, 0.03, 0.35), "atlas", "steel_dark")
    box(B, (0, 0.55, zc), (1.8, 0.22, 0.5), "atlas", "under")      # transom
    box(B, (0, 0.6, zc + 0.6), (0.7, 0.3, 0.5), "atlas", "under")  # traction motor
    box(B, (0, 0.6, zc - 0.6), (0.7, 0.3, 0.5), "atlas", "under")


def build_car(cab):
    B = Builder()
    for side in (-1, 1):
        car_side(B, side)
    car_roof(B)
    car_end(B, 1, cab)
    car_end(B, -1, False)
    for zc in (-6.5, 6.5):
        truck(B, zc)
    # equipment boxes under the floor between the trucks
    for i, (zc, w, l) in enumerate([(-3.9, 2.2, 1.6), (-1.8, 1.6, 1.8), (0.4, 2.3, 1.2), (2.2, 1.8, 1.5), (4.2, 2.1, 1.4)]):
        box(B, (0, 0.47 + (i % 2) * 0.03, zc), (w, 0.3 - (i % 2) * 0.06, l), "atlas", "under", skip=("py",))
    return B


# ============================================================ track: one 4 m module, origin floor at the track centre

RAIL_PROFILE = [(-0.07, 0.185), (0.07, 0.185), (0.07, 0.197), (0.012, 0.212), (0.009, 0.305), (0.035, 0.318), (0.035, 0.345),
                (0.03, RAIL_TOP), (-0.03, RAIL_TOP), (-0.035, 0.345), (-0.035, 0.318), (-0.009, 0.305), (-0.012, 0.212), (-0.07, 0.197)]


def rail(B, xc, z0, z1, prof=RAIL_PROFILE):
    n = len(prof)
    for i in range(n):
        (xa, ya), (xb, yb) = prof[i], prof[(i + 1) % n]
        if ya < 0.19 and yb < 0.19:
            continue   # the foot's underside
        top = ya >= RAIL_TOP - 1e-4 and yb >= RAIL_TOP - 1e-4
        mx, my = (xa + xb) / 2, (ya + yb) / 2
        B.quad((xc + xa, ya, z0), (xc + xb, yb, z0), (xc + xb, yb, z1), (xc + xa, ya, z1), "metal", "rail_top" if top else "rail_side",
               ((0, 0), (1, 0), (1, 1), (0, 1)), out=(mx, my - 0.27, 0))


def build_track():
    B = Builder()
    z0, z1 = -TRACK_L / 2, TRACK_L / 2
    # concrete invert with the drainage trough between the rails
    hw, tw, yt, yb = 1.75, 0.2, 0.10, 0.03
    stz = lambda x, z: ((z - z0) / TRACK_L, 1 - (x + hw) / (2 * hw))
    for xa, xb, y in ((-hw, -tw, yt), (tw, hw, yt), (-tw, tw, yb)):
        B.face([(xa, y, z0), (xb, y, z0), (xb, y, z1), (xa, y, z1)], "atlas", "concrete_track",
               [stz(xa, z0), stz(xb, z0), stz(xb, z1), stz(xa, z1)], out=(0, 1, 0))
    for x in (-tw, tw):
        B.quad((x, yb, z0), (x, yt, z0), (x, yt, z1), (x, yb, z1), "atlas", "grime", out=(-x, 0, 0))
    for x in (-hw, hw):
        B.quad((x, 0, z0), (x, yt, z0), (x, yt, z1), (x, 0, z1), "atlas", "grime", out=(x, 0, 0))
    # half-ties set in the concrete, tie plates, rails
    for k in range(6):
        zc = z0 + TRACK_L / 12 + k * TRACK_L / 6
        for sx in (-1, 1):
            box(B, (sx * 0.72, 0.135, zc), (0.8, 0.07, 0.24), "atlas", "tie_wood", skip=("ny",))
            box(B, (sx * 0.72, 0.177, zc), (0.36, 0.016, 0.18), "atlas", "steel_dark", skip=("ny", "pz", "nz"))
    for sx in (-1, 1):
        rail(B, sx * 0.7175, z0, z1)
    # covered third rail on the +X side: rail, insulator pedestal, protection board and its bracket
    tx = 1.48
    box(B, (tx, 0.37, 0), (0.08, 0.12, TRACK_L), "metal", "rail_side", rects={"py": "rail_top"}, skip=("ny", "pz", "nz"))
    box(B, (tx, 0.135, 0), (0.36, 0.07, 0.3), "atlas", "concrete_light", skip=("ny",))
    cyl(B, (tx, 0.17, 0), (tx, 0.31, 0), 0.055, 8, "atlas", "booth_tan", caps=False)
    box(B, (tx - 0.02, 0.53, 0), (0.44, 0.04, TRACK_L), "atlas", "board", mode="fit", rects={"py": "board", "ny": "board"})
    box(B, (tx + 0.25, 0.32, 0), (0.04, 0.44, 0.06), "atlas", "steel_dark")
    box(B, (tx + 0.02, 0.495, 0), (0.5, 0.03, 0.06), "atlas", "steel_dark", skip=("ny",))
    # drain grate in the trough
    B.quad((-tw, yb + 0.004, -0.3), (tw, yb + 0.004, -0.3), (tw, yb + 0.004, 0.3), (-tw, yb + 0.004, 0.3), "atlas", "tray", out=(0, 1, 0))
    return B


def build_platform_edge():
    """4 m of platform edge. origin: floor, at the edge line; the platform runs toward +X"""
    B = Builder()
    z0, z1 = -2, 2
    H = PLATFORM_H
    # coping stone with its overhang, the yellow tactile strip, recessed wall below
    B.quad((-0.05, H - 0.15, z0), (-0.05, H - 0.15, z1), (-0.05, H, z1), (-0.05, H, z0), "atlas", "plat_edge",
           ((0, 0.55), (1, 0.55), (1, 1), (0, 1)), out=(-1, 0, 0))
    B.quad((-0.05, H - 0.15, z0), (0.45, H - 0.15, z0), (0.45, H - 0.15, z1), (-0.05, H - 0.15, z1), "atlas", "grime", out=(0, -1, 0))
    B.quad((0.45, 0, z0), (0.45, 0, z1), (0.45, H - 0.15, z1), (0.45, H - 0.15, z0), "atlas", "plat_edge", ((0, 0), (1, 0), (1, 0.5), (0, 0.5)), out=(-1, 0, 0))
    B.quad((-0.05, H, z0), (0.08, H, z0), (0.08, H, z1), (-0.05, H, z1), "atlas", "white", out=(0, 1, 0))
    B.quad((0.08, H + 0.004, z0), (0.68, H + 0.004, z0), (0.68, H + 0.004, z1), (0.08, H + 0.004, z1), "atlas", "tactile",
           ((0, 0), (0, 1), (2, 1), (2, 0)), out=(0, 1, 0))
    B.quad((0.68, H, z0), (1.2, H, z0), (1.2, H, z1), (0.68, H, z1), "atlas", "concrete_light", out=(0, 1, 0))
    return B


# ============================================================ columns

def ibeam(B, h, rect, depth=0.36, flange=0.3, tf=0.025, tw=0.02):
    for sz in (-1, 1):
        box(B, (0, h / 2, sz * (depth / 2 - tf / 2)), (flange, h, tf), "atlas", rect)
    box(B, (0, h / 2, 0), (tw, h, depth - 2 * tf), "atlas", rect, skip=("py", "ny"))


def build_column():
    """station column: platform top to ceiling (6.0 m, scale y to fit)"""
    B = Builder()
    ibeam(B, 6.0, "column_paint")
    box(B, (0, 0.03, 0), (0.42, 0.06, 0.48), "atlas", "concrete_light", skip=("ny",))
    box(B, (0, 5.9, 0), (0.5, 0.2, 0.6), "atlas", "column_paint")
    return B


def build_ibeam():
    """tunnel I-beam between the tracks, floor to ceiling (6.9 m)"""
    B = Builder()
    ibeam(B, 6.9, "ibeam_paint", depth=0.32, flange=0.36)
    box(B, (0, 0.15, 0), (0.5, 0.3, 0.5), "atlas", "concrete_light", skip=("ny",))
    return B


# ============================================================ wall-mounted tunnel props (origin: wall at the floor; +X into the tunnel)

def build_cable_run():
    B = Builder()
    z0, z1 = -2, 2
    # upper cable tray on a bracket
    box(B, (0.28, 4.10, 0), (0.46, 0.03, TRACK_L), "metal", "tray", mode="fit", rects={"py": "tray", "ny": "tray"})
    box(B, (0.5, 4.16, 0), (0.02, 0.1, TRACK_L), "metal", "tray")
    B.quad((0.08, 4.17, z0), (0.46, 4.17, z0), (0.46, 4.17, z1), (0.08, 4.17, z1), "atlas", "cable", ((0, 0), (0, 1), (3, 1), (3, 0)), out=(0, 1, 0))
    box(B, (0.25, 3.98, 0), (0.5, 0.2, 0.06), "atlas", "steel_dark")
    # lower cables on hooks
    for i, y in enumerate((2.35, 2.47, 2.59)):
        cyl(B, (0.12, y, z0), (0.12, y, z1), 0.045, 6, "atlas", "cable", caps=False)
    box(B, (0.08, 2.47, 0), (0.16, 0.42, 0.05), "atlas", "steel_dark")
    # water main and a conduit
    cyl(B, (0.2, 1.65, z0), (0.2, 1.65, z1), 0.1, 8, "atlas", "pipe_rust", caps=False, t_span=None)
    cyl(B, (0.12, 1.95, z0), (0.12, 1.95, z1), 0.04, 6, "atlas", "steel_dark", caps=False)
    box(B, (0.14, 1.55, 0), (0.28, 0.06, 0.08), "atlas", "steel_dark")
    return B


def build_work_light():
    B = Builder()
    y = 0.0   # origin at the lamp mount height (TS places at ceiling - 1.2)
    box(B, (0.05, y, 0), (0.1, 0.24, 0.24), "atlas", "steel_dark")
    tube(B, (0.1, y, 0), (0.28, y - 0.05, 0), 0.02, "atlas", "steel_dark", 5)
    cyl(B, (0.28, y - 0.02, 0), (0.28, y - 0.08, 0), 0.08, 8, "atlas", "steel_dark", r2=0.11, caps=False)
    cyl(B, (0.28, y - 0.08, 0), (0.28, y - 0.2, 0), 0.06, 8, "glow", "glow_amber", r2=0.04)
    for a in range(4):   # wire cage
        ang = a * math.pi / 2
        dx, dz = math.cos(ang) * 0.085, math.sin(ang) * 0.085
        tube(B, (0.28 + dx, y - 0.08, dz), (0.28 + dx * 0.5, y - 0.25, dz * 0.5), 0.006, "atlas", "steel_dark", 3)
    return B


def build_signal(lit):
    """tunnel signal head on a wall bracket; lenses face +Z (toward the oncoming train)"""
    B = Builder()
    box(B, (0.1, 2.4, 0), (0.2, 0.1, 0.1), "atlas", "steel_dark")
    box(B, (0.32, 2.4, 0), (0.3, 0.8, 0.22), "atlas", "paint_black")
    for i, (y, col) in enumerate(((2.6, "sig_red"), (2.2, "sig_green"))):
        on = (lit == "red" and i == 0) or (lit == "green" and i == 1)
        disc(B, (0.32, y, 0.112), (0, 0, 1), 0.085, "glow" if on else "atlas", col if on else "paint_black", 10)
        if not on:
            disc(B, (0.32, y, 0.113), (0, 0, 1), 0.06, "atlas", "steel_dark", 8)
        # hood
        B.quad((0.22, y + 0.11, 0.11), (0.42, y + 0.11, 0.11), (0.42, y + 0.11, 0.26), (0.22, y + 0.11, 0.26), "atlas", "paint_black", out=(0, 1, 0))
        B.quad((0.22, y + 0.11, 0.11), (0.42, y + 0.11, 0.11), (0.42, y + 0.11, 0.26), (0.22, y + 0.11, 0.26), "atlas", "paint_black", out=(0, -1, 0))
    box(B, (0.32, 1.88, 0.0), (0.24, 0.14, 0.03), "atlas", "white")    # number plate
    box(B, (0.32, 1.35, 0.0), (0.05, 2.7, 0.05), "atlas", "paint_black", skip=("py",))
    return B


def build_blue_light():
    """emergency alarm / telephone / power-removal box under a blue light"""
    B = Builder()
    box(B, (0.08, 1.5, 0), (0.16, 0.6, 0.5), "atlas", "paint_blue", rects={"px": "bluebox_face"})
    box(B, (0.06, 1.95, 0), (0.12, 0.08, 0.12), "atlas", "steel_dark")
    cyl(B, (0.08, 1.99, 0), (0.08, 2.17, 0), 0.075, 10, "glow", "blue_lamp")
    box(B, (0.03, 0.75, 0), (0.06, 1.5, 0.08), "atlas", "steel_dark", skip=("ny",))
    return B


def build_emergency_light():
    B = Builder()
    box(B, (0.06, 0, 0), (0.12, 0.16, 0.36), "atlas", "white")
    plane(B, (0.121, -0.01, 0), (0, 0, -1), (0, 1, 0), 0.3, 0.1, "glow", "glow_white", out=(1, 0, 0))
    return B


def build_fluor_hung():
    """a station fluorescent fixture hung on two drop rods: the rods run 0.5 m up from its top (into the vault
    over the ceiling line); the fixture's underside is 0.42 m under the origin (the ceiling line)"""
    B = Builder()
    box(B, (0, -0.33, 0), (0.3, 0.1, 2.4), "atlas", "white")
    B.quad((-0.12, -0.382, -1.15), (0.12, -0.382, -1.15), (0.12, -0.382, 1.15), (-0.12, -0.382, 1.15), "glow", "fluor_tube",
           ((0, 0), (0, 1), (1, 1), (1, 0)), out=(0, -1, 0))
    for z in (-0.9, 0.9):
        tube(B, (0, -0.28, z), (0, 0.3, z), 0.012, "atlas", "steel_dark", 4)
    return B


def build_girder():
    """2.5 m of riveted steel I-beam girder running along X, its top at the origin (the ceiling line), 0.32 deep"""
    B = Builder()
    Lg, D, F = 2.5, 0.32, 0.26
    box(B, (0, -0.02, 0), (Lg, 0.04, F), "atlas", "column_paint", skip=("nx", "px"))
    box(B, (0, -D + 0.02, 0), (Lg, 0.04, F), "atlas", "column_paint", skip=("nx", "px"))
    box(B, (0, -D / 2, 0), (Lg, D - 0.08, 0.03), "atlas", "column_paint", skip=("nx", "px", "py", "ny"))
    return B


def build_conduit():
    """3 m of ceiling services along Z: a cable tray, two conduits, a rusty pipe and a junction box, on a strap.
    Origin at the ceiling line; nothing hangs more than 0.24 m under it"""
    B = Builder()
    box(B, (0, -0.12, 0), (0.4, 0.05, 3.0), "atlas", "tray", skip=("nz", "pz"))
    for x in (-0.28, -0.22):
        cyl(B, (x, -0.08, -1.5), (x, -0.08, 1.5), 0.022, 6, "metal", "steel_plain", caps=False)
    cyl(B, (0.3, -0.1, -1.5), (0.3, -0.1, 1.5), 0.05, 8, "atlas", "pipe_rust", caps=False)
    box(B, (-0.25, -0.12, 0.6), (0.16, 0.16, 0.12), "atlas", "steel_dark")
    for z in (-1.0, 1.0):
        box(B, (0, -0.07, z), (0.75, 0.02, 0.04), "atlas", "steel_dark")
        for x in (-0.36, 0.36):
            tube(B, (x, 0, z), (x, -0.07, z), 0.008, "atlas", "steel_dark", 3)
    return B


def build_cctv():
    """a CCTV dome on a short bracket, and the origin at the ceiling (0.3 m down)"""
    B = Builder()
    box(B, (0, -0.05, 0), (0.06, 0.1, 0.06), "atlas", "steel_dark")
    box(B, (0, -0.12, 0), (0.22, 0.04, 0.22), "atlas", "white")
    sphere(B, (0, -0.14, 0), 0.1, "atlas", "glass_booth", segs=10, rings=4)
    return B


def build_speaker():
    """a PA horn speaker on a bracket, pointing along +Z and down a little"""
    B = Builder()
    box(B, (0, -0.06, 0), (0.05, 0.12, 0.05), "atlas", "steel_dark")
    cyl(B, (0, -0.16, -0.12), (0, -0.2, 0.18), 0.05, 8, "atlas", "paint_grey", r2=0.16)
    return B


def build_fluor():
    """station fluorescent fixture, 2.6 m long. origin at the ceiling"""
    B = Builder()
    box(B, (0, -0.06, 0), (0.3, 0.1, 2.6), "atlas", "white", skip=("py",))
    B.quad((-0.12, -0.112, -1.25), (0.12, -0.112, -1.25), (0.12, -0.112, 1.25), (-0.12, -0.112, 1.25), "glow", "fluor_tube",
           ((0, 0), (0, 1), (1, 1), (1, 0)), out=(0, -1, 0))
    for z in (-0.9, 0.9):
        tube(B, (0, 0, z), (0, 0.3, z), 0.01, "atlas", "steel_dark", 3)
    return B


# ============================================================ fare control and station furniture (origin: platform / floor top)

def build_turnstile():
    """the classic waist-high three-arm turnstile: stainless cabinet along Z, rotor out to +X.
    Lane pitch 0.95 m in X. Entry from -Z (card reader at the -Z end of the top)."""
    B = Builder()
    # brushed-steel cabinet with rounded ends (0.95 m to the top), a black kick plinth and a dark seam band
    box(B, (0, 0.5, 0), (0.32, 0.9, 0.83), "metal", "steel_flute", rects={"py": "turnstile_top"}, skip=("ny", "py", "pz", "nz"))
    box(B, (0, 0.975, 0), (0.32, 0.05, 0.83), "metal", "steel_plain", rects={"py": "turnstile_top"}, skip=("ny", "pz", "nz"))
    for zc in (-0.415, 0.415):
        cyl(B, (0, 0.06, zc), (0, 0.95, zc), 0.16, 12, "metal", "steel_flute")
        cyl(B, (0, 0.95, zc), (0, 1.0, zc), 0.16, 12, "metal", "steel_plain")
    box(B, (0, 0.06, 0), (0.34, 0.12, 1.16), "atlas", "rubber", skip=("ny",))
    box(B, (0, 0.62, 0), (0.33, 0.05, 0.84), "atlas", "steel_dark", skip=("ny", "py"))
    # reader head on top at the entry end, screen tilted toward the rider
    M = RX(-0.5)
    box(B, (0, 1.08, -0.38), (0.26, 0.18, 0.26), "atlas", "paint_black", M=M)
    c = V(0, 1.08, -0.38) + M @ V(0, 0.091, 0)
    plane(B, tuple(c), (1, 0, 0), tuple(M @ V(0, 0, 1)), 0.2, 0.2, "glow", "reader_screen", out=tuple(M @ V(0, 1, 0)))
    # rotor: hub on a shaft tilted toward the entry, three arms, one across the lane
    hub = V(0.30, 0.93, 0.05)
    axis = V(0.35, 1.0, -0.9).normalized()
    cyl(B, (0.12, 0.85, 0.12), tuple(hub), 0.05, 8, "metal", "steel_plain")
    cyl(B, tuple(hub - axis * 0.05), tuple(hub + axis * 0.08), 0.09, 10, "metal", "steel_plain")
    a1 = (V(1, 0, 0) - axis * axis.dot(V(1, 0, 0))).normalized()
    a2 = axis.cross(a1)
    for k in range(3):
        ang = k * 2 * math.pi / 3
        d = a1 * math.cos(ang) + a2 * math.sin(ang)
        tube(B, tuple(hub), tuple(hub + d * 0.5), 0.03, "metal", "steel_plain", 8)
        disc(B, tuple(hub + d * 0.5), tuple(d), 0.03, "atlas", "rubber", 8)
    return B


def build_exit_gate():
    """full-height rotating exit gate (a cage of horizontal bars around a central rotor). 1.6 m wide (X)"""
    B = Builder()
    H = 2.25
    r = 0.78
    # rotor post and three wings of bars
    cyl(B, (0, 0, 0), (0, H, 0), 0.06, 8, "metal", "heet_grey")
    for k in range(3):
        ang = k * 2 * math.pi / 3 + 0.3
        d = V(math.cos(ang), 0, math.sin(ang))
        tube(B, tuple(d * 0.62 + V(0, 0.08, 0)), tuple(d * 0.62 + V(0, H - 0.15, 0)), 0.025, "metal", "heet_grey", 5)
        for i in range(10):
            y = 0.18 + i * (H - 0.4) / 9
            tube(B, tuple(V(0, y, 0) + d * 0.06), tuple(V(0, y, 0) + d * 0.62), 0.018, "metal", "heet_grey", 4)
    # the fixed comb halves either side (arcs of bars), the frame and the top plate
    for side in (-1, 1):
        a0, a1_ = (math.radians(-60), math.radians(60)) if side > 0 else (math.radians(120), math.radians(240))
        pts = [V(math.cos(a0 + (a1_ - a0) * t / 4) * r, 0, math.sin(a0 + (a1_ - a0) * t / 4) * r) for t in range(5)]
        for p in (pts[0], pts[-1]):
            tube(B, tuple(p), tuple(p + V(0, H, 0)), 0.035, "metal", "heet_grey", 6)
        for i in range(10):
            y = 0.18 + i * (H - 0.4) / 9
            for p, q in zip(pts, pts[1:]):
                tube(B, tuple(p + V(0, y, 0)), tuple(q + V(0, y, 0)), 0.016, "metal", "heet_grey", 4)
    box(B, (0, H + 0.05, 0), (1.7, 0.1, 1.7), "metal", "heet_grey")
    box(B, (0, H + 0.13, 0), (1.0, 0.06, 1.0), "atlas", "paint_black")
    # NO ENTRY plate on the paid side
    plane(B, (0, H - 0.02, -0.86), (-1, 0, 0), (0, 1, 0), 0.5, 0.14, "atlas", "paint_red", out=(0, 0, -1))
    return B


def build_emergency_gate():
    """waist-high emergency exit gate with its red sign and alarm box; 1.2 m wide (X), swings on +X post"""
    B = Builder()
    for x in (-0.6, 0.6):
        cyl(B, (x, 0, 0), (x, 1.15, 0), 0.04, 8, "metal", "heet_grey")
    tube(B, (-0.55, 1.0, 0), (0.55, 1.0, 0), 0.025, "metal", "heet_grey")
    tube(B, (-0.55, 0.12, 0), (0.55, 0.12, 0), 0.025, "metal", "heet_grey")
    for i in range(9):
        x = -0.48 + i * 0.12
        tube(B, (x, 0.12, 0), (x, 1.0, 0), 0.012, "metal", "heet_grey", 4)
    box(B, (0, 0.72, 0), (0.62, 0.32, 0.06), "atlas", "paint_red", rects={"pz": "emergency_sign", "nz": "emergency_sign"})
    box(B, (0.6, 1.3, 0), (0.12, 0.22, 0.1), "atlas", "paint_red")
    cyl(B, (0.6, 1.41, 0), (0.6, 1.47, 0), 0.04, 8, "glow", "sig_red")
    tube(B, (-0.5, 0.95, 0.06), (0.5, 0.95, 0.06), 0.02, "atlas", "paint_yellow", 6)   # push bar
    return B


def build_fare_rail():
    """2 m of fare-control railing along Z (posts, rails, vertical bars)"""
    B = Builder()
    for z in (-1, 1):
        cyl(B, (0, 0, z), (0, 1.15, z), 0.035, 6, "metal", "heet_grey")
    for y in (0.1, 1.1):
        tube(B, (0, y, -1), (0, y, 1), 0.022, "metal", "heet_grey", 6)
    for i in range(15):
        z = -0.88 + i * 0.125
        tube(B, (0, 0.1, z), (0, 1.1, z), 0.009, "metal", "heet_grey", 4)
    return B


def build_booth():
    """token booth: 2.4 (X) x 2.0 (Z) x 2.7, window and sign facing +Z"""
    B = Builder()
    W, D = 2.4, 2.0
    box(B, (0, 0.55, 0), (W, 1.1, D), "metal", "steel_plain", rects={"pz": "booth_front"}, skip=("ny",))
    # lit interior behind the glass on three sides, glass bars
    for face, c, right, w in (("pz", (0, 1.67, D / 2 - 0.05), (1, 0, 0), W - 0.2), ("px", (W / 2 - 0.05, 1.67, 0), (0, 0, -1), D - 0.2),
                              ("nx", (-W / 2 + 0.05, 1.67, 0), (0, 0, 1), D - 0.2)):
        n = V(right).cross(V(0, 1, 0))
        plane(B, c, right, (0, 1, 0), w, 1.12, "glow", "booth_interior", out=tuple(n))
    for x in [(-W / 2 + 0.1) + i * (W - 0.2) / 8 for i in range(9)]:
        tube(B, (x, 1.1, D / 2), (x, 2.24, D / 2), 0.012, "metal", "steel_plain", 4)
    for z in (-D / 2, D / 2):
        for x in (-W / 2, W / 2):
            box(B, (x, 1.67, z), (0.08, 1.14, 0.08), "metal", "steel_plain")
    box(B, (0, 2.4, 0), (W + 0.1, 0.3, D + 0.1), "metal", "steel_plain", rects={"pz": "booth_sign"}, mats={"pz": "glow"})
    box(B, (0, 2.58, 0), (W, 0.06, D), "atlas", "steel_dark")
    box(B, (0, 1.12, D / 2 + 0.15), (1.2, 0.04, 0.3), "metal", "steel_plain")   # counter shelf
    return B


def build_bench():
    """wooden platform bench, 2.4 m along Z, seat facing +X"""
    B = Builder()
    L = 2.4
    box(B, (0, 0.45, 0), (0.42, 0.06, L), "atlas", "bench_wood", rects={"py": "bench_wood"})
    M = RZ(-0.18)
    box(B, (-0.21, 0.78, 0), (0.05, 0.5, L), "atlas", "bench_wood", M=M)
    for z in (-1.1, -0.37, 0.37, 1.1):
        box(B, (0, 0.21, z), (0.36, 0.42, 0.06), "atlas", "paint_black")
        box(B, (-0.02, 0.62, z), (0.38, 0.05, 0.06), "atlas", "paint_black")
    return B


def build_trash():
    B = Builder()
    cyl(B, (0, 0, 0), (0, 0.85, 0), 0.3, 12, "atlas", "trash", caps=False)
    cyl(B, (0, 0.85, 0), (0, 0.9, 0), 0.32, 12, "atlas", "paint_black", caps=False)
    disc(B, (0, 0.82, 0), (0, 1, 0), 0.3, "atlas", "rubber", 12)
    cyl(B, (0, 0.82, 0), (0, 0.95, 0), 0.18, 7, "atlas", "rubber", r2=0.05, caps=False)   # bag bulging out
    return B


def build_sign_hang():
    """hanging wayfinding sign, readable from both ends of the platform. origin: ceiling"""
    B = Builder()
    w, h = 2.4, 0.6
    yc = -0.72   # (hung from a girder: its foot is the ceiling line; the sign's underside 1.05 m under it)
    for x in (-0.9, 0.9):
        tube(B, (x, 0, 0), (x, yc + h / 2, 0), 0.015, "atlas", "steel_dark", 4)
    box(B, (0, yc, 0), (w + 0.06, h + 0.06, 0.1), "atlas", "paint_black", skip=("pz", "nz"))
    for nz in (1, -1):
        plane(B, (0, yc, nz * 0.051), (nz, 0, 0), (0, 1, 0), w, h, "glow", "sign_uptown", out=(0, 0, nz))
    return B


def build_ad_frame():
    """poster frame on the wall (poster 1.2 x 1.8 m); +X out of the wall; y from the platform"""
    B = Builder()
    yc = 1.85
    box(B, (0.025, yc, 0), (0.05, 1.92, 1.32), "metal", "steel_plain", skip=("nx",))
    plane(B, (0.052, yc, 0), (0, 0, -1), (0, 1, 0), 1.2, 1.8, "atlas", "ad_soup", out=(1, 0, 0))
    return B


def build_map_frame():
    B = Builder()
    yc = 1.6
    box(B, (0.025, yc, 0), (0.05, 0.72, 1.82), "metal", "steel_plain", skip=("nx",))
    plane(B, (0.052, yc, 0), (0, 0, -1), (0, 1, 0), 1.7, 0.64, "atlas", "map_poster", out=(1, 0, 0))
    return B


def build_plaque():
    B = Builder()
    box(B, (0.02, 0, 0), (0.04, 0.9, 0.9), "atlas", "booth_tan", skip=("nx",))
    plane(B, (0.042, 0, 0), (0, 0, -1), (0, 1, 0), 0.82, 0.82, "atlas", "plaque_leaf", out=(1, 0, 0))
    return B


# the platform stairs: up from the platform to the landing in front of the doorway where a street entrance's
# passage comes through the station wall (world/underground.ts FareArea: 2.0 m up, the passage floor). Same
# numbers as there: 12 risers over 3.42 m, a 4.8 m landing, 2.2 m wide; the station wall on one side (no wall of
# its own there: the doorway is in it), a tiled wall with a maroon band on the other.
PS_RISE, PS_N, PS_RUN, PS_LAND, PS_W = 2.0, 12, 0.285, 4.8, 2.2


def build_platform_stair(outer):
    """outer: the side (+1 = +X) of the tiled wall; the station wall is on the other side. Origin: the platform
    at the foot of the flight, mid-width; the flight rises along +Z, then the landing"""
    B = Builder()
    W, rise, n, run = PS_W, PS_RISE, PS_N, PS_RUN
    rh = rise / n
    L = n * run
    E = L + PS_LAND
    for i in range(n):
        y0, y1 = i * rh, (i + 1) * rh
        z0, z1 = i * run, (i + 1) * run
        B.quad((-W / 2, y0, z0), (W / 2, y0, z0), (W / 2, y1, z0), (-W / 2, y1, z0), "atlas", "concrete_light", out=(0, 0, -1))
        B.quad((-W / 2, y1, z0), (W / 2, y1, z0), (W / 2, y1, z1), (-W / 2, y1, z1), "atlas", "stair_tread",
               ((0, 1), (1, 1), (1, 0.1), (0, 0.1)), out=(0, 1, 0))
    # the landing (its floor is the passage floor), and its end face down to the platform
    B.quad((-W / 2, rise, L), (W / 2, rise, L), (W / 2, rise, E), (-W / 2, rise, E), "atlas", "concrete_light", out=(0, 1, 0))
    B.quad((-W / 2, 0, E), (W / 2, 0, E), (W / 2, rise, E), (-W / 2, rise, E), "atlas", "tile_white", ((0, 0), (3.6, 0), (3.6, 1), (0, 1)), out=(0, 0, 1))
    B.quad((-W / 2, rise - 0.12, E + 0.005), (W / 2, rise - 0.12, E + 0.005), (W / 2, rise, E + 0.005), (-W / 2, rise, E + 0.005), "atlas", "paint_red", out=(0, 0, 1))
    # the outer wall: real 3x6 inch subway tile (the tile_white rect is 4 x 8 tiles: 0.6 m square), laid in
    # 0.6 m cells under the sloping top, with a maroon band under the cap
    top = lambda z: 0.9 if z <= 0 else (rise + 0.9 if z >= L else 0.9 + rise * z / L)
    TS = 0.6

    def tiled(x, outx):
        zs = [-0.05] + [k * TS for k in range(1, int(E / TS) + 1) if k * TS < E] + [L, E]
        zs = sorted(set(round(z, 4) for z in zs))
        for z0, z1 in zip(zs, zs[1:]):
            t0, t1 = top(z0) - 0.14, top(z1) - 0.14
            y = 0.0
            while y < max(t0, t1) - 1e-4:
                y1 = y + TS
                a0, a1 = min(y1, t0), min(y1, t1)
                if a0 > y + 1e-4 or a1 > y + 1e-4:
                    a0, a1 = max(a0, y), max(a1, y)
                    s0 = z0 / TS - math.floor(z0 / TS + 1e-6)
                    s1 = s0 + (z1 - z0) / TS
                    B.face([(x, y, z0), (x, y, z1), (x, a1, z1), (x, a0, z0)], "atlas", "tile_white",
                           [(s0, 0), (s1, 0), (s1, (a1 - y) / TS), (s0, (a0 - y) / TS)], out=(outx, 0, 0))
                y = y1
            B.face([(x, t0, z0), (x, t1, z1), (x, t1 + 0.14, z1), (x, t0 + 0.14, z0)], "atlas", "paint_red", out=(outx, 0, 0))

    sx = outer
    x = sx * (W / 2 + 0.2)
    tiled(x, sx)
    tiled(x - sx * 0.2, -sx)
    B.quad((x - sx * 0.2, 0.9, 0), (x, 0.9, 0), (x, rise + 0.9, L), (x - sx * 0.2, rise + 0.9, L), "atlas", "concrete_light", out=(0, 1, -0.5))
    B.quad((x - sx * 0.2, rise + 0.9, L), (x, rise + 0.9, L), (x, rise + 0.9, E), (x - sx * 0.2, rise + 0.9, E), "atlas", "concrete_light", out=(0, 1, 0))
    B.quad((x - sx * 0.2, 0, -0.05), (x, 0, -0.05), (x, 0.9, -0.05), (x - sx * 0.2, 0.9, -0.05), "atlas", "concrete_light", out=(0, 0, -1))
    B.quad((x - sx * 0.2, 0, E), (x, 0, E), (x, rise + 0.9, E), (x - sx * 0.2, rise + 0.9, E), "atlas", "concrete_light", out=(0, 0, 1))
    # handrails: on the tiled wall and on the station wall, on brackets
    for hs in (-1, 1):
        hx = hs * (W / 2 - 0.08)
        tube(B, (hx, 0.95, -0.2), (hx, rise + 0.95, L), 0.025, "metal", "steel_plain", 6)
        tube(B, (hx, rise + 0.95, L), (hx, rise + 0.95, L + 0.6), 0.025, "metal", "steel_plain", 6)
        for t in (0.1, 0.5, 0.9):
            p = V(hx, t * rise + 0.95, t * L)
            tube(B, tuple(p), tuple(p + V(hs * 0.12, -0.05, 0)), 0.012, "metal", "steel_plain", 4)
    # a railing across the landing's far end, over the drop to the platform
    tube(B, (-W / 2, rise + 1.0, E - 0.05), (W / 2, rise + 1.0, E - 0.05), 0.025, "metal", "steel_plain", 6)
    for xx in (-W / 2 + 0.05, 0, W / 2 - 0.05):
        tube(B, (xx, rise, E - 0.05), (xx, rise + 1.0, E - 0.05), 0.02, "metal", "steel_plain", 5)
    return B


def build_barrier():
    """a steel crowd-control barrier (the grey interlocking kind): 2.3 m along X, 1.1 m high, on two flat feet"""
    B = Builder()
    Lb, H = 2.3, 1.1
    for y in (0.22, H - 0.04):
        tube(B, (-Lb / 2, y, 0), (Lb / 2, y, 0), 0.024, "metal", "heet_grey", 6)
    for x in (-Lb / 2, Lb / 2):
        tube(B, (x, 0.12, 0), (x, H, 0), 0.024, "metal", "heet_grey", 6)
    for i in range(1, 15):
        x = -Lb / 2 + i * Lb / 15
        tube(B, (x, 0.22, 0), (x, H - 0.04, 0), 0.01, "metal", "heet_grey", 4)
    for x in (-Lb / 2 + 0.25, Lb / 2 - 0.25):
        box(B, (x, 0.015, 0), (0.06, 0.03, 0.7), "metal", "heet_grey")
        tube(B, (x, 0.03, 0), (x, 0.22, 0), 0.02, "metal", "heet_grey", 5)
    box(B, (0, 0.66, 0.012), (0.5, 0.18, 0.012), "atlas", "white")   # a blank plate
    return B


def build_street_entrance():
    """the street entrance around a 4.2 m square stair opening: green-painted railings on three
    sides, globe lamps on posts at the open (-Z) side and a sign on the back railing. origin: street level"""
    B = Builder()
    r = 2.15
    Hr = 1.05
    rails = [((-r, -r), (-r, r)), ((-r, r), (r, r)), ((r, r), (r, -r))]
    for (x0, z0), (x1, z1) in rails:
        for y in (0.08, Hr - 0.1, Hr):
            tube(B, (x0, y, z0), (x1, y, z1), 0.03 if y == Hr else 0.018, "atlas", "paint_green", 6)
        L = math.hypot(x1 - x0, z1 - z0)
        n = int(L / 0.14)
        for i in range(1, n):
            t = i / n
            x, z = x0 + (x1 - x0) * t, z0 + (z1 - z0) * t
            tube(B, (x, 0.08, z), (x, Hr - 0.1, z), 0.01, "atlas", "paint_green", 4)
            if i % 2 == 0:
                disc(B, (x, Hr - 0.2, z), (z1 - z0, 0, -(x1 - x0)), 0.035, "atlas", "paint_green", 6)
    for x, z in ((-r, -r), (-r, r), (r, r), (r, -r)):
        box(B, (x, Hr / 2 + 0.05, z), (0.12, Hr + 0.1, 0.12), "atlas", "paint_green")
        cyl(B, (x, Hr + 0.1, z), (x, Hr + 0.18, z), 0.07, 8, "atlas", "paint_green", r2=0.02)
    # globe lamps either side of the way in
    for x in (-r, r):
        cyl(B, (x, 0, -r - 0.2), (x, 2.2, -r - 0.2), 0.05, 8, "atlas", "paint_green")
        cyl(B, (x, 0, -r - 0.2), (x, 0.3, -r - 0.2), 0.12, 8, "atlas", "paint_green", r2=0.06)
        cyl(B, (x, 2.2, -r - 0.2), (x, 2.28, -r - 0.2), 0.1, 8, "atlas", "paint_green")
        # the globe (a squat ico-ish sphere: two cones)
        sphere(B, (x, 2.5, -r - 0.2), 0.23, "glow", "globe_green")
    # sign on posts above the back railing, readable from the way in (-Z) and from behind
    for x in (-0.95, 0.95):
        tube(B, (x, Hr, r), (x, Hr + 0.9, r), 0.025, "atlas", "paint_green", 6)
    box(B, (0, Hr + 0.85, r), (2.1, 0.42, 0.08), "atlas", "paint_black", skip=("pz", "nz"))
    plane(B, (0, Hr + 0.85, r - 0.041), (-1, 0, 0), (0, 1, 0), 2.0, 0.36, "glow", "sign_entrance", out=(0, 0, -1))
    plane(B, (0, Hr + 0.85, r + 0.041), (1, 0, 0), (0, 1, 0), 2.0, 0.36, "glow", "sign_entrance", out=(0, 0, 1))
    return B


# ============================================================ materials, export, previews

# ============================================================ station life (fare machines, a sleeper, a busker)

def build_fare_machine():
    """a fare-card vending machine against the wall: 0.6 deep (+X out of the wall), 0.95 wide (Z), 1.85 tall.
    origin: the platform top at the wall"""
    B = Builder()
    D, W, H = 0.6, 0.95, 1.85
    box(B, (D / 2, 0.06, 0), (D - 0.04, 0.12, W - 0.04), "atlas", "rubber")                  # kick plate
    box(B, (D / 2, 0.12 + (H - 0.32) / 2, 0), (D, H - 0.32, W), "metal", "paint_blue", skip=("px", "ny"))
    plane(B, (D + 0.001, 0.12 + 0.35, 0), (0, 0, -1), (0, 1, 0), W, 0.7, "metal", "paint_blue", out=(1, 0, 0))
    plane(B, (D + 0.002, 0.12 + 0.7 + 0.42, 0), (0, 0, -1), (0, 1, 0), W - 0.04, 0.84, "atlas", "fare_machine", out=(1, 0, 0))
    # the lit header and the hood over the screen
    box(B, (D / 2 + 0.02, H - 0.1, 0), (D + 0.04, 0.2, W + 0.04), "atlas", "paint_black")
    box(B, (D + 0.06, 1.43, 0), (0.12, 0.03, W - 0.1), "metal", "steel_dark")
    return B


def figure_coat(B, M, c, size, rect="coat_tweed"):
    box(B, tuple(V(c)), size, "atlas", rect, M=M)


def build_sleeper():
    """someone asleep along a platform bench under a newspaper, a bag for a pillow. Same frame as the
    bench (seat facing +X, 2.4 m along Z); origin the platform top under the bench's middle"""
    B = Builder()
    seat = 0.48
    # bag under the head, shoes at the far end
    box(B, (0.0, seat + 0.09, 0.95), (0.34, 0.18, 0.4), "atlas", "paint_red")
    # legs (bent a little at the knee), the coat over the body, the arms folded on it
    box(B, (0.02, seat + 0.09, -0.62), (0.3, 0.18, 0.62), "atlas", "wood_dark")
    box(B, (0.0, seat + 0.1, -0.12), (0.34, 0.2, 0.42), "atlas", "wood_dark", M=RX(-0.12))
    box(B, (0.0, seat + 0.15, 0.36), (0.42, 0.3, 0.62), "atlas", "coat_tweed")
    box(B, (0.12, seat + 0.3, 0.32), (0.16, 0.08, 0.4), "atlas", "coat_tweed")
    box(B, (0.02, seat + 0.12, -1.0), (0.26, 0.2, 0.14), "atlas", "rubber")
    # the head on the bag, a knit hat, and the paper over the face
    sphere(B, (0.0, seat + 0.27, 0.82), 0.11, "atlas", "booth_tan", segs=10, rings=5)
    cyl(B, (0.0, seat + 0.27, 0.84), (0.0, seat + 0.27, 0.95), 0.115, 10, "atlas", "paint_green", r2=0.07)
    # (spread over the chest and face, tilted a little toward the platform so it reads from there)
    plane(B, (0.03, seat + 0.36, 0.62), (0, 0, -1), (0.96, 0.28, 0), 0.52, 0.4, "atlas", "newspaper", out=(-0.28, 0.96, 0))
    return B


def build_busker():
    """a guitarist on an upturned milk crate, the case open in front for coins, a cardboard sign.
    Faces +X; origin the platform top under the crate"""
    B = Builder()
    box(B, (0, 0.17, 0), (0.34, 0.34, 0.34), "atlas", "orange")
    # legs: thighs forward, shins down, boots
    for z in (-0.1, 0.1):
        box(B, (0.2, 0.42, z), (0.42, 0.15, 0.15), "atlas", "paint_blue")
        box(B, (0.4, 0.21, z), (0.13, 0.42, 0.13), "atlas", "paint_blue")
        box(B, (0.45, 0.05, z), (0.24, 0.1, 0.12), "atlas", "rubber")
    # body in a heavy coat, scarf, head, beanie
    box(B, (-0.02, 0.72, 0), (0.26, 0.56, 0.4), "atlas", "coat_tweed", M=RZ(-0.08))
    box(B, (0.0, 1.0, 0), (0.22, 0.08, 0.3), "atlas", "paint_red")
    sphere(B, (0.0, 1.13, 0), 0.11, "atlas", "booth_tan", segs=10, rings=5)
    cyl(B, (-0.01, 1.15, 0), (-0.02, 1.27, 0), 0.115, 10, "atlas", "paint_yellow", r2=0.06)
    # the guitar across the lap: body (two lobes) facing +X, neck out to the left (-Z)
    for zc, r in ((0.07, 0.17), (-0.15, 0.13)):
        cyl(B, (0.19, 0.66, zc), (0.27, 0.66, zc), r, 12, "atlas", "bench_wood")
    disc(B, (0.275, 0.66, -0.02), (1, 0, 0), 0.045, "atlas", "rubber", 8)
    box(B, (0.24, 0.72, -0.55), (0.04, 0.05, 0.62), "atlas", "wood_dark", M=RX(0.25))
    box(B, (0.24, 0.8, -0.87), (0.05, 0.07, 0.12), "atlas", "wood_dark", M=RX(0.25))
    # arms: one over the strings, one up the neck
    box(B, (0.15, 0.78, 0.1), (0.3, 0.1, 0.1), "atlas", "coat_tweed", M=RY(-0.3))
    box(B, (0.13, 0.76, -0.32), (0.1, 0.1, 0.42), "atlas", "coat_tweed", M=RX(0.2))
    # the case: open on the floor in front, red lining, coins, the sign propped in it
    box(B, (0.95, 0.04, 0), (0.42, 0.08, 1.05), "atlas", "paint_black", skip=("py",))
    plane(B, (0.95, 0.075, 0), (0, 0, 1), (1, 0, 0), 1.0, 0.38, "atlas", "paint_red", out=(0, 1, 0))
    box(B, (1.38, 0.015, 0), (0.42, 0.03, 1.05), "atlas", "paint_black")      # the lid, flat open beyond it
    for i in range(7):
        disc(B, (0.88 + 0.03 * (i % 3), 0.078, -0.3 + i * 0.08), (0, 1, 0), 0.016, "atlas", "brass", 6)
    plane(B, (0.95, 0.24, 0.32), (0, 0, -1), (0.45, 0.89, 0), 0.32, 0.32, "atlas", "busker_sign", out=(0.89, -0.45, 0))
    return B


def commuter(B, coat, legs, hat, extra):
    """someone standing on the platform waiting, facing +X (the tracks); origin the platform top"""
    for z in (-0.09, 0.09):
        box(B, (0.0, 0.42, z), (0.15, 0.84, 0.14), "atlas", legs)
        box(B, (0.04, 0.04, z), (0.26, 0.08, 0.13), "atlas", "rubber")
    box(B, (0.0, 1.12, 0), (0.3, 0.62, 0.46), "atlas", coat)                 # coat
    box(B, (0.0, 0.83, 0), (0.32, 0.12, 0.48), "atlas", coat)                # its skirt
    box(B, (0.01, 1.47, 0), (0.2, 0.08, 0.26), "atlas", "paint_red" if coat != "paint_red" else "paint_grey")  # scarf
    sphere(B, (0.0, 1.6, 0), 0.105, "atlas", "booth_tan", segs=10, rings=5)
    if hat == "beanie":
        cyl(B, (0.0, 1.62, 0), (0.0, 1.74, 0), 0.11, 10, "atlas", "paint_green", r2=0.05)
    else:
        cyl(B, (0.0, 1.66, 0), (0.0, 1.68, 0), 0.17, 10, "atlas", "paint_black")
        cyl(B, (0.0, 1.68, 0), (0.0, 1.8, 0), 0.105, 10, "atlas", "paint_black")
    if extra == "bag":
        box(B, (0.0, 0.95, 0.27), (0.08, 0.5, 0.06), "atlas", coat)          # arm down
        box(B, (0.0, 0.62, 0.3), (0.12, 0.3, 0.38), "atlas", "wood_dark")    # briefcase
        box(B, (0.0, 0.95, -0.27), (0.08, 0.5, 0.06), "atlas", coat)
    else:
        # looking at a phone: forearms forward, the screen lit
        for z in (-0.12, 0.12):
            box(B, (0.1, 1.05, z * 1.9), (0.08, 0.36, 0.08), "atlas", coat)
            box(B, (0.2, 1.17, z * 0.7), (0.24, 0.08, 0.08), "atlas", coat)
        box(B, (0.33, 1.22, 0), (0.02, 0.15, 0.08), "atlas", "rubber")
        plane(B, (0.341, 1.22, 0), (0, 0, -1), (0, 1, 0), 0.07, 0.13, "glow", "reader_screen", out=(1, 0, 0))


def build_commuter_a():
    B = Builder()
    commuter(B, "coat_tweed", "paint_grey", "hat", "bag")
    return B


def build_commuter_b():
    B = Builder()
    commuter(B, "paint_blue", "wood_dark", "beanie", "phone")
    return B


def convert_textures():
    s = bpy.context.scene
    s.render.image_settings.file_format = "JPEG"
    s.render.image_settings.quality = 86
    s.view_settings.view_transform = "Standard"
    out = {}
    for src, dst in (("Atlas.png", "subway_atlas.jpg"), ("StationWall.png", "subway_station_wall.jpg"),
                     ("TunnelWall.png", "subway_tunnel_wall.jpg"), ("Floor.png", "subway_floor.jpg")):
        img = bpy.data.images.load(os.path.join(ATLAS_DIR, src))
        p = os.path.join(OUT, dst)
        img.save_render(p, scene=s)
        out[src] = img
    return out


def make_materials(atlas_img):
    def mat(name, rough, metal, emit=0.0, image=None, color=(1, 1, 1)):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = (*color, 1)
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = metal
        if image:
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image = image
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
            if emit:
                nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
        elif emit:
            bsdf.inputs["Emission Color"].default_value = (*color, 1)
        bsdf.inputs["Emission Strength"].default_value = emit
        return m
    return {"atlas": mat("atlas", 0.75, 0.0, image=atlas_img), "metal": mat("metal", 0.35, 0.35, image=atlas_img),
            "glow": mat("glow", 0.5, 0.0, emit=2.0, image=atlas_img), "lamp": mat("lamp", 0.3, 0.0, emit=6.0, color=(1, 0.95, 0.85))}


def finish(name, B, mats):
    me = bpy.data.meshes.new(name)
    B.bm.to_mesh(me)
    B.bm.free()
    for mn in MATS:
        me.materials.append(mats[mn])
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


BUILDERS = [
    ("car_front", lambda: build_car(True)), ("car_mid", lambda: build_car(False)),
    ("track", build_track), ("platform_edge", build_platform_edge),
    ("column", build_column), ("ibeam", build_ibeam),
    ("cable_run", build_cable_run), ("work_light", build_work_light),
    ("signal_red", lambda: build_signal("red")), ("signal_green", lambda: build_signal("green")),
    ("blue_light", build_blue_light), ("emergency_light", build_emergency_light), ("fluor", build_fluor),
    ("turnstile", build_turnstile), ("exit_gate", build_exit_gate), ("emergency_gate", build_emergency_gate),
    ("fare_rail", build_fare_rail), ("booth", build_booth), ("bench", build_bench), ("trash", build_trash),
    ("sign_hang", build_sign_hang), ("ad_frame", build_ad_frame), ("map_frame", build_map_frame), ("plaque", build_plaque),
    ("platform_stair_a", lambda: build_platform_stair(-1)), ("platform_stair_b", lambda: build_platform_stair(1)),
    ("barrier", build_barrier), ("street_entrance", build_street_entrance),
    ("fluor_hung", build_fluor_hung), ("girder", build_girder), ("conduit", build_conduit), ("cctv", build_cctv), ("speaker", build_speaker),
    ("fare_machine", build_fare_machine), ("sleeper", build_sleeper), ("busker", build_busker),
    ("commuter_a", build_commuter_a), ("commuter_b", build_commuter_b),
]


def export(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    path = os.path.join(OUT, "subway.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True,
                              export_apply=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_image_format="NONE", export_animations=False)
    return path


def clean_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)


def place(ob, x, y, z, yaw=0.0):
    """position in three space (y up), yaw about three Y"""
    ob.location = (x, -z, y)
    ob.rotation_euler = (0, 0, yaw)


def previews(objs, imgs, only=None):
    s = bpy.context.scene
    s.render.engine = "BLENDER_EEVEE"
    s.render.threads_mode = "FIXED"
    s.render.threads = 8
    s.render.image_settings.file_format = "PNG"
    s.view_settings.view_transform = "AgX"
    world = bpy.data.worlds.new("dark")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.16, 0.15, 0.15, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    s.world = world
    bpy.ops.object.light_add(type="SUN", rotation=(math.radians(55), 0, math.radians(-30)))
    sun = bpy.context.object
    sun.data.energy = 2.2
    sun.data.color = (1.0, 0.9, 0.75)
    bpy.ops.object.camera_add()
    cam = bpy.context.object
    s.camera = cam
    cam.data.clip_end = 400
    os.makedirs(PREV, exist_ok=True)
    by = {o.name: o for o in objs}

    def shoot(name, target, dist, yaw, elev, res=(1400, 800), lens=40):
        if only and name not in only:
            return
        cam.data.lens = lens
        t = Vector((target[0], -target[2], target[1]))
        d = Vector((math.sin(math.radians(yaw)), -math.cos(math.radians(yaw)), math.tan(math.radians(elev))))
        cam.location = t + d.normalized() * dist
        cam.rotation_euler = (t - cam.location).to_track_quat("-Z", "Y").to_euler()
        s.render.resolution_x, s.render.resolution_y = res
        s.render.filepath = os.path.join(PREV, name + ".png")
        bpy.ops.render.render(write_still=True)

    def show(names):
        for o in s.objects:
            if o.type == "MESH":
                o.hide_render = o.name.split(".")[0] not in names

    # ground for context
    bpy.ops.mesh.primitive_plane_add(size=300, location=(0, 0, -0.001))
    g = bpy.context.object
    gm = bpy.data.materials.new("g")
    gm.use_nodes = True
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.08, 0.075, 0.07, 1)
    g.data.materials.append(gm)
    g.name = "ground"

    # a train on its track: two cars on a run of track modules
    tracks = []
    for k in range(-6, 7):
        o = by["track"].copy()
        s.collection.objects.link(o)
        place(o, 0, 0, k * 4)
        tracks.append(o.name)
    place(by["car_front"], 0, RAIL_TOP, 9.4)
    mid = by["car_mid"]
    place(mid, 0, RAIL_TOP, -9.4)
    show(["track", "car_front", "car_mid", "ground"])
    shoot("train_front", (0, 1.9, 17.5), 13, 35, 6)
    shoot("train_side", (0, 2.0, 0), 26, 90, 4, res=(1800, 700))
    shoot("train_low", (1.8, 0.6, 14), 7, 120, -2)
    show(["track", "ground"])
    shoot("track", (0, 0.3, 0), 6, 140, 28)
    place(by["car_front"], 0, 0, 0)
    place(by["car_mid"], 0, 0, 0)
    for n in tracks:
        s.objects[n].hide_render = True

    # station props lineup
    line = ["turnstile", "exit_gate", "emergency_gate", "fare_rail", "booth", "bench", "trash", "platform_stair_a", "barrier", "street_entrance"]
    x = 0.0
    for n in line:
        place(by[n], x, 0, 0, math.radians(180) if n == "platform_stair_a" else 0)
        x += {"booth": 3.2, "platform_stair_a": 3.5, "barrier": 2.6, "street_entrance": 5.5, "exit_gate": 2.2}.get(n, 1.6)
    show(line + ["ground"])
    shoot("station_props", (x / 2 - 1, 1.2, 0), x * 0.95, 0, 14, res=(1800, 700))
    shoot("fare_line", (2, 1.0, 0), 5.5, 25, 18)
    # tunnel / wall props
    wall = ["cable_run", "signal_red", "signal_green", "blue_light", "emergency_light", "work_light", "ibeam", "column", "sign_hang",
            "ad_frame", "map_frame", "plaque", "fluor", "platform_edge"]
    x = 0.0
    for n in wall:
        y = {"work_light": 3.0, "emergency_light": 2.0, "sign_hang": 3.2, "plaque": 2.5, "fluor": 3.4}.get(n, 0)
        place(by[n], x, y, 0, math.radians(-90))
        x += {"cable_run": 4.5, "ibeam": 1.2, "sign_hang": 2.8, "ad_frame": 1.6, "map_frame": 2.2}.get(n, 1.2)
    show(wall + ["ground"])
    shoot("wall_props", (x / 2, 1.8, 0), x * 0.8, 0, 10, res=(1800, 700))
    # station life: a fare machine, the sleeper on a bench, the busker
    place(by["fare_machine"], -2.2, 0, 0, math.radians(-90))
    place(by["bench"], 0, 0, 0, math.radians(-90))
    place(by["sleeper"], 0, 0, 0, math.radians(-90))
    place(by["busker"], 2.6, 0, 0, math.radians(-90))
    place(by["commuter_a"], 4.4, 0, 0.8, math.radians(-90))
    place(by["commuter_b"], 5.4, 0, 0.8, math.radians(-90))
    show(["fare_machine", "bench", "sleeper", "busker", "commuter_a", "commuter_b", "ground"])
    shoot("station_life", (1.6, 0.9, 0.4), 7.0, 0, 14, res=(1600, 800))
    shoot("station_life_close", (2.8, 0.6, 0.6), 2.4, 30, 18)
    for o in objs:
        place(o, 0, 0, 0)


def main():
    clean_scene()
    imgs = convert_textures()
    mats = make_materials(imgs["Atlas.png"])
    objs, info = [], {}
    for name, fn in BUILDERS:
        B = fn()
        info[name] = B.tris()
        print(f"[subway] {name}: {B.tris()} tris", flush=True)
        objs.append(finish(name, B, mats))
    path = export(objs)
    print("[subway] exported", path, os.path.getsize(path), "bytes")
    meta = {"railTop": RAIL_TOP, "carLength": CAR_L, "bodyHalfLength": BODY_HL, "trackModule": TRACK_L, "platformHeight": PLATFORM_H,
            "tris": info, "atlas": LAYOUT}
    with open(os.path.join(OUT, "subway.json"), "w") as f:
        json.dump(meta, f)
    if "--no-previews" not in FLAGS:
        only = None
        if "--prev" in FLAGS:
            only = FLAGS[FLAGS.index("--prev") + 1].split(",")
        previews(objs, imgs, only)


main()
