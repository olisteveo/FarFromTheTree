"""
Far From the Tree - subway entrance styles, air-vent hardware and stairwell fittings, modelled in code
(headless Blender 5.2).

    blender -b -t 8 --factory-startup --python entrances_blender.py -- <models_dir> <tex_dir> <atlas_dir> <preview_dir> [--no-previews]

Writes <models_dir>/entrances.glb (geometry + named material slots, no embedded images), entrances.json
(atlas layout + triangle counts) and <tex_dir>/{atlas,stair_wall}.webp + grate.png (alpha keyed from black).

Modelling space is the game's (three.js) space, in a shaft's own frame (underground.ts):
  +X  across the opening (b)          +Y  up (origin at the sidewalk / road surface)
  +Z  along +a: for stairs toward the tunnel (the open way in is at -Z), for vents along the tunnel
The stair opening is |X| < 1.95, |Z| < 2.1; nothing may stand inside that column, nor on its open -Z
side, nor over it (the leaf flies in from in front and from above). The SUBWAY sign post (subwaySigns.ts)
stands at X = 0, Z = 2.55. Vents: the grate is |X| < 1.4, |Z| < 4.6, the shaft drops to y = -2.6.

Material slots (every object, same order): atlas, metal, glow, glass, grate.
"""
import bpy, bmesh, math, os, sys, json
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT, TEX, ATLAS_DIR, PREV = argv[0], argv[1], argv[2], argv[3]
FLAGS = argv[4:]
LAYOUT = json.load(open(os.path.join(ATLAS_DIR, "layout.json")))
RECTS = LAYOUT["rects"]
AW, AH = LAYOUT["size"]
SWATCH = set(LAYOUT["swatches"]) | set(LAYOUT["glows"])
MATS = ["atlas", "metal", "glow", "glass", "grate"]
MI = {n: i for i, n in enumerate(MATS)}

OPEN_X, OPEN_Z = 1.95, 2.1
VENT_X, VENT_Z, VENT_DEPTH = 1.4, 4.6, 2.6


def V(*a):
    return Vector(a[0] if len(a) == 1 else a)


def uv_of(rect, s, t):
    if rect is None:
        return (s, t)
    x, y, w, h = RECTS[rect]
    if rect in SWATCH:
        s, t = 0.5, 0.5
    s = min(1.0, max(0.0, s))
    t = min(1.0, max(0.0, t))
    u = (x + 0.5 + s * (w - 1)) / AW
    v = 1 - (y + 0.5 + (1 - t) * (h - 1)) / AH
    return (u, v)


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
        """pts in three space; st: per-point (s, t) inside the rect (raw uvs when rect is None)"""
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
    ax = max(range(3), key=lambda i: abs(n[i]))
    if ax == 1:
        si, ti = 0, 2
    else:
        si, ti = (2 if ax == 0 else 0), 1
    if mode == "fit":
        s = (p[si] - lo[si]) / max(1e-6, hi[si] - lo[si])
        t = (p[ti] - lo[ti]) / max(1e-6, hi[ti] - lo[ti])
    else:
        s = (p[si] - lo[si]) / span[0]
        t = (p[ti] - lo[ti]) / span[1]
    if (ax == 0 and n[0] > 0) or (ax == 2 and n[2] < 0):
        s = 1 - s if mode == "fit" else (hi[si] - p[si]) / span[0]
    return (s, t)


def box(B, c, size, mat="atlas", rect="steel_dark", mode="fit", span=(1, 1), M=None, skip=(), rects=None, mats=None):
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


def bx(B, x0, x1, y0, y1, z0, z1, mat="atlas", rect="steel_dark", **kw):
    """box from extents"""
    box(B, ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (x1 - x0, y1 - y0, z1 - z0), mat, rect, **kw)


def frame_axes(d):
    d = d.normalized()
    up = V(0, 1, 0) if abs(d.y) < 0.9 else V(1, 0, 0)
    s = d.cross(up).normalized()
    u = s.cross(d).normalized()
    return d, s, u


def cyl(B, a, b, r, segs=8, mat="atlas", rect="steel_dark", caps=True, r2=None, smooth=True, t_span=None):
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
    c = V(c)
    for i in range(rings):
        a0, a1 = math.pi * i / rings - math.pi / 2, math.pi * (i + 1) / rings - math.pi / 2
        cyl(B, tuple(c + V(0, math.sin(a0) * r, 0)), tuple(c + V(0, math.sin(a1) * r, 0)), max(1e-5, math.cos(a0) * r), segs, mat, rect,
            caps=False, r2=max(1e-5, math.cos(a1) * r))


def tube(B, a, b, r, mat="metal", rect="steel_dark", segs=6):
    cyl(B, a, b, r, segs, mat, rect, caps=False)


def disc(B, c, n, r, mat, rect, segs=10):
    c, n = V(c), V(n).normalized()
    _, s, u = frame_axes(n)
    pts = [c + (s * math.cos(2 * math.pi * i / segs) + u * math.sin(2 * math.pi * i / segs)) * r for i in range(segs)]
    st = [(0.5 + 0.5 * math.cos(2 * math.pi * i / segs), 0.5 + 0.5 * math.sin(2 * math.pi * i / segs)) for i in range(segs)]
    B.face(pts, mat, rect, st, out=n)


def plane(B, c, right, up, w, h, mat, rect, out=None, st=None):
    c, R, U = V(c), V(right).normalized(), V(up).normalized()
    pts = [c - R * w / 2 - U * h / 2, c + R * w / 2 - U * h / 2, c + R * w / 2 + U * h / 2, c - R * w / 2 + U * h / 2]
    B.face(pts, mat, rect, list(st or [(0, 0), (1, 0), (1, 1), (0, 1)]), out=out if out is not None else R.cross(U))


def arc_pts(cx, cy, rx, ry, a0, a1, n):
    return [(cx + rx * math.cos(a0 + (a1 - a0) * i / n), cy + ry * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


def finial(B, x, y, z, h=0.32, rect="iron_green", mat="atlas"):
    cyl(B, (x, y, z), (x, y + h * 0.35, z), 0.05, 8, mat, rect, r2=0.03)
    sphere(B, (x, y + h * 0.5, z), 0.06, mat, rect, 8, 4)
    cyl(B, (x, y + h * 0.6, z), (x, y + h, z), 0.035, 6, mat, rect, r2=0.0)


def globe_lamp(B, x, z, y_top, rect="globe_green", post_rect="iron_green", post=True, base_y=0.0):
    """the classic globe on a post (or a stub when post=False, sitting at y_top)"""
    if post:
        cyl(B, (x, base_y, z), (x, base_y + 0.3, z), 0.12, 8, "atlas", post_rect, r2=0.06)
        cyl(B, (x, base_y, z), (x, y_top, z), 0.05, 8, "atlas", post_rect)
    cyl(B, (x, y_top, z), (x, y_top + 0.08, z), 0.1, 8, "atlas", post_rect, r2=0.12)
    sphere(B, (x, y_top + 0.32, z), 0.23, "glow", rect, 12, 6)
    cyl(B, (x, y_top + 0.54, z), (x, y_top + 0.62, z), 0.05, 6, "atlas", post_rect, r2=0.0)


# ============================================================ entrance style 1: cast-iron kiosk (Beaux-Arts)

def build_kiosk():
    """Cast iron and glass, after the 1904 kiosks: panelled dado, glazed sides and back, a frieze, a
    glazed hip on the outer edges and open arched ribs over the stair (the leaf drops straight in)."""
    B = Builder()
    X, Z0, Z1 = 2.15, -2.2, 2.25
    y0 = 0.0
    DADO, GL, EAVE = 1.0, 2.35, 2.65
    posts_z = [Z0, -0.73, 0.76, Z1]
    # walls: sides (x = +-X) and back (z = Z1)
    walls = [((-X, Z0), (-X, Z1)), ((X, Z0), (X, Z1)), ((-X, Z1), (X, Z1))]
    for (xa, za), (xb, zb) in walls:
        L = math.hypot(xb - xa, zb - za)
        tx, tz = (xb - xa) / L, (zb - za) / L
        nx, nz = -tz, tx   # one side; faces are double-sided by drawing both
        n_pan = max(1, int(round(L / 1.48)))
        for k in range(n_pan):
            ta, tb = k / n_pan, (k + 1) / n_pan
            pa = (xa + (xb - xa) * ta, za + (zb - za) * ta)
            pb = (xa + (xb - xa) * tb, za + (zb - za) * tb)
            for sgn in (1, -1):
                o = 0.045 * sgn
                ox, oz = nx * o, nz * o
                B.quad((pa[0] + ox, y0 + 0.12, pa[1] + oz), (pb[0] + ox, y0 + 0.12, pb[1] + oz), (pb[0] + ox, DADO, pb[1] + oz), (pa[0] + ox, DADO, pa[1] + oz),
                       "atlas", "iron_panel", out=(nx * sgn, 0, nz * sgn))
            # glass between mullions, two lights per bay with a transom
            mid = ((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2)
            B.quad((pa[0], DADO, pa[1]), (pb[0], DADO, pb[1]), (pb[0], GL, pb[1]), (pa[0], GL, pa[1]), "glass", "glass", out=(nx, 0, nz))
            tube(B, (mid[0], DADO, mid[1]), (mid[0], GL, mid[1]), 0.025, "atlas", "iron_green", 6)
            tube(B, (pa[0], 2.0, pa[1]), (pb[0], 2.0, pb[1]), 0.022, "atlas", "iron_green", 6)
        # plinth and the dado rail, the glazing head
        bx(B, min(xa, xb) - 0.07, max(xa, xb) + 0.07, y0, y0 + 0.12, min(za, zb) - 0.07, max(za, zb) + 0.07, "atlas", "granite_dark")
        tube(B, (xa, DADO, za), (xb, DADO, zb), 0.055, "atlas", "iron_green", 8)
        tube(B, (xa, GL, za), (xb, GL, zb), 0.06, "atlas", "iron_green", 8)
    # fluted posts with bases and capitals
    corners = [(-X, z) for z in posts_z] + [(X, z) for z in posts_z] + [(-0.73, Z1), (0.73, Z1)]
    for x, z in corners:
        cyl(B, (x, y0, z), (x, 0.35, z), 0.11, 8, "atlas", "iron_green", r2=0.085)
        cyl(B, (x, 0.35, z), (x, EAVE - 0.15, z), 0.075, 8, "atlas", "iron_green")
        for k in range(4):   # flutes: raised ribs
            a = k * math.pi / 2 + math.pi / 4
            tube(B, (x + math.cos(a) * 0.07, 0.4, z + math.sin(a) * 0.07), (x + math.cos(a) * 0.07, EAVE - 0.2, z + math.sin(a) * 0.07), 0.018, "atlas", "iron_green", 4)
        cyl(B, (x, EAVE - 0.15, z), (x, EAVE, z), 0.08, 8, "atlas", "iron_green", r2=0.14)
    # frieze / eave all round (front too: a beam over the way in), with a dentil row
    EX = X + 0.32
    for (xa, za), (xb, zb), out in (((-EX, Z0 - 0.3), (-EX, Z1 + 0.3), (-1, 0, 0)), ((EX, Z0 - 0.3), (EX, Z1 + 0.3), (1, 0, 0)),
                                    ((-EX, Z1 + 0.3), (EX, Z1 + 0.3), (0, 0, 1)), ((-EX, Z0 - 0.3), (EX, Z0 - 0.3), (0, 0, -1))):
        B.quad((xa, EAVE, za), (xb, EAVE, zb), (xb, EAVE + 0.32, zb), (xa, EAVE + 0.32, za), "atlas", "iron_green", ((0, 0), (4, 0), (4, 0.3), (0, 0.3)), out=out)
        L = math.hypot(xb - xa, zb - za)
        for k in range(int(L / 0.18)):
            t = (k + 0.5) / int(L / 0.18)
            px, pz = xa + (xb - xa) * t + out[0] * 0.03, za + (zb - za) * t + out[2] * 0.03
            box(B, (px, EAVE + 0.27, pz), (0.07 if out[0] == 0 else 0.06, 0.06, 0.06 if out[0] == 0 else 0.07), "atlas", "iron_green")
    # eave soffit (underside) from the frieze back to the wall line
    for sgn in (-1, 1):
        B.quad((sgn * X, EAVE, Z0 - 0.3), (sgn * EX, EAVE, Z0 - 0.3), (sgn * EX, EAVE, Z1 + 0.3), (sgn * X, EAVE, Z1 + 0.3), "atlas", "iron_dark", out=(0, -1, 0))
        # the glazed hip: from the eave up and in to x = +-1.75 (never over the opening's middle)
        B.quad((sgn * EX, EAVE + 0.32, Z0 - 0.3), (sgn * EX, EAVE + 0.32, Z1 + 0.3), (sgn * 1.75, EAVE + 0.72, Z1 + 0.3), (sgn * 1.75, EAVE + 0.72, Z0 - 0.3),
               "glass", "glass", out=(sgn * 0.5, 1, 0))
        tube(B, (sgn * 1.75, EAVE + 0.72, Z0 - 0.3), (sgn * 1.75, EAVE + 0.72, Z1 + 0.3), 0.05, "atlas", "iron_green", 6)
        for k in range(7):
            z = Z0 - 0.3 + (Z1 - Z0 + 0.6) * k / 6
            tube(B, (sgn * EX, EAVE + 0.32, z), (sgn * 1.75, EAVE + 0.72, z), 0.025, "atlas", "iron_green", 4)
    B.quad((-EX, EAVE, Z1 + 0.3), (EX, EAVE, Z1 + 0.3), (EX, EAVE, Z1), (-EX, EAVE, Z1), "atlas", "iron_dark", out=(0, -1, 0))
    # open arched ribs across the top (thin cast iron), a ridge and finials
    ribs = [Z0 - 0.3 + (Z1 - Z0 + 0.6) * k / 5 for k in range(6)]
    for z in ribs:
        pts = arc_pts(0, EAVE + 0.72, 1.75, 0.85, 0, math.pi, 12)
        for (x0, y0_), (x1, y1_) in zip(pts, pts[1:]):
            tube(B, (x0, y0_, z), (x1, y1_, z), 0.035, "atlas", "iron_green", 5)
        for k in range(1, 6):   # scrollwork spandrels
            x = -1.75 + 3.5 * k / 6
            yy = EAVE + 0.72 + 0.85 * math.sqrt(max(0, 1 - (x / 1.75) ** 2))
            if abs(x) > 0.9:
                tube(B, (x, EAVE + 0.72, z), (x, yy, z), 0.015, "atlas", "iron_green", 4)
    tube(B, (0, EAVE + 1.57, Z0 - 0.3), (0, EAVE + 1.57, Z1 + 0.3), 0.045, "atlas", "iron_green", 6)
    for z in (Z0 - 0.3, Z1 + 0.3):
        finial(B, 0, EAVE + 1.57, z, 0.5)
    for x in (-EX, EX):
        for z in (Z0 - 0.3, Z1 + 0.3):
            finial(B, x, EAVE + 0.32, z, 0.42)
    for k in range(1, 12):   # cresting along the side friezes
        z = Z0 - 0.3 + (Z1 - Z0 + 0.6) * k / 12
        for x in (-EX, EX):
            cyl(B, (x, EAVE + 0.32, z), (x, EAVE + 0.5, z), 0.025, 4, "atlas", "iron_green", r2=0.0)
    # the front gable: an arched iron frame with the cartouche at its crown
    pts = arc_pts(0, EAVE + 0.72, 1.75, 0.85, 0, math.pi, 14)
    for (x0, y0_), (x1, y1_) in zip(pts, pts[1:]):
        tube(B, (x0, y0_, Z0 - 0.33), (x1, y1_, Z0 - 0.33), 0.055, "atlas", "iron_green", 6)
    plane(B, (0, EAVE + 1.05, Z0 - 0.38), (-1, 0, 0), (0, 1, 0), 1.5, 0.75, "atlas", "cartouche_in", out=(0, 0, -1))
    plane(B, (0, EAVE + 1.05, Z0 - 0.28), (1, 0, 0), (0, 1, 0), 1.5, 0.75, "atlas", "cartouche_in", out=(0, 0, 1))
    # the back gable the same, with the porcelain sign under it inside
    for (x0, y0_), (x1, y1_) in zip(pts, pts[1:]):
        tube(B, (x0, y0_, Z1 + 0.33), (x1, y1_, Z1 + 0.33), 0.055, "atlas", "iron_green", 6)
    plane(B, (0, 2.12, Z1 - 0.06), (-1, 0, 0), (0, 1, 0), 2.6, 0.48, "glow", "sign_subway", out=(0, 0, -1))
    # globes on brackets at the front posts
    for sx in (-1, 1):
        x = sx * X
        tube(B, (x, 2.05, Z0), (x + sx * 0.35, 2.05, Z0 - 0.15), 0.03, "atlas", "iron_green", 5)
        tube(B, (x, 1.75, Z0), (x + sx * 0.35, 2.02, Z0 - 0.15), 0.02, "atlas", "iron_green", 5)
        globe_lamp(B, x + sx * 0.35, Z0 - 0.15, 2.05, post=False)
    return B


# ============================================================ entrance style 2: modern glass and steel

def build_canopy():
    """Frameless glass balustrades on a steel shoe, four slender stainless columns, gull-wing glass
    canopies over the side strips only, and a back-lit name band on the front beam."""
    B = Builder()
    X, Z0, Z1 = 2.12, -2.15, 2.25
    H = 3.45
    # glass balustrades on the sides and back
    for (xa, za), (xb, zb), out in (((-X, Z0), (-X, Z1), (1, 0, 0)), ((X, Z0), (X, Z1), (-1, 0, 0)), ((-X, Z1), (X, Z1), (0, 0, -1))):
        B.quad((xa, 0.1, za), (xb, 0.1, zb), (xb, 1.12, zb), (xa, 1.12, za), "glass", "glass", out=out)
        # stainless shoe and cap rail
        if xa == xb:
            bx(B, xa - 0.06, xa + 0.06, 0, 0.14, za - 0.06, zb + 0.06, "metal", "steel_brushed")
            bx(B, xa - 0.035, xa + 0.035, 1.1, 1.17, za - 0.03, zb + 0.03, "metal", "stainless")
        else:
            bx(B, xa - 0.06, xb + 0.06, 0, 0.14, za - 0.06, za + 0.06, "metal", "steel_brushed")
            bx(B, xa - 0.03, xb + 0.03, 1.1, 1.17, za - 0.035, za + 0.035, "metal", "stainless")
    # an inner handrail on stand-offs
    for sx in (-1, 1):
        x = sx * (X - 0.09)
        tube(B, (x, 0.95, Z0 + 0.05), (x, 0.95, Z1 - 0.05), 0.022, "metal", "stainless", 8)
        for z in (Z0 + 0.4, 0.0, Z1 - 0.4):
            tube(B, (x, 0.95, z), (sx * X, 0.95, z), 0.012, "metal", "stainless", 4)
    # columns
    for x in (-X - 0.12, X + 0.12):
        for z in (Z0 - 0.05, Z1 + 0.05):
            cyl(B, (x, 0, z), (x, H, z), 0.07, 10, "metal", "stainless")
            cyl(B, (x, 0, z), (x, 0.04, z), 0.14, 10, "metal", "steel_dark")
    # side beams and the front / back beams
    for x in (-X - 0.12, X + 0.12):
        bx(B, x - 0.08, x + 0.08, H - 0.05, H + 0.2, Z0 - 0.35, Z1 + 0.35, "metal", "steel_dark")
    bx(B, -X - 0.2, X + 0.2, H - 0.05, H + 0.2, Z1 - 0.03, Z1 + 0.13, "metal", "steel_dark")
    bx(B, -X - 0.2, X + 0.2, H + 0.2, H + 0.62, Z0 - 0.12, Z0 + 0.02, "metal", "steel_dark", skip=("nz", "pz"))
    plane(B, (0, H + 0.41, Z0 - 0.125), (-1, 0, 0), (0, 1, 0), 2 * X + 0.3, 0.38, "glow", "band_in", out=(0, 0, -1))
    plane(B, (0, H + 0.41, Z0 + 0.025), (1, 0, 0), (0, 1, 0), 2 * X + 0.3, 0.38, "glow", "band_in", out=(0, 0, 1))
    # gull-wing glass over the side strips, on fins
    for sx in (-1, 1):
        xi, xo = sx * 1.7, sx * (X + 0.75)
        B.quad((xi, H + 0.05, Z0 - 0.35), (xi, H + 0.05, Z1 + 0.35), (xo, H + 0.55, Z1 + 0.35), (xo, H + 0.55, Z0 - 0.35), "glass", "glass", out=(-sx * 0.5, 1, 0))
        B.quad((xi, H + 0.04, Z0 - 0.35), (xi, H + 0.04, Z1 + 0.35), (xo, H + 0.54, Z1 + 0.35), (xo, H + 0.54, Z0 - 0.35), "glass", "glass", out=(sx * 0.5, -1, 0))
        for k in range(5):
            z = Z0 - 0.35 + (Z1 - Z0 + 0.7) * k / 4
            B.face([(xi, H + 0.03, z), (xo, H + 0.53, z), (xo, H + 0.3, z), (sx * (X + 0.12), H - 0.05, z)], "metal", "steel_dark", out=(0, 0, 1))
            B.face([(xi, H + 0.03, z), (xo, H + 0.53, z), (xo, H + 0.3, z), (sx * (X + 0.12), H - 0.05, z)], "metal", "steel_dark", out=(0, 0, -1))
        # downlights under the side beams
        for z in (Z0 + 0.4, 0.05, Z1 - 0.4):
            disc(B, (sx * (X + 0.12), H - 0.06, z), (0, -1, 0), 0.07, "glow", "glow_white", 8)
    # small green "open" lamps on the front columns
    for sx in (-1, 1):
        x = sx * (X + 0.12)
        bx(B, x - 0.09, x + 0.09, 2.45, 2.75, Z0 - 0.2, Z0 - 0.08, "metal", "steel_dark")
        plane(B, (x, 2.6, Z0 - 0.205), (-1, 0, 0), (0, 1, 0), 0.14, 0.26, "glow", "globe_green", out=(0, 0, -1))
        plane(B, (x + sx * 0.095, 2.6, Z0 - 0.14), (0, 0, sx), (0, 1, 0), 0.1, 0.26, "glow", "globe_green", out=(sx, 0, 0))
    # paving: a granite surround round the opening
    return B


# ============================================================ entrance style 3: limestone, part of a building's base

def build_stone():
    """As if the stair were cut into the ground floor of a prewar building: rusticated limestone walls on a
    granite plinth, a moulded cornice, heavy front piers with bronze lanterns, and a carved lintel."""
    B = Builder()
    Xi, Xo = 2.0, 2.34
    Z0, Z1 = -2.2, 2.38
    TOP = 2.85
    for sx in (-1, 1):
        x0, x1 = sorted((sx * Xi, sx * Xo))
        bx(B, x0, x1, 0, 0.55, Z0, Z1, "atlas", "granite", mode="m", span=(1.2, 0.6))
        bx(B, x0 + 0.02 * sx, x1 - 0.02 * sx, 0.55, TOP, Z0, Z1, "atlas", "limestone", mode="m", span=(2.0, 1.0), skip=("ny",))
        # cornice: projecting steps
        bx(B, x0 - 0.06, x1 + 0.06, TOP, TOP + 0.12, Z0 - 0.06, Z1 + 0.06, "atlas", "limestone", mode="m", span=(2.0, 1.0))
        bx(B, x0 - 0.12, x1 + 0.12, TOP + 0.12, TOP + 0.22, Z0 - 0.12, Z1 + 0.12, "atlas", "granite_dark", mode="m", span=(1.0, 1.0))
        # front pier
        px0, px1 = sorted((sx * 1.95, sx * 2.55))
        bx(B, px0, px1, 0, 0.6, Z0 - 0.42, Z0 + 0.12, "atlas", "granite", mode="m", span=(1.2, 0.6))
        bx(B, px0 + 0.03, px1 - 0.03, 0.6, 3.25, Z0 - 0.39, Z0 + 0.09, "atlas", "limestone", mode="m", span=(2.0, 1.0), skip=("ny",))
        bx(B, px0 - 0.06, px1 + 0.06, 3.25, 3.42, Z0 - 0.48, Z0 + 0.18, "atlas", "granite_dark", mode="m", span=(1.0, 1.0))
        # bronze lantern on the pier face, a globe above it
        lx = sx * 2.25
        bx(B, lx - 0.13, lx + 0.13, 1.75, 2.25, Z0 - 0.62, Z0 - 0.39, "metal", "bronze")
        plane(B, (lx, 2.0, Z0 - 0.625), (-1, 0, 0), (0, 1, 0), 0.18, 0.38, "glow", "lamp_warm", out=(0, 0, -1))
        for k in (-1, 1):
            plane(B, (lx + k * 0.135, 2.0, Z0 - 0.505), (0, 0, k), (0, 1, 0), 0.16, 0.38, "glow", "lamp_warm", out=(k, 0, 0))
        cyl(B, (lx, 2.25, Z0 - 0.5), (lx, 2.36, Z0 - 0.5), 0.15, 4, "metal", "bronze", r2=0.02)
        globe_lamp(B, lx, Z0 - 0.15, 3.42, post=False, post_rect="bronze")
        plane(B, (sx * 2.25, 1.15, Z0 - 0.395), (-1, 0, 0), (0, 1, 0), 0.5, 0.25, "metal", "bronze_plaque", out=(0, 0, -1))
    # back wall (behind the stair, in front of the sign post)
    bx(B, -Xo, Xo, 0, 0.55, Z1 - 0.2, Z1, "atlas", "granite", mode="m", span=(1.2, 0.6))
    bx(B, -Xo + 0.02, Xo - 0.02, 0.55, TOP, Z1 - 0.18, Z1 - 0.02, "atlas", "limestone", mode="m", span=(2.0, 1.0), skip=("ny",))
    bx(B, -Xo - 0.12, Xo + 0.12, TOP + 0.12, TOP + 0.22, Z1 - 0.32, Z1 + 0.1, "atlas", "granite_dark")
    plane(B, (0, 2.1, Z1 - 0.205), (-1, 0, 0), (0, 1, 0), 2.7, 0.5, "glow", "sign_subway", out=(0, 0, -1))
    # the carved lintel across the front, between the piers
    bx(B, -2.0, 2.0, 2.95, 3.42, Z0 - 0.36, Z0 + 0.06, "atlas", "limestone", skip=("pz", "nz"))
    plane(B, (0, 3.185, Z0 - 0.365), (-1, 0, 0), (0, 1, 0), 4.0, 0.47, "atlas", "lintel_in", out=(0, 0, -1))
    plane(B, (0, 3.185, Z0 + 0.065), (1, 0, 0), (0, 1, 0), 4.0, 0.47, "atlas", "lintel_in", out=(0, 0, 1))
    # an iron grille on top of the side walls (a balustrade for the building's areaway)
    for sx in (-1, 1):
        x = sx * 2.17
        tube(B, (x, TOP + 0.85, Z0 + 0.1), (x, TOP + 0.85, Z1 - 0.1), 0.025, "atlas", "iron_dark", 5)
        n = 22
        for k in range(n + 1):
            z = Z0 + 0.1 + (Z1 - Z0 - 0.2) * k / n
            tube(B, (x, TOP + 0.22, z), (x, TOP + 0.85, z), 0.012, "atlas", "iron_dark", 4)
            if k % 2 == 0:
                cyl(B, (x, TOP + 0.85, z), (x, TOP + 0.97, z), 0.025, 4, "atlas", "iron_dark", r2=0.0)
    return B


# ============================================================ the massive vents

def tiled_strip(B, x0, x1, z0, z1, y, mat, rect, piece):
    """a flat strip split along its long side into pieces about `piece` long, each mapping the whole rect"""
    along_x = (x1 - x0) >= (z1 - z0)
    L = (x1 - x0) if along_x else (z1 - z0)
    n = max(1, int(round(L / piece)))
    for k in range(n):
        if along_x:
            a0, a1 = x0 + L * k / n, x0 + L * (k + 1) / n
            B.quad((a0, y, z0), (a1, y, z0), (a1, y, z1), (a0, y, z1), mat, rect, ((0, 0), (1, 0), (1, 1), (0, 1)), out=(0, 1, 0))
        else:
            a0, a1 = z0 + L * k / n, z0 + L * (k + 1) / n
            B.quad((x0, y, a0), (x1, y, a0), (x1, y, a1), (x0, y, a1), mat, rect, ((0, 0), (0, 1), (1, 1), (1, 0)), out=(0, 1, 0))


def build_vent_frame():
    """flush with the road: the bar grating on bearers, a diamond-plate frame, a hazard band round it"""
    B = Builder()
    X, Z = VENT_X, VENT_Z
    y = 0.05
    # the grating (raw uvs in metres: the grate texture repeats every metre)
    B.face([(-X, y, -Z), (X, y, -Z), (X, y, Z), (-X, y, Z)], "grate", None, [(-X, -Z), (X, -Z), (X, Z), (-X, Z)], out=(0, 1, 0))
    B.face([(-X, y - 0.005, -Z), (X, y - 0.005, -Z), (X, y - 0.005, Z), (-X, y - 0.005, Z)], "grate", None, [(-X, -Z), (X, -Z), (X, Z), (-X, Z)], out=(0, -1, 0))
    # bearers underneath (seen from below and through the bars)
    for k in range(-4, 5):
        z = k * 1.0
        bx(B, -X, X, y - 0.2, y - 0.01, z - 0.04, z + 0.04, "metal", "steel_dark")
    bx(B, -0.04, 0.04, y - 0.25, y - 0.01, -Z, Z, "metal", "steel_dark")
    # diamond-plate frame, flush (in ~1 m plates so the pattern keeps its scale)
    W = 0.28
    for (x0, x1, z0, z1) in ((-X - W, X + W, -Z - W, -Z), (-X - W, X + W, Z, Z + W), (-X - W, -X, -Z, Z), (X, X + W, -Z, Z)):
        tiled_strip(B, x0, x1, z0, z1, y + 0.004, "metal", "diamond_plate", 1.0)
    # inner lip down into the shaft
    for (a, b_, out) in ((((-X, -Z), (X, -Z)), None, (0, 0, 1)), (((X, Z), (-X, Z)), None, (0, 0, -1)), (((-X, Z), (-X, -Z)), None, (1, 0, 0)), (((X, -Z), (X, Z)), None, (-1, 0, 0))):
        (xa, za), (xb, zb) = a
        B.quad((xa, y, za), (xb, y, zb), (xb, y - 0.35, zb), (xa, y - 0.35, za), "metal", "steel_dark", out=out)
    # hazard band painted on the road round the frame (with the inbound / outbound colours swapped at runtime)
    H = 0.5
    X2, Z2 = X + W, Z + W
    for (x0, x1, z0, z1) in ((-X2 - H, X2 + H, -Z2 - H, -Z2), (-X2 - H, X2 + H, Z2, Z2 + H), (-X2 - H, -X2, -Z2, Z2), (X2, X2 + H, -Z2, Z2)):
        tiled_strip(B, x0, x1, z0, z1, 0.046, "atlas", "hazard", 1.0)
    # warning plates set into the frame ends
    for sz in (-1, 1):
        plane(B, (0, y + 0.006, sz * (Z + W / 2)), (sz, 0, 0), (0, 0, -sz), 1.0, 0.24, "atlas", "warn_in", out=(0, 1, 0))
    return B


def build_vent_shaft():
    """the shaft from the road down to the tunnel roof: board-formed concrete, cable runs, a ladder, lights"""
    B = Builder()
    X, Z, D = VENT_X, VENT_Z, VENT_DEPTH
    walls = [((-X, -Z), (X, -Z), (0, 0, 1)), ((X, Z), (-X, Z), (0, 0, -1)), ((-X, Z), (-X, -Z), (1, 0, 0)), ((X, -Z), (X, Z), (-1, 0, 0))]
    for (xa, za), (xb, zb), out in walls:
        L = math.hypot(xb - xa, zb - za)
        n = max(1, int(round(L / 1.6)))
        for k in range(n):
            ta, tb = k / n, (k + 1) / n
            B.quad((xa + (xb - xa) * ta, -D - 0.15, za + (zb - za) * ta), (xa + (xb - xa) * tb, -D - 0.15, za + (zb - za) * tb),
                   (xa + (xb - xa) * tb, 0.16, za + (zb - za) * tb), (xa + (xb - xa) * ta, 0.16, za + (zb - za) * ta), "atlas", "concrete_shaft", out=out)
    # cable runs on both long walls, conduit, the lights (glow rect swapped per vent kind at runtime)
    for sx in (-1, 1):
        x = sx * (X - 0.05)
        B.quad((x, -0.8, -Z + 0.2), (x, -0.8, Z - 0.2), (x, -0.55, Z - 0.2), (x, -0.55, -Z + 0.2), "atlas", "cables", ((0, 0), (6, 0), (6, 1), (0, 1)), out=(-sx, 0, 0))
        tube(B, (sx * (X - 0.08), -1.25, -Z + 0.1), (sx * (X - 0.08), -1.25, Z - 0.1), 0.04, "metal", "steel_galv", 6)
        for z in (-3.0, 0.0, 3.0):
            bx(B, x - sx * 0.12, x, -0.42, -0.3, z - 0.6, z + 0.6, "metal", "steel_dark")
            plane(B, (x - sx * 0.121, -0.36, z), (0, 0, 1), (0, 1, 0), 1.1, 0.07, "glow", "fluor", out=(-sx, 0, 0))
        plane(B, (x - sx * 0.01, -1.0, sx * 1.6), (0, 0, -sx), (0, 1, 0), 0.9, 0.45, "atlas", "warn_in", out=(-sx, 0, 0))
    # a steel ladder down the end wall
    for x in (-0.25, 0.25):
        tube(B, (x, 0.0, Z - 0.18), (x, -D, Z - 0.18), 0.025, "metal", "steel_galv", 5)
    for k in range(int(D / 0.3)):
        y = -0.25 - k * 0.3
        tube(B, (-0.25, y, Z - 0.18), (0.25, y, Z - 0.18), 0.016, "metal", "steel_galv", 4)
    for y in (-0.5, -2.0):
        tube(B, (-0.25, y, Z - 0.18), (-0.25, y, Z - 0.02), 0.02, "metal", "steel_galv", 4)
        tube(B, (0.25, y, Z - 0.18), (0.25, y, Z - 0.02), 0.02, "metal", "steel_galv", 4)
    # the steel beams the fans hang from
    for z in (-1.5, 1.5):
        bx(B, -X, X, -0.95, -0.7, z - 0.06, z + 0.06, "metal", "steel_galv")
    for z in (-4.55, 4.55):
        bx(B, -X, X, -0.95, -0.7, z - 0.05, z + 0.05, "metal", "steel_galv")
    return B


FAN_R = 1.16


def build_fan_frame():
    """a fan housing: a short galvanised drum with a bellmouth, struts to the motor, a wire guard on top.
    origin at the fan's centre, axis up; drum from y = -0.35 to +0.25"""
    B = Builder()
    R = FAN_R + 0.08
    segs = 20
    cyl(B, (0, -0.35, 0), (0, 0.25, 0), R, segs, "metal", "steel_galv", caps=False, smooth=True)
    cyl(B, (0, 0.25, 0), (0, -0.35, 0), R - 0.02, segs, "metal", "steel_galv", caps=False, smooth=True)   # inner face
    cyl(B, (0, 0.25, 0), (0, 0.33, 0), R, segs, "metal", "steel_galv", caps=False, r2=R + 0.12)          # bellmouth
    cyl(B, (0, -0.35, 0), (0, -0.4, 0), R, segs, "atlas", "hazard", caps=False, r2=R + 0.05)
    # mounting lugs to the beams (x = +-1.4 walls)
    for sx in (-1, 1):
        bx(B, sx * R, sx * 1.38, -0.12, 0.0, -0.08, 0.08, "metal", "steel_dark")
    # the motor below the rotor, on four struts
    cyl(B, (0, -0.32, 0), (0, -0.05, 0), 0.24, 12, "atlas", "steel_dark")
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        tube(B, (math.cos(a) * 0.22, -0.2, math.sin(a) * 0.22), (math.cos(a) * (R - 0.02), -0.2, math.sin(a) * (R - 0.02)), 0.03, "metal", "steel_dark", 5)
    # the guard: rings and spokes over the top
    for r in (0.3, 0.55, 0.8, 1.05, R):
        n = 18
        for k in range(n):
            a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
            tube(B, (math.cos(a0) * r, 0.36, math.sin(a0) * r), (math.cos(a1) * r, 0.36, math.sin(a1) * r), 0.012, "metal", "steel_dark", 3)
    for k in range(8):
        a = k * math.pi / 4
        tube(B, (0, 0.37, 0), (math.cos(a) * R, 0.36, math.sin(a) * R), 0.014, "metal", "steel_dark", 3)
    return B


def build_fan_rotor():
    """six pitched blades on a hub, origin at the hub, axis up (TS spins it about +Y)"""
    B = Builder()
    cyl(B, (0, -0.06, 0), (0, 0.1, 0), 0.2, 12, "atlas", "fan_hub")
    disc(B, (0, 0.1, 0), (0, 1, 0), 0.2, "atlas", "fan_hub", 12)
    for k in range(6):
        a = k * math.pi / 3
        c, s = math.cos(a), math.sin(a)
        # a blade: root chord 0.42 at r 0.18, tip chord 0.55 at r FAN_R, pitched 30 degrees
        pts, st = [], []
        for r, ch, pitch, t in ((0.18, 0.36, 0.7, 0.0), (FAN_R, 0.56, 0.42, 1.0)):
            for side in (-1, 1):
                lx = side * ch / 2
                ly = -side * ch / 2 * math.sin(pitch) * 0.6
                lz = r
                # tangent direction (-s, c) and radial (c, s): lx along tangent
                pts.append((c * lz - s * lx, ly + 0.02, s * lz + c * lx))
                st.append((t, (side + 1) / 2))
        quad = [pts[0], pts[1], pts[3], pts[2]]
        qst = [st[0], st[1], st[3], st[2]]
        B.face(quad, "metal", "fan_blade", qst, out=(0, 1, 0))
        B.face(quad, "metal", "fan_blade", qst, out=(0, -1, 0))
    return B


def build_fixture():
    """the stairwell / passage fluorescent: a 1.2 m two-tube fitting with a wire guard, origin at the ceiling"""
    B = Builder()
    bx(B, -0.13, 0.13, -0.09, 0.0, -0.62, 0.62, "atlas", "white", skip=("py",))
    for x in (-0.06, 0.06):
        cyl(B, (x, -0.12, -0.58), (x, -0.12, 0.58), 0.025, 6, "glow", "fluor", caps=False)
    for z in (-0.45, 0.0, 0.45):
        pts = arc_pts(0, -0.09, 0.15, 0.09, math.pi, 2 * math.pi, 6)
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            tube(B, (x0, y0, z), (x1, y1, z), 0.006, "atlas", "steel_dark", 3)
    return B


BUILDERS = [
    ("kiosk", build_kiosk), ("canopy", build_canopy), ("stone", build_stone),
    ("vent_frame", build_vent_frame), ("vent_shaft", build_vent_shaft), ("fan_frame", build_fan_frame), ("fan_rotor", build_fan_rotor),
    ("fixture", build_fixture),
]


# ============================================================ textures, materials, export, previews

def convert_textures():
    """atlas and stair wall -> WebP; the grate -> RGBA PNG with alpha from its brightness"""
    s = bpy.context.scene
    s.view_settings.view_transform = "Standard"
    out = {}
    for src, dst, fmt in (("EntranceAtlas.png", "atlas.webp", "WEBP"), ("StairWall.png", "stair_wall.webp", "WEBP")):
        img = bpy.data.images.load(os.path.join(ATLAS_DIR, src))
        s.render.image_settings.file_format = fmt
        s.render.image_settings.quality = 88
        s.render.image_settings.color_mode = "RGB"
        img.save_render(os.path.join(TEX, dst), scene=s)
        out[src] = img
    g = bpy.data.images.load(os.path.join(ATLAS_DIR, "Grate.png"))
    w, h = g.size
    px = list(g.pixels)
    for i in range(0, len(px), 4):
        lum = max(px[i], px[i + 1], px[i + 2])
        px[i + 3] = 1.0 if lum > 0.12 else lum / 0.12
    k = bpy.data.images.new("grate_rgba", w, h, alpha=True)
    k.pixels = px
    k.filepath_raw = os.path.join(TEX, "grate.png")
    k.file_format = "PNG"
    k.save()
    out["Grate.png"] = k
    return out


def make_materials(atlas_img, grate_img):
    def mat(name, rough, metal, emit=0.0, image=None, color=(1, 1, 1), alpha=1.0):
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
            if image == grate_img:
                nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
        bsdf.inputs["Emission Strength"].default_value = emit
        if alpha < 1:
            bsdf.inputs["Alpha"].default_value = alpha
        return m
    return {"atlas": mat("atlas", 0.75, 0.0, image=atlas_img), "metal": mat("metal", 0.35, 0.5, image=atlas_img),
            "glow": mat("glow", 0.5, 0.0, emit=2.0, image=atlas_img), "glass": mat("glass", 0.1, 0.0, image=atlas_img, alpha=0.35),
            "grate": mat("grate", 0.5, 0.6, image=grate_img)}


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
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    path = os.path.join(OUT, "entrances.glb")
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
    ob.location = (x, -z, y)
    ob.rotation_euler = (0, 0, yaw)


def previews(objs):
    s = bpy.context.scene
    s.render.engine = "BLENDER_EEVEE"
    s.render.threads_mode = "FIXED"
    s.render.threads = 8
    s.render.image_settings.file_format = "PNG"
    s.render.image_settings.color_mode = "RGBA"
    s.view_settings.view_transform = "AgX"
    world = bpy.data.worlds.new("dusk")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.35, 0.38, 0.45, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
    s.world = world
    bpy.ops.object.light_add(type="SUN", rotation=(math.radians(50), 0, math.radians(-35)))
    bpy.context.object.data.energy = 2.6
    bpy.context.object.data.color = (1.0, 0.92, 0.82)
    bpy.ops.object.camera_add()
    cam = bpy.context.object
    s.camera = cam
    cam.data.clip_end = 300
    by = {o.name: o for o in objs}
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.001))
    g = bpy.context.object
    gm = bpy.data.materials.new("g")
    gm.use_nodes = True
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.18, 0.17, 0.16, 1)
    g.data.materials.append(gm)
    g.name = "ground"

    def shoot(name, target, dist, yaw, elev, res=(1400, 800), lens=35):
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

    place(by["kiosk"], -6.5, 0, 0)
    place(by["canopy"], 0, 0, 0)
    place(by["stone"], 6.5, 0, 0)
    show(["kiosk", "canopy", "stone", "ground"])
    shoot("entrances_front", (0, 1.8, 0), 17, 200, 14, res=(1800, 800))
    shoot("entrances_back", (0, 1.8, 0), 17, 25, 22, res=(1800, 800))
    shoot("kiosk", (-6.5, 2.0, 0), 7.5, 215, 12)
    shoot("stone", (6.5, 2.0, 0), 7.5, 150, 10)
    shoot("canopy", (0, 2.0, 0), 7.5, 160, 18)
    for n in ("kiosk", "canopy", "stone"):
        place(by[n], 0, 0, 0)
    # the vent: frame, shaft and three fans (seen from above and from the side, ground hidden)
    place(by["vent_frame"], 0, 0, 0)
    place(by["vent_shaft"], 0, 0, 0)
    fans = []
    for z in (-3.05, 0.0, 3.05):
        for n in ("fan_frame", "fan_rotor"):
            o = by[n].copy()
            s.collection.objects.link(o)
            place(o, 0, -1.6, z)
            fans.append(o.name)
    show(["vent_frame", "vent_shaft", "fan_frame", "fan_rotor"] + fans)
    s.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.05, 0.05, 0.06, 1)
    shoot("vent_above", (0, -1.0, 0), 9, 130, 60)
    shoot("vent_side", (0, -1.2, 0), 9, 90, 15)
    show(["fixture", "fan_rotor"])
    place(by["fixture"], 2, 1.5, 0)
    shoot("small_parts", (1, 1.0, 0), 5, 30, -20)


def main():
    clean_scene()
    os.makedirs(TEX, exist_ok=True)
    imgs = convert_textures()
    mats = make_materials(imgs["EntranceAtlas.png"], imgs["Grate.png"])
    objs, info = [], {}
    for name, fn in BUILDERS:
        B = fn()
        info[name] = B.tris()
        print(f"[entrances] {name}: {B.tris()} tris", flush=True)
        objs.append(finish(name, B, mats))
    path = export(objs)
    print("[entrances] exported", path, os.path.getsize(path), "bytes")
    meta = {"tris": info, "atlas": LAYOUT, "fanRadius": FAN_R}
    with open(os.path.join(OUT, "entrances.json"), "w") as f:
        json.dump(meta, f)
    if "--no-previews" not in FLAGS:
        previews(objs)


main()
