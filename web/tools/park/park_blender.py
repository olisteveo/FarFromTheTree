"""Far From the Tree - Central Park models, built procedurally in headless Blender.

Run by build_park.py:
  blender -b -t 8 --factory-startup --python park_blender.py -- MODELS TEXOUT TESSERACT_DIR PREVIEWS

Writes
  MODELS/park_trees.glb   tree_{elm,oak,plane}_lod{0,1,2}: bare winter trees, one material "bark"
                          (UVs into textures/park/trees.png: bark strips repeat in v, twig cards in
                          the right-hand column). Origin at the base of the trunk, +Y up, 1 unit = 1 m.
  MODELS/park_props.glb   lamp_post, lamp_globe, bench, basket_wire, basket_bag, cart, cart_umbrella,
                          person_stand, person_sit, duck, rock_{big,ridge,mid,small,boulder},
                          bridge, maine
  TEXOUT/*.jpg|png        the Tesseract renders: trees.png + props.png (alpha), schist/wall/rubble/ice.jpg
Materials are exported by name only (no images): the game binds the textures itself.
Mesh "front" is +Z in three.js (-Y here); long axes along X.
"""
import bpy, bmesh, math, os, random, shutil, sys
from mathutils import Matrix, Vector, noise

argv = sys.argv[sys.argv.index("--") + 1:]
MODELS, TEXOUT, TS, PREV = argv[:4]
TRIS = {}

# ------------------------------------------------------------------------------ geometry builder

class Geo:
    """Accumulates polygons with per-corner UVs and colours, then makes one Blender mesh."""

    def __init__(self):
        self.v, self.f, self.uv, self.mat, self.col = [], [], [], [], []
        self.M = Matrix.Identity(4)
        self.mats = []
        self.cur_col = (1, 1, 1, 1)
        self.flat = False      # faces added while set are flat-shaded (boxes)
        self.fl = []

    def m(self, name):
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)

    def vert(self, p):
        self.v.append(tuple(self.M @ Vector(p)))
        return len(self.v) - 1

    def face(self, idx, uvs, mat, cols=None):
        self.f.append(tuple(idx))
        self.uv.append([tuple(u) for u in uvs])
        self.mat.append(self.m(mat))
        self.col.append(cols or [self.cur_col] * len(idx))
        self.fl.append(self.flat)

    def quad(self, a, b, c, d, uvs, mat, flip=False):
        ids = [self.vert(a), self.vert(b), self.vert(c), self.vert(d)]
        if flip:
            ids.reverse(); uvs = list(reversed(uvs))
        self.face(ids, uvs, mat)

    def build(self, name, smooth=True):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        uvl = me.uv_layers.new(name="UVMap")
        use_col = any(c != (1, 1, 1, 1) for cs in self.col for c in cs)
        ca = me.color_attributes.new("Color", "FLOAT_COLOR", "CORNER") if use_col else None
        for name_ in self.mats:
            me.materials.append(material(name_))
        for poly in me.polygons:
            poly.material_index = self.mat[poly.index]
            poly.use_smooth = smooth and not self.fl[poly.index]
            for k, li in enumerate(poly.loop_indices):
                uvl.data[li].uv = self.uv[poly.index][k]
                if ca:
                    ca.data[li].color = self.col[poly.index][k]
        bm = bmesh.new()   # weld coincident vertices so smooth shading is smooth (UV seams are kept per corner)
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
        bm.to_mesh(me)
        bm.free()
        for at in [a for a in me.color_attributes if a.name != "Color"]:
            me.color_attributes.remove(at)
        if "Color" in me.color_attributes:
            me.color_attributes.active_color = me.color_attributes["Color"]
            me.color_attributes.render_color_index = 0
        me.validate(clean_customdata=False)
        me.update()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        TRIS[name] = sum(len(p.vertices) - 2 for p in me.polygons)
        return ob


MATCOL = {"bark": (0.35, 0.3, 0.26), "props": (0.5, 0.5, 0.5), "wire": (0.1, 0.1, 0.1), "globe": (1, 0.9, 0.6),
          "schist": (0.42, 0.42, 0.4), "rubble": (0.4, 0.38, 0.35), "deck": (0.3, 0.3, 0.3), "person": (1, 1, 1),
          "water": (0.1, 0.15, 0.15)}


def material(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*MATCOL.get(name, (0.5, 0.5, 0.5)), 1)
    return m


# ------------------------------------------------------------------------------ UV helpers

def atlas(px, py):
    """pixel (top-left origin) in a 1024 atlas -> Blender UV"""
    return (px / 1024.0, 1.0 - py / 1024.0)


PROPS = {"iron": (0, 0), "wood": (1, 0), "wire": (2, 0), "bag": (3, 0), "steel": (0, 1), "sign": (1, 1), "umbrella": (2, 1),
         "globe": (3, 1), "gilded": (0, 2), "granite": (1, 2), "marble": (2, 2), "boards": (3, 2)}


def cell(name, u, v):
    """u, v in 0..1 inside a props cell (v up) -> atlas UV, inset to avoid bleeding"""
    c, r = PROPS[name]
    u = 0.03 + 0.94 * min(1, max(0, u))
    v = 0.03 + 0.94 * min(1, max(0, v))
    return atlas(c * 256 + u * 256, r * 256 + (1 - v) * 256)


def frame(d):
    d = d.normalized()
    a = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    s = d.cross(a).normalized()
    return s, d.cross(s).normalized()


# ------------------------------------------------------------------------------ primitives

def lathe(g, prof, segs, mat, uvf, flute=None, cap=False):
    """Revolve a profile [(r, z), ...] about Z. uvf(u, v) -> uv (u round, v along the profile)."""
    L = [0.0]
    for i in range(1, len(prof)):
        L.append(L[-1] + math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]))
    tot = L[-1] or 1
    rings = []
    for i, (r, z) in enumerate(prof):
        ring = []
        for j in range(segs + 1):
            a = j / segs * math.tau
            rr = r * (1 + (flute(i, a) if flute else 0))
            ring.append((math.cos(a) * rr, math.sin(a) * rr, z))
        rings.append(ring)
    for i in range(len(prof) - 1):
        for j in range(segs):
            if prof[i][0] < 1e-5 and prof[i + 1][0] < 1e-5:
                continue
            g.quad(rings[i][j], rings[i][j + 1], rings[i + 1][j + 1], rings[i + 1][j],
                   [uvf(j / segs, L[i] / tot), uvf((j + 1) / segs, L[i] / tot), uvf((j + 1) / segs, L[i + 1] / tot), uvf(j / segs, L[i + 1] / tot)], mat)


def box(g, c, s, mat, uvf, faces="all"):
    """axis-aligned box: centre c, size s. uvf(face, u, v) -> uv, u/v in metres along the face"""
    was, g.flat = g.flat, True
    x, y, z = c
    hx, hy, hz = s[0] / 2, s[1] / 2, s[2] / 2
    P = lambda i, j, k: (x + i * hx, y + j * hy, z + k * hz)
    F = {  # name: corners (counter-clockwise from outside), face width, height
        "+z": ([P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)], s[0], s[1]),
        "-z": ([P(-1, 1, -1), P(1, 1, -1), P(1, -1, -1), P(-1, -1, -1)], s[0], s[1]),
        "-y": ([P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1)], s[0], s[2]),
        "+y": ([P(1, 1, -1), P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1)], s[0], s[2]),
        "+x": ([P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1)], s[1], s[2]),
        "-x": ([P(-1, 1, -1), P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1)], s[1], s[2]),
    }
    for k, (pts, w, h) in F.items():
        if faces != "all" and k not in faces:
            continue
        g.quad(*pts, [uvf(k, 0, 0), uvf(k, w, 0), uvf(k, w, h), uvf(k, 0, h)], mat)
    g.flat = was


def tube(g, pts, radii, sides, mat, uvf):
    """a tapering tube along a polyline (parallel-transported frame). uvf(j/sides, dist) -> uv"""
    t0 = (pts[1] - pts[0]).normalized()
    s, b = frame(t0)
    rings, dist = [], 0.0
    for i, p in enumerate(pts):
        if i > 0:
            dist += (p - pts[i - 1]).length
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        s = (s - t * s.dot(t)).normalized()
        b = t.cross(s)
        ring = []
        for j in range(sides + 1):
            a = j / sides * math.tau
            ring.append((p + (s * math.cos(a) + b * math.sin(a)) * radii[i], j / sides, dist))
        rings.append(ring)
    for i in range(len(pts) - 1):
        for j in range(sides):
            A, B, C, D = rings[i][j], rings[i][j + 1], rings[i + 1][j + 1], rings[i + 1][j]
            g.quad(A[0], B[0], C[0], D[0], [uvf(A[1], A[2]), uvf(B[1], B[2]), uvf(C[1], C[2]), uvf(D[1], D[2])], mat)


# ================================================================================ trees

BARK_X = {"plane": 0, "elm": 256, "oak": 512}
CARD_Y = {"elm": 0, "oak": 256, "plane": 512, "brush": 768}

SPECIES = {
    # per depth: kids, where along the parent they start (1 = all at the tip), branch angle, length ratio,
    # radius ratio, kink, tropism (+ up / - droop), segment length
    "elm": dict(trunk=(3.6, 0.42, 0.78), maxd=4, card=2.3,
                kids=[4, 5, 3, 3], t0=[1.0, 0.35, 0.3, 0.35], ang=[0.40, 0.62, 0.70, 0.75], lr=[3.0, 0.42, 0.55, 0.62],
                rr=[0.66, 0.5, 0.58, 0.6], kink=[0.04, 0.06, 0.12, 0.16, 0.2], trop=[0.0, -0.035, -0.07, -0.10, -0.12], seg=[1.6, 1.5, 1.3, 1.0, 9]),
    "oak": dict(trunk=(4.4, 0.5, 0.7), maxd=4, card=2.0,
                kids=[4, 4, 3, 3], t0=[0.72, 0.3, 0.3, 0.35], ang=[0.95, 0.80, 0.85, 0.85], lr=[1.85, 0.5, 0.55, 0.6],
                rr=[0.62, 0.55, 0.58, 0.6], kink=[0.05, 0.22, 0.3, 0.35, 0.4], trop=[0.0, 0.03, 0.0, -0.02, 0.0], seg=[1.6, 1.3, 1.1, 0.9, 9]),
    "plane": dict(trunk=(17.0, 0.5, 0.22), maxd=4, card=2.2,
                  kids=[6, 4, 3, 2], t0=[0.33, 0.3, 0.3, 0.35], ang=[0.85, 0.75, 0.75, 0.8], lr=[0.44, 0.5, 0.55, 0.62],
                  rr=[0.55, 0.55, 0.58, 0.6], kink=[0.03, 0.12, 0.16, 0.2, 0.25], trop=[0.02, 0.035, 0.02, 0.0, -0.02], seg=[2.0, 1.4, 1.2, 1.0, 9]),
}


def rnd_vec(rng):
    return Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)))


def skeleton(sp, seed):
    """-> list of branches (points, radii, depth)"""
    P = SPECIES[sp]
    rng = random.Random(seed)
    out = []

    def grow(start, d, length, r0, depth, taper):
        n = max(1, min(10, int(length / P["seg"][depth]) + 1))
        pts, rad = [start.copy()], [r0]
        cur, dv = start.copy(), d.normalized()
        for i in range(1, n + 1):
            dv = (dv + rnd_vec(rng) * P["kink"][depth] + Vector((0, 0, 1)) * P["trop"][depth]).normalized()
            if dv.z < -0.5:
                dv.z = -0.5; dv.normalize()
            cur = cur + dv * (length / n)
            pts.append(cur.copy())
            rad.append(max(0.012, r0 * (1 - (1 - taper) * i / n)))
        out.append((pts, rad, depth))
        if depth >= P["maxd"]:
            return
        k = P["kids"][depth]
        t0 = P["t0"][depth]
        phase = rng.random() * math.tau
        for c in range(k):
            t = 1.0 if t0 >= 1 else t0 + (1 - t0) * min(1, max(0, (c + 0.5 + rng.uniform(-0.3, 0.3)) / k))
            f = t * n
            i = min(n - 1, int(f)); fr = f - i
            p = pts[i].lerp(pts[i + 1], fr)
            pd = (pts[i + 1] - pts[i]).normalized()
            rp = rad[i] + (rad[i + 1] - rad[i]) * fr
            s, b = frame(pd)
            a = phase + c * 2.39996 + rng.uniform(-0.3, 0.3)
            axis = s * math.cos(a) + b * math.sin(a)
            ang = P["ang"][depth] * rng.uniform(0.8, 1.2)
            cd = (pd * math.cos(ang) + axis * math.sin(ang)).normalized()
            ln = length * P["lr"][depth] * (1 - 0.3 * t if t0 < 1 else 1) * rng.uniform(0.85, 1.15)
            grow(p - pd * 0.05, cd, ln, rp * P["rr"][depth], depth + 1, 0.55)

    tl, tr, ttaper = SPECIES[sp]["trunk"]
    grow(Vector((0, 0, -0.3)), Vector((rng.uniform(-0.04, 0.04), rng.uniform(-0.04, 0.04), 1)), tl + 0.3, tr, 0, ttaper)
    return out


def card(g, base, d, size, kind, roll, crossed=False):
    """twig card: bottom-middle at base, rising along d"""
    s, b = frame(d)
    side = s * math.cos(roll) + b * math.sin(roll)
    y0 = CARD_Y[kind]
    uv = [atlas(770, y0 + 254), atlas(1022, y0 + 254), atlas(1022, y0 + 2), atlas(770, y0 + 2)]
    for k in ([0, 1] if crossed else [0]):
        sd = side if k == 0 else d.cross(side).normalized()
        a, bb = base - sd * size / 2, base + sd * size / 2
        g.quad(a, bb, bb + d * size, a + d * size, uv, "bark")


def tree(sp, seed=7):
    br = skeleton(sp, seed)
    P = SPECIES[sp]
    xs = BARK_X[sp]
    rng = random.Random(seed + 1)
    for lod in (0, 1, 2):
        g = Geo()
        maxd = {0: P["maxd"], 1: 2, 2: 1}[lod]
        for pts, rad, depth in br:
            if depth > maxd:
                continue
            r0 = rad[0]
            sides = [[8, 6, 4, 3, 3], [5, 4, 3], [4, 3]][lod][depth]
            if lod == 2 and len(pts) > 3:   # fewer rings far away
                keep = list(range(0, len(pts), 2))
                if keep[-1] != len(pts) - 1:
                    keep.append(len(pts) - 1)
                pts, rad = [pts[i] for i in keep], [rad[i] for i in keep]
            circ = math.tau * max(r0, 0.03)
            tube(g, pts, rad, sides, "bark", lambda u, dist, circ=circ: atlas(xs + 2 + u * 252, 0)[:1] + (dist / (circ * 4),))
            d = (pts[-1] - pts[-2]).normalized()
            if lod == 0 and depth == P["maxd"] and rng.random() < 0.7:
                card(g, pts[-1] - d * 0.4, d, P["card"] * 0.7 * rng.uniform(0.8, 1.2), sp, rng.random() * math.tau)
            if lod == 1 and depth == 2:
                ln = (pts[-1] - pts[0]).length
                card(g, pts[len(pts) // 2], d, max(2.0, ln * 1.0), "brush", rng.random() * math.tau, crossed=True)
            if lod == 2 and depth == 1:
                ln = (pts[-1] - pts[0]).length
                for f in (0.5, 0.9):
                    q = pts[int(f * (len(pts) - 1))]
                    card(g, q - d * 0.5, (d + Vector((0, 0, 0.6))).normalized(), max(3.0, ln * 0.5), "brush", rng.random() * math.tau, crossed=True)
        g.build("tree_%s_lod%d" % (sp, lod))


# ================================================================================ props

def C(name):
    return lambda u, v: cell(name, u, v)


def lamp():
    """Henry Bacon's Central Park lamppost: fluted cast-iron post and a glass globe (about 3.9 m)"""
    g = Geo()
    prof = [(0.21, 0), (0.21, 0.08), (0.18, 0.1), (0.16, 0.32), (0.12, 0.36), (0.13, 0.44), (0.085, 0.5), (0.075, 2.6), (0.07, 2.7),
            (0.11, 2.78), (0.11, 2.84), (0.055, 2.9), (0.06, 3.02), (0.13, 3.06), (0.0, 3.08)]
    lathe(g, prof, 16, "props", C("iron"), flute=lambda i, a: (0.12 * math.cos(a * 8)) if 6 <= i <= 7 else (0.06 * math.cos(a * 8) if i <= 3 else 0))
    # crown and finial above the globe
    lathe(g, [(0.0, 3.6), (0.15, 3.6), (0.16, 3.64), (0.09, 3.72), (0.04, 3.76), (0.05, 3.84), (0.0, 3.92)], 12, "props", C("iron"))
    g.build("lamp_post")
    gl = Geo()
    lathe(gl, [(0.0, 3.08), (0.12, 3.1), (0.2, 3.22), (0.23, 3.36), (0.21, 3.5), (0.15, 3.6), (0.0, 3.61)], 16, "globe", C("globe"))
    gl.build("lamp_globe")


def bench():
    """World's Fair bench: cast-iron ends, curved wooden slats (1.8 m)"""
    g = Geo()
    L = 1.8
    wood = lambda f, u, v: cell("wood", u / L, v / 0.12 if f in ("+z", "-z", "+y", "-y") else 0.5)
    # seat slats curving down at the front; back slats leaning back (front faces -Y)
    seat = [(-0.24, 0.45), (-0.14, 0.455), (-0.04, 0.455), (0.06, 0.45), (0.16, 0.44)]
    for y, z in seat:
        box(g, (0, y, z), (L, 0.085, 0.03), "props", wood)
    for i in range(4):
        z = 0.56 + i * 0.1
        y = 0.2 + i * 0.035
        box(g, (0, y, z), (L, 0.03, 0.075), "props", wood)
    iron = lambda f, u, v: cell("iron", u * 2, v * 2)
    for x in (-L / 2 + 0.12, 0, L / 2 - 0.12):
        # end frame: front leg, rear leg, seat rail, back upright, arm on the ends
        box(g, (x, -0.24, 0.21), (0.05, 0.05, 0.42), "props", iron)
        box(g, (x, 0.16, 0.21), (0.05, 0.05, 0.42), "props", iron)
        box(g, (x, -0.04, 0.42), (0.05, 0.48, 0.04), "props", iron)
        for i in range(4):
            box(g, (x, 0.19 + i * 0.035, 0.52 + i * 0.1), (0.05, 0.05, 0.12), "props", iron)
        if x != 0:
            box(g, (x, -0.06, 0.66), (0.05, 0.42, 0.04), "props", iron)
            box(g, (x, -0.25, 0.55), (0.05, 0.04, 0.22), "props", iron)
    g.build("bench")


def basket():
    """the wire trash basket with a black bag in it"""
    g = Geo()
    prof = [(0.22, 0.0), (0.25, 0.1), (0.31, 0.88)]
    lathe(g, prof, 14, "wire", C("wire"))
    g2 = Geo()   # inner face so the mesh shows from inside too
    lathe(g2, [(0.30, 0.88), (0.245, 0.1), (0.215, 0.0)], 14, "wire", lambda u, v: cell("wire", u, 1 - v))
    for i, f in enumerate(g2.f):
        g.face([g.vert(g2.v[k]) for k in f], g2.uv[i], "wire")
    lathe(g, [(0.29, 0.9), (0.31, 0.92), (0.33, 0.9), (0.31, 0.87)], 14, "props", C("iron"))   # rim
    g.build("basket_wire")
    b = Geo()
    lathe(b, [(0.0, 0.05), (0.2, 0.06), (0.24, 0.6), (0.29, 0.84), (0.32, 0.8)], 12, "props", C("bag"))
    b.build("basket_bag")


def cart():
    """a hot dog / pretzel cart with a striped umbrella"""
    g = Geo()
    steel = lambda f, u, v: cell("steel", u / 1.6, v / 0.9)
    box(g, (0, 0, 0.72), (1.6, 0.8, 0.9), "props", steel)
    box(g, (0, 0, 1.2), (1.5, 0.7, 0.06), "props", steel)                        # griddle top
    box(g, (0.45, 0, 1.36), (0.5, 0.5, 0.28), "props", steel)                    # steam box
    box(g, (-0.95, 0, 0.98), (0.3, 0.04, 0.04), "props", lambda f, u, v: cell("iron", u, v))   # handle
    for yy in (-0.3, 0.3):
        box(g, (-0.85, yy, 0.9), (0.04, 0.04, 0.2), "props", lambda f, u, v: cell("iron", u, v))
    for s in (-1, 1):   # signs on both long sides
        y = s * 0.405
        a, b, c, d = (-0.75, y, 0.32), (0.75, y, 0.32), (0.75, y, 1.12), (-0.75, y, 1.12)
        uv = [cell("sign", 0, 0), cell("sign", 1, 0), cell("sign", 1, 1), cell("sign", 0, 1)]
        if s < 0:
            g.quad(a, b, c, d, uv, "props")
        else:
            g.quad(b, a, d, c, uv, "props")
    for s in (-1, 1):   # wheels
        g.M = Matrix.Translation((0.45, s * 0.42, 0.28)) @ Matrix.Rotation(math.pi / 2, 4, "X")
        lathe(g, [(0, -0.04), (0.27, -0.04), (0.28, 0), (0.27, 0.04), (0, 0.04)], 14, "props", C("iron"))
    g.M = Matrix.Translation((-0.6, 0, 0.27))
    box(g, (0, 0, -0.13), (0.06, 0.06, 0.28), "props", lambda f, u, v: cell("iron", u, v))   # stand leg
    g.M = Matrix.Identity(4)
    lathe(g, [(0.02, 1.2), (0.02, 2.35)], 6, "props", C("iron"))   # umbrella pole
    g.build("cart")
    u = Geo()
    prof = [(0.0, 2.45), (0.25, 2.4), (0.7, 2.25), (1.05, 2.08), (1.07, 2.0)]
    lathe(u, prof, 16, "props", lambda uu, vv: cell("umbrella", uu, 1 - vv))
    lathe(u, list(reversed(prof)), 16, "props", lambda uu, vv: cell("umbrella", uu, vv))
    u.build("cart_umbrella")


SKIN = [(0.93, 0.76, 0.64, 1), (0.42, 0.27, 0.18, 1), (0.72, 0.52, 0.38, 1)]


def person(pose):
    """a plain low-poly figure, ~1.72 m. Vertex colour alpha 0 marks the coat (tinted per instance).
    Legs are the vertices below 0.9 m with |x| > 0 (left x < 0): the game swings them for skating."""
    g = Geo()
    coat = (0.5, 0.5, 0.5, 0)
    pants = (0.12, 0.12, 0.14, 1)
    shoe = (0.06, 0.06, 0.06, 1)
    skin = SKIN[0]
    uv = lambda u, v: (0.5, 0.5)
    sit = pose == "sit"
    for s in (-1, 1):
        x = s * 0.1
        if sit:   # thighs forward, shins down
            g.cur_col = pants
            g.M = Matrix.Translation((x, -0.02, 0.47)) @ Matrix.Rotation(math.pi / 2, 4, "X")
            lathe(g, [(0.075, 0), (0.07, 0.42)], 6, "person", uv)
            g.M = Matrix.Translation((x, -0.44, 0.0))
            lathe(g, [(0.055, 0.06), (0.065, 0.47)], 6, "person", uv)
            g.cur_col = shoe
            g.M = Matrix.Identity(4)
            box(g, (x, -0.49, 0.04), (0.1, 0.24, 0.08), "person", lambda f, u, v: (0.5, 0.5))
        else:
            g.cur_col = pants
            g.M = Matrix.Translation((x, 0, 0.08))
            lathe(g, [(0.055, 0), (0.065, 0.42), (0.08, 0.82)], 6, "person", uv)
            g.cur_col = shoe
            g.M = Matrix.Identity(4)
            box(g, (x, -0.04, 0.05), (0.1, 0.26, 0.1), "person", lambda f, u, v: (0.5, 0.5))
    hip = 0.47 if sit else 0.9
    g.M = Matrix.Translation((0, 0.02 if sit else 0, hip - 0.05))
    g.cur_col = coat
    lathe(g, [(0.0, 0.0), (0.17, 0.02), (0.19, 0.25), (0.18, 0.5), (0.13, 0.58), (0.06, 0.62)], 8, "person", uv)
    for s in (-1, 1):   # arms
        g.M = Matrix.Translation((s * 0.22, 0.02 if sit else 0, hip + 0.5)) @ Matrix.Rotation(math.pi + s * (0.12 if not sit else 0.05), 4, "Y")
        if sit:
            g.M = g.M @ Matrix.Rotation(-0.5, 4, "X")
        lathe(g, [(0.05, 0), (0.055, 0.28), (0.045, 0.5)], 6, "person", uv)
        g.cur_col = skin
        lathe(g, [(0.045, 0.5), (0.04, 0.58), (0.0, 0.6)], 6, "person", uv)
        g.cur_col = coat
    g.M = Matrix.Translation((0, 0.02 if sit else 0, hip + 0.57))
    g.cur_col = skin
    lathe(g, [(0.0, 0.0), (0.05, 0.02), (0.05, 0.08), (0.09, 0.12), (0.1, 0.2), (0.09, 0.28), (0.0, 0.32)], 8, "person", uv)
    g.cur_col = coat   # knit hat
    lathe(g, [(0.0, 0.33), (0.095, 0.28), (0.1, 0.22), (0.0, 0.22)], 8, "person", uv)
    g.M = Matrix.Identity(4)
    g.build("person_" + pose)


def duck():
    g = Geo()
    uv = lambda u, v: (0.5, 0.5)
    g.cur_col = (0.45, 0.38, 0.30, 1)
    g.M = Matrix.Rotation(math.pi / 2, 4, "X")   # body along -Y (front)
    lathe(g, [(0.0, -0.2), (0.08, -0.16), (0.11, -0.02), (0.1, 0.12), (0.06, 0.2), (0.0, 0.22)], 8, "person", uv)
    g.cur_col = (0.10, 0.36, 0.18, 1)
    g.M = Matrix.Translation((0, -0.16, 0.12))
    lathe(g, [(0.0, -0.05), (0.045, -0.03), (0.05, 0.03), (0.0, 0.07)], 6, "person", uv)
    g.cur_col = (0.85, 0.65, 0.15, 1)
    g.M = Matrix.Translation((0, -0.21, 0.13)) @ Matrix.Rotation(math.pi / 2, 4, "X")
    lathe(g, [(0.02, -0.03), (0.0, 0.03)], 4, "person", uv)
    g.M = Matrix.Identity(4)
    g.build("duck")


def rock(name, sx, sy, sz, nx, ny, seed, dip=0.25, step=0.55):
    """A Manhattan schist outcrop: a glacier-polished whaleback with tilted foliation steps.
    Height field over an ellipse, sunk 0.35 m at its edges. UVs: triplanar by face, 4 m per tile."""
    g = Geo()
    rng = random.Random(seed)
    off = Vector((rng.random() * 50, rng.random() * 50, rng.random() * 50))
    dirx, diry = math.cos(seed), math.sin(seed)

    def h(u, v):
        r = (abs(u) ** 2.2 + abs(v) ** 2.2) ** (1 / 2.2)
        base = max(0.0, 1 - r ** 2.2) ** 0.4
        # lopsided: one flank steep, the other a long glacier-smoothed slope
        side = max(-1.0, min(1.0, u * dirx + v * diry))
        base *= 0.78 + 0.3 * side
        p = Vector((u * sx / 6, v * sy / 6, 0)) + off
        n = noise.fractal(p, 0.6, 2.0, 4) * 0.3 + noise.noise(p * 3.1) * 0.08
        ridge = (1 - abs(noise.noise(p * 1.7 + Vector((3.3, 1.1, 0))))) ** 3 * 0.18
        z = sz * (base + (n + ridge) * base ** 0.3)
        # foliation: tilted planes stepped like stairs
        q = z + (u * dirx + v * diry) * sx * dip * 0.25
        st = step * sz / 2.5
        k = math.floor(q / st)
        fr = q / st - k
        z += (k * st + st * (fr ** 4) - q) * 0.85 * base ** 0.2
        return z - 0.35

    P = [[None] * (ny + 1) for _ in range(nx + 1)]
    for i in range(nx + 1):
        for j in range(ny + 1):
            u, v = i / nx * 2 - 1, j / ny * 2 - 1
            u *= 1.05; v *= 1.05
            P[i][j] = Vector((u * sx / 2, v * sy / 2, h(u, v)))
    for i in range(nx):
        for j in range(ny):
            a, b, c, d = P[i][j], P[i + 1][j], P[i + 1][j + 1], P[i][j + 1]
            if max(a.z, b.z, c.z, d.z) < -0.3:
                continue
            n = (b - a).cross(d - a)
            ax = max(range(3), key=lambda k: abs(n[k]))
            uvf = (lambda p: (p.x / 5, p.y / 5)) if ax == 2 else (lambda p: (p.x / 5, p.z / 5)) if ax == 1 else (lambda p: (p.y / 5, p.z / 5))
            g.quad(a, b, c, d, [uvf(a), uvf(b), uvf(c), uvf(d)], "schist")
    ob = g.build(name)
    return ob


def bridge():
    """Gapstow Bridge (1896): a single rough schist arch over the Pond's neck. Span along X (23 m),
    roadway 4.6 m wide between low parapets, arch span 13.4 m, crown of the deck 4.4 m above the water
    (water level is the origin; the banks are at +0.3)."""
    g = Geo()
    L, W, S, R = 23.0, 4.6, 13.4, 3.3     # length, deck width, arch span, arch rise
    th = 0.55                               # parapet thickness
    N = 46
    xs = [-L / 2 + L * i / N for i in range(N + 1)]
    deck = lambda x: 4.4 - 1.6 * (x / (L / 2)) ** 2
    arch = lambda x: (R * math.sqrt(max(0.0, 1 - (x / (S / 2)) ** 2)) - 0.6) if abs(x) < S / 2 else -0.6
    ruv = lambda a, b: (a / 3.0, b / 3.0)
    yo, yi = W / 2 + th, W / 2
    for i in range(N):
        x0, x1 = xs[i], xs[i + 1]
        for s in (-1, 1):
            y = s * yo
            # outer face: from the arch (or the ground) up to the parapet top
            a0, a1 = arch(x0), arch(x1)
            t0, t1 = deck(x0) + 0.95, deck(x1) + 0.95
            g.quad((x0, y, a0), (x1, y, a1), (x1, y, t1), (x0, y, t0), [ruv(x0, a0), ruv(x1, a1), ruv(x1, t1), ruv(x0, t0)], "rubble", flip=s > 0)
            # parapet inner face and coping
            yy = s * yi
            d0, d1 = deck(x0), deck(x1)
            g.quad((x0, yy, d0), (x1, yy, d1), (x1, yy, t1), (x0, yy, t0), [ruv(x0, d0), ruv(x1, d1), ruv(x1, t1), ruv(x0, t0)], "rubble", flip=s < 0)
            g.quad((x0, yy, t0), (x1, yy, t1), (x1, y, t1), (x0, y, t0), [ruv(x0, 0), ruv(x1, 0), ruv(x1, th), ruv(x0, th)], "rubble", flip=s < 0)
        # roadway
        d0, d1 = deck(x0), deck(x1)
        g.quad((x0, -yi, d0), (x1, -yi, d1), (x1, yi, d1), (x0, yi, d0), [(x0 / 4, 0), (x1 / 4, 0), (x1 / 4, W / 4), (x0 / 4, W / 4)], "deck")
        # soffit of the arch
        if abs(x0) < S / 2 and abs(x1) < S / 2 + 1e-6:
            a0, a1 = arch(x0), arch(x1)
            g.quad((x0, yo, a0), (x1, yo, a1), (x1, -yo, a1), (x0, -yo, a0), [ruv(x0, 0), ruv(x1, 0), ruv(x1, W + 2 * th), ruv(x0, W + 2 * th)], "rubble")
    # the arch ring (voussoirs) stands proud of the face
    M = 30
    for s in (-1, 1):
        y = s * (yo + 0.12)
        for i in range(M):
            a0, a1 = math.pi * i / M, math.pi * (i + 1) / M
            p = lambda a, rr: (math.cos(a) * S / 2 * rr, y, math.sin(a) * R * rr - 0.6)
            r1 = 1.0 + 0.85 / R
            q = [p(a0, 1.0), p(a1, 1.0), p(a1, r1), p(a0, r1)]
            g.quad(*q, [ruv(q[0][0], q[0][2]), ruv(q[1][0], q[1][2]), ruv(q[2][0], q[2][2]), ruv(q[3][0], q[3][2])], "rubble", flip=s < 0)
    # end posts at the four corners of the parapets
    for sx_ in (-1, 1):
        for sy_ in (-1, 1):
            x = sx_ * (L / 2 - 0.4)
            box(g, (x, sy_ * (W / 2 + th / 2), deck(x) + 0.6), (0.8, th + 0.15, 1.5), "rubble", lambda f, u, v: ruv(u, v))
    g.build("bridge")


def maine():
    """The USS Maine National Monument at Merchants' Gate, stylised: a stepped granite base and pool,
    a tall pylon with a ship's prow and marble figures, and on top a gilded figure in a shell chariot
    drawn by three sea-horses. Front faces -Y (three.js +Z). About 18 m to the top."""
    g = Geo()
    gran = lambda f, u, v: cell("granite", u / 3, v / 3)
    marb = lambda f, u, v: cell("marble", u / 2, v / 2)
    gild = lambda u, v: cell("gilded", u, v)
    box(g, (0, 0, 0.25), (12, 9, 0.5), "props", gran)       # platform
    box(g, (0, 0.8, 0.75), (9, 6, 0.5), "props", gran)      # step
    box(g, (0, 1.2, 1.25), (6.5, 4.4, 0.5), "props", gran)  # step
    # pool basin in front
    box(g, (0, -3.2, 0.7), (7.5, 0.4, 0.5), "props", gran)
    for s in (-1, 1):
        box(g, (s * 3.55, -2.4, 0.7), (0.4, 2.0, 0.5), "props", gran)
    # pylon, tapering, with a cornice
    H = 13.0
    g.M = Matrix.Translation((0, 1.2, 1.5))
    pts = [(-1.7, -1.3), (1.7, -1.3), (1.7, 1.3), (-1.7, 1.3)]
    top = 0.78
    for i in range(4):
        (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % 4]
        g.quad((x0, y0, 0), (x1, y1, 0), (x1 * top, y1 * top, H), (x0 * top, y0 * top, H),
               [cell("granite", 0, 0), cell("granite", 1, 0), cell("granite", 1, 1), cell("granite", 0, 1)], "props")
    box(g, (0, 0, H + 0.25), (3.2, 2.5, 0.5), "props", gran)
    box(g, (0, 0, H + 0.75), (2.6, 2.0, 0.5), "props", gran)
    # ship's prow at the foot of the pylon, with a marble figure group
    g.M = Matrix.Translation((0, -0.2, 1.5))
    prow = [(-1.3, 0, 0), (1.3, 0, 0), (0, -2.6, 0), (-1.0, 0, 2.6), (1.0, 0, 2.6), (0, -2.2, 2.9)]
    i = [g.vert(p) for p in prow]
    U = lambda u, v: cell("marble", u, v)
    g.face([i[0], i[2], i[5], i[3]], [U(0, 0), U(1, 0), U(1, 1), U(0, 1)], "props")
    g.face([i[2], i[1], i[4], i[5]], [U(0, 0), U(1, 0), U(1, 1), U(0, 1)], "props")
    g.face([i[3], i[5], i[4]], [U(0, 0), U(1, 0), U(0.5, 1)], "props")
    for k, (x, y, s_) in enumerate([(0, -1.4, 1.0), (-1.4, -0.4, 0.8), (1.4, -0.4, 0.8)]):
        g.M = Matrix.Translation((x, y - 0.2, 4.4 if k == 0 else 1.5)) @ Matrix.Scale(s_, 4)
        lathe(g, [(0.0, 0.0), (0.4, 0.05), (0.35, 0.9), (0.28, 1.3), (0.18, 1.45), (0.2, 1.7), (0.0, 1.85)], 8, "props", lambda u, v: cell("marble", u, v))
    # Columbia in her shell chariot, three hippocampi leaping ahead
    g.M = Matrix.Translation((0, 1.2, 1.5 + H + 1.0))
    lathe(g, [(0.0, 0.0), (0.9, 0.1), (1.2, 0.6), (1.1, 1.0), (0.0, 0.7)], 10, "props", gild)        # shell
    g.M = Matrix.Translation((0, 1.4, 1.5 + H + 1.6))
    lathe(g, [(0.0, 0.0), (0.38, 0.1), (0.3, 1.0), (0.22, 1.5), (0.14, 1.65), (0.16, 1.85), (0.0, 2.05)], 8, "props", gild)   # figure
    g.M = Matrix.Translation((0.15, 1.4, 1.5 + H + 3.0)) @ Matrix.Rotation(-0.35, 4, "Y")
    lathe(g, [(0.07, 0.0), (0.06, 1.2), (0.0, 1.3)], 6, "props", gild)   # raised arm
    for k, x in enumerate((-0.75, 0.0, 0.75)):
        g.M = Matrix.Translation((x, 0.0 - (0.15 if k == 1 else 0), 1.5 + H + 1.5)) @ Matrix.Rotation(-1.0, 4, "X")
        lathe(g, [(0.0, -0.9), (0.22, -0.6), (0.26, 0.0), (0.2, 0.4), (0.12, 0.75), (0.16, 0.95), (0.0, 1.1)], 8, "props", gild)
    g.M = Matrix.Identity(4)
    g.build("maine")
    w = Geo()
    w.quad((-3.35, -3.0, 0.82), (3.35, -3.0, 0.82), (3.35, -1.4, 0.82), (-3.35, -1.4, 0.82), [(0, 0), (1, 0), (1, 1), (0, 1)], "water")
    w.build("maine_pool")


# ================================================================================ export

def export(path, names):
    bpy.ops.object.select_all(action="DESELECT")
    for n in names:
        bpy.data.objects[n].select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_materials="EXPORT", export_image_format="NONE", export_normals=True,
                              export_texcoords=True, export_yup=True, export_animations=False, export_vertex_color="ACTIVE")


def textures():
    os.makedirs(TEXOUT, exist_ok=True)
    sc = bpy.context.scene
    sc.render.image_settings.file_format = "JPEG"
    sc.render.image_settings.color_mode = "RGB"
    sc.render.image_settings.quality = 82
    for name in ("Schist", "Wall", "Rubble", "Ice"):
        src = os.path.join(TS, name, name + ".png")
        im = bpy.data.images.load(src)
        im.save_render(os.path.join(TEXOUT, name.lower() + ".jpg"), scene=sc)
    for name in ("Trees", "Props"):
        shutil.copyfile(os.path.join(TS, name, name + ".png"), os.path.join(TEXOUT, name.lower() + ".png"))


def main():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    textures()
    for sp in ("elm", "oak", "plane"):
        tree(sp, {"elm": 11, "oak": 23, "plane": 37}[sp])
    export(os.path.join(MODELS, "park_trees.glb"), [n for n in TRIS if n.startswith("tree_")])
    lamp(); bench(); basket(); cart(); person("stand"); person("sit"); duck()
    rock("rock_big", 30, 19, 4.2, 46, 30, 3)
    rock("rock_ridge", 22, 7, 3.4, 36, 12, 5, dip=0.5)
    rock("rock_mid", 12, 8, 2.6, 22, 16, 8)
    rock("rock_small", 4.5, 3.2, 1.5, 10, 8, 12)
    rock("rock_boulder", 2.2, 1.7, 1.2, 7, 6, 15, step=1.0)
    bridge(); maine()
    export(os.path.join(MODELS, "park_props.glb"), [n for n in TRIS if not n.startswith("tree_")])
    for k, v in TRIS.items():
        print("TRIS %-16s %6d" % (k, v))


main()
