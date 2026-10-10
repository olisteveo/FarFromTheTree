"""Far From the Tree - New York street furniture, built procedurally in headless Blender.

Run by build_street.py:
  blender -b -t 8 --factory-startup --python street_blender.py -- MODELS TEXOUT TESSERACT_DIR

Writes
  MODELS/street_props.glb   one node per prop (names below), materials by name only (no images):
                              street  opaque, samples textures/street/atlas.jpg
                              wire    alpha-tested mesh, samples textures/street/wire.png
                              glass   see-through glazing (atlas "glass" cell)
                              lamp    a lit lamp refractor (atlas "lamp" cell, drawn bright)
                              screen  lit ads and kiosk screens (atlas cells, drawn bright)
  TEXOUT/atlas.jpg, names.jpg, wire.png   from the Tesseract renders (tesseract/Atlas, tesseract/Names)

Frames: Blender Z up; the glTF export turns -Y into three.js +Z, which is every prop's "front"
(toward the road for kerb things, the open side of a shelter, the face of a sign). 1 unit = 1 m,
origin on the ground at the prop's foot.
"""
import bpy, bmesh, math, os, sys
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
MODELS, TEXOUT, TS = argv[:3]
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import street_design as SD   # noqa: E402  (the atlas rects)

R = SD.R
TRIS = {}


# ------------------------------------------------------------------------------ geometry builder

class Geo:
    def __init__(self):
        self.v, self.f, self.uv, self.mat = [], [], [], []
        self.M = Matrix.Identity(4)
        self.mats = []
        self.flat = False
        self.fl = []

    def m(self, name):
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)

    def vert(self, p):
        self.v.append(tuple(self.M @ Vector(p)))
        return len(self.v) - 1

    def face(self, idx, uvs, mat):
        self.f.append(tuple(idx))
        self.uv.append([tuple(u) for u in uvs])
        self.mat.append(self.m(mat))
        self.fl.append(self.flat)

    def quad(self, a, b, c, d, uvs, mat, flip=False):
        ids = [self.vert(a), self.vert(b), self.vert(c), self.vert(d)]
        if flip:
            ids.reverse(); uvs = list(reversed(uvs))
        self.face(ids, uvs, mat)

    def tri(self, a, b, c, uvs, mat):
        self.face([self.vert(a), self.vert(b), self.vert(c)], uvs, mat)

    def build(self, name, smooth=True):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        uvl = me.uv_layers.new(name="UVMap")
        for name_ in self.mats:
            me.materials.append(material(name_))
        for poly in me.polygons:
            poly.material_index = self.mat[poly.index]
            poly.use_smooth = smooth and not self.fl[poly.index]
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


MATCOL = {"net": (0.8, 0.8, 0.8), "street": (0.5, 0.5, 0.5), "wire": (0.1, 0.3, 0.2), "glass": (0.6, 0.7, 0.75), "lamp": (1, 0.85, 0.6), "screen": (1, 1, 1)}


def material(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*MATCOL.get(name, (0.5, 0.5, 0.5)), 1)
    return m


# ------------------------------------------------------------------------------ UVs

def cell(name, u, v, inset=0.02):
    """u, v in 0..1 inside an atlas rect (v up) -> UV"""
    x, y, w, h = R[name]
    u = inset + (1 - 2 * inset) * min(1, max(0, u))
    v = inset + (1 - 2 * inset) * min(1, max(0, v))
    return ((x + u * w) / SD.AW, 1.0 - (y + (1 - v) * h) / SD.AH)


def C(name):
    return lambda u, v: cell(name, u, v)


def tile(name, sx=1.0, sy=1.0):
    """box uv function: metres -> the cell, repeating every sx by sy metres (clamped, no wrap)"""
    return lambda f, u, v: cell(name, (u / sx) % 1.0001, (v / sy) % 1.0001)


def fit(name):
    """box uv function stretching the cell over each face"""
    return lambda f, u, v: cell(name, u, v)


# ------------------------------------------------------------------------------ primitives

def lathe(g, prof, segs, mat, uvf, a0=0.0):
    """Revolve [(r, z), ...] about Z. uvf(u round, v along profile 0..1)."""
    L = [0.0]
    for i in range(1, len(prof)):
        L.append(L[-1] + math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]))
    tot = L[-1] or 1
    rings = []
    for (r, z) in prof:
        rings.append([(math.cos(a0 + j / segs * math.tau) * r, math.sin(a0 + j / segs * math.tau) * r, z) for j in range(segs + 1)])
    for i in range(len(prof) - 1):
        for j in range(segs):
            if prof[i][0] < 1e-5 and prof[i + 1][0] < 1e-5:
                continue
            g.quad(rings[i][j], rings[i][j + 1], rings[i + 1][j + 1], rings[i + 1][j],
                   [uvf(j / segs, L[i] / tot), uvf((j + 1) / segs, L[i] / tot), uvf((j + 1) / segs, L[i + 1] / tot), uvf(j / segs, L[i + 1] / tot)], mat)


def box(g, c, s, mat, uvf, faces="all"):
    """axis-aligned box: centre c, size s. uvf(face, u, v) with u, v in 0..1 over each face"""
    was, g.flat = g.flat, True
    x, y, z = c
    hx, hy, hz = s[0] / 2, s[1] / 2, s[2] / 2
    P = lambda i, j, k: (x + i * hx, y + j * hy, z + k * hz)
    F = {
        "+z": [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)],
        "-z": [P(-1, 1, -1), P(1, 1, -1), P(1, -1, -1), P(-1, -1, -1)],
        "-y": [P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1)],
        "+y": [P(1, 1, -1), P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1)],
        "+x": [P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1)],
        "-x": [P(-1, 1, -1), P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1)],
    }
    for k, pts in F.items():
        if faces != "all" and k not in faces:
            continue
        g.quad(*pts, [uvf(k, 0, 0), uvf(k, 1, 0), uvf(k, 1, 1), uvf(k, 0, 1)], mat)
    g.flat = was


def tube(g, pts, radii, sides, mat, uvf, caps=False):
    """a tube along a polyline of Vectors. uvf(round 0..1, along 0..1)"""
    pts = [Vector(p) for p in pts]
    t0 = (pts[1] - pts[0]).normalized()
    a = Vector((0, 0, 1)) if abs(t0.z) < 0.9 else Vector((1, 0, 0))
    s = t0.cross(a).normalized()
    rings, dist = [], [0.0]
    for i in range(1, len(pts)):
        dist.append(dist[-1] + (pts[i] - pts[i - 1]).length)
    tot = dist[-1] or 1
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        s = (s - t * s.dot(t)).normalized()
        b = t.cross(s)
        rings.append([tuple(p + (s * math.cos(j / sides * math.tau) + b * math.sin(j / sides * math.tau)) * radii[i]) for j in range(sides + 1)])
    for i in range(len(pts) - 1):
        for j in range(sides):
            g.quad(rings[i][j], rings[i][j + 1], rings[i + 1][j + 1], rings[i + 1][j],
                   [uvf(j / sides, dist[i] / tot), uvf((j + 1) / sides, dist[i] / tot), uvf((j + 1) / sides, dist[i + 1] / tot), uvf(j / sides, dist[i + 1] / tot)], mat)
    if caps:
        for i, rev in ((0, True), (len(pts) - 1, False)):
            c = tuple(pts[i])
            for j in range(sides):
                a_, b_ = rings[i][j], rings[i][j + 1]
                if rev:
                    a_, b_ = b_, a_
                g.tri(c, a_, b_, [uvf(0.5, 0.5)] * 3, mat)


def panel(g, a, b, c, d, name, mat="street", both=False):
    """a quad a-b-c-d (counter-clockwise seen from the front) mapped onto a whole cell; both = a back face too"""
    g.quad(a, b, c, d, [cell(name, 0, 0, 0.005), cell(name, 1, 0, 0.005), cell(name, 1, 1, 0.005), cell(name, 0, 1, 0.005)], mat)
    if both:
        g.quad(b, a, d, c, [cell(name, 0, 0, 0.005), cell(name, 1, 0, 0.005), cell(name, 1, 1, 0.005), cell(name, 0, 1, 0.005)], mat)


def arc(c, r, a0, a1, n, plane="yz"):
    out = []
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n
        if plane == "yz":
            out.append(Vector((c[0], c[1] + math.cos(a) * r, c[2] + math.sin(a) * r)))
    return out


# ================================================================================ lights

def light_cobra(lod):
    """NYC octagonal davit pole with a cobra-head luminaire reaching over the road (-Y)."""
    g = Geo()
    segs = 8 if lod == 0 else 6
    lathe(g, [(0.30, 0), (0.30, 0.42), (0.24, 0.48), (0.15, 0.52), (0.13, 0.62)], segs, "street", C("galv"), a0=math.pi / 8)
    # the shaft and the davit curve, tapering
    pts = [Vector((0, 0, 0.6)), Vector((0, 0, 7.4))]
    for i in range(1, 9 if lod == 0 else 5):
        a = (i / (8 if lod == 0 else 4)) * (math.pi / 2)
        pts.append(Vector((0, -1.2 * (1 - math.cos(a)), 7.4 + 1.2 * math.sin(a))))
    pts.append(Vector((0, -2.0, 8.6)))
    radii = [0.13] + [0.13 - 0.06 * (i / (len(pts) - 1)) for i in range(1, len(pts))]
    tube(g, pts, radii, segs, "street", C("galv"))
    # the head: a long rounded shell, lens on its underside
    hx, hy, hz = 0.0, -2.35, 8.55
    if lod == 0:
        prof = [(0.0, -0.05), (0.09, -0.03), (0.16, 0.08), (0.19, 0.25), (0.18, 0.45), (0.13, 0.62), (0.0, 0.72)]
        h = Geo()
        lathe(h, prof, 12, "street", C("cobra"))
        for i, p in enumerate(h.v):   # squash: wider than tall, flat underneath
            x, y, z = p
            h.v[i] = (x * 1.05, y * 0.62, z)
        h.M = Matrix.Identity(4)
        M = Matrix.Translation((hx, hy + 0.36, hz)) @ Matrix.Rotation(math.pi / 2, 4, "X")
        for i, f in enumerate(h.f):
            ids = []
            for k in f:
                v = M @ Vector(h.v[k])
                if v.z < hz - 0.05:
                    v.z = hz - 0.05 + (v.z - (hz - 0.05)) * 0.3
                ids.append(g.vert(tuple(v)))
            g.face(ids, h.uv[i], "street")
        # refractor lens underneath
        L = Geo()
        lathe(L, [(0.0, 0), (0.12, 0.0), (0.15, -0.04), (0.0, -0.05)], 10, "lamp", C("lamp"))
        Ml = Matrix.Translation((hx, hy - 0.02, hz - 0.06)) @ Matrix.Diagonal((1.0, 2.3, 1.0, 1.0))
        for i, f in enumerate(L.f):
            g.face([g.vert(tuple(Ml @ Vector(L.v[k]))) for k in f], L.uv[i], "lamp")
    else:
        box(g, (hx, hy, hz + 0.05), (0.36, 0.8, 0.18), "street", fit("cobra"))
        box(g, (hx, hy, hz - 0.06), (0.26, 0.6, 0.04), "lamp", fit("lamp"), faces=["-z"])
    g.build("light_cobra_lod%d" % lod)


def light_crook(lod):
    """Bishop's crook: a fluted cast-iron post, a scroll crook and a hanging lantern (cast iron, painted dark green)."""
    g = Geo()
    segs = 12 if lod == 0 else 6
    base = [(0.30, 0), (0.30, 0.1), (0.26, 0.14), (0.24, 0.5), (0.20, 0.56), (0.22, 0.62), (0.16, 0.72), (0.14, 1.3), (0.17, 1.36), (0.17, 1.42),
            (0.11, 1.5), (0.10, 1.6)]
    lathe(g, base, segs, "street", C("iron"))
    tube(g, [(0, 0, 1.6), (0, 0, 6.2)], [0.095, 0.07], 8 if lod == 0 else 6, "street", C("iron"))
    if lod == 0:
        lathe(g, [(0.07, 6.2), (0.12, 6.24), (0.12, 6.32), (0.07, 6.36)], 10, "street", C("iron"))   # collar
    # the crook: up, over in a half circle, down to the lantern
    pts = [Vector((0, 0, 6.3)), Vector((0, 0, 7.1))]
    n = 8 if lod == 0 else 4
    for i in range(1, n + 1):
        a = math.pi * i / n
        pts.append(Vector((0, -0.52 + 0.52 * math.cos(a), 7.1 + 0.52 * math.sin(a))))
    pts.append(Vector((0, -1.04, 6.95)))
    tube(g, pts, [0.06] * len(pts), 6, "street", C("iron"))
    if lod == 0:   # the scroll under the crook
        sc = [Vector((0, -0.05 - 0.38 * (k / 10) - 0.06 * math.sin(k / 10 * math.tau), 6.95 + 0.18 * math.sin(k / 10 * math.pi))) for k in range(11)]
        tube(g, sc, [0.02] * len(sc), 4, "street", C("iron"))
    # the lantern: a cap, the glowing glass, a finial
    cx, cy = 0, -1.04
    cap = Geo()
    lathe(cap, [(0.0, 6.95), (0.06, 6.94), (0.26, 6.78), (0.27, 6.74), (0.17, 6.72)], segs, "street", C("iron"))
    lathe(cap, [(0.17, 6.30), (0.11, 6.26), (0.04, 6.18), (0.0, 6.12)], segs, "street", C("iron"))
    for i, f in enumerate(cap.f):
        g.face([g.vert((cap.v[k][0] + cx, cap.v[k][1] + cy, cap.v[k][2])) for k in f], cap.uv[i], "street")
    glass = Geo()
    lathe(glass, [(0.17, 6.72), (0.2, 6.6), (0.2, 6.42), (0.17, 6.30)], segs, "lamp", C("lamp"))
    for i, f in enumerate(glass.f):
        g.face([g.vert((glass.v[k][0] + cx, glass.v[k][1] + cy, glass.v[k][2])) for k in f], glass.uv[i], "lamp")
    g.build("light_crook_lod%d" % lod)


# ================================================================================ signals

def signal_pole():
    g = Geo()
    lathe(g, [(0.26, 0), (0.26, 0.38), (0.2, 0.44), (0.14, 0.5)], 8, "street", C("galv"), a0=math.pi / 8)
    tube(g, [(0, 0, 0.5), (0, 0, 6.9)], [0.13, 0.1], 10, "street", C("galv"))
    lathe(g, [(0.1, 6.9), (0.12, 6.92), (0.08, 7.0), (0.0, 7.02)], 10, "street", C("galv"))
    # the clamp bracket for the street name blades
    box(g, (0, 0, 6.75), (0.08, 0.08, 0.5), "street", fit("galv"))
    # a push-button box for the crossing
    box(g, (0, -0.15, 1.1), (0.12, 0.08, 0.18), "street", fit("sigbody"))
    g.build("signal_pole")


def mast_arm():
    """unit length along -Y (scaled by the runtime to the arm's length)"""
    g = Geo()
    tube(g, [(0, 0, 0), (0, -1.0, 0)], [0.09, 0.07], 8, "street", C("galv"), caps=True)
    g.build("mast_arm")


def signal_head():
    """three-section vehicle signal facing -Y, centred on the origin, hanging from a bracket"""
    g = Geo()
    box(g, (0, 0.0, 0), (0.36, 0.28, 1.04), "street", fit("sigbody"))
    box(g, (0, 0.17, 0), (0.62, 0.03, 1.24), "street", fit("sigbody"))    # backplate
    for k in (1, 0, -1):
        z = k * 0.33
        # a visor: a half-tube hood over each lens
        pts = [Vector((0, -0.14, z + 0.0)), Vector((0, -0.4, z - 0.02))]
        ring = []
        for j in range(7):
            a = math.pi * j / 6
            ring.append((math.cos(a) * 0.15, math.sin(a) * 0.15))
        for j in range(6):
            (x0, z0), (x1, z1) = ring[j], ring[j + 1]
            a = (x0, -0.14, z + z0); b = (x1, -0.14, z + z1); c = (x1, -0.40, z + z1 - 0.02); d = (x0, -0.40, z + z0 - 0.02)
            uv = [cell("sigbody", 0, 0), cell("sigbody", 1, 0), cell("sigbody", 1, 1), cell("sigbody", 0, 1)]
            g.quad(a, b, c, d, uv, "street")
            g.quad(b, a, d, c, uv, "street")
    box(g, (0, 0.0, 0.62), (0.08, 0.08, 0.2), "street", fit("galv"))     # hanger
    g.build("signal_head")


def ped_head():
    g = Geo()
    box(g, (0, 0.0, 0), (0.42, 0.24, 0.42), "street", fit("sigbody"))
    for (x, z, sx, sz) in ((0, 0.22, 0.46, 0.04), (0, -0.22, 0.46, 0.04), (0.22, 0, 0.04, 0.46), (-0.22, 0, 0.04, 0.46)):
        box(g, (x, -0.16, z), (sx, 0.1, sz), "street", fit("sigbody"))    # the frame round the face
    box(g, (0, 0.17, 0), (0.1, 0.1, 0.3), "street", fit("galv"))           # clamp to the pole
    g.build("ped_head")


# ================================================================================ kerb furniture

def hydrant():
    """a New York fire hydrant: silver barrel, red caps"""
    g = Geo()
    lathe(g, [(0.0, 0.0), (0.21, 0.0), (0.21, 0.05), (0.16, 0.07), (0.13, 0.1), (0.125, 0.52), (0.165, 0.54), (0.165, 0.6), (0.14, 0.62),
              (0.13, 0.7), (0.09, 0.77), (0.04, 0.8)], 14, "street", C("hydrant"))
    lathe(g, [(0.04, 0.8), (0.045, 0.86), (0.0, 0.87)], 5, "street", C("hydrant"))   # operating nut
    for sx in (-1, 1):   # side hose nozzles with red caps
        g.M = Matrix.Translation((sx * 0.12, 0, 0.45)) @ Matrix.Rotation(sx * math.pi / 2, 4, "Y")
        lathe(g, [(0.055, 0.0), (0.055, 0.07), (0.065, 0.07), (0.065, 0.12), (0.0, 0.125)], 10, "street", lambda u, v: cell("red", u, v))
    g.M = Matrix.Translation((0, -0.12, 0.38)) @ Matrix.Rotation(math.pi / 2, 4, "X")   # the big pumper nozzle facing the road
    lathe(g, [(0.08, 0.0), (0.08, 0.06), (0.09, 0.06), (0.09, 0.13), (0.0, 0.135)], 12, "street", lambda u, v: cell("red", u, v))
    g.M = Matrix.Identity(4)
    g.build("hydrant")


def standpipe():
    """a Siamese standpipe connection on a facade (wall behind at +Y 0.18)"""
    g = Geo()
    box(g, (0, 0.16, 0.65), (0.5, 0.04, 0.34), "street", fit("red"))
    g.M = Matrix.Translation((0, 0.14, 0.62)) @ Matrix.Rotation(-math.pi / 2, 4, "X")
    lathe(g, [(0.07, 0), (0.07, 0.16), (0.1, 0.2), (0.0, 0.22)], 10, "street", C("red"))
    for sx in (-1, 1):
        g.M = Matrix.Translation((sx * 0.13, -0.02, 0.6)) @ Matrix.Rotation(-math.pi / 2 + 0.35, 4, "X") @ Matrix.Rotation(sx * 0.4, 4, "Y")
        lathe(g, [(0.05, 0), (0.05, 0.12), (0.065, 0.12), (0.065, 0.18), (0.0, 0.185)], 10, "street", C("hydrant"))
    g.M = Matrix.Identity(4)
    g.build("standpipe")


def mailbox():
    g = Geo()
    box(g, (0, 0, 0.7), (0.53, 0.48, 1.0), "street", lambda f, u, v: cell("mail_front" if f == "-y" else "mail_side", u, v))
    # the rounded top: a half cylinder along Y
    n = 8
    for j in range(n):
        a0, a1 = math.pi * j / n, math.pi * (j + 1) / n
        x0, z0, x1, z1 = math.cos(a0) * 0.265, 1.2 + math.sin(a0) * 0.12, math.cos(a1) * 0.265, 1.2 + math.sin(a1) * 0.12
        g.quad((x1, -0.24, z1), (x0, -0.24, z0), (x0, 0.24, z0), (x1, 0.24, z1),
               [cell("mail_side", j / n, 0.9), cell("mail_side", (j + 1) / n, 0.9), cell("mail_side", (j + 1) / n, 1), cell("mail_side", j / n, 1)], "street")
    for yy in (-0.24, 0.24):   # end caps of the dome
        pts = [(math.cos(math.pi * j / n) * 0.265, yy, 1.2 + math.sin(math.pi * j / n) * 0.12) for j in range(n + 1)]
        for j in range(n):
            a, b = pts[j], pts[j + 1]
            if yy < 0:
                g.tri((0, yy, 1.2), b, a, [cell("mail_front", 0.5, 0.98)] * 3, "street")
            else:
                g.tri((0, yy, 1.2), a, b, [cell("mail_side", 0.5, 0.98)] * 3, "street")
    box(g, (0, -0.26, 1.05), (0.4, 0.05, 0.18), "street", fit("mail_side"))     # the chute handle
    for x in (-0.22, 0.22):
        for y in (-0.19, 0.19):
            box(g, (x, y, 0.1), (0.06, 0.06, 0.2), "street", fit("mail_side"))
    g.build("mailbox")


def basket():
    g = Geo()
    prof = [(0.24, 0.02), (0.26, 0.1), (0.3, 0.9)]
    lathe(g, prof, 14, "wire", C("wire"))
    inner = Geo()
    lathe(inner, list(reversed([(r - 0.01, z) for r, z in prof])), 14, "wire", lambda u, v: cell("wire", u, 1 - v))
    for i, f in enumerate(inner.f):
        g.face([g.vert(inner.v[k]) for k in f], inner.uv[i], "wire")
    lathe(g, [(0.28, 0.9), (0.31, 0.93), (0.33, 0.91), (0.31, 0.88)], 14, "street", C("iron"))   # rim
    lathe(g, [(0.0, 0.03), (0.24, 0.03)], 10, "street", C("iron"))
    lathe(g, [(0.0, 0.07), (0.21, 0.08), (0.25, 0.6), (0.28, 0.86), (0.31, 0.82), (0.2, 0.84), (0.0, 0.86)], 12, "street", C("bag"))
    g.build("basket")


def newsstand():
    """a corner newsstand: green steel kiosk, the open front (-Y) full of papers and candy"""
    g = Geo()
    W, D, H = 3.3, 1.6, 2.5
    box(g, (0, 0, H / 2), (W, D, H), "street", lambda f, u, v: cell("news_side" if f in ("+x", "-x", "+y") else "news_roof", u, v), faces=["+x", "-x", "+y", "-z"])
    # front: counter, the display, the sign band
    box(g, (0, -D / 2 - 0.15, 0.95), (W, 0.3, 0.06), "street", fit("steel"))
    box(g, (0, 0, 0.45), (W, D, 0.9), "street", fit("news_side"), faces=["-y"])
    panel(g, (-W / 2, -D / 2, 0.9), (W / 2, -D / 2, 0.9), (W / 2, -D / 2, 2.15), (-W / 2, -D / 2, 2.15), "news_front")
    panel(g, (-W / 2, -D / 2 - 0.02, 2.15), (W / 2, -D / 2 - 0.02, 2.15), (W / 2, -D / 2 - 0.02, H), (-W / 2, -D / 2 - 0.02, H), "news_sign")
    box(g, (0, -0.1, H + 0.08), (W + 0.3, D + 0.6, 0.16), "street", fit("news_roof"))
    # magazines clipped on the side walls
    panel(g, (W / 2 + 0.01, -D / 2 + 0.1, 1.2), (W / 2 + 0.01, D / 2 - 0.1, 1.2), (W / 2 + 0.01, D / 2 - 0.1, 2.0), (W / 2 + 0.01, -D / 2 + 0.1, 2.0), "news_front")
    g.build("newsstand")


def food_cart():
    """a halal cart: stainless body, a lit menu on the front (-Y), a canopy, the grill steaming"""
    g = Geo()
    box(g, (0, 0, 0.85), (2.0, 0.95, 1.0), "street", fit("steel"))
    box(g, (0, 0, 1.38), (2.0, 0.95, 0.06), "street", fit("steel"))
    panel(g, (-0.95, -0.49, 0.42), (0.95, -0.49, 0.42), (0.95, -0.49, 1.3), (-0.95, -0.49, 1.3), "cart_sign", mat="screen")
    panel(g, (0.95, 0.49, 0.42), (-0.95, 0.49, 0.42), (-0.95, 0.49, 1.3), (0.95, 0.49, 1.3), "cart_sign", mat="screen")
    box(g, (0.55, 0, 1.55), (0.7, 0.7, 0.3), "street", fit("steel"))      # the grill hood
    box(g, (-0.5, 0, 1.5), (0.5, 0.5, 0.2), "street", fit("glass"))
    for x in (-0.95, 0.95):
        for y in (-0.42, 0.42):
            tube(g, [(x, y, 1.4), (x, y, 2.25)], [0.025, 0.025], 5, "street", C("steel"))
    # a peaked canopy
    for s in (-1, 1):
        g.quad((-1.15, 0, 2.45), (1.15, 0, 2.45), (1.15, s * 0.75, 2.22), (-1.15, s * 0.75, 2.22),
               [cell("umbrella", 0, 1), cell("umbrella", 1, 1), cell("umbrella", 1, 0), cell("umbrella", 0, 0)], "street", flip=(s > 0))
        g.quad((1.15, 0, 2.45), (-1.15, 0, 2.45), (-1.15, s * 0.75, 2.22), (1.15, s * 0.75, 2.22),
               [cell("umbrella", 0, 1), cell("umbrella", 1, 1), cell("umbrella", 1, 0), cell("umbrella", 0, 0)], "street", flip=(s > 0))
    for x in (-0.7, 0.7):   # wheels
        g.M = Matrix.Translation((x, -0.5, 0.3)) @ Matrix.Rotation(math.pi / 2, 4, "X")
        lathe(g, [(0, -0.03), (0.28, -0.03), (0.3, 0), (0.28, 0.03), (0, 0.03)], 12, "street", C("rubber"))
        g.M = Matrix.Translation((x, 0.5, 0.3)) @ Matrix.Rotation(math.pi / 2, 4, "X")
        lathe(g, [(0, -0.03), (0.28, -0.03), (0.3, 0), (0.28, 0.03), (0, 0.03)], 12, "street", C("rubber"))
    g.M = Matrix.Identity(4)
    g.build("food_cart")


def bike(name="bike"):
    """a share bike, its front (basket) toward -Y; wheels 0.66 m"""
    g = Geo()
    T = C("bike_brand")
    for y in (-0.55, 0.5):
        g.M = Matrix.Translation((0, y, 0.34)) @ Matrix.Rotation(math.pi / 2, 4, "Y")
        ring = [Vector((math.cos(a / 14 * math.tau) * 0.31, math.sin(a / 14 * math.tau) * 0.31, 0)) for a in range(15)]
        tube(g, ring, [0.03] * 15, 5, "street", C("rubber"))
        lathe(g, [(0.0, -0.02), (0.06, -0.02), (0.06, 0.02), (0.0, 0.02)], 8, "street", C("galv"))
    g.M = Matrix.Identity(4)
    # frame: step-through, fat tubes
    tube(g, [(0, 0.5, 0.34), (0, 0.1, 0.42), (0, -0.25, 0.42), (0, -0.42, 0.85)], [0.035] * 4, 6, "street", T)
    tube(g, [(0, 0.15, 0.4), (0, 0.18, 0.82)], [0.03, 0.03], 6, "street", T)          # seat tube
    tube(g, [(0, 0.5, 0.34), (0, 0.18, 0.78)], [0.02, 0.02], 5, "street", T)           # seat stays
    tube(g, [(0, -0.55, 0.34), (0, -0.42, 0.85), (0, -0.4, 1.0)], [0.025, 0.03, 0.03], 6, "street", T)   # fork and stem
    tube(g, [(-0.3, -0.36, 1.02), (0.3, -0.36, 1.02)], [0.018, 0.018], 5, "street", C("rubber"))      # bars
    box(g, (0, 0.2, 0.86), (0.14, 0.26, 0.06), "street", fit("rubber"))               # saddle
    box(g, (0, -0.62, 0.8), (0.42, 0.3, 0.26), "street", lambda f, u, v: cell("bike_brand", u, v))   # front basket panel
    for y in (-0.55, 0.5):   # fenders
        pts = [Vector((0, y + math.cos(a) * 0.36, 0.34 + math.sin(a) * 0.36)) for a in [math.pi * (0.15 + 0.7 * i / 6) for i in range(7)]]
        tube(g, pts, [0.03] * 7, 3, "street", T)
    g.build(name)


def bike_dock():
    """one dock: a base plate along X and a post the bike's front wheel locks into (at -Y)"""
    g = Geo()
    box(g, (0, -0.3, 0.03), (0.85, 1.6, 0.06), "street", fit("galv"))
    box(g, (0, -0.78, 0.45), (0.14, 0.2, 0.8), "street", lambda f, u, v: cell("dock" if f == "+y" else "galv", u, v))
    g.build("bike_dock")


def bike_kiosk():
    g = Geo()
    box(g, (0, 0, 1.05), (0.62, 0.3, 2.1), "street", lambda f, u, v: cell("bike_kiosk" if f == "-y" else "bike_brand" if f == "+y" else "steel", u, v))
    g.quad((-0.5, 0.35, 2.25), (0.5, 0.35, 2.25), (0.5, -0.35, 2.55), (-0.5, -0.35, 2.55),
           [cell("glass", 0, 0), cell("glass", 1, 0), cell("glass", 1, 1), cell("glass", 0, 1)], "street")   # solar panel
    tube(g, [(0, 0, 2.1), (0, 0, 2.4)], [0.04, 0.04], 6, "street", C("steel"))
    box(g, (0, 0, 0.03), (0.8, 0.5, 0.06), "street", fit("galv"))
    g.build("bike_kiosk")


def bike_rack():
    """the NYC hoop rack: an upside-down U, in the Y-Z plane"""
    g = Geo()
    pts = [Vector((0, -0.38, 0.0)), Vector((0, -0.38, 0.62))]
    for i in range(1, 8):
        a = math.pi * i / 8
        pts.append(Vector((0, -0.38 * math.cos(a) * 1.0, 0.62 + 0.3 * math.sin(a))))
    pts.append(Vector((0, 0.38, 0.62)))
    pts.append(Vector((0, 0.38, 0.0)))
    tube(g, pts, [0.03] * len(pts), 8, "street", C("galv"))
    g.build("bike_rack")


def bus_pole():
    g = Geo()
    tube(g, [(0, 0, 0), (0, 0, 3.1)], [0.045, 0.04], 8, "street", C("galv"))
    lathe(g, [(0.05, 3.1), (0.06, 3.12), (0.0, 3.15)], 8, "street", C("galv"))
    box(g, (0, -0.09, 1.55), (0.32, 0.12, 0.55), "street", lambda f, u, v: cell("bus_info" if f in ("-y", "+y") else "steel", u, v))
    g.build("bus_pole")


def bus_shelter():
    """open to -Y (the road), glazed back and one end, a lit ad panel at the other end, a bench"""
    g = Geo()
    L, D, H = 4.8, 1.45, 2.45
    # posts
    for x in (-L / 2, 0, L / 2):
        for y in (-D / 2, D / 2):
            if x == 0 and y < 0:
                continue
            box(g, (x, y, H / 2), (0.07, 0.07, H), "street", fit("steel"))
    # roof, sloping a little to the back
    g.quad((-L / 2 - 0.15, -D / 2 - 0.2, H + 0.12), (L / 2 + 0.15, -D / 2 - 0.2, H + 0.12), (L / 2 + 0.15, D / 2 + 0.1, H + 0.02), (-L / 2 - 0.15, D / 2 + 0.1, H + 0.02),
           [cell("steel", 0, 0), cell("steel", 1, 0), cell("steel", 1, 1), cell("steel", 0, 1)], "street")
    box(g, (0, -0.05, H), (L + 0.3, D + 0.3, 0.08), "street", fit("steel"), faces=["-z", "-y", "+y", "+x", "-x"])
    # glass: the back and the near end
    for (a, b) in (((-L / 2, D / 2), (L / 2, D / 2)), ((-L / 2, -D / 2 + 0.25), (-L / 2, D / 2))):
        g.quad((a[0], a[1], 0.25), (b[0], b[1], 0.25), (b[0], b[1], H - 0.1), (a[0], a[1], H - 0.1),
               [cell("glass", 0, 0), cell("glass", 1, 0), cell("glass", 1, 1), cell("glass", 0, 1)], "glass")
        g.quad((b[0], b[1], 0.25), (a[0], a[1], 0.25), (a[0], a[1], H - 0.1), (b[0], b[1], H - 0.1),
               [cell("glass", 0, 0), cell("glass", 1, 0), cell("glass", 1, 1), cell("glass", 0, 1)], "glass")
    # the ad panel at the far end: a lit box with posters both sides
    box(g, (L / 2, 0, 1.25), (0.22, D - 0.1, 2.1), "street", fit("steel"), faces=["+z", "-z", "-y", "+y"])
    panel(g, (L / 2 + 0.115, -D / 2 + 0.1, 0.25), (L / 2 + 0.115, D / 2 - 0.1, 0.25), (L / 2 + 0.115, D / 2 - 0.1, 2.25), (L / 2 + 0.115, -D / 2 + 0.1, 2.25), "ad_soup", mat="screen")
    panel(g, (L / 2 - 0.115, D / 2 - 0.1, 0.25), (L / 2 - 0.115, -D / 2 + 0.1, 0.25), (L / 2 - 0.115, -D / 2 + 0.1, 2.25), (L / 2 - 0.115, D / 2 - 0.1, 2.25), "ad_pigeon", mat="screen")
    # bench along the back
    box(g, (-0.4, D / 2 - 0.3, 0.46), (2.6, 0.38, 0.05), "street", fit("bench_seat"))
    for x in (-1.5, 0.7):
        box(g, (x, D / 2 - 0.3, 0.22), (0.05, 0.3, 0.44), "street", fit("steel"))
    # a route map in the back glass
    panel(g, (-1.9, D / 2 - 0.02, 0.9), (-1.2, D / 2 - 0.02, 0.9), (-1.2, D / 2 - 0.02, 1.8), (-1.9, D / 2 - 0.02, 1.8), "bus_info")
    g.build("bus_shelter")


def kiosk():
    """a slim city wi-fi kiosk, screens on both faces"""
    g = Geo()
    box(g, (0, 0, 1.45), (0.9, 0.28, 2.9), "street", fit("steel"))
    panel(g, (-0.36, -0.145, 1.0), (0.36, -0.145, 1.0), (0.36, -0.145, 2.65), (-0.36, -0.145, 2.65), "kiosk_screen", mat="screen")
    panel(g, (0.36, 0.145, 1.0), (-0.36, 0.145, 1.0), (-0.36, 0.145, 2.65), (0.36, 0.145, 2.65), "ad_leaf", mat="screen")
    box(g, (0.47, -0.05, 1.25), (0.05, 0.2, 0.3), "street", fit("sigbody"))   # the tablet
    g.build("kiosk")


def munimeter():
    g = Geo()
    box(g, (0, 0, 0.5), (0.12, 0.12, 1.0), "street", fit("sigbody"))
    box(g, (0, 0, 1.32), (0.36, 0.26, 0.64), "street", lambda f, u, v: cell("munimeter" if f == "-y" else "sigbody", u, v))
    g.quad((-0.2, 0.15, 1.66), (0.2, 0.15, 1.66), (0.2, -0.15, 1.74), (-0.2, -0.15, 1.74),
           [cell("glass", 0, 0), cell("glass", 1, 0), cell("glass", 1, 1), cell("glass", 0, 1)], "street")
    g.build("munimeter")


def sign_post():
    g = Geo()
    box(g, (0, 0, 1.4), (0.05, 0.05, 2.8), "street", fit("galv"))
    g.build("sign_post")


def planter(round_=False):
    g = Geo()
    if round_:
        lathe(g, [(0.0, 0.72), (0.6, 0.72), (0.66, 0.78), (0.7, 0.78), (0.66, 0.0), (0.0, 0.0)], 16, "street", lambda u, v: cell("concrete", u, 1 - v))
        lathe(g, [(0.0, 0.74), (0.6, 0.74)], 16, "street", C("soil"))
    else:
        box(g, (0, 0, 0.4), (1.25, 1.25, 0.8), "street", fit("concrete"), faces=["+x", "-x", "+y", "-y"])
        g.quad((-0.55, -0.55, 0.74), (0.55, -0.55, 0.74), (0.55, 0.55, 0.74), (-0.55, 0.55, 0.74),
               [cell("soil", 0, 0), cell("soil", 1, 0), cell("soil", 1, 1), cell("soil", 0, 1)], "street")
        for (a, b) in (((-0.625, -0.625), (0.625, -0.625)), ((0.625, -0.625), (0.625, 0.625)), ((0.625, 0.625), (-0.625, 0.625)), ((-0.625, 0.625), (-0.625, -0.625))):
            ia = (a[0] * 0.88, a[1] * 0.88); ib = (b[0] * 0.88, b[1] * 0.88)
            g.quad((a[0], a[1], 0.8), (b[0], b[1], 0.8), (ib[0], ib[1], 0.8), (ia[0], ia[1], 0.8),
                   [cell("concrete", 0, 0.9), cell("concrete", 1, 0.9), cell("concrete", 1, 1), cell("concrete", 0, 1)], "street")
            g.quad((ia[0], ia[1], 0.8), (ib[0], ib[1], 0.8), (ib[0], ib[1], 0.74), (ia[0], ia[1], 0.74),
                   [cell("concrete", 0, 0.9), cell("concrete", 1, 0.9), cell("concrete", 1, 1), cell("concrete", 0, 1)], "street")
    # bare winter twigs poking up
    for i in range(9):
        a = i * 2.4
        r = 0.15 + (i % 3) * 0.13
        x, y = math.cos(a) * r, math.sin(a) * r
        tube(g, [(x, y, 0.72), (x * 1.3 + 0.03, y * 1.3, 1.05 + (i % 4) * 0.1), (x * 1.5, y * 1.6 + 0.04, 1.25 + (i % 3) * 0.12)], [0.018, 0.012, 0.005], 3, "street", C("iron"))
    g.build("planter_round" if round_ else "planter")


def bollard():
    g = Geo()
    lathe(g, [(0.0, 0.0), (0.16, 0.0), (0.15, 0.85), (0.13, 0.92), (0.07, 0.96), (0.0, 0.97)], 12, "street", C("sigbody"))
    lathe(g, [(0.152, 0.72), (0.152, 0.78)], 12, "street", C("white"))   # reflective band
    g.build("bollard")


def jersey():
    g = Geo()
    prof = [(-0.305, 0.0), (-0.305, 0.075), (-0.2, 0.33), (-0.075, 0.81), (0.075, 0.81), (0.2, 0.33), (0.305, 0.075), (0.305, 0.0)]
    L = 3.05
    tot = sum(math.hypot(prof[i + 1][0] - prof[i][0], prof[i + 1][1] - prof[i][1]) for i in range(len(prof) - 1))
    acc = 0
    for i in range(len(prof) - 1):
        (y0, z0), (y1, z1) = prof[i], prof[i + 1]
        l = math.hypot(y1 - y0, z1 - z0)
        v0, v1 = acc / tot, (acc + l) / tot
        acc += l
        # v: 0 at the bottom of one side, 1 at the bottom of the other: fold so dirt is at the foot
        f0, f1 = 1 - abs(v0 - 0.5) * 2, 1 - abs(v1 - 0.5) * 2
        g.quad((-L / 2, y0, z0), (L / 2, y0, z0), (L / 2, y1, z1), (-L / 2, y1, z1),
               [cell("jersey", 0, f0), cell("jersey", 1, f0), cell("jersey", 1, f1), cell("jersey", 0, f1)], "street", flip=True)
    for x, sgn in ((-L / 2, -1), (L / 2, 1)):
        pts = [(x, y, z) for (y, z) in prof]
        for i in range(1, len(pts) - 1):
            a, b, c = pts[0], pts[i], pts[i + 1]
            if sgn > 0:
                g.tri(a, b, c, [cell("jersey", 0.1, 0.1)] * 3, "street")
            else:
                g.tri(a, c, b, [cell("jersey", 0.1, 0.1)] * 3, "street")
    g.build("jersey")


def shed_bay():
    """one 2.4 m bay of a sidewalk shed: building at Y=0, kerb at Y=-4 (scaled to the real depth)"""
    g = Geo()
    D, W = 4.0, 2.4
    box(g, (0, -D / 2, 3.15), (W, D, 0.2), "street", lambda f, u, v: cell("deck", u, v))
    # the parapet along the kerb: green plywood, both faces
    panel(g, (-W / 2, -D - 0.03, 3.25), (W / 2, -D - 0.03, 3.25), (W / 2, -D - 0.03, 4.35), (-W / 2, -D - 0.03, 4.35), "plywood")
    panel(g, (W / 2, -D + 0.03, 3.25), (-W / 2, -D + 0.03, 3.25), (-W / 2, -D + 0.03, 4.35), (W / 2, -D + 0.03, 4.35), "plywood")
    box(g, (0, -D, 4.37), (W, 0.1, 0.04), "street", fit("news_roof"))
    # posts at this bay's right end: kerb side and building side; a beam across under the deck
    for y in (-D + 0.1, -0.15):
        tube(g, [(W / 2, y, 0.0), (W / 2, y, 3.05)], [0.05, 0.05], 6, "street", C("iron"))
    box(g, (W / 2, -D / 2, 2.95), (0.12, D, 0.2), "street", fit("iron"))
    box(g, (0, -D + 0.1, 2.95), (W, 0.1, 0.18), "street", fit("iron"))
    box(g, (0, -D / 2, 3.03), (1.2, 0.1, 0.05), "lamp", fit("lamp"), faces=["-z"])   # a strip light under the deck
    g.build("shed_bay")


def shed_end():
    g = Geo()
    D = 4.0
    for y in (-D + 0.1, -0.15):
        tube(g, [(0, y, 0.0), (0, y, 3.05)], [0.05, 0.05], 6, "street", C("iron"))
    box(g, (0, -D / 2, 2.95), (0.12, D, 0.2), "street", fit("iron"))
    panel(g, (0, -0.05, 3.05), (0, -D, 3.05), (0, -D, 4.35), (0, -0.05, 4.35), "shed_end", both=True)
    g.build("shed_end")


def steam_stack():
    """the orange-and-white Con Ed chimney over a steam manhole"""
    g = Geo()
    lathe(g, [(0.0, 0.0), (0.62, 0.0), (0.62, 0.08), (0.5, 0.18), (0.4, 0.42)], 14, "street", C("stack"))
    lathe(g, [(0.4, 0.42), (0.38, 3.0), (0.42, 3.04), (0.42, 3.1), (0.36, 3.1), (0.34, 2.6)], 14, "street", C("stack"))
    g.build("steam_stack")


# ================================================================================ basketball

def hoop():
    """a park hoop: a steel gooseneck pole behind, a flat steel backboard, an orange rim and a chain net.
    The board faces -Y (three.js +Z: toward the court); the pole stands 1.2 m behind it."""
    g = Geo()
    tube(g, [(0, 1.25, 0.0), (0, 1.25, 2.9), (0, 1.0, 3.35), (0, 0.12, 3.45)], [0.07, 0.07, 0.065, 0.06], 8, "street", C("galv"))
    box(g, (0, 0.06, 3.45), (1.8, 0.04, 1.05), "street", lambda f, u, v: cell("white" if f == "-y" else "galv", u, v))
    box(g, (0, 0.035, 3.3), (0.6, 0.012, 0.45), "street", fit("sigbody"), faces=["-y"])        # the shooter's square
    box(g, (0, 0.0, 2.95), (0.2, 0.12, 0.08), "street", fit("red"))                         # rim bracket
    g.M = Matrix.Translation((0, -0.29, 3.05))
    ring = [Vector((math.cos(a / 16 * math.tau) * 0.23, math.sin(a / 16 * math.tau) * 0.23, 0)) for a in range(17)]
    tube(g, ring, [0.012] * 17, 4, "street", C("red"))
    g.M = Matrix.Identity(4)
    net = Geo()
    lathe(net, [(0.23, 3.05), (0.19, 2.8), (0.15, 2.62)], 12, "wire", lambda u, v: cell("white", u, v))
    for i, f in enumerate(net.f):   # double sided, mapped onto the net texture (u round, v down)
        vs = [(net.v[k][0], net.v[k][1] - 0.29, net.v[k][2]) for k in f]
        uv = [((net.v[k][0] + 0.25) * 2, (net.v[k][2] - 2.6) * 2.2) for k in f]
        ids = [g.vert(p) for p in vs]
        g.face(ids, uv, "net")
        g.face(list(reversed([g.vert(p) for p in vs])), list(reversed(uv)), "net")
    g.build("hoop")


def fence_post():
    """a galvanised fence post, 4 m (scaled to the fence height), with a cap"""
    g = Geo()
    tube(g, [(0, 0, 0), (0, 0, 4.0)], [0.045, 0.045], 6, "street", C("galv"))
    lathe(g, [(0.05, 4.0), (0.06, 4.02), (0.0, 4.06)], 6, "street", C("galv"))
    g.build("fence_post")


# ================================================================================ export

def export(path, names):
    bpy.ops.object.select_all(action="DESELECT")
    for n in names:
        bpy.data.objects[n].select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_materials="EXPORT", export_image_format="NONE", export_normals=True,
                              export_texcoords=True, export_yup=True, export_animations=False, export_vertex_color="NONE")


def textures():
    os.makedirs(TEXOUT, exist_ok=True)
    sc = bpy.context.scene
    sc.render.image_settings.file_format = "JPEG"
    sc.render.image_settings.color_mode = "RGB"
    sc.render.image_settings.quality = 84
    atlas = bpy.data.images.load(os.path.join(TS, "Atlas", "Atlas.png"))
    atlas.save_render(os.path.join(TEXOUT, "atlas.jpg"), scene=sc)
    names = bpy.data.images.load(os.path.join(TS, "Names", "Names.png"))
    names.save_render(os.path.join(TEXOUT, "names.jpg"), scene=sc)
    # the wire basket mesh needs its alpha: cut its cell out as a small PNG
    x, y, w, h = R["wire"]
    W, H = atlas.size
    px = list(atlas.pixels)
    out = bpy.data.images.new("wire", w, h, alpha=True)
    o = [0.0] * (w * h * 4)
    for j in range(h):
        src_row = (H - 1 - (y + (h - 1 - j)))   # blender pixel rows run bottom-up
        for i in range(w):
            si = (src_row * W + x + i) * 4
            di = (j * w + i) * 4
            o[di:di + 4] = px[si:si + 4]
    out.pixels = o
    out.filepath_raw = os.path.join(TEXOUT, "wire.png")
    out.file_format = "PNG"
    out.save()
    court = bpy.data.images.load(os.path.join(TS, "Court", "Court.png"))
    court.save_render(os.path.join(TEXOUT, "court.jpg"), scene=sc)
    # chain-link (left half) and the hoop net (right half) as two small alpha PNGs
    fence = bpy.data.images.load(os.path.join(TS, "Fence", "Fence.png"))
    FW, FH = fence.size
    fp = list(fence.pixels)
    for name, x0 in (("chainlink", 0), ("net", FW // 2)):
        w = FW // 2
        im = bpy.data.images.new(name, w, FH, alpha=True)
        o = [0.0] * (w * FH * 4)
        for j in range(FH):
            for i in range(w):
                si = (j * FW + x0 + i) * 4
                di = (j * w + i) * 4
                o[di:di + 4] = fp[si:si + 4]
        im.pixels = o
        im.filepath_raw = os.path.join(TEXOUT, name + ".png")
        im.file_format = "PNG"
        im.save()


def main():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    textures()
    light_cobra(0); light_cobra(1); light_crook(0); light_crook(1)
    signal_pole(); mast_arm(); signal_head(); ped_head()
    hydrant(); standpipe(); mailbox(); basket(); newsstand(); food_cart()
    bike(); bike_dock(); bike_kiosk(); bike_rack(); bus_pole(); bus_shelter(); kiosk(); munimeter(); sign_post()
    planter(False); planter(True); bollard(); jersey(); shed_bay(); shed_end(); steam_stack(); hoop(); fence_post()
    export(os.path.join(MODELS, "street_props.glb"), list(TRIS))
    for k, v in TRIS.items():
        print("TRIS %-18s %6d" % (k, v))


main()
