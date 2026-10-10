"""Far From the Tree - Chinatown models, built procedurally in headless Blender.

Run by build_chinatown.py:
  blender -b -t 8 --factory-startup --python chinatown_blender.py -- MODELS TEXOUT TESSERACT_DIR PREVIEWS [--no-previews]

Writes
  MODELS/chinatown.glb         the kit: gate_1 (one bay, nominal half width 7.4 m) and gate_3 (three bays,
                               half width 14 m): red lacquered pillars on granite drums, painted beams, gilded
                               plaques (華埠 / 天下為公), bracket sets and green glazed roofs with upturned eaves,
                               ridge 10 m; lantern_hi / lantern_lo (origin at the hook, hanging down -y),
                               neon_0..3 (blade signs, origin on the wall, sticking out +x), stall, barricade,
                               sign_closed, lion (a lion-dance lion resting), crackers (a string of firecrackers)
  MODELS/chinatown_bridge.glb  bridge_main (the Manhattan Bridge: towers, four cables and suspenders, the
                               stiffening truss deck, the anchorages, the masonry approaches), and
  MODELS/chinatown_arch.glb    bridge_arch (Carrere & Hastings' arch and colonnade at Canal St and the Bowery), both in the
                               bridge's frame: origin at the arch centre, +x along the axis toward Brooklyn, +z
                               to the left (see bridge_layout.json, made by layout.ts from city.json)
  MODELS/chinatown.json        the gate openings (for the lantern curtains), the bridge frame, triangle counts
  MODELS/ct_district_kit.glb   the bridge district's kit: water_tower, lamp (cobra head), car, suv, jersey,
                               railing, hoarding, fence, crane, cabin, train_car (an R160 car for the bridge)
  TEXOUT/atlas*.webp, district*.webp, granite/limestone/steel/truss.webp   the Tesseract textures
Materials go out by name only (ct, ct_glow, br, br_alpha): the game binds the textures itself.
All coordinates below are three.js ones (x, y up, z) and converted to Blender's (x, -z, y) on the way in.
"""
import bpy, bmesh, json, math, os, random, sys
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
MODELS, TEXOUT, TS, PREV = argv[:4]
FLAGS = argv[4:]
HERE = os.path.dirname(os.path.abspath(__file__))
LAY = json.load(open(os.path.join(TS, "layout.json")))
RA, SW = LAY["atlas"]["rects"], LAY["atlas"]["swatches"]
RB = LAY["bridge"]["rects"]
BL = json.load(open(os.path.join(HERE, "bridge_layout.json")))
TRIS = {}
META = {"gates": {}}

# ------------------------------------------------------------------------------ geometry builder

class Geo:
    """Polygons in three.js space with per-corner UVs and a material each; one Blender mesh."""

    def __init__(self):
        self.v, self.f, self.uv, self.mat, self.flat = [], [], [], [], []
        self.mats = []
        self.M = Matrix.Identity(4)

    def vert(self, p):
        q = self.M @ Vector((p[0], p[1], p[2]))
        self.v.append((q.x, -q.z, q.y))
        return len(self.v) - 1

    def poly(self, pts, uvs, mat, flat=True):
        if uvs and isinstance(uvs[0], MUV):
            # metric planar UVs (repeating textures): project on the face's dominant axis
            mat = uvs[0].mat
            P = [self.M @ Vector((p[0], p[1], p[2])) for p in pts]
            n = (P[1] - P[0]).cross(P[2] - P[0])
            k = MSCALE.get(mat, 2.0)
            ax = max(range(3), key=lambda i: abs(n[i]))
            if ax == 1:
                uvs = [(q.x / k, q.z / k) for q in P]
            elif ax == 0:
                uvs = [(q.z / k, q.y / k) for q in P]
            else:
                uvs = [(q.x / k, q.y / k) for q in P]
        if mat not in self.mats:
            self.mats.append(mat)
        self.f.append([self.vert(p) for p in pts])
        self.uv.append(list(uvs))
        self.mat.append(self.mats.index(mat))
        self.flat.append(flat)

    def merge(self, other, M=None):
        """append another Geo, transformed"""
        M = M or Matrix.Identity(4)
        for k, f in enumerate(other.f):
            pts = []
            for i in f:
                bx, by, bz = other.v[i]
                p = M @ Vector((bx, bz, -by))
                pts.append((p.x, p.y, p.z))
            self.poly(pts, other.uv[k], other.mats[other.mat[k]], other.flat[k])

    def tris(self):
        return sum(len(f) - 2 for f in self.f)

    def build(self, name, smooth_all=False):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        uvl = me.uv_layers.new(name="UVMap")
        for m in self.mats:
            me.materials.append(material(m))
        for poly in me.polygons:
            poly.material_index = self.mat[poly.index]
            poly.use_smooth = smooth_all or not self.flat[poly.index]
            for k, li in enumerate(poly.loop_indices):
                uvl.data[li].uv = self.uv[poly.index][k]
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
        bm.to_mesh(me)
        bm.free()
        me.validate(clean_customdata=False)
        me.update()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        TRIS[name] = sum(len(p.vertices) - 2 for p in me.polygons)
        return ob


class MUV:
    """a UV 'value' that asks for metric planar UVs in material mat (see Geo.poly)"""
    def __init__(self, mat):
        self.mat = mat


class Metric:
    def __init__(self, mat):
        self.mat = mat

    def __call__(self, u, v):
        return MUV(self.mat)


MSCALE = {"br_granite": 2.6, "br_lime": 2.2, "br_steel": 3.2, "br_deck": 4.0}
MATCOL = {"dk": (0.5, 0.4, 0.3), "br_granite": (0.6, 0.57, 0.52), "br_lime": (0.8, 0.78, 0.72), "br_steel": (0.5, 0.56, 0.6), "br_deck": (0.2, 0.2, 0.2),"ct": (0.6, 0.1, 0.1), "ct_glow": (1, 0.3, 0.1), "br": (0.5, 0.56, 0.6), "br_alpha": (0.5, 0.56, 0.6)}


def material(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*MATCOL.get(name, (0.5, 0.5, 0.5)), 1)
    return m


# ------------------------------------------------------------------------------ UVs

def uvr(rect, size, u, v, inset=2):
    """u, v in 0..1 inside a pixel rect (v up) -> Blender UV"""
    x, y, w, h = rect
    u = min(1.0, max(0.0, u)); v = min(1.0, max(0.0, v))
    px = x + inset + (w - 2 * inset) * u
    py = y + inset + (h - 2 * inset) * (1 - v)
    return (px / size, 1 - py / size)


def A(name):
    """UV function for an atlas cell (or a flat swatch)"""
    r = RA["sw_" + name] if ("sw_" + name) in RA else RA[name]
    ins = 6 if ("sw_" + name) in RA else 2
    return lambda u, v: uvr(r, 1024, u, v, ins)


RD = LAY["district"]["rects"]


def D(name):
    """UV function for a district atlas cell (the arcade shopfronts)"""
    r = RD[name]
    return lambda u, v: uvr(r, 1024, u, v, 2)


def B(name):
    """the bridge: stone and steel are repeating textures with metric UVs; truss and lattice live in an alpha atlas"""
    if name in ("granite", "limestone", "steel", "deck", "cable"):
        return Metric({"granite": "br_granite", "limestone": "br_lime", "steel": "br_steel", "deck": "br_deck", "cable": "br_steel"}[name])
    x, y, w, h = RB[name]
    W, H = LAY["bridge"]["size"]
    return lambda u, v: ((x + 1 + (w - 2) * min(1, max(0, u))) / W, 1 - (y + 1 + (h - 2) * (1 - min(1, max(0, v)))) / H)


def quad(g, p0, p1, p2, p3, mat, uvf, u0=0.0, v0=0.0, u1=1.0, v1=1.0):
    """corners counter-clockwise seen from the front: bottom-left, bottom-right, top-right, top-left"""
    g.poly([p0, p1, p2, p3], [uvf(u0, v0), uvf(u1, v0), uvf(u1, v1), uvf(u0, v1)], mat)


def box(g, c, s, mat, uvf, faces="all", uvs=None):
    """axis-aligned box, centre c, size s (three space). uvf: one function or a dict per face (+x -x +y -y +z -z)"""
    x, y, z = c
    hx, hy, hz = s[0] / 2, s[1] / 2, s[2] / 2
    P = lambda i, j, k: (x + i * hx, y + j * hy, z + k * hz)
    F = {
        "+z": [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)],
        "-z": [P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1)],
        "+x": [P(1, -1, 1), P(1, -1, -1), P(1, 1, -1), P(1, 1, 1)],
        "-x": [P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1)],
        "+y": [P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), P(-1, 1, -1)],
        "-y": [P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1)],
    }
    for k, pts in F.items():
        if faces != "all" and k not in faces:
            continue
        f = uvf[k] if isinstance(uvf, dict) else uvf
        m = mat[k] if isinstance(mat, dict) else mat
        if f is None:
            continue
        quad(g, *pts, m, f)


def obox(g, a, b, w, h, mat, uvf, up=(0, 1, 0)):
    """a box from point a to point b (three space), w across, h along 'up' (roughly)"""
    a, b = Vector(a), Vector(b)
    d = (b - a)
    L = d.length
    d.normalize()
    upv = Vector(up)
    s = d.cross(upv)
    if s.length < 1e-4:
        s = d.cross(Vector((1, 0, 0)))
    s.normalize()
    u = s.cross(d).normalized()
    corners = []
    for t in (0, L):
        for (i, j) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            corners.append(a + d * t + s * (i * w / 2) + u * (j * h / 2))
    c0, c1 = corners[:4], corners[4:]
    for k in range(4):
        k2 = (k + 1) % 4
        quad(g, c0[k], c0[k2], c1[k2], c1[k], mat, uvf)
    quad(g, c0[3], c0[2], c0[1], c0[0], mat, uvf)
    quad(g, c1[0], c1[1], c1[2], c1[3], mat, uvf)


def lathe(g, prof, segs, mat, uvf, cx=0.0, cz=0.0, y0=0.0, u_rep=1.0, flute=None, smooth=True, phase=0.0):
    """revolve [(r, y), ...] about the vertical axis at (cx, cz). uvf(u, v): u round, v down the profile (1 at the first point)"""
    L = [0.0]
    for i in range(1, len(prof)):
        L.append(L[-1] + math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]))
    tot = L[-1] or 1
    rings = []
    for i, (r, y) in enumerate(prof):
        ring = []
        for j in range(segs + 1):
            a = j / segs * math.tau + phase
            rr = r * (1 + (flute(a) if flute else 0))
            ring.append((cx + math.cos(a) * rr, y0 + y, cz - math.sin(a) * rr))
        rings.append(ring)
    for i in range(len(prof) - 1):
        for j in range(segs):
            if prof[i][0] < 1e-5 and prof[i + 1][0] < 1e-5:
                continue
            uA, uB = (j / segs) * u_rep, ((j + 1) / segs) * u_rep
            uA -= math.floor(uA); uB = uA + u_rep / segs
            vA, vB = 1 - L[i] / tot, 1 - L[i + 1] / tot
            g.poly([rings[i + 1][j], rings[i + 1][j + 1], rings[i][j + 1], rings[i][j]],
                   [uvf(uA, vB), uvf(uB, vB), uvf(uB, vA), uvf(uA, vA)], mat, flat=not smooth)


def tube(g, pts, r, sides, mat, uvf, v_per_m=0.1):
    pts = [Vector(p) for p in pts]
    t0 = (pts[1] - pts[0]).normalized()
    a = Vector((0, 1, 0)) if abs(t0.y) < 0.9 else Vector((1, 0, 0))
    s = t0.cross(a).normalized()
    rings, dist = [], 0.0
    for i, p in enumerate(pts):
        if i:
            dist += (p - pts[i - 1]).length
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        s = (s - t * s.dot(t)).normalized()
        b = t.cross(s)
        rings.append(([p + (s * math.cos(j / sides * math.tau) + b * math.sin(j / sides * math.tau)) * r for j in range(sides + 1)], dist))
    for i in range(len(pts) - 1):
        (r0, d0), (r1, d1) = rings[i], rings[i + 1]
        for j in range(sides):
            g.poly([r0[j], r0[j + 1], r1[j + 1], r1[j]],
                   [uvf(j / sides, (d0 * v_per_m) % 1), uvf((j + 1) / sides, (d0 * v_per_m) % 1), uvf((j + 1) / sides, (d0 * v_per_m) % 1 + (d1 - d0) * v_per_m), uvf(j / sides, (d0 * v_per_m) % 1 + (d1 - d0) * v_per_m)],
                   mat, flat=False)


def T(x, y, z):
    return Matrix.Translation((x, y, z))


def RY(a):
    return Matrix.Rotation(a, 4, "Y")


def S(x, y, z):
    return Matrix.Diagonal((x, y, z, 1))


# ================================================================================ lanterns

def lantern_geo(sides=10, rings=7, tassel=True):
    """a round red paper lantern hanging from its hook at the origin: about 1.15 m top to tassel"""
    g = Geo()
    gold = A("gold")
    lo = sides < 8
    if lo:   # the cheap one for the strings over the streets: body, flat caps, a 3-sided tassel
        lathe(g, [(0.0, -0.13), (0.15, -0.16), (0.16, -0.19)], sides, "ct", gold)
        prof = [(0.06 + 0.29 * math.cos(a), -0.48 - 0.30 * math.sin(a)) for a in (math.pi / 2 * 0.8, math.pi / 4, 0.0, -math.pi / 4, -math.pi / 2 * 0.8)]
        lathe(g, prof, sides, "ct_glow", A("lantern"))
        lathe(g, [(0.16, -0.77), (0.15, -0.80), (0.0, -0.83)], sides, "ct", gold)
        lathe(g, [(0.03, -0.83), (0.08, -1.15), (0.0, -1.16)], 3, "ct", A("tassel"))
        return g
    box(g, (0, -0.06, 0), (0.025, 0.12, 0.025), "ct", A("black"), faces=["+x", "-x", "+z", "-z"])
    lathe(g, [(0.0, -0.12), (0.12, -0.13), (0.16, -0.17), (0.16, -0.19)], 8, "ct", gold, smooth=True)
    prof = []
    for i in range(rings + 1):
        a = -math.pi / 2 + math.pi * i / rings
        prof.append((0.06 + 0.29 * math.cos(a), -0.48 - 0.30 * math.sin(a)))
    # top to bottom
    prof = sorted(prof, key=lambda p: -p[1])
    lathe(g, prof, sides, "ct_glow", A("lantern"), flute=(lambda a: 0.035 * abs(math.cos(a * sides / 2))) if sides >= 8 else None)
    lathe(g, [(0.16, -0.77), (0.14, -0.80), (0.09, -0.83), (0.0, -0.835)], 8, "ct", gold)
    if tassel:
        lathe(g, [(0.03, -0.83), (0.035, -0.93), (0.06, -0.96), (0.085, -1.18), (0.0, -1.19)], 5, "ct", A("tassel"))
    return g


def neon_geo(k):
    """a vertical blade sign sticking out from a wall at the origin (+x), 0.8 x 2.0 m"""
    g = Geo()
    x0, x1, y0, y1, t = 0.28, 1.08, -1.0, 1.0, 0.09
    r = A("neon_%d" % k)
    quad(g, (x0, y0, t), (x1, y0, t), (x1, y1, t), (x0, y1, t), "ct_glow", r)
    quad(g, (x1, y0, -t), (x0, y0, -t), (x0, y1, -t), (x1, y1, -t), "ct_glow", r)
    iron = A("iron")
    box(g, ((x0 + x1) / 2, y1 + 0.03, 0), (x1 - x0 + 0.06, 0.06, 2 * t + 0.04), "ct", iron)
    box(g, ((x0 + x1) / 2, y0 - 0.03, 0), (x1 - x0 + 0.06, 0.06, 2 * t + 0.04), "ct", iron)
    box(g, (x1 + 0.03, 0, 0), (0.06, y1 - y0, 2 * t + 0.04), "ct", iron)
    box(g, (x0 - 0.03, 0, 0), (0.06, y1 - y0, 2 * t + 0.04), "ct", iron)
    for y in (y0 + 0.3, y1 - 0.3):   # wall brackets
        box(g, (x0 / 2, y, 0), (x0, 0.05, 0.05), "ct", iron)
    return g


# ================================================================================ the gates

def roof(g, x0, x1, ridge_y, eave_y, depth, curl=0.8, tile_w=1.3, tile_h=1.1):
    """a double-pitched glazed roof, ridge along x at z=0, concave slopes, eaves curling up at the corners.
    The tile cell is mapped once per tile_w x tile_h patch (the mesh is split to repeat it)."""
    tiles, lac = A("tiles"), A("lacquer")
    cx, hx = (x0 + x1) / 2, (x1 - x0) / 2
    H = ridge_y - eave_y
    nu = max(2, round((x1 - x0) / tile_w))
    nv = max(2, round(math.hypot(depth, H) / tile_h))

    def P(u, v, side):
        e = abs(2 * u - 1) ** 3                    # toward the ends
        x = cx + (2 * u - 1) * hx * (1 + 0.06 * v * e)
        y = ridge_y - H * (1 - (1 - v) ** 2) + curl * e * v ** 2.2
        z = side * v * depth * (1 + 0.10 * e)
        return (x, y, z)

    for side in (1, -1):
        for i in range(nu):
            for j in range(nv):
                u0, u1, v0, v1 = i / nu, (i + 1) / nu, j / nv, (j + 1) / nv
                a, b, c, d = P(u0, v1, side), P(u1, v1, side), P(u1, v0, side), P(u0, v0, side)
                if side < 0:
                    a, b, c, d = b, a, d, c
                g.poly([a, b, c, d], [tiles(0, 0), tiles(1, 0), tiles(1, 1), tiles(0, 1)], "ct", flat=False)
                # the underside: red lacquered rafters
                o = 0.12
                a2, b2, c2, d2 = [(p[0], p[1] - o, p[2]) for p in (a, b, c, d)]
                g.poly([d2, c2, b2, a2], [lac(0, 1), lac(1, 1), lac(1, 0), lac(0, 0)], "ct")
        # the eave edge (fascia): a thin green-gold band
        for i in range(nu):
            u0, u1 = i / nu, (i + 1) / nu
            a, b = P(u0, 1, side), P(u1, 1, side)
            if side < 0:
                a, b = b, a
            quad(g, (a[0], a[1] - 0.16, a[2]), (b[0], b[1] - 0.16, b[2]), b, a, "ct", A("green_glaze"))
    # gable ends: triangles of red board, set in a little from the ends
    for sx in (-1, 1):
        x = cx + sx * (hx - 0.35)
        pts = [(x, eave_y + 0.1, -depth * 0.75), (x, eave_y + 0.1, depth * 0.75), (x, ridge_y - 0.05, 0)]
        if sx > 0:
            pts = [pts[1], pts[0], pts[2]]
        g.poly([pts[0], pts[1], pts[2]], [lac(0, 0), lac(1, 0), lac(0.5, 1)], "ct")
    # the ridge: a tiled roll with curled chiwen ornaments at the ends and a flaming pearl in the middle
    gl = A("green_glaze")
    box(g, (cx, ridge_y + 0.17, 0), (x1 - x0 - 0.6, 0.38, 0.32), "ct", gl)
    box(g, (cx, ridge_y + 0.39, 0), (x1 - x0 - 0.7, 0.07, 0.36), "ct", A("gold_flat"))
    for sx in (-1, 1):
        xe = cx + sx * (hx - 0.3)
        pts = []
        for k in range(10):
            a = k / 9 * math.pi * 1.25
            pts.append((xe - sx * (0.35 * math.sin(a)), ridge_y + 0.3 + 0.55 * (1 - math.cos(a)) * 0.9, 0))
        tube(g, pts, 0.15, 6, "ct", gl)
        # the upturned eave corners: a gold finial at each
        for side in (1, -1):
            p = P(0 if sx < 0 else 1, 1, side)
            lathe(g, [(0.0, 0.32), (0.08, 0.2), (0.06, 0.05), (0.0, 0.0)], 6, "ct", A("gold_flat"), cx=p[0], cz=p[2], y0=p[1] - 0.1)
    lathe(g, [(0.0, 0.62), (0.16, 0.56), (0.22, 0.42), (0.16, 0.28), (0.07, 0.22), (0.18, 0.1), (0.24, 0.0)], 10, "ct", A("gold"), cx=cx, y0=ridge_y + 0.4)


def brackets(g, x0, x1, y0, y1, d):
    """dougong: rows of stacked blocks and arms under the eaves, front and back"""
    n = max(3, round((x1 - x0) / 0.75))
    for i in range(n + 1):
        x = x0 + (x1 - x0) * i / n
        for side in (1, -1):
            box(g, (x, y0 + 0.14, side * d), (0.26, 0.28, 0.26), "ct", A("teal"))
            box(g, (x, y0 + 0.36, side * (d + 0.12)), (0.62, 0.16, 0.28), "ct", A("lacquer"))
            box(g, (x, y0 + 0.36 + 0.14, side * (d + 0.24)), (0.24, 0.14, 0.3), "ct", A("blue"))
            box(g, (x, y0 + 0.63, side * (d + 0.32)), (0.5, 0.12, 0.26), "ct", A("gold_flat"))
    box(g, ((x0 + x1) / 2, y1 - 0.08, 0), (x1 - x0 + 0.8, 0.16, 2 * d + 0.9), "ct", A("lacquer"))


def pillar(g, x, y_top, r=0.36):
    """a red lacquered column on a granite drum, gold collar under the capital, with front/back stone drums (baogu)"""
    st = A("stone")
    box(g, (x, 0.35, 0), (1.3, 0.7, 1.3), "ct", st)
    lathe(g, [(r * 1.45, 1.0), (r * 1.6, 0.85), (r * 1.6, 0.75), (r * 1.4, 0.7)], 12, "ct", st, cx=x)
    lathe(g, [(r * 0.95, y_top), (r, y_top - 0.3), (r, 1.0)], 12, "ct", A("lacquer"), cx=x, u_rep=2.0)
    lathe(g, [(r * 1.08, y_top - 0.32), (r * 1.08, y_top - 0.52)], 12, "ct", A("gold"), cx=x)
    for side in (1, -1):   # drum stones that brace the column, front and back
        lathe(g, [(0.0, 1.55), (0.42, 1.45), (0.5, 1.1), (0.42, 0.75), (0.0, 0.7)], 10, "ct", st, cx=x, cz=side * 0.95)
        box(g, (x, 0.35, side * 0.95), (0.9, 0.7, 0.7), "ct", st)


def crackers(g, x, z, y_top, length=3.4):
    """a string of firecrackers hanging from a gold knot"""
    lathe(g, [(0.0, y_top), (0.12, y_top - 0.1), (0.14, y_top - 0.25), (0.0, y_top - 0.35)], 8, "ct", A("gold"), cx=x, cz=z)
    n = int(length / 0.5)
    for k in range(n):
        ya = y_top - 0.35 - k * 0.5
        lathe(g, [(0.15, ya), (0.15, ya - 0.48)], 8, "ct", A("cracker"), cx=x, cz=z, phase=k * 0.7)
    lathe(g, [(0.15, y_top - 0.35 - n * 0.5), (0.0, y_top - 0.35 - n * 0.5 - 0.05)], 8, "ct", A("gold"), cx=x, cz=z)


def bay(g, x0, x1, lintel, plaque_top, upper_top, ridge, plaque=None, depth=0.5, roof_over=1.6, roof_depth=2.0):
    """the beams, plaque, brackets and roof of one bay between pillars at x0, x1"""
    cx, w = (x0 + x1) / 2, x1 - x0
    bb, ba = A("beam_b"), A("beam_a")
    lac = A("lacquer")
    # the lower lintel (painted both faces), its ends in lacquer
    y0, y1 = lintel, lintel + 0.6
    box(g, (cx, (y0 + y1) / 2, 0), (w + 0.5, y1 - y0, depth), "ct", {"+z": bb, "-z": bb, "+x": lac, "-x": lac, "+y": lac, "-y": lac})
    # between lintel and upper beam: the plaque in the middle, lacquered panels with gold frames either side
    if plaque:
        pw = min(w * 0.42, 3.6)
        ph = plaque_top - y1
        pz = depth / 2 + 0.06
        quad(g, (cx - pw / 2, y1, pz), (cx + pw / 2, y1, pz), (cx + pw / 2, plaque_top, pz), (cx - pw / 2, plaque_top, pz), "ct", A(plaque[0]))
        quad(g, (cx + pw / 2, y1, -pz), (cx - pw / 2, y1, -pz), (cx - pw / 2, plaque_top, -pz), (cx + pw / 2, plaque_top, -pz), "ct", A(plaque[1]))
        box(g, (cx, (y1 + plaque_top) / 2, 0), (pw + 0.2, ph + 0.1, depth + 0.1), "ct", A("gold_flat"), faces=["+x", "-x", "+y"])
        for sx in (-1, 1):
            a, b = cx + sx * (pw / 2 + 0.1), (x1 if sx > 0 else x0)
            px0, px1 = min(a, b), max(a, b)
            box(g, ((px0 + px1) / 2, (y1 + plaque_top) / 2, 0), (px1 - px0, plaque_top - y1, depth * 0.6), "ct", lac)
            for k in range(2):   # gold lattice panels (a carved screen look)
                xx = px0 + (px1 - px0) * (k + 0.5) / 2
                box(g, (xx, (y1 + plaque_top) / 2, 0), ((px1 - px0) / 2 - 0.25, (plaque_top - y1) - 0.25, depth * 0.62), "ct", A("gold"), faces=["+z", "-z"])
    else:
        box(g, (cx, (y1 + plaque_top) / 2, 0), (w, plaque_top - y1, depth * 0.6), "ct", lac)
        box(g, (cx, (y1 + plaque_top) / 2, 0), (w - 0.4, plaque_top - y1 - 0.2, depth * 0.62), "ct", A("gold"), faces=["+z", "-z"])
    # the upper beam
    box(g, (cx, (plaque_top + upper_top) / 2, 0), (w + 1.0, upper_top - plaque_top, depth + 0.1), "ct", {"+z": ba, "-z": ba, "+x": lac, "-x": lac, "+y": lac, "-y": lac})
    # brackets, then the roof
    eave = upper_top + 0.85
    brackets(g, x0 - 0.4, x1 + 0.4, upper_top, eave, depth / 2 + 0.05)
    roof(g, x0 - roof_over, x1 + roof_over, ridge - 0.45, eave, roof_depth)


def gate(name, half, bays_spec, pillars):
    """bays_spec: [(x0, x1, lintel, plaque_top, upper_top, ridge, plaque)], pillars: [(x, top)]"""
    g = Geo()
    for x, top in pillars:
        pillar(g, x, top)
    for b in bays_spec:
        bay(g, *b)
    # firecrackers down the inner faces of the pillars
    for x, top in pillars:
        for sx in (-1, 1):
            xx = x + sx * 0.55
            inside = any(b[0] < xx < b[1] for b in bays_spec)
            if inside:
                crackers(g, xx, 0.42, top - 1.4, 2.6)
    g.build(name)
    META["gates"][name] = {"half": half, "bays": [[b[0], b[1], b[2]] for b in bays_spec], "pillars": [p[0] for p in pillars]}


def gates():
    # one bay: the street (7-9 m) between pillars on the sidewalks; nominal half width 7.4
    gate("gate_1", 7.4, [(-6.0, 6.0, 5.5, 6.9, 7.5, 10.0, ("plaque_a", "plaque_b"))], [(-6.0, 7.5), (6.0, 7.5)])
    # three bays: a wide central bay and two lower side bays; nominal half width 14
    gate("gate_3", 14.0, [(-5.0, 5.0, 5.7, 7.0, 7.6, 10.0, ("plaque_a", "plaque_b")),
                           (-13.0, -5.0, 4.4, 5.3, 5.8, 8.0, None),
                           (5.0, 13.0, 4.4, 5.3, 5.8, 8.0, None)],
         [(-13.0, 5.8), (-5.0, 7.6), (5.0, 7.6), (13.0, 5.8)])


# ================================================================================ festival dressing

def stall():
    """a festival stall, 2.8 x 2.2 m, open to +z: counter, posts, striped canopy and valance, goods"""
    g = Geo()
    wood, lac, aw = A("wood"), A("lacquer"), A("awning")
    for sx in (-1.3, 1.3):
        for sz in (-1.0, 1.0):
            box(g, (sx, 1.25, sz), (0.08, 2.5, 0.08), "ct", wood)
    box(g, (0, 0.5, 0.85), (2.6, 1.0, 0.5), "ct", {"+z": lac, "-z": wood, "+x": wood, "-x": wood, "+y": wood, "-y": wood})
    box(g, (0, 1.03, 0.85), (2.7, 0.06, 0.6), "ct", wood)
    box(g, (0, 0.45, -0.9), (2.6, 0.9, 0.4), "ct", wood)
    box(g, (0, 1.2, -1.05), (2.6, 2.4, 0.05), "ct", A("canvas"))
    # canopy: sloping down to the front, valance hanging at the front
    quad(g, (-1.45, 2.3, 1.25), (1.45, 2.3, 1.25), (1.45, 2.75, -1.15), (-1.45, 2.75, -1.15), "ct", aw, 0, 0.25, 1, 1)
    quad(g, (1.45, 2.3, 1.25), (-1.45, 2.3, 1.25), (-1.45, 2.75, -1.15), (1.45, 2.75, -1.15), "ct", aw, 0, 0.25, 1, 1)
    quad(g, (-1.45, 1.92, 1.26), (1.45, 1.92, 1.26), (1.45, 2.3, 1.26), (-1.45, 2.3, 1.26), "ct", aw, 0, 0, 1, 0.22)
    quad(g, (1.45, 1.92, 1.25), (-1.45, 1.92, 1.25), (-1.45, 2.3, 1.25), (1.45, 2.3, 1.25), "ct", aw, 0, 0, 1, 0.22)
    rng = random.Random(4)
    for i in range(9):   # goods on the counter: boxes of oranges, red packets, sweets
        x = -1.15 + i * 0.29
        c = rng.choice(["orange", "red", "gold_flat", "pink", "white"])
        box(g, (x, 1.1 + 0.06, 0.85 + rng.uniform(-0.1, 0.1)), (0.24, 0.12 + rng.random() * 0.1, 0.3), "ct", A(c))
    # two small lanterns at the front corners
    lg = lantern_geo(6, 4, True)
    for sx in (-1.25, 1.25):
        g.merge(lg, T(sx, 2.25, 1.15) @ S(0.55, 0.55, 0.55))
    g.build("stall")


def barricade():
    """a red festival barricade, 2.3 m: gold rail, lacquered panel, black feet"""
    g = Geo()
    lac, gold = A("lacquer"), A("gold_flat")
    for sx in (-1.1, 1.1):
        box(g, (sx, 0.55, 0), (0.07, 1.1, 0.07), "ct", lac)
        box(g, (sx, 0.04, 0), (0.12, 0.08, 0.7), "ct", A("black"))
    box(g, (0, 1.06, 0), (2.3, 0.08, 0.08), "ct", gold)
    box(g, (0, 0.62, 0), (2.1, 0.62, 0.04), "ct", {"+z": lac, "-z": lac, "+x": gold, "-x": gold, "+y": gold, "-y": gold})
    box(g, (0, 0.3, 0), (2.2, 0.05, 0.05), "ct", gold)
    g.build("barricade")


def sign_closed():
    g = Geo()
    s = A("sign_closed")
    x, y0, y1, t = 1.3, 1.1, 1.75, 0.03
    quad(g, (-x, y0, t), (x, y0, t), (x, y1, t), (-x, y1, t), "ct", s)
    quad(g, (x, y0, -t), (-x, y0, -t), (-x, y1, -t), (x, y1, -t), "ct", s)
    box(g, (0, (y0 + y1) / 2, 0), (2 * x + 0.06, y1 - y0 + 0.06, 2 * t - 0.01), "ct", A("gold_flat"), faces=["+x", "-x", "+y", "-y"])
    for sx in (-1.1, 1.1):
        box(g, (sx, 0.55, 0), (0.06, 1.1, 0.06), "ct", A("iron"))
        box(g, (sx, 0.03, 0), (0.1, 0.06, 0.6), "ct", A("black"))
    g.build("sign_closed")


def lion():
    """a lion-dance lion resting on the ground between performances, head toward +z (about 2.6 m long)"""
    g = Geo()
    fur, red, gold, white, black = A("lion"), A("red"), A("gold_flat"), A("white"), A("black")
    # the body: a draped cloth over a hoop, a long half-tube lying on the ground
    prof = [(0.0, 0.0), (0.5, 0.05), (0.62, 0.35), (0.55, 0.6), (0.0, 0.66)]
    for i in range(10):
        z0, z1 = -2.0 + i * 0.19, -2.0 + (i + 1) * 0.19
        k0, k1 = 0.75 + 0.25 * math.sin(i / 9 * math.pi), 0.75 + 0.25 * math.sin((i + 1) / 9 * math.pi)
        for j in range(len(prof) - 1):
            for sx in (1, -1):
                a0 = (sx * prof[j][0] * k0, prof[j][1] * k0, z0)
                a1 = (sx * prof[j + 1][0] * k0, prof[j + 1][1] * k0, z0)
                b0 = (sx * prof[j][0] * k1, prof[j][1] * k1, z1)
                b1 = (sx * prof[j + 1][0] * k1, prof[j + 1][1] * k1, z1)
                pts = [a0, b0, b1, a1] if sx > 0 else [b0, a0, a1, b1]
                g.poly(pts, [fur(0, 0), fur(1, 0), fur(1, 1), fur(0, 1)], "ct", flat=False)
    # the tail
    lathe(g, [(0.0, 0.5), (0.18, 0.3), (0.12, 0.0)], 6, "ct", fur, cz=-2.1)
    # the head: a big rounded box, painted face at the front, fur elsewhere; horn, ears, jaw, a white beard
    face = A("lion_face")
    hx, hy, hz, cy, cz = 0.52, 0.45, 0.45, 0.85, 0.35
    box(g, (0, cy, cz), (2 * hx, 2 * hy, 2 * hz), "ct", {"+z": face, "-z": fur, "+x": fur, "-x": fur, "+y": fur, "-y": red})
    for sx in (-1, 1):   # rounded cheeks of fur
        lathe(g, [(0.0, 0.42), (0.26, 0.32), (0.3, 0.0), (0.26, -0.32), (0.0, -0.42)], 8, "ct", fur, cx=sx * 0.48, cz=cz + 0.05, y0=cy - 0.05)
        obox(g, (sx * 0.38, cy + hy, cz - 0.1), (sx * 0.62, cy + hy + 0.3, cz - 0.25), 0.22, 0.08, "ct", gold)   # ears
    lathe(g, [(0.0, 0.5), (0.05, 0.42), (0.1, 0.0)], 6, "ct", gold, cz=cz + 0.2, y0=cy + hy)                 # horn
    box(g, (0, cy - hy - 0.05, cz + 0.12), (0.8, 0.12, 0.6), "ct", red)                                      # lower jaw
    lathe(g, [(0.0, 0.0), (0.18, -0.05), (0.06, -0.45)], 6, "ct", A("white"), cz=cz + 0.45, y0=cy - hy - 0.1)  # beard
    g.build("lion")


# ================================================================================ the Manhattan Bridge

# along the axis (t, metres from the arch centre toward Brooklyn; s across, + to the left)
T_ANCH_M, T_TOW_M, T_TOW_B, T_ANCH_B = 497.0, 719.0, 1167.0, 1389.0
T_RAMP0, T_END_B = 40.0, 1846.0
DECK_ANCH, DECK_TOW, DECK_MID = 38.0, 41.0, 45.0
TOWER_H, SADDLE = 103.0, 99.0
LEG_S = 17.0
CABLES = [-18.2, -15.8, 15.8, 18.2]
APPROACH_HALF = 15.0
DECK_HALF = 17.6


def deck_y(t):
    """top of the roadway along the axis"""
    if t <= T_RAMP0:
        return 0.0
    if t < T_ANCH_M:
        return DECK_ANCH * ((t - T_RAMP0) / (T_ANCH_M - T_RAMP0)) ** 1.15
    if t < T_TOW_M:
        return DECK_ANCH + (DECK_TOW - DECK_ANCH) * (t - T_ANCH_M) / (T_TOW_M - T_ANCH_M)
    if t <= T_TOW_B:
        q = (t - (T_TOW_M + T_TOW_B) / 2) / ((T_TOW_B - T_TOW_M) / 2)
        return DECK_MID - (DECK_MID - DECK_TOW) * q * q
    if t < T_ANCH_B:
        return DECK_TOW + (DECK_ANCH - DECK_TOW) * (t - T_TOW_B) / (T_ANCH_B - T_TOW_B)
    if t < T_END_B:
        return DECK_ANCH * max(0.0, (T_END_B - t) / (T_END_B - T_ANCH_B)) ** 1.15
    return 0.0


def cable_y(t):
    if T_TOW_M <= t <= T_TOW_B:
        q = (t - (T_TOW_M + T_TOW_B) / 2) / ((T_TOW_B - T_TOW_M) / 2)
        return DECK_MID + 3.5 + (SADDLE - DECK_MID - 3.5) * q * q
    if t < T_TOW_M:
        f = (t - (T_ANCH_M + 8)) / (T_TOW_M - T_ANCH_M - 8)
        return (DECK_ANCH + 3) + (SADDLE - DECK_ANCH - 3) * f - 7 * 4 * f * (1 - f)
    f = ((T_ANCH_B - 8) - t) / (T_ANCH_B - 8 - T_TOW_B)
    return (DECK_ANCH + 3) + (SADDLE - DECK_ANCH - 3) * f - 7 * 4 * f * (1 - f)


def approach(g, t0, t1, sgn):
    """the masonry approach: arcaded granite walls, vaulted bays, a parapeted roadway (sgn +1 rising with t)"""
    gr, dk = B("granite"), B("deck")
    hw = APPROACH_HALF
    bay = 24.0
    t = t0
    while t < t1 - 1e-3:
        ta, tb = t, min(t1, t + bay)
        ya, yb = deck_y(ta), deck_y(tb)
        # the roadway, in 8 m steps so it follows the curve
        n = max(1, round((tb - ta) / 8))
        for k in range(n):
            a, b = ta + (tb - ta) * k / n, ta + (tb - ta) * (k + 1) / n
            y0, y1 = deck_y(a), deck_y(b)
            if max(y0, y1) < 0.3:
                continue
            quad(g, (a, y0 + 0.02, hw), (b, y1 + 0.02, hw), (b, y1 + 0.02, -hw), (a, y0 + 0.02, -hw), "br", dk)
            for s in (-1, 1):   # parapets
                ss = s * hw
                quad(g, (a, y0, ss + s * 0.0), (b, y1, ss), (b, y1 + 1.2, ss), (a, y0 + 1.2, ss), "br", gr) if s < 0 else \
                    quad(g, (b, y1, ss), (a, y0, ss), (a, y0 + 1.2, ss), (b, y1 + 1.2, ss), "br", gr)
                quad(g, (a, y0 + 1.2, ss), (b, y1 + 1.2, ss), (b, y1 + 1.2, ss + s * 0.6), (a, y0 + 1.2, ss + s * 0.6), "br", gr) if s > 0 else \
                    quad(g, (b, y1 + 1.2, ss), (a, y0 + 1.2, ss), (a, y0 + 1.2, ss + s * 0.6), (b, y1 + 1.2, ss + s * 0.6), "br", gr)
        ym = min(ya, yb)
        # the side walls: solid where low, an arch through the bay where there's room
        pier = 4.0
        rise_room = ym - 1.6
        for s in (-1, 1):
            ss = s * (hw + 0.6)
            def wall(pts):
                if s < 0:
                    pts = [(p[0], p[1], p[2]) for p in pts][::-1]
                    # keep the quad's corner order valid after reversing
                g.poly(pts, [gr(0, 0), gr(1, 0), gr(1, 1), gr(0, 1)][:len(pts)], "br")
            if rise_room < 7:
                n = max(1, round((tb - ta) / 8))
                for k in range(n):
                    a, b = ta + (tb - ta) * k / n, ta + (tb - ta) * (k + 1) / n
                    y0, y1 = deck_y(a) + 1.2, deck_y(b) + 1.2
                    if max(y0, y1) < 1.5:
                        continue
                    wall([(a, -0.5, ss), (b, -0.5, ss), (b, y1, ss), (a, y0, ss)])
            else:
                o0, o1 = ta + pier, tb
                span = o1 - o0
                spring = max(0.0, ym - 1.8 - span / 2)
                # pier faces
                wall([(ta, -0.5, ss), (ta + pier, -0.5, ss), (ta + pier, deck_y(ta + pier) + 1.2, ss), (ta, ya + 1.2, ss)])
                # spandrel and arch: fan quads from the arch curve up to the deck line
                M = 8
                for k in range(M):
                    a0, a1 = math.pi * (1 - k / M), math.pi * (1 - (k + 1) / M)
                    x0_, x1_ = (o0 + o1) / 2 + math.cos(a0) * span / 2, (o0 + o1) / 2 + math.cos(a1) * span / 2
                    c0, c1 = spring + math.sin(a0) * span / 2, spring + math.sin(a1) * span / 2
                    wall([(x0_, c0, ss), (x1_, c1, ss), (x1_, deck_y(x1_) + 1.2, ss), (x0_, deck_y(x0_) + 1.2, ss)])
                    if s > 0:   # the vault soffit across the full width
                        quad(g, (x1_, c1, -hw - 0.6), (x0_, c0, -hw - 0.6), (x0_, c0, hw + 0.6), (x1_, c1, hw + 0.6), "br", gr)
                if spring > 0.05:
                    for xx in (o0, o1):
                        wall([(xx, -0.5, ss), (xx + 0.01, -0.5, ss), (xx + 0.01, spring, ss), (xx, spring, ss)])
                # the pier's ends (inside the arch openings)
                for xx, nd in ((ta + pier, 1), (ta, -1)):
                    if spring > 0.05 and nd > 0:
                        quad(g, (xx, -0.5, -hw - 0.6), (xx, -0.5, hw + 0.6), (xx, spring, hw + 0.6), (xx, spring, -hw - 0.6), "br", gr)
                if spring > 0.05:
                    quad(g, (o1, -0.5, hw + 0.6), (o1, -0.5, -hw - 0.6), (o1, spring, -hw - 0.6), (o1, spring, hw + 0.6), "br", gr)
                # shops tucked into the arches: a shopfront set back in each opening, the vault's dark mouth above
                if s > 0 and spring > 1.5 and span > 12:
                    inset = hw + 0.6 - 1.4
                    for side in (1, -1):
                        z = side * inset
                        cx = (o0 + o1) / 2
                        sw = min(16.0, span - 2.0)
                        st = "store_a" if (int(ta) // 24) % 2 == 0 else "store_b"
                        a_, b_ = (cx - sw / 2, cx + sw / 2) if side > 0 else (cx + sw / 2, cx - sw / 2)
                        quad(g, (a_, 0.0, z), (b_, 0.0, z), (b_, 4.0, z), (a_, 4.0, z), "dk", D(st))
                        top = spring + span / 2 * 0.92
                        quad(g, (a_, 4.0, z), (b_, 4.0, z), (b_, top, z), (a_, top, z), "br", dk)
            # a cornice band along the top of the wall
            if max(ya, yb) < 0.3:
                continue
            quad(g, (ta, ya + 1.2, ss + s * 0.3), (tb, yb + 1.2, ss + s * 0.3), (tb, yb + 1.45, ss + s * 0.3), (ta, ya + 1.45, ss + s * 0.3), "br", gr) if s > 0 else \
                quad(g, (tb, yb + 1.2, ss + s * 0.3), (ta, ya + 1.2, ss + s * 0.3), (ta, ya + 1.45, ss + s * 0.3), (tb, yb + 1.45, ss + s * 0.3), "br", gr)
        t = tb


def anchorage(g, tc):
    """a granite anchorage: a battered block with arched recesses and a cornice; the roadway runs over it"""
    gr = B("granite")
    L, Wd, H = 56.0, 52.0, DECK_ANCH - 0.5
    box(g, (tc, H / 2 - 1, 0), (L, H + 2, Wd), "br", gr)
    box(g, (tc, H + 0.6, 0), (L + 2.4, 1.4, Wd + 2.4), "br", gr)
    # recessed arched panels on the long sides (dark insets read as blind arches)
    for s in (-1, 1):
        for k in range(4):
            t = tc - L / 2 + (k + 0.5) * L / 4
            box(g, (t, H * 0.45, s * (Wd / 2 + 0.05)), (8.0, H * 0.6, 0.4), "br", B("deck"), faces=["+z" if s > 0 else "-z"])
            box(g, (t, H * 0.75 + 2.5, s * (Wd / 2 + 0.6)), (9.5, 1.2, 1.2), "br", gr)
    # a deck slab and parapets across the top
    y = DECK_ANCH
    quad(g, (tc - L / 2, y + 0.02, DECK_HALF), (tc + L / 2, y + 0.02, DECK_HALF), (tc + L / 2, y + 0.02, -DECK_HALF), (tc - L / 2, y + 0.02, -DECK_HALF), "br", B("deck"))


def truss_deck(g, t0, t1):
    """the stiffening truss: alpha panels on both sides, two deck slabs, lower bracing"""
    tr, st, dk = B("truss"), B("steel"), B("deck")
    D = 7.3
    n = max(1, round((t1 - t0) / 7.6))
    for k in range(n):
        a, b = t0 + (t1 - t0) * k / n, t0 + (t1 - t0) * (k + 1) / n
        ya, yb = deck_y(a), deck_y(b)
        for s in (-DECK_HALF + 0.4, DECK_HALF - 0.4, -6.0, 6.0):
            # double sided alpha panel
            quad(g, (a, ya - D, s), (b, yb - D, s), (b, yb + 0.6, s), (a, ya + 0.6, s), "br_alpha", tr)
            quad(g, (b, yb - D, s), (a, ya - D, s), (a, ya + 0.6, s), (b, yb + 0.6, s), "br_alpha", tr)
        # upper roadway and lower deck
        quad(g, (a, ya, DECK_HALF), (b, yb, DECK_HALF), (b, yb, -DECK_HALF), (a, ya, -DECK_HALF), "br", dk)
        quad(g, (b, yb - 0.5, DECK_HALF), (a, ya - 0.5, DECK_HALF), (a, ya - 0.5, -DECK_HALF), (b, yb - 0.5, -DECK_HALF), "br", st)
        quad(g, (a, ya - D + 0.8, DECK_HALF), (b, yb - D + 0.8, DECK_HALF), (b, yb - D + 0.8, -DECK_HALF), (a, ya - D + 0.8, -DECK_HALF), "br", dk)
        quad(g, (b, yb - D, DECK_HALF), (a, ya - D, DECK_HALF), (a, ya - D, -DECK_HALF), (b, yb - D, -DECK_HALF), "br", st)
        # the outer fascia girders (solid strips top and bottom of the outer trusses, so the edge reads from afar)
        for s in (-1, 1):
            z = s * DECK_HALF
            if s > 0:
                quad(g, (a, ya - 0.2, z), (b, yb - 0.2, z), (b, yb + 0.9, z), (a, ya + 0.9, z), "br", st)
                quad(g, (a, ya - D, z), (b, yb - D, z), (b, yb - D + 0.9, z), (a, ya - D + 0.9, z), "br", st)
            else:
                quad(g, (b, yb - 0.2, z), (a, ya - 0.2, z), (a, ya + 0.9, z), (b, yb + 0.9, z), "br", st)
                quad(g, (b, yb - D, z), (a, ya - D, z), (a, ya - D + 0.9, z), (b, yb - D + 0.9, z), "br", st)


def tower(g, tc):
    st, lat, gr = B("steel"), B("lattice"), B("granite")
    yd = deck_y(tc)
    # the masonry pier in the river
    box(g, (tc, 2.0, 0), (16, 8.0, 2 * LEG_S + 14), "br", gr)
    box(g, (tc, 6.3, 0), (17, 0.6, 2 * LEG_S + 15), "br", gr)
    # two legs, tapering, with vertical ribs
    for s in (-1, 1):
        for k in range(10):
            y0, y1 = 6.6 + (TOWER_H - 6.6) * k / 10, 6.6 + (TOWER_H - 6.6) * (k + 1) / 10
            w0, w1 = 7.2 - 2.2 * k / 10, 7.2 - 2.2 * (k + 1) / 10      # along t
            d0, d1 = 5.4 - 1.4 * k / 10, 5.4 - 1.4 * (k + 1) / 10      # across
            z = s * LEG_S
            P = lambda w, d, y, i, j: (tc + i * w / 2, y, z + j * d / 2)
            for (i0, j0), (i1, j1) in (((-1, 1), (1, 1)), ((1, 1), (1, -1)), ((1, -1), (-1, -1)), ((-1, -1), (-1, 1))):
                quad(g, P(w0, d0, y0, i0, j0), P(w0, d0, y0, i1, j1), P(w1, d1, y1, i1, j1), P(w1, d1, y1, i0, j0), "br", st)
            # a raised rib down the middle of each long face
            for i in (-1, 1):
                box(g, (tc + i * (w0 + w1) / 4, (y0 + y1) / 2, z), (0.5, y1 - y0, 0.9), "br", st)
        # leg cap and finial
        box(g, (tc, TOWER_H + 0.9, s * LEG_S), (6.0, 1.8, 4.8), "br", st)
        box(g, (tc, TOWER_H + 2.2, s * LEG_S), (4.8, 0.8, 3.8), "br", st)
        lathe(g, [(0.0, 4.6), (1.0, 4.0), (1.3, 3.0), (1.0, 2.0), (0.5, 1.6), (0.9, 0.5), (1.2, 0.0)], 10, "br", st, cx=tc, cz=s * LEG_S, y0=TOWER_H + 2.6)
    # the top portal: a deep girder between the legs with an arched underside
    inner = LEG_S - 2.0
    for f in (-1, 1):
        tt = tc + f * 2.2
        M = 10
        for k in range(M):
            a0, a1 = math.pi * k / M, math.pi * (k + 1) / M
            z0, z1 = math.cos(a0) * inner, math.cos(a1) * inner
            c0, c1 = 84.0 + math.sin(a0) * 8.0, 84.0 + math.sin(a1) * 8.0
            pts = [(tt, c0, z0), (tt, c1, z1), (tt, 98.0, z1), (tt, 98.0, z0)]
            if f < 0:
                pts = [pts[1], pts[0], pts[3], pts[2]]
            g.poly(pts, [st(0, 0), st(1, 0), st(1, 1), st(0, 1)], "br")
            if f > 0:   # the arch soffit
                quad(g, (tc + 2.2, c0, z0), (tc - 2.2, c0, z0), (tc - 2.2, c1, z1), (tc + 2.2, c1, z1), "br", st)
        box(g, (tt + f * 0.4, 98.6, 0), (0.8, 1.2, 2 * inner + 2), "br", st)
    box(g, (tc, 100.0, 0), (6.4, 1.8, 2 * LEG_S + 6), "br", st)
    # a light lattice strut at mid height, and the deck-level strut
    box(g, (tc, 66.0, 0), (3.0, 2.2, 2 * inner), "br", st)
    for f in (-1, 1):
        quad(g, (tc + f * 1.6, 64.9, inner if f > 0 else -inner), (tc + f * 1.6, 64.9, -inner if f > 0 else inner),
             (tc + f * 1.6, 67.1, -inner if f > 0 else inner), (tc + f * 1.6, 67.1, inner if f > 0 else -inner), "br", st)
    # X lattice bracing below the deck, panels across, front and back
    yb0, yb1 = 7.0, yd - 8.0
    nx = 6
    ny = max(1, round((yb1 - yb0) / 9.0))
    for f in (-1, 1):
        tt = tc + f * 2.6
        for i in range(nx):
            for j in range(ny):
                z0, z1 = -inner + 2 * inner * i / nx, -inner + 2 * inner * (i + 1) / nx
                y0, y1 = yb0 + (yb1 - yb0) * j / ny, yb0 + (yb1 - yb0) * (j + 1) / ny
                quad(g, (tt, y0, z0), (tt, y0, z1), (tt, y1, z1), (tt, y1, z0), "br_alpha", lat)
                quad(g, (tt, y0, z1), (tt, y0, z0), (tt, y1, z0), (tt, y1, z1), "br_alpha", lat)
    box(g, (tc, yd - 7.6, 0), (5.0, 1.2, 2 * inner), "br", st)


def cables(g):
    cb, st = B("cable"), B("steel")
    for s in CABLES:
        segs = []
        for (a, b, step) in ((T_ANCH_M + 8, T_TOW_M, 6.0), (T_TOW_M, T_TOW_B, 5.6), (T_TOW_B, T_ANCH_B - 8, 6.0)):
            n = round((b - a) / step)
            pts = [(a + (b - a) * k / n, cable_y(a + (b - a) * k / n), s) for k in range(n + 1)]
            tube(g, pts, 0.55, 6, "br", cb, v_per_m=0.05)
            # suspenders down to the deck (on the outer and inner cables alike)
            for k in range(1, n):
                t, y = pts[k][0], pts[k][1]
                yd = deck_y(t) + 0.6
                if y - yd > 1.0:
                    obox(g, (t, yd, s), (t, y, s), 0.12, 0.12, "br", st, up=(1, 0, 0))
        # where the cables dive into the anchorages
        for (t, d) in ((T_ANCH_M + 8, -1), (T_ANCH_B - 8, 1)):
            obox(g, (t, cable_y(t), s), (t + d * 8, DECK_ANCH - 1, s), 1.6, 1.6, "br", st)


def deck_dressing(g, t0, t1):
    """lane markings on the upper roadway (white dashes, a double yellow up the middle) and lamp posts"""
    w, yel = A("white"), A("gold_flat")
    t = t0
    while t < t1:
        a, b = t, min(t1, t + 3.0)
        ya, yb = deck_y(a) + 0.05, deck_y(b) + 0.05
        if max(ya, yb) > 0.3:
            for s in (-7.0, -3.5, 3.5, 7.0):
                quad(g, (a, ya, s + 0.07), (b, yb, s + 0.07), (b, yb, s - 0.07), (a, ya, s - 0.07), "ct", w)
        t += 9.0
    t = t0
    while t < t1:
        b = min(t1, t + 8.0)
        ya, yb = deck_y(t) + 0.05, deck_y(b) + 0.05
        if max(ya, yb) > 0.3:
            for s in (-0.18, 0.18):
                quad(g, (t, ya, s + 0.06), (b, yb, s + 0.06), (b, yb, s - 0.06), (t, ya, s - 0.06), "ct", yel)
        t = b
    pole = A("pole_grey")
    t = t0 + 20
    while t < t1:
        y = deck_y(t)
        if y > 3:
            for sg in (-1, 1):
                z = sg * (DECK_HALF - 0.8)
                lathe(g, [(0.09, 7.5), (0.11, 0.0)], 5, "ct", pole, cx=t, cz=z, y0=y)
                obox(g, (t, y + 7.4, z), (t, y + 7.6, z - sg * 1.8), 0.1, 0.1, "ct", pole)
                box(g, (t, y + 7.55, z - sg * 2.0), (0.8, 0.2, 0.4), "ct", pole)
                q = [(t + 0.35, y + 7.44, z - sg * 1.85), (t - 0.35, y + 7.44, z - sg * 1.85), (t - 0.35, y + 7.44, z - sg * 2.15), (t + 0.35, y + 7.44, z - sg * 2.15)]
                if sg < 0:
                    q = [q[1], q[0], q[3], q[2]]
                quad(g, *q, "ct_glow", A("lamp_head"))
        t += 45.0


def bridge_main():
    g = Geo()
    deck_dressing(g, T_RAMP0, T_END_B)
    approach(g, 3.0, T_ANCH_M - 28, 1)
    anchorage(g, T_ANCH_M)
    truss_deck(g, T_ANCH_M + 28, T_ANCH_B - 28)
    tower(g, T_TOW_M)
    tower(g, T_TOW_B)
    cables(g)
    anchorage(g, T_ANCH_B)
    approach(g, T_ANCH_B + 28, T_END_B, -1)
    g.build("bridge_main")


PLAIN = lambda u, v: (0.30 + 0.04 * u, 0.40 + 0.04 * v)   # a smooth patch of one limestone block


def column(g, x, z, h, r, mat, uvf, y0=0.0):
    """a Tuscan column: base, shaft with entasis, capital"""
    lathe(g, [(r * 1.0, y0 + h), (r * 1.35, y0 + h - 0.08), (r * 1.35, y0 + h - 0.32), (r * 0.95, y0 + h - 0.45), (r * 0.9, y0 + h * 0.66),
              (r * 1.0, y0 + 0.55), (r * 1.3, y0 + 0.4), (r * 1.35, y0 + 0.0)], 10, mat, uvf, cx=x, cz=z)


def bridge_arch():
    """the arch (Porte Saint-Denis-like: a big round-headed opening, paired columns, a heavy cornice and
    attic with a sculpture group) and the curved colonnades either side, on a granite stylobate"""
    g = Geo()
    ls, gr = B("limestone"), B("granite")
    t0, t1 = -0.9 - 1.5, 3.0 + 1.5                 # the arch block, front (plaza) to back
    hw = 11.75
    ow, spring = 5.0, 10.0                          # opening half width, springing height
    crown = spring + ow
    top = 17.0
    # piers
    for s in (-1, 1):
        z0, z1 = s * ow, s * hw
        box(g, ((t0 + t1) / 2, top / 2, (z0 + z1) / 2), (t1 - t0, top, abs(z1 - z0)), "br", ls)
    # the spandrel above the opening, front and back faces + the soffit (intrados)
    M = 12
    for k in range(M):
        a0, a1 = math.pi * k / M, math.pi * (k + 1) / M
        z0, z1 = math.cos(a0) * ow, math.cos(a1) * ow
        y0, y1 = spring + math.sin(a0) * ow, spring + math.sin(a1) * ow
        quad(g, (t0, y1, z1), (t0, y0, z0), (t0, top, z0), (t0, top, z1), "br", ls)       # front face (-t)
        quad(g, (t1, y0, z0), (t1, y1, z1), (t1, top, z1), (t1, top, z0), "br", ls)       # back face (+t)
        quad(g, (t1, y1, z1), (t1, y0, z0), (t0, y0, z0), (t0, y1, z1), "br", ls)       # soffit (facing down)
        # voussoirs: a proud ring around the opening, with a keystone
        for tt, sg in ((t0 - 0.15, -1), (t1 + 0.15, 1)):
            r0, r1 = ow, ow + 1.1
            p = [(tt, spring + math.sin(a0) * r0, math.cos(a0) * r0), (tt, spring + math.sin(a1) * r0, math.cos(a1) * r0),
                 (tt, spring + math.sin(a1) * r1, math.cos(a1) * r1), (tt, spring + math.sin(a0) * r1, math.cos(a0) * r1)]
            if sg < 0:
                p = [p[1], p[0], p[3], p[2]]
            g.poly(p, [gr(0, 0), gr(1, 0), gr(1, 1), gr(0, 1)], "br")
    box(g, ((t0 + t1) / 2, crown + 0.8, 0), (t1 - t0 + 0.6, 1.8, 1.4), "br", gr)
    # the opening's jambs
    for s in (-1, 1):
        quad(g, (t1, 0, s * ow), (t0, 0, s * ow), (t0, spring, s * ow), (t1, spring, s * ow), "br", ls) if s > 0 else \
            quad(g, (t0, 0, s * ow), (t1, 0, s * ow), (t1, spring, s * ow), (t0, spring, s * ow), "br", ls)
    # paired columns on both faces, on pedestals, carrying an entablature break
    for tt, sg in ((t0 - 0.8, -1), (t1 + 0.8, 1)):
        for s in (-1, 1):
            for zc in (6.6, 9.6):
                box(g, (tt, 1.1, s * zc), (1.7, 2.2, 1.7), "br", gr)
                column(g, tt, s * zc, 11.2, 0.62, "br_lime", PLAIN, y0=2.2)
            box(g, (tt, 14.0, s * 8.1), (1.9, 1.6, 5.2), "br", ls)
    # cornice, attic, and the sculpture group on top
    box(g, ((t0 + t1) / 2, top + 0.5, 0), (t1 - t0 + 3.6, 1.0, 2 * hw + 2.4), "br", gr)
    box(g, ((t0 + t1) / 2, top + 1.2, 0), (t1 - t0 + 2.6, 0.4, 2 * hw + 1.6), "br", ls)
    box(g, ((t0 + t1) / 2, top + 3.1, 0), (t1 - t0 + 0.6, 3.4, 2 * hw - 1.0), "br", ls)
    box(g, ((t0 + t1) / 2, top + 4.95, 0), (t1 - t0 + 1.4, 0.5, 2 * hw - 0.2), "br", gr)
    for tt in (t0 - 0.35, t1 + 0.35):   # inscription panels on the attic, framed
        box(g, (tt, top + 3.1, 0), (0.12, 2.0, 12.0), "br", gr, faces=["+x", "-x"])
    for s in (-1, 1):                   # pedestals at the attic's corners
        box(g, ((t0 + t1) / 2, top + 5.9, s * (hw - 1.6)), (t1 - t0 - 0.4, 1.4, 2.4), "br", ls)
    # the colonnades: two curved wings from the arch's plaza face back toward the Bowery
    # (centreline from the city footprint, bridge_layout.json: (t, s) pairs; mirrored for -s)
    fp = BL["footprint"]
    outer = [(-5.22, 16.67), (-12.36, 21.5), (-20.31, 24.81), (-28.77, 26.49), (-34.18, 27.05)]
    inner = [(-5.23, 13.25), (-11.71, 17.95), (-17.53, 20.73), (-23.67, 22.62), (-29.98, 23.5)]
    void = fp
    H = 8.6
    for s in (-1, 1):
        # resample both edges and build the stylobate, two rows of columns, the entablature and a balustrade
        def edge(pts, k, n):
            f = k / n * (len(pts) - 1)
            i = min(len(pts) - 2, int(f)); fr = f - i
            return (pts[i][0] + (pts[i + 1][0] - pts[i][0]) * fr, s * (pts[i][1] + (pts[i + 1][1] - pts[i][1]) * fr))
        n = 12
        O = [edge(outer, k, n) for k in range(n + 1)]
        I = [edge(inner, k, n) for k in range(n + 1)]
        for k in range(n):
            o0, o1, i0, i1 = O[k], O[k + 1], I[k], I[k + 1]
            def P(p, y):
                return (p[0], y, p[1])
            for (y0, y1, mat_) in ((0.0, 0.7, gr), (H, H + 1.6, ls), (H + 1.6, H + 2.4, gr)):
                # outer face, inner face, top
                qo = [P(o0, y0), P(o1, y0), P(o1, y1), P(o0, y1)]
                qi = [P(i1, y0), P(i0, y0), P(i0, y1), P(i1, y1)]
                if s > 0:
                    qo = [qo[1], qo[0], qo[3], qo[2]]
                    qi = [qi[1], qi[0], qi[3], qi[2]]
                g.poly(qo, [mat_(0, 0), mat_(1, 0), mat_(1, 1), mat_(0, 1)], "br")
                g.poly(qi, [mat_(0, 0), mat_(1, 0), mat_(1, 1), mat_(0, 1)], "br")
                qt = [P(i0, y1), P(i1, y1), P(o1, y1), P(o0, y1)]
                qb = [P(o0, y0), P(o1, y0), P(i1, y0), P(i0, y0)]
                if s < 0:
                    qt = [qt[1], qt[0], qt[3], qt[2]]
                    qb = [qb[1], qb[0], qb[3], qb[2]]
                g.poly(qt, [mat_(0, 0), mat_(1, 0), mat_(1, 1), mat_(0, 1)], "br")
                if y0 > 0:
                    g.poly(qb, [mat_(0, 0), mat_(1, 0), mat_(1, 1), mat_(0, 1)], "br")
            # balusters on top (a row of small posts read as a balustrade)
            for f in (0.25, 0.75):
                m = ((o0[0] + o1[0]) / 2 * 0.5 + (i0[0] + i1[0]) / 2 * 0.5, (o0[1] + o1[1]) / 2 * 0.5 + (i0[1] + i1[1]) / 2 * 0.5)
                box(g, (m[0] + (o1[0] - o0[0]) * (f - 0.5), H + 2.85, m[1] + (o1[1] - o0[1]) * (f - 0.5)), (0.5, 0.9, 0.5), "br", ls)
        # columns: outer and inner rows, every other resampled point
        for k in range(0, n + 1):
            for row, pts, inset in (("o", O, 0.75), ("i", I, -0.75)):
                p = pts[k]
                q = I[k] if row == "o" else O[k]
                dx, dz = q[0] - p[0], q[1] - p[1]
                L = math.hypot(dx, dz) or 1
                cx, cz = p[0] + dx / L * 0.75, p[1] + dz / L * 0.75
                column(g, cx, cz, H - 0.7, 0.42, "br_lime", PLAIN, y0=0.7)
        # the end pavilion
        e = ((O[-1][0] + I[-1][0]) / 2 - 1.5, (O[-1][1] + I[-1][1]) / 2)
        box(g, (e[0], (H + 2.4) / 2, e[1]), (3.2, H + 2.4, 4.6), "br", ls)
        box(g, (e[0], H + 2.8, e[1]), (3.6, 0.8, 5.0), "br", gr)
    # stylobate under the arch, and the plaza paving between the wings
    box(g, ((t0 + t1) / 2, 0.15, 0), (t1 - t0 + 4, 0.3, 2 * hw + 4), "br", gr, faces=["+x", "-x", "+z", "-z", "+y"])
    g.build("bridge_arch")


# ================================================================================ textures, export, previews

def textures():
    s = bpy.context.scene
    s.view_settings.view_transform = "Standard"
    s.render.image_settings.file_format = "WEBP"
    s.render.image_settings.quality = 90
    out = {}
    def load(name):
        return bpy.data.images.load(os.path.join(TS, name, name + ".png"))
    src = load("ChinatownAtlas")
    s.render.image_settings.color_mode = "RGB"
    src.save_render(os.path.join(TEXOUT, "atlas.webp"), scene=s)
    small = src.copy()
    small.scale(512, 512)
    small.save_render(os.path.join(TEXOUT, "atlas_512.webp"), scene=s)
    out["atlas"] = src
    dsrc = load("DistrictAtlas")
    dsrc.save_render(os.path.join(TEXOUT, "district.webp"), scene=s)
    dsmall = dsrc.copy()
    dsmall.scale(512, 512)
    dsmall.save_render(os.path.join(TEXOUT, "district_512.webp"), scene=s)
    dtiny = dsrc.copy()
    dtiny.scale(256, 256)
    dtiny.save_render(os.path.join(TEXOUT, "district_256.webp"), scene=s)
    out["district"] = dsrc
    for name, f in (("BridgeGranite", "granite"), ("BridgeLimestone", "limestone"), ("BridgeSteel", "steel")):
        im = load(name)
        im.save_render(os.path.join(TEXOUT, f + ".webp"), scene=s)
        out[f] = im
    tr = load("BridgeTruss")
    s.render.image_settings.color_mode = "RGBA"
    tr.save_render(os.path.join(TEXOUT, "truss.webp"), scene=s)
    out["truss"] = tr
    return out


def export(path, names):
    bpy.ops.object.select_all(action="DESELECT")
    for n in names:
        bpy.data.objects[n].select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_materials="EXPORT", export_image_format="NONE", export_normals=True,
                              export_texcoords=True, export_yup=True, export_animations=False)


def preview_materials(imgs):
    """give the materials real textures for the review renders (the GLBs go out without images)"""
    def setup(m, img, emit=0.0, alpha=False, rough=0.6, metal=0.0):
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        tex.interpolation = "Closest" if False else "Linear"
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = metal
        if emit:
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = emit
        if alpha:
            nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
            m.surface_render_method = "DITHERED"
    for n in ("ct", "ct_glow", "br_granite", "br_lime", "br_steel"):
        material(n).use_backface_culling = True
    setup(material("ct"), imgs["atlas"], rough=0.55)
    setup(material("ct_glow"), imgs["atlas"], emit=2.5)
    setup(material("dk"), imgs["district"], emit=0.6)
    setup(material("br_granite"), imgs["granite"], rough=0.8)
    setup(material("br_lime"), imgs["limestone"], rough=0.7)
    setup(material("br_steel"), imgs["steel"], rough=0.6, metal=0.2)
    setup(material("br_alpha"), imgs["truss"], alpha=True, rough=0.6, metal=0.2)
    setup(material("crane_alpha"), imgs["truss"], alpha=True, rough=0.6, metal=0.2)
    dm = material("br_deck")
    dm.use_nodes = True
    dm.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (0.05, 0.05, 0.05, 1)


def previews(imgs):
    preview_materials(imgs)
    s = bpy.context.scene
    s.render.engine = "BLENDER_EEVEE"
    s.render.threads_mode = "FIXED"
    s.render.threads = 8
    s.render.image_settings.file_format = "PNG"
    s.render.image_settings.color_mode = "RGB"
    s.view_settings.view_transform = "AgX"
    world = bpy.data.worlds.new("nov")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.42, 0.47, 0.55, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
    s.world = world
    bpy.ops.object.light_add(type="SUN", rotation=(math.radians(62), 0, math.radians(-35)))
    sun = bpy.context.object
    sun.data.energy = 2.2
    sun.data.color = (1.0, 0.86, 0.72)
    bpy.ops.object.camera_add()
    cam = bpy.context.object
    s.camera = cam
    cam.data.clip_end = 5000
    bpy.ops.mesh.primitive_plane_add(size=6000, location=(0, 0, -0.01))
    gnd = bpy.context.object
    gnd.name = "ground"
    gm = bpy.data.materials.new("gnd")
    gm.use_nodes = True
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.16, 0.16, 0.16, 1)
    gnd.data.materials.append(gm)
    objs = {o.name: o for o in s.objects if o.type == "MESH"}

    def place(name, x, y, z, yaw=0.0, sc=(1, 1, 1)):
        o = objs[name]
        o.location = (x, -z, y)
        o.rotation_euler = (0, 0, yaw)
        o.scale = sc
        return o

    def copy(name, x, y, z, yaw=0.0, sc=(1, 1, 1)):
        o = objs[name].copy()
        s.collection.objects.link(o)
        o.location = (x, -z, y)
        o.rotation_euler = (0, 0, yaw)
        o.scale = sc
        return o

    def show(names):
        for o in s.objects:
            if o.type == "MESH":
                o.hide_render = o.name.split(".")[0] not in names and o.name != "ground"

    def shoot(name, target, dist, yaw, elev, res=(1400, 800), lens=35):
        cam.data.lens = lens
        t = Vector((target[0], -target[2], target[1]))
        d = Vector((math.sin(math.radians(yaw)), -math.cos(math.radians(yaw)), math.tan(math.radians(elev))))
        cam.location = t + d.normalized() * dist
        cam.rotation_euler = (t - cam.location).to_track_quat("-Z", "Y").to_euler()
        s.render.resolution_x, s.render.resolution_y = res
        s.render.filepath = os.path.join(PREV, name + ".png")
        bpy.ops.render.render(write_still=True)

    # the gates with their lantern curtains, barricades and a stall, as the game lays them out
    for o in objs.values():
        o.location = (0, 0, -500)
    place("gate_1", -9, 0, 0)
    place("gate_3", 14, 0, 0)
    for gname, gx in (("gate_1", -9), ("gate_3", 14)):
        for b in META["gates"][gname]["bays"]:
            x0, x1, lintel = b
            n = max(2, int((x1 - x0 - 1.0) / 0.8))
            for i in range(n):
                x = gx + x0 + 0.5 + (x1 - x0 - 1.0) * (i + 0.5) / n
                y = lintel - 0.1
                while y > 2.6:
                    copy("lantern_hi", x, y, 0.1 * ((i % 2) * 2 - 1), sc=(0.8, 0.8, 0.8))
                    y -= 1.0
            nb = max(1, int((x1 - x0) / 2.4))
            for i in range(nb):
                copy("barricade", gx + x0 + (x1 - x0) * (i + 0.5) / nb, 0, 1.0)
        copy("sign_closed", gx, 0, 1.6)
    copy("stall", -11, 0, -4.5, math.pi)
    copy("stall", 18, 0, -5, math.pi)
    copy("lion", 6, 0, -4.0, 0.4)
    show(["gate_1", "gate_3", "lantern_hi", "barricade", "sign_closed", "stall", "lion"])
    shoot("gates_front", (3, 5.5, 0), 34, 185, 6, res=(1600, 800))
    shoot("gate1_close", (-9, 6.5, 0), 15, 200, 4)
    shoot("gate3_roof", (14, 8.5, 0), 14, 160, 22)
    shoot("gates_back", (3, 5, 0), 30, 20, 10, res=(1600, 800))
    # lanterns and signs up close
    show(["lantern_hi", "lantern_lo", "neon_0", "neon_1", "neon_2", "neon_3", "lion", "stall"])
    place("lantern_hi", 0, 2.5, 0)
    place("lantern_lo", 1.2, 2.5, 0)
    for k in range(4):
        place("neon_%d" % k, 2.5 + k * 0.9, 1.5, 0, -math.pi / 2)
    place("lion", -2.5, 0, 0, 0.5)
    place("stall", -6.5, 0, 0)
    shoot("kit_close", (-0.5, 1.3, 0), 9, 190, 8)
    # the district kit
    show(["water_tower", "lamp", "car", "suv", "jersey", "railing", "train_car", "hoarding", "fence", "cabin", "crane"])
    for i, n in enumerate(["water_tower", "lamp", "car", "suv", "jersey", "railing", "hoarding", "fence", "cabin"]):
        place(n, -16 + i * 4, 0, 0)
    place("train_car", 0, 0, -6)
    shoot("district_kit", (0, 2.5, -2), 30, 200, 14, res=(1600, 800))
    place("crane", 0, 0, 30)
    shoot("district_crane", (15, 35, 30), 110, 200, 8, res=(1200, 900))
    # the bridge
    show(["bridge_main", "bridge_arch"])
    place("bridge_main", 0, 0, 0)
    place("bridge_arch", 0, 0, 0)
    gnd.location = (0, 0, -1.6)
    s.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    shoot("bridge_side", (930, 45, 0), 1300, 0, 4, res=(1800, 700), lens=40)
    shoot("bridge_tower", (719, 60, 0), 220, 300, 6, res=(1400, 900))
    shoot("bridge_approach", (250, 15, 0), 260, 330, 12, res=(1600, 900))
    shoot("arch_plaza", (-6, 9, 0), 70, 280, 8, res=(1600, 900))
    shoot("arch_above", (-10, 5, 0), 90, 250, 40, res=(1600, 900))


# ================================================================================ the bridge district's kit

def water_tower():
    """a rooftop water tank: steel legs, a wooden tank with hoops, a conical roof (about 7 m tall)"""
    g = Geo()
    iron, wood = A("iron"), A("tank_wood")
    for sx in (-1, 1):
        for sz in (-1, 1):
            box(g, (sx * 1.2, 1.4, sz * 1.2), (0.16, 2.8, 0.16), "ct", iron)
    box(g, (0, 2.8, 0), (2.9, 0.18, 2.9), "ct", iron)
    lathe(g, [(1.75, 6.0), (1.75, 2.9)], 10, "ct", wood, u_rep=3.0)
    for y in (3.4, 4.3, 5.2):
        lathe(g, [(1.79, y + 0.05), (1.79, y - 0.05)], 10, "ct", iron)
    lathe(g, [(0.0, 7.3), (0.12, 7.1), (1.95, 6.0), (1.75, 5.95)], 10, "ct", iron)
    g.build("water_tower")


def lamp():
    """a NYC cobra-head street light, 9 m, the head over the street (+z)"""
    g = Geo()
    pole = A("pole_grey")
    lathe(g, [(0.10, 8.6), (0.12, 1.0), (0.2, 0.9), (0.22, 0.0)], 6, "ct", pole)
    obox(g, (0, 8.4, 0), (0, 8.9, 1.6), 0.12, 0.12, "ct", pole)
    obox(g, (0, 8.9, 1.6), (0, 8.95, 2.6), 0.12, 0.12, "ct", pole)
    box(g, (0, 8.9, 3.0), (0.45, 0.22, 0.95), "ct", pole)
    quad(g, (0.2, 8.78, 3.4), (-0.2, 8.78, 3.4), (-0.2, 8.78, 2.6), (0.2, 8.78, 2.6), "ct_glow", A("lamp_head"))
    g.build("lamp")


def car(name, suv=False):
    """a parked car (or SUV), 4.6 m long along +z: body in white (tinted per instance), dark glass, black tyres"""
    g = Geo()
    body, glass, tyre = A("car_white"), A("glass_dark"), A("car_black")
    L, W = (4.9, 1.95) if suv else (4.6, 1.8)
    h0, h1, h2 = 0.32, (1.0 if suv else 0.85), (1.75 if suv else 1.42)
    box(g, (0, (h0 + h1) / 2, 0), (W, h1 - h0, L), "ct", body)
    # the cabin: a tapered box with glass sides
    c0, c1 = (-1.7, 1.5) if suv else (-1.1, 1.0)
    t0, t1 = (c0 + 0.15, c1 - 0.1) if suv else (c0 + 0.45, c1 - 0.35)
    w0, w1 = W / 2 - 0.05, W / 2 - 0.2
    P = [(-w0, h1, c0), (w0, h1, c0), (w0, h1, c1), (-w0, h1, c1), (-w1, h2, t0), (w1, h2, t0), (w1, h2, t1), (-w1, h2, t1)]
    quad(g, P[1], P[0], P[4], P[5], "ct", glass)      # rear
    quad(g, P[3], P[2], P[6], P[7], "ct", glass)      # windscreen
    quad(g, P[2], P[1], P[5], P[6], "ct", glass)      # sides
    quad(g, P[0], P[3], P[7], P[4], "ct", glass)
    quad(g, P[4], P[7], P[6], P[5], "ct", body)       # roof
    for sz in (-L * 0.32, L * 0.32):
        for sx in (-1, 1):
            box(g, (sx * (W / 2 - 0.1), 0.33, sz), (0.24, 0.66, 0.66), "ct", tyre, faces=["+x", "-x", "+z", "-z", "+y"])
    for sx in (-0.6, 0.6):
        box(g, (sx, h1 - 0.2, L / 2 + 0.01), (0.3, 0.12, 0.02), "ct_glow", A("headlight"), faces=["+z"])
        box(g, (sx, h1 - 0.2, -L / 2 - 0.01), (0.3, 0.12, 0.02), "ct_glow", A("tail_red"), faces=["-z"])
    g.build(name)


def jersey():
    """1 m of concrete median barrier along +x (the game stretches it)"""
    g = Geo()
    c = A("jersey")
    prof = [(0.3, 0.0), (0.28, 0.08), (0.12, 0.33), (0.075, 0.81), (-0.075, 0.81), (-0.12, 0.33), (-0.28, 0.08), (-0.3, 0.0)]
    for k in range(len(prof) - 1):
        (z0, y0), (z1, y1) = prof[k], prof[k + 1]
        quad(g, (0.5, y0, z0), (-0.5, y0, z0), (-0.5, y1, z1), (0.5, y1, z1), "ct", c)
    g.build("jersey")


def railing():
    """2 m of esplanade railing along +x: a post, a top rail, three lower rails (dark green iron)"""
    g = Geo()
    c = A("pole_green")
    box(g, (-0.95, 0.55, 0), (0.08, 1.1, 0.08), "ct", c)
    box(g, (0, 1.08, 0), (2.0, 0.07, 0.09), "ct", c)
    for y in (0.3, 0.55, 0.8):
        box(g, (0, y, 0), (2.0, 0.03, 0.03), "ct", c, faces=["+y", "-y", "+z", "-z"])
    g.build("railing")


def train_car():
    """an R160 subway car, 18.4 m along +x: silver body, a dark window band, the blue stripe, end lights"""
    g = Geo()
    s, glass, blue = A("silver"), A("glass_dark"), A("train_blue")
    L, W, H = 18.4, 3.0, 3.6
    box(g, (0, 0.25 + 1.45, 0), (L, 2.9, W), "ct", s)                      # body
    box(g, (0, 0.25 + 3.15, 0), (L - 0.4, 0.5, W - 0.3), "ct", s)          # roof
    for sz in (1, -1):
        z = sz * (W / 2 + 0.01)
        f = (lambda p: p) if sz > 0 else (lambda p: [p[1], p[0], p[3], p[2]])
        q = f([(-L / 2 + 0.6, 1.6, z), (L / 2 - 0.6, 1.6, z), (L / 2 - 0.6, 2.55, z), (-L / 2 + 0.6, 2.55, z)])
        quad(g, *q, "ct", glass)
        q = f([(-L / 2, 1.2, z), (L / 2, 1.2, z), (L / 2, 1.38, z), (-L / 2, 1.38, z)])
        quad(g, *q, "ct", blue)
        for k in range(4):   # doors (darker)
            x = -L / 2 + 2.3 + k * 4.6
            zd = sz * (W / 2 + 0.03)
            q = f([(x - 0.65, 0.45, zd), (x + 0.65, 0.45, zd), (x + 0.65, 2.75, zd), (x - 0.65, 2.75, zd)])
            quad(g, *q, "ct", A("pole_grey"))
    for sx in (1, -1):
        for zz in (-0.9, 0.9):
            box(g, (sx * (L / 2 + 0.01), 0.9, zz), (0.02, 0.2, 0.3), "ct_glow", A("headlight"), faces=["+x" if sx > 0 else "-x"])
    box(g, (0, 0.15, 0), (L - 1.0, 0.3, W - 0.6), "ct", A("black"))      # running gear
    g.build("train_car")


def hoarding():
    """a 2.4 m panel of painted plywood site hoarding on two posts (white: the game paints it per panel), a poster"""
    g = Geo()
    box(g, (0, 1.25, 0), (2.4, 2.5, 0.06), "ct", A("white"))
    for sx in (-1.15, 1.15):
        box(g, (sx, 1.25, -0.12), (0.1, 2.5, 0.1), "ct", A("white"), faces=["+x", "-x", "-z", "+z"])
    quad(g, (-0.7, 0.9, 0.035), (0.5, 0.9, 0.035), (0.5, 2.0, 0.035), (-0.7, 2.0, 0.035), "ct", A("neon_2"))   # a fly-poster
    g.build("hoarding")


def fence():
    """2.4 m of chain-link on steel posts (the lattice reads as the mesh)"""
    g = Geo()
    lat = B("lattice")
    quad(g, (-1.2, 0.05, 0), (1.2, 0.05, 0), (1.2, 1.9, 0), (-1.2, 1.9, 0), "br_alpha", lat)
    quad(g, (1.2, 0.05, 0), (-1.2, 0.05, 0), (-1.2, 1.9, 0), (1.2, 1.9, 0), "br_alpha", lat)
    box(g, (-1.2, 1.0, 0), (0.07, 2.0, 0.07), "ct", A("silver"))
    box(g, (0, 1.92, 0), (2.4, 0.05, 0.05), "ct", A("silver"))
    g.build("fence")


def crane():
    """a tower crane, 60 m to the jib: lattice mast, the slewing unit and cab, a 50 m jib and the counter jib
    with its weights, the A-frame and ties (yellow: the game tints the lattice)"""
    g = Geo()
    lat, y, blk = B("lattice"), A("gold_flat"), A("iron")
    H, w = 60.0, 2.0
    for k in range(20):
        y0, y1 = k * 3.0, (k + 1) * 3.0
        for (ax, az, bx, bz) in ((-1, 1, 1, 1), (1, 1, 1, -1), (1, -1, -1, -1), (-1, -1, -1, 1)):
            p = [(ax * w / 2, y0, az * w / 2), (bx * w / 2, y0, bz * w / 2), (bx * w / 2, y1, bz * w / 2), (ax * w / 2, y1, az * w / 2)]
            quad(g, *p, "crane_alpha", lat)
            quad(g, p[1], p[0], p[3], p[2], "crane_alpha", lat)
    box(g, (0, H + 1.0, 0), (2.6, 2.0, 2.6), "ct", y)                      # slewing unit
    box(g, (1.6, H + 1.4, 1.2), (1.6, 2.0, 1.4), "ct", y)                  # the cab
    quad(g, (2.41, H + 1.0, 0.6), (2.41, H + 1.0, 1.8), (2.41, H + 2.1, 1.8), (2.41, H + 2.1, 0.6), "ct", A("glass_dark"))
    # the jib along +x and the counter jib along -x: triangular lattice booms
    for (x0, x1) in ((1.3, 50.0), (-1.3, -15.0)):
        n = int(abs(x1 - x0) / 3.0)
        for k in range(n):
            a, b = x0 + (x1 - x0) * k / n, x0 + (x1 - x0) * (k + 1) / n
            lo, hi = H + 2.0, H + 3.8
            for zz in (-0.9, 0.9):
                p = [(a, lo, zz), (b, lo, zz), (b, hi, 0), (a, hi, 0)]
                quad(g, *p, "crane_alpha", lat)
                quad(g, p[1], p[0], p[3], p[2], "crane_alpha", lat)
    box(g, (-13.0, H + 1.6, 0), (4.0, 2.4, 2.2), "ct", A("concrete"))     # counterweights
    for sz in (-0.6, 0.6):                                                  # the A-frame
        obox(g, (-1.0, H + 2.0, sz), (0.0, H + 9.0, 0), 0.25, 0.25, "ct", y)
        obox(g, (1.0, H + 2.0, sz), (0.0, H + 9.0, 0), 0.25, 0.25, "ct", y)
    obox(g, (0.0, H + 9.0, 0), (34.0, H + 3.9, 0), 0.08, 0.08, "ct", blk)  # ties
    obox(g, (0.0, H + 9.0, 0), (-14.0, H + 3.9, 0), 0.08, 0.08, "ct", blk)
    obox(g, (30.0, H + 2.0, 0), (30.0, H - 22.0, 0), 0.05, 0.05, "ct", blk)   # the hook line
    box(g, (30.0, H - 22.5, 0), (0.5, 0.8, 0.4), "ct", y)
    g.build("crane")


def cabin():
    """a site office: a 6 m container cabin with windows and a door"""
    g = Geo()
    box(g, (0, 1.35, 0), (6.0, 2.6, 2.4), "ct", A("orange"))
    for x in (-1.8, 0.4):
        quad(g, (x, 1.1, 1.21), (x + 1.2, 1.1, 1.21), (x + 1.2, 2.0, 1.21), (x, 2.0, 1.21), "ct", A("glass_dark"))
    quad(g, (2.0, 0.1, 1.21), (2.8, 0.1, 1.21), (2.8, 2.2, 1.21), (2.0, 2.2, 1.21), "ct", A("pole_grey"))
    g.build("cabin")


def district_kit():
    water_tower(); lamp(); car("car"); car("suv", True); jersey(); railing(); train_car(); hoarding(); fence(); crane(); cabin()
    names = ["water_tower", "lamp", "car", "suv", "jersey", "railing", "train_car", "hoarding", "fence", "crane", "cabin"]
    export(os.path.join(MODELS, "ct_district_kit.glb"), names)


def main():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    imgs = textures()
    gates()
    lantern_geo(10, 6).build("lantern_hi", smooth_all=False)
    lantern_geo(6, 4).build("lantern_lo")
    for k in range(4):
        neon_geo(k).build("neon_%d" % k)
    stall(); barricade(); sign_closed(); lion()
    kit = [n for n in TRIS]
    META["district"] = LAY["district"]
    export(os.path.join(MODELS, "chinatown.glb"), kit)
    district_kit()
    bridge_main(); bridge_arch()
    export(os.path.join(MODELS, "chinatown_bridge.glb"), ["bridge_main"])
    export(os.path.join(MODELS, "chinatown_arch.glb"), ["bridge_arch"])
    META["bridge"] = {"arch": BL["arch"], "axis": BL["axis"], "towers": [T_TOW_M, T_TOW_B], "anchorages": [T_ANCH_M, T_ANCH_B], "ramp": [T_RAMP0, T_END_B],
                      "deck": [DECK_ANCH, DECK_TOW, DECK_MID], "height": TOWER_H, "deckHalf": DECK_HALF, "truss": 7.3}
    META["tris"] = TRIS
    with open(os.path.join(MODELS, "chinatown.json"), "w") as f:
        json.dump(META, f, indent=1)
    for k, v in TRIS.items():
        print("TRIS %-14s %7d" % (k, v))
    if "--no-previews" not in FLAGS:
        previews(imgs)


main()
