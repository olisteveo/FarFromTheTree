"""Far From the Tree - pedestrians, Blender side (run headless by build_people.py).

  blender -b -t 8 --python people_blender.py -- <out_dir> <atlas_png> <preview_dir>

Builds every character from Python (mesh + UVs into the shared atlas + armature + skin weights),
keys walk / stroll / idle / flinch actions procedurally, bakes them into vertex animation data
(per-frame vertex positions + normals), writes people.glb / people_vat.bin / people.json, and
renders review previews.

Conventions: Blender Z up, characters face -Y, their left is +X. Exported data is converted to
three.js space: (x, y, z)_three = (x, z, -y)_blender, so characters face +Z in three.
"""
import bpy, bmesh, sys, os, math, json, struct, zlib, gzip, random
import numpy as np
from mathutils import Vector, Matrix, Quaternion, Euler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import atlas_design as AD

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if len(argv) > 0 else os.path.abspath("out")
ATLAS = argv[1] if len(argv) > 1 else ""
PREV = argv[2] if len(argv) > 2 else os.path.join(OUT, "previews")
ONLY = argv[3].split(",") if len(argv) > 3 and argv[3] else None
os.makedirs(OUT, exist_ok=True)
os.makedirs(PREV, exist_ok=True)

TAU = math.tau
AW, AH = AD.W, AD.H
Z4 = (0, 0, 0, 0)          # vertex mask: nothing tinted, no flag
HAIRM = (0, 0, 1, 0)       # hair tint

# ======================================================================================== atlas
def cell(name):
    if name in AD.FABRICS:
        return AD.fabric_rect(name)
    if name in AD.MISC:
        return AD.misc_rect(name)
    for i, f in enumerate(AD.FACES):
        if f["name"] == name:
            return AD.face_rect(i)
    raise KeyError(name)


def skin_rect(face):
    x, y, w, h = cell(face)
    sx, sy, sw, sh = AD.SKIN_PATCH
    return (x + sx, y + sy, sw, sh)


def uvpx(rect, u, v, inset=3.0):
    """u,v in 0..1 (v=1 top of cell) -> atlas pixel coords (top-left origin)."""
    x, y, w, h = rect
    ins = min(inset, w * 0.1, h * 0.1)
    return (x + ins + u * (w - 2 * ins), y + ins + (1.0 - v) * (h - 2 * ins))


# ======================================================================================== mesh builder
class MB:
    def __init__(self):
        self.anchors = {}
        self.v = []        # Vector
        self.w = []        # {bone: weight}
        self.m = []        # mask (r, g, b)
        self.f = []        # (vertex indices tuple, uv tuple of (px,py))

    def add_v(self, p, w, m):
        self.v.append(Vector(p))
        self.w.append(w)
        self.m.append(m)
        return len(self.v) - 1

    def ntris(self):
        return sum(len(f) - 2 for f, _ in self.f)


def ring_frame(axis, ref):
    a = Vector(axis).normalized()
    r = Vector(ref)
    r = (r - a * r.dot(a))
    if r.length < 1e-6:
        r = Vector((0, 0, 1)) if abs(a.z) < 0.9 else Vector((0, 1, 0))
        r = (r - a * r.dot(a))
    r.normalize()
    s = a.cross(r).normalized()
    return a, r, s


def sq(c, e):
    return math.copysign(abs(c) ** e, c)


def loft(mb, rings, n, rect, weights, mask=Z4, v0=1.0, v1=0.0, cap0=False, cap1=False,
         ref=(0, 1, 0), u_off=0.0, cap_uv=None, theta_range=None, flip=False, inset=3.0):
    """rings: list of dict(c=center, ax=axis dir, rx=side radius, ry=ref radius, sq=squareness,
    bump=fn(theta)->extra radius, v=optional explicit v). u=0 at the ref direction.
    weights: fn(ring_index, center, point) -> {bone: w}. theta_range: open surface (start, end)."""
    if theta_range:
        t0, t1 = theta_range
        thetas = [t0 + (t1 - t0) * k / n for k in range(n + 1)]
        closed = False
    else:
        thetas = [TAU * k / n for k in range(n)]
        closed = True
    # v along the loft by cumulative centre distance
    L = [0.0]
    for a, b in zip(rings, rings[1:]):
        L.append(L[-1] + (Vector(b["c"]) - Vector(a["c"])).length)
    tot = L[-1] or 1.0
    idx = []
    vs = []
    for i, R in enumerate(rings):
        c = Vector(R["c"])
        ax = R.get("ax") or ((Vector(rings[min(i + 1, len(rings) - 1)]["c"]) - Vector(rings[max(i - 1, 0)]["c"])))
        a, r, s = ring_frame(ax, R.get("ref", ref))
        e = R.get("sq", 1.0)
        row = []
        for k, th in enumerate(thetas):
            cth, sth = math.cos(th), math.sin(th)
            rr = 1.0 + (R["bump"](th) if R.get("bump") else 0.0)
            p = c + r * (sq(cth, e) * R["ry"] * rr) + s * (sq(sth, e) * R["rx"] * rr)
            if R.get("off"):
                p = p + R["off"](th)
            row.append(mb.add_v(p, weights(i, c, p), mask))
        idx.append(row)
        vs.append(R["v"] if "v" in R else v0 + (v1 - v0) * (L[i] / tot))
    # winding check on a mid quad
    mid = len(rings) // 2
    i0 = max(0, mid - 1)

    def us(k):
        return (k / n) if closed else (k / n)
    faces = []
    m = n if closed else n
    for i in range(len(rings) - 1):
        for k in range(m):
            k1 = (k + 1) % n if closed else k + 1
            q = (idx[i][k], idx[i][k1], idx[i + 1][k1], idx[i + 1][k])
            uvs = (uvpx(rect, (u_off + us(k)) % 1.0001 if u_off else us(k), vs[i], inset),
                   uvpx(rect, (u_off + us(k + 1)) if u_off else us(k + 1), vs[i], inset),
                   uvpx(rect, (u_off + us(k + 1)) if u_off else us(k + 1), vs[i + 1], inset),
                   uvpx(rect, (u_off + us(k)) if u_off else us(k), vs[i + 1], inset))
            faces.append([q, uvs])
    # orientation: normal should point away from the ring centre
    def outward(fq):
        q = fq[0]
        p = [mb.v[j] for j in q]
        nrm = (p[1] - p[0]).cross(p[3] - p[0])
        cen = sum(p, Vector()) / 4
        ri = None
        return nrm, cen
    test_i = len(faces) // 2
    nrm, cen = outward(faces[test_i])
    ring_i = test_i // m
    rc = (Vector(rings[ring_i]["c"]) + Vector(rings[ring_i + 1]["c"])) / 2
    inward = nrm.dot(cen - rc) < 0
    if flip:
        inward = not inward
    for q, uvs in faces:
        if inward:
            q = tuple(reversed(q))
            uvs = tuple(reversed(uvs))
        mb.f.append((q, uvs))
    # caps
    for which, do in ((0, cap0), (len(rings) - 1, cap1)):
        if not do:
            continue
        R = rings[which]
        c = Vector(R["c"])
        if isinstance(do, (tuple, list, Vector)):
            c = c + Vector(do)
        ci = mb.add_v(c, weights(which, Vector(R["c"]), c), mask)
        row = idx[which]
        cu = cap_uv or (0.5, vs[which])
        for k in range(n if closed else n):
            k1 = (k + 1) % n if closed else k + 1
            tri = (row[k], row[k1], ci)
            uvs = (uvpx(rect, k / n, vs[which], inset), uvpx(rect, (k + 1) / n, vs[which], inset), uvpx(rect, cu[0], cu[1], inset))
            p = [mb.v[j] for j in tri]
            nrm = (p[1] - p[0]).cross(p[2] - p[0])
            # cap should face away from the neighbouring ring
            nb = Vector(rings[1 if which == 0 else which - 1]["c"])
            if nrm.dot(c - nb) < 0:
                tri = tuple(reversed(tri))
                uvs = tuple(reversed(uvs))
            mb.f.append((tri, uvs))
    return idx


def chain_weights(chain, blend=0.06):
    """chain: [(joint_pos, bone), ..., (end_pos, None)]. Returns weights(i, centre, p) using the
    ring centre's projection onto the chain, blending across joints."""
    pts = [Vector(p) for p, _ in chain]
    bones = [b for _, b in chain[:-1]]
    segL = [(pts[i + 1] - pts[i]).length for i in range(len(bones))]
    S = [0.0]
    for l in segL:
        S.append(S[-1] + l)

    def fn(i, c, p):
        best = None
        for j in range(len(bones)):
            a, b = pts[j], pts[j + 1]
            d = b - a
            t = max(0.0, min(1.0, (c - a).dot(d) / max(1e-9, d.length_squared)))
            dist = (a + d * t - c).length
            if best is None or dist < best[0] - 1e-6:
                best = (dist, j, t)
        _, j, t = best
        s = S[j] + t * segL[j]
        w = {bones[j]: 1.0}
        if j > 0 and s - S[j] < blend:
            k = 0.5 + 0.5 * (s - S[j]) / blend
            w = {bones[j]: k, bones[j - 1]: 1 - k}
        elif j < len(bones) - 1 and S[j + 1] - s < blend:
            k = 0.5 + 0.5 * (S[j + 1] - s) / blend
            w = {bones[j]: k, bones[j + 1]: 1 - k}
        return w
    return fn


def rigid(bone):
    return lambda i, c, p: {bone: 1.0}


def by_z(table):
    """table: [(z, {bone: w})...] sorted by z; linear blend on the vertex z."""
    def fn(i, c, p):
        z = p.z
        if z <= table[0][0]:
            return dict(table[0][1])
        for (z0, w0), (z1, w1) in zip(table, table[1:]):
            if z0 <= z <= z1:
                t = (z - z0) / max(1e-9, z1 - z0)
                out = {}
                for b, w in w0.items():
                    out[b] = out.get(b, 0) + w * (1 - t)
                for b, w in w1.items():
                    out[b] = out.get(b, 0) + w * t
                return out
        return dict(table[-1][1])
    return fn


# ======================================================================================== body
ADULT = dict(ankle=0.085, knee=0.50, hipj=0.90, crotch=0.83, pelvis=0.95, waist=1.07, chest=1.26, armpit=1.33,
             shoulder=1.43, neck=1.49, crown=1.75, hipx=0.088, shx=0.19, elbow=1.14, wrist=0.88, hand=0.70,
             foot=0.25, headsc=1.0)
KID = dict(ankle=0.06, knee=0.32, hipj=0.57, crotch=0.53, pelvis=0.61, waist=0.69, chest=0.82, armpit=0.86,
           shoulder=0.93, neck=0.975, crown=1.20, hipx=0.065, shx=0.135, elbow=0.75, wrist=0.57, hand=0.455,
           foot=0.18, headsc=0.86)


def body(H, kid=False, female=False, build=1.0):
    base = KID if kid else ADULT
    ref = 1.20 if kid else 1.75
    k = H / ref
    B = {}
    for key, val in base.items():
        B[key] = val * k if key not in ("headsc",) else val
    B["k"] = k
    B["w"] = build * (0.94 if female else 1.0) * (k if not kid else k * 0.96)
    B["female"] = female
    B["kid"] = kid
    B["H"] = H
    if female:
        B["shx"] *= 0.93
    return B


def make_skeleton(B, prefix="", ox=0.0):
    """Returns ordered dict name -> (head, tail, parent, deform)."""
    p = prefix
    X = lambda x: x + ox
    S = {}
    S[p + "hips"] = ((X(0), 0.01, B["pelvis"]), (X(0), 0.01, B["waist"]), p + "root" if False else None, True)
    S[p + "spine"] = ((X(0), 0.01, B["waist"]), (X(0), 0.0, B["chest"]), p + "hips", True)
    S[p + "chest"] = ((X(0), 0.0, B["chest"]), (X(0), 0.01, B["neck"]), p + "spine", True)
    S[p + "neck"] = ((X(0), 0.01, B["neck"]), (X(0), 0.0, B["neck"] + (B["crown"] - B["neck"]) * 0.28), p + "chest", True)
    S[p + "head"] = ((X(0), 0.0, B["neck"] + (B["crown"] - B["neck"]) * 0.28), (X(0), 0.0, B["crown"]), p + "neck", True)
    for side, sg in (("L", 1), ("R", -1)):
        sx = B["shx"] * sg
        S[p + "shoulder." + side] = ((X(0.03 * sg * B["k"]), 0.0, B["shoulder"] - 0.01 * B["k"]), (X(sx), 0.01, B["shoulder"]), p + "chest", True)
        ex, wx, hx = sx + 0.025 * sg * B["k"], sx + 0.04 * sg * B["k"], sx + 0.045 * sg * B["k"]
        S[p + "upperarm." + side] = ((X(sx), 0.01, B["shoulder"]), (X(ex), 0.025, B["elbow"]), p + "shoulder." + side, True)
        S[p + "forearm." + side] = ((X(ex), 0.025, B["elbow"]), (X(wx), 0.0, B["wrist"]), p + "upperarm." + side, True)
        S[p + "hand." + side] = ((X(wx), 0.0, B["wrist"]), (X(hx), -0.005, B["hand"]), p + "forearm." + side, True)
        hxj = B["hipx"] * sg
        S[p + "thigh." + side] = ((X(hxj), 0.0, B["hipj"]), (X(hxj * 1.05), -0.015, B["knee"]), p + "hips", True)
        S[p + "shin." + side] = ((X(hxj * 1.05), -0.015, B["knee"]), (X(hxj * 1.1), 0.01, B["ankle"]), p + "thigh." + side, True)
        S[p + "foot." + side] = ((X(hxj * 1.1), 0.01, B["ankle"]), (X(hxj * 1.12), -B["foot"] * 0.62, 0.02 * B["k"]), p + "shin." + side, True)
        S[p + "foot_ik." + side] = ((X(hxj * 1.1), 0.01, B["ankle"]), (X(hxj * 1.12), -B["foot"] * 0.62, 0.02 * B["k"]), None, False)
    return S


# ---------------------------------------------------------------------------------------- head
HEAD_PROFILE = [  # v, rx, ry, dy(+ = back)
    (0.00, 0.050, 0.054, 0.016), (0.17, 0.049, 0.052, 0.018), (0.25, 0.058, 0.070, 0.004),
    (0.36, 0.067, 0.085, 0.006), (0.48, 0.073, 0.092, 0.008), (0.60, 0.076, 0.096, 0.010),
    (0.68, 0.077, 0.097, 0.012), (0.80, 0.074, 0.094, 0.014), (0.92, 0.058, 0.077, 0.016)]


def head_eval(v):
    P = HEAD_PROFILE
    if v <= P[0][0]:
        return P[0][1:]
    for a, b in zip(P, P[1:]):
        if a[0] <= v <= b[0]:
            t = (v - a[0]) / (b[0] - a[0])
            return tuple(x + (y - x) * t for x, y in zip(a[1:], b[1:]))
    # above the last ring: dome to the crown
    a = P[-1]
    t = min(1.0, (v - a[0]) / (1.0 - a[0]))
    f = math.sqrt(max(0.0, 1 - t * t))
    return (a[1] * f / 1.0 if t < 1 else 0.0, a[2] * f if t < 1 else 0.0, a[3])


def head_point(B, th, v, inflate=0.0, ox=0.0):
    """th: 0 = back, pi = front; v: 0 = neck base, 1 = crown."""
    hs = B["headsc"] * (B["k"] if not B["kid"] else B["k"] * 1.0)
    span = B["crown"] - B["neck"]
    if v > 0.68:
        # ellipsoidal dome from the brow up to the crown
        t = min(1.0, (v - 0.68) / 0.32)
        f = math.sqrt(max(0.0, 1.0 - t * t))
        rx, ry, dy = 0.077 * f * hs, 0.097 * f * hs, 0.012 * hs
        z = B["neck"] + span * v
    else:
        rx, ry, dy = head_eval(v)
        rx, ry, dy = rx * hs, ry * hs, dy * hs
        z = B["neck"] + span * v
    nrm = Vector((-math.sin(th) * rx, math.cos(th) * ry, 0))
    if nrm.length > 0:
        nrm.normalize()
    if v > 0.68:
        t = min(1.0, (v - 0.68) / 0.32)
        # ellipsoid normal: horizontal part scales with f / R, vertical with t / H
        Hd = span * 0.32
        nrm = (nrm * (math.sqrt(max(0.0, 1 - t * t)) / max(1e-6, 0.087 * hs)) + Vector((0, 0, t / Hd))).normalized()
    # ring parameterisation must match loft(): p = c + ref*cos*ry + side*sin*rx with ref=+Y, side = Z x Y = -X
    p = Vector((ox - math.sin(th) * rx, dy + math.cos(th) * ry, z))
    return p + nrm * inflate


def head_bump(B, th, v):
    """face relief: nose, brow, chin, ears (in metres, along the outward normal)."""
    hs = B["k"] * B["headsc"]
    d = 0.0
    fr = math.cos(th - math.pi)          # 1 at the front
    front = max(0.0, fr) ** 8
    if abs(v - 0.48) < 0.07:
        d += 0.016 * front * (1 - abs(v - 0.48) / 0.07)
    if abs(v - 0.27) < 0.06:
        d += 0.006 * front
    if abs(v - 0.66) < 0.05:
        d += 0.004 * max(0.0, fr) ** 3
    side = max(0.0, abs(math.sin(th))) ** 12
    if 0.45 < v < 0.68:
        d += 0.010 * side
    return d * hs


def add_head(mb, B, face, w_fn, ox=0.0, fmask=Z4):
    rect = cell(face)
    vs = [0.0, 0.17, 0.25, 0.36, 0.48, 0.58, 0.66, 0.76, 0.86, 0.94]
    n = 12
    rows = []
    for v in vs:
        row = []
        for k in range(n):
            th = TAU * k / n
            p0 = head_point(B, th, v, 0.0, ox)
            p = head_point(B, th, v, head_bump(B, th, v), ox)
            row.append(mb.add_v(p, w_fn(v), fmask))
        rows.append(row)
    crown = mb.add_v(head_point(B, 0.0, 1.0, 0.0, ox), w_fn(1.0), fmask)
    for i in range(len(vs) - 1):
        for k in range(n):
            k1 = (k + 1) % n
            q = (rows[i][k], rows[i + 1][k], rows[i + 1][k1], rows[i][k1])
            uv = (uvpx(rect, k / n, vs[i], 1.5), uvpx(rect, k / n, vs[i + 1], 1.5),
                  uvpx(rect, (k + 1) / n, vs[i + 1], 1.5), uvpx(rect, (k + 1) / n, vs[i], 1.5))
            mb.f.append((tuple(reversed(q)), tuple(reversed(uv))))     # outward winding
    for k in range(n):
        k1 = (k + 1) % n
        mb.f.append(((rows[-1][k1], crown, rows[-1][k]),
                     (uvpx(rect, (k + 1) / n, vs[-1], 1.5), uvpx(rect, (k + 0.5) / n, 1.0, 1.5), uvpx(rect, k / n, vs[-1], 1.5))))
    _fix_winding_shell(mb, rows, B, ox)


def _fix_winding_shell(mb, rows, B, ox):
    pass  # head winding chosen explicitly above (checked in previews)


def head_shell(mb, B, rect, w_fn, mask, line_fn, top=1.0, inflate=0.01, rows=3, n=12, ox=0.0, infl_fn=None,
               theta_range=None, v_bottom_fn=None, flip=False, lift=0.0):
    """A shell over the scalp from line_fn(theta) (v of the lower edge) up to `top`."""
    closed = theta_range is None
    thetas = [TAU * k / n for k in range(n)] if closed else [theta_range[0] + (theta_range[1] - theta_range[0]) * k / n for k in range(n + 1)]
    R = []
    for r in range(rows + 1):
        t = r / rows
        row = []
        for th in thetas:
            v = line_fn(th) + (top - line_fn(th)) * t
            inf = infl_fn(th, t) if infl_fn else inflate
            p = head_point(B, th, min(v, 0.995), inf, ox)
            p.z += lift * t * t
            row.append(mb.add_v(p, w_fn(v), mask))
        R.append(row)
    cols = n if closed else n
    for r in range(rows):
        for k in range(cols):
            k1 = (k + 1) % n if closed else k + 1
            q = (R[r][k], R[r + 1][k], R[r + 1][k1], R[r][k1])
            uv = (uvpx(rect, k / n, 1 - r / rows), uvpx(rect, k / n, 1 - (r + 1) / rows),
                  uvpx(rect, (k + 1) / n, 1 - (r + 1) / rows), uvpx(rect, (k + 1) / n, 1 - r / rows))
            if not flip:      # built order winds inward: reverse for outward-facing shells
                q, uv = tuple(reversed(q)), tuple(reversed(uv))
            mb.f.append((q, uv))
    if closed and top >= 0.999:
        pass
    return R


# ======================================================================================== characters
# coat kinds: long, mid, short, puffer_long, puffer_short, parka, hoodie, peacoat
CHARACTERS = [
    dict(name="commuter", H=1.80, female=False, build=1.04, face="ben", hair="short", hair_cell="hair_brown",
         coat="long", coat_cell="wool", coat_mask="A", legs="charcoal", shoes="leather_black", scarf="plaid_red",
         gloves="leather_black", hat=None, props=["cup.R"], style=dict(swing=16, lean=4)),
    dict(name="puffer", H=1.68, female=True, build=1.0, face="priya", hair="long", hair_cell="hair_black",
         coat="puffer_long", coat_cell="puffer", coat_mask="A", legs="leggings", shoes="sneaker", scarf=None,
         gloves=None, hat="beanie_pom", hat_cell="knit", hat_mask="B", props=["tote.L"], style=dict(swing=18, lean=3)),
    dict(name="parka", H=1.84, female=False, build=1.08, face="marcus", hair="fade", hair_cell="hair_black",
         coat="parka", coat_cell="parka", coat_mask="A", legs="denim", shoes="boot_tan", boots=True, scarf=None,
         gloves=None, hat="beanie", hat_cell="knit", hat_mask="B", props=["backpack"], fur=True, style=dict(swing=20, lean=4)),
    dict(name="texter", H=1.64, female=True, build=0.98, face="mei", hair="bob", hair_cell="hair_black",
         coat="puffer_short", coat_cell="puffer", coat_mask="A", legs="denim", shoes="sneaker", scarf="stripe_scarf",
         gloves=None, hat=None, props=["phone.R"], style=dict(swing=12, lean=5, head_down=18)),
    dict(name="shopper", H=1.71, female=True, build=1.0, face="siobhan", hair="long", hair_cell="hair_red",
         coat="mid", coat_cell="camel", coat_mask=None, legs="leggings", shoes="leather_brown", boots=True, scarf=None,
         gloves=None, hat=None, props=["bag.L", "bag.R"], style=dict(swing=8, lean=3)),
    dict(name="courier", H=1.78, female=False, build=1.02, face="omar", hair="short", hair_cell="hair_black",
         coat="puffer_short", coat_cell="puffer", coat_mask="A", legs="sweats", shoes="sneaker", scarf=None,
         gloves="leather_black", hat="cap", hat_cell="nylon", hat_mask="B", props=["cube"], style=dict(swing=22, lean=7)),
    dict(name="gent", H=1.72, female=False, build=1.0, face="walter", hair="balding", hair_cell="hair_grey",
         coat="long", coat_cell="houndstooth", coat_mask="A", legs="charcoal", shoes="leather_black", scarf="plaid_green",
         gloves="leather_brown", hat="flatcap", hat_cell="wool", hat_mask="B", props=[], old=True, style=dict(swing=9, lean=9, hunch=10)),
    dict(name="nana", H=1.60, female=True, build=1.06, face="gloria", hair="short_curl", hair_cell="hair_grey",
         coat="mid", coat_cell="wool", coat_mask="A", legs="khaki", shoes="leather_brown", boots=True, scarf=None,
         gloves=None, hat="beanie", hat_cell="knit", hat_mask="B", props=["bag.R"], old=True, style=dict(swing=8, lean=7, hunch=8)),
    dict(name="student", H=1.66, female=True, build=0.97, face="nia", hair="braids", hair_cell="hair_black",
         coat="short", coat_cell="fleece", coat_mask="A", legs="denim", shoes="sneaker", scarf=None,
         gloves=None, hat=None, props=["backpack"], style=dict(swing=19, lean=3)),
    dict(name="banker", H=1.86, female=False, build=1.05, face="arjun", hair="short", hair_cell="hair_black",
         coat="peacoat", coat_cell="wool", coat_mask="A", legs="khaki", shoes="leather_brown", scarf="knit",
         scarf_mask="B", gloves=None, hat=None, props=["messenger"], style=dict(swing=17, lean=3)),
    dict(name="hoodie", H=1.76, female=False, build=1.0, face="kenji", hair="short", hair_cell="hair_black",
         coat="hoodie", coat_cell="fleece", coat_mask="A", legs="sweats", shoes="sneaker", scarf=None,
         gloves=None, hat="hood", props=[], style=dict(swing=14, lean=5, hands_pockets=True)),
    dict(name="parent_kid", H=1.70, female=True, build=1.0, face="rosa", hair="bun", hair_cell="hair_brown",
         coat="parka", coat_cell="parka", coat_mask="A", legs="denim", shoes="boot_tan", boots=True, scarf=None,
         gloves=None, hat=None, props=["hold.R"], fur=True, style=dict(swing=16, lean=3),
         kid=dict(H=1.12, female=False, face="leo", hair="short", hair_cell="hair_brown", coat="puffer_short", coat_cell="puffer",
                  coat_mask="B", legs="denim", shoes="sneaker", hat="beanie_pom", hat_cell="knit", hat_mask="B", ox=-0.40,
                  props=["hold.L"], style=dict(swing=14, lean=2))),
    dict(name="kid", H=1.22, female=True, kidbody=True, build=1.0, face="ava", hair="long", hair_cell="hair_blonde",
         coat="puffer_long", coat_cell="puffer", coat_mask="A", legs="leggings", shoes="boot_tan", boots=True, scarf=None,
         gloves=None, hat="beanie_pom", hat_cell="knit", hat_mask="B", props=["backpack"], style=dict(swing=22, lean=2)),
    dict(name="trench", H=1.72, female=True, build=0.98, face="siobhan", hair="long", hair_cell="hair_brown",
         coat="long", coat_cell="trench", coat_mask=None, legs="leggings", shoes="leather_black", boots=True, scarf="plaid_red",
         gloves="leather_black", hat=None, props=["tote.R"], style=dict(swing=15, lean=3)),
    dict(name="hivis", H=1.81, female=False, build=1.1, face="marcus", hair="short", hair_cell="hair_black",
         coat="short", coat_cell="hivis", coat_mask=None, legs="denim", shoes="boot_tan", boots=True, scarf=None,
         gloves="leather_brown", hat="hardhat", hat_cell="gear", hat_mask=None, props=[], style=dict(swing=17, lean=4)),
    dict(name="tourist", H=1.77, female=False, build=1.06, face="kenji", hair="short", hair_cell="hair_black",
         coat="short", coat_cell="windbreaker", coat_mask="A", legs="khaki", shoes="sneaker", scarf=None,
         gloves=None, hat="cap", hat_cell="nylon", hat_mask="B", props=["camera", "backpack"],
         style=dict(swing=13, lean=2, gawk=True)),
    dict(name="stroller", H=1.69, female=True, build=1.0, face="nia", hair="bun", hair_cell="hair_black",
         coat="puffer_long", coat_cell="puffer", coat_mask="A", legs="denim", shoes="sneaker", scarf="stripe_scarf",
         gloves=None, hat=None, props=["stroller"], style=dict(swing=0, lean=6)),
]

# vertex mask (COLOR_0): r = coat tint, g = accessory tint, b = hair tint, a = flag / 8
#   flags: 1 = face/skin region (per-instance face swap), 2 = optional hat, 3 = scarf (hue shift),
#          4 = second (child) face region
Z4 = (0, 0, 0, 0)
HAIRM = (0, 0, 1, 0)
MASKS = {None: (0, 0, 0, 0), "A": (1, 0, 0, 0), "B": (0, 1, 0, 0)}


def flagged(m, flag):
    return (m[0], m[1], m[2], flag / 8.0)


def build_person(mb, C, B, p="", ox=0.0):
    k = B["k"]
    w = B["w"]
    fem = B["female"]
    X = lambda x: x + ox
    coat = C["coat"]
    puffer = coat.startswith("puffer")
    fat = 0.022 * k if puffer else (0.012 * k if coat in ("parka",) else 0.0)
    cm = MASKS[C.get("coat_mask")]
    ccell = cell(C["coat_cell"])
    # ---------------- legs
    leg_r = 0.86 if C["legs"] == "leggings" else 1.0
    for side, sg in (("L", 1), ("R", -1)):
        hx = B["hipx"] * sg
        thigh = "%sthigh.%s" % (p, side)
        shin = "%sshin.%s" % (p, side)
        rings = []
        prof = [(B["hipj"] + 0.06 * k, 0.088, 0.0), (B["hipj"] - 0.12 * k, 0.078, 0.0), (B["knee"] + 0.06 * k, 0.062, -0.003),
                (B["knee"], 0.058, -0.012), (B["knee"] - 0.14 * k, 0.06, 0.0), (B["ankle"] + 0.07 * k, 0.047, 0.0),
                (B["ankle"] + 0.02 * k, 0.05 if C["legs"] != "leggings" else 0.042, 0.0)]
        if fem:
            prof[0] = (prof[0][0], 0.095, 0.0)
            prof[1] = (prof[1][0], 0.084, 0.0)
        for z, r, dy in prof:
            t = (B["hipj"] - z) / (B["hipj"] - B["ankle"])
            x = hx * (1 + 0.1 * t)
            rr = r * k * leg_r * (1.0 if not B["kid"] else 1.05)
            rings.append(dict(c=(X(x), dy * k + (-0.015 * k if 0.3 < t < 0.6 else 0), z), rx=rr * 0.98, ry=rr, ax=(0, 0, -1)))
        chain = chain_weights([((X(hx), 0, B["hipj"]), thigh), ((X(hx * 1.05), -0.015, B["knee"]), shin), ((X(hx * 1.1), 0, B["ankle"]), None)], blend=0.07 * k)
        top_w = lambda i, c, pt, ch=chain, th=thigh: ({th: 0.6, p + "hips": 0.4} if i == 0 else ch(i, c, pt))
        loft(mb, rings, 8, cell(C["legs"]), top_w, v0=1.0, v1=0.0)
        # shoe: loft heel -> toe, u=0 at the sole
        foot = "%sfoot.%s" % (p, side)
        fx = X(hx * 1.12)
        fl = B["foot"]
        hgt = 0.10 * k
        sw = 0.047 * k
        shoe = [(0.06 * fl, 0.25 * hgt, 0.45 * sw, 0.5 * hgt), (0.045 * fl / 0.25 * 0.25, 0.52 * hgt, 0.85 * sw, 0.52 * hgt),
                (-0.10 * fl / 0.25 * 0.25, 0.42 * hgt, 0.95 * sw, 0.42 * hgt), (-0.38 * fl, 0.33 * hgt, 1.0 * sw, 0.33 * hgt),
                (-0.60 * fl, 0.25 * hgt, 0.85 * sw, 0.25 * hgt), (-0.70 * fl, 0.17 * hgt, 0.55 * sw, 0.17 * hgt)]
        rings = [dict(c=(fx, y, z), rx=rx, ry=ry, ax=(0, -1, 0), ref=(0, 0, -1), sq=0.75) for y, z, rx, ry in shoe]
        if C.get("boots"):
            rings[1]["ry"] *= 1.05
        loft(mb, rings, 8, cell(C["shoes"]), rigid(foot), v0=0.0, v1=1.0, cap0=True, cap1=True)
        if C.get("boots"):
            bz0, bz1 = 0.05 * k, B["ankle"] + 0.16 * k
            loft(mb, [dict(c=(X(hx * 1.1), 0.005, bz0), rx=0.052 * k, ry=0.058 * k, ax=(0, 0, 1)),
                      dict(c=(X(hx * 1.1), 0.005, B["ankle"] + 0.04 * k), rx=0.05 * k, ry=0.052 * k, ax=(0, 0, 1)),
                      dict(c=(X(hx * 1.1), 0.0, bz1), rx=0.056 * k, ry=0.058 * k, ax=(0, 0, 1))],
                 8, cell(C["shoes"]), by_z([(B["ankle"] + 0.02 * k, {foot: 1.0}), (bz1, {shin: 1.0})]), v0=0.3, v1=0.7)
    # ---------------- pants top (hips)
    pc = cell(C["legs"])
    hipw = (0.17 if not fem else 0.18) * w
    loft(mb, [dict(c=(X(0), 0.0, B["crotch"]), rx=hipw * 0.92, ry=0.105 * k, ax=(0, 0, 1)),
              dict(c=(X(0), 0.005, B["pelvis"]), rx=hipw, ry=0.115 * k, ax=(0, 0, 1)),
              dict(c=(X(0), 0.0, B["waist"] + 0.02 * k), rx=hipw * 0.9, ry=0.105 * k, ax=(0, 0, 1))],
         10, pc, lambda i, c, pt: {p + "hips": 1.0} if pt.z > B["crotch"] + 0.04 * k else
         ({p + "hips": 0.6, p + "thigh.L": 0.4} if pt.x - ox > 0.02 else ({p + "hips": 0.6, p + "thigh.R": 0.4} if pt.x - ox < -0.02 else {p + "hips": 1.0})),
         v0=0.3, v1=1.0, cap0=True)
    # ---------------- torso / coat
    hem = {"long": B["knee"] - 0.02 * k, "mid": B["knee"] + 0.17 * k, "short": B["crotch"] + 0.02 * k,
           "puffer_long": B["knee"] - 0.04 * k, "puffer_short": B["crotch"] + 0.03 * k, "parka": B["crotch"] - 0.08 * k,
           "hoodie": B["crotch"] + 0.06 * k, "peacoat": B["crotch"] - 0.04 * k}[coat]
    chw = (0.172 if not fem else 0.162) * w
    sh = B["shx"] + 0.02 * k
    prof = []   # z, rx, ry, dy
    flare = {"long": 1.18, "mid": 1.1, "puffer_long": 1.12, "parka": 1.05}.get(coat, 1.0)
    if hem < B["crotch"] - 0.02 * k:
        prof.append((hem, hipw * flare + fat, 0.15 * k * (flare ** 0.5) + fat, 0.01))
        if hem < B["knee"] + 0.25 * k:
            mz = (hem + B["pelvis"]) / 2
            prof.append((mz, hipw * (1 + (flare - 1) * 0.5) + fat, 0.135 * k + fat, 0.008))
    else:
        prof.append((hem, hipw * 1.0 + fat, 0.125 * k + fat, 0.005))
    prof += [(B["pelvis"] + 0.02 * k, hipw * 1.02 + fat, 0.125 * k + fat, 0.005),
             (B["waist"], (0.155 if not fem else 0.142) * w + fat, 0.118 * k + fat, -0.002),
             ((B["waist"] + B["chest"]) / 2, chw * 0.98 + fat, 0.125 * k + fat, -0.006),
             (B["chest"], chw + fat, 0.132 * k + fat, -0.01),
             (B["armpit"], sh * 0.92 + fat, 0.125 * k + fat, -0.004),
             (B["shoulder"] - 0.005 * k, sh * 0.98 + fat, 0.105 * k + fat, 0.004),
             (B["shoulder"] + 0.035 * k, sh * 0.62 + fat * 0.6, 0.088 * k + fat * 0.6, 0.008),
             (B["neck"] + 0.005 * k, 0.068 * k + fat * 0.5, 0.066 * k + fat * 0.5, 0.012),
             (B["neck"] + 0.045 * k, 0.07 * k + fat * 0.4, 0.068 * k + fat * 0.4, 0.016),
             (B["neck"] + 0.035 * k, 0.056 * k, 0.056 * k, 0.018)]
    if coat == "hoodie":
        prof[-2] = (B["neck"] + 0.03 * k, 0.085 * k, 0.08 * k, 0.03)
    rings = []
    nb = len(prof)
    for i, (z, rx, ry, dy) in enumerate(prof):
        R = dict(c=(X(0), dy * k, z), rx=rx, ry=ry, ax=(0, 0, 1), sq=0.92 if z > B["waist"] else 1.0)
        if puffer and B["pelvis"] < z < B["shoulder"]:
            R["rx"] += 0.01 * k
            R["ry"] += 0.008 * k
        if fem and abs(z - B["chest"]) < 0.01:
            R["off"] = (lambda th, k=k: Vector((0, -0.018 * k * max(0.0, -math.cos(th)) ** 3, 0)))
        rings.append(R)
    # puffer quilting: thin seam rings between bands
    if puffer:
        out = []
        for a, b in zip(rings, rings[1:]):
            out.append(a)
            za, zb = a["c"][2], b["c"][2]
            if B["pelvis"] - 0.1 < za < B["armpit"] and zb - za > 0.08 * k:
                m = dict(a)
                m["c"] = (a["c"][0], (a["c"][1] + b["c"][1]) / 2, (za + zb) / 2)
                m["rx"] = (a["rx"] + b["rx"]) / 2 - 0.012 * k
                m["ry"] = (a["ry"] + b["ry"]) / 2 - 0.012 * k
                m.pop("off", None)
                out.append(m)
        out.append(rings[-1])
        rings = out

    def torso_w(i, c, pt, rings=rings):
        z = pt.z
        sp, hp, ch, nk = p + "spine", p + "hips", p + "chest", p + "neck"
        if z > B["neck"] + 0.02 * k:
            return {nk: 0.6, ch: 0.4}
        if z > B["shoulder"] - 0.03 * k:
            sd = "L" if pt.x - ox > 0 else "R"
            f = max(0.0, min(1.0, (abs(pt.x - ox) - 0.10 * k) / (0.1 * k)))
            return {ch: 1.0 - 0.5 * f, p + "shoulder." + sd: 0.5 * f}
        if z > B["chest"]:
            return {ch: 1.0}
        if z > B["waist"]:
            t = (z - B["waist"]) / (B["chest"] - B["waist"])
            return {ch: t, sp: 1 - t}
        if z > B["pelvis"]:
            t = (z - B["pelvis"]) / (B["waist"] - B["pelvis"])
            return {sp: t, hp: 1 - t}
        # coat skirt: follows the thighs a little, more toward the hem
        t = min(1.0, (B["pelvis"] - z) / max(0.05, B["pelvis"] - B["knee"]))
        lr = (pt.x - ox) / max(0.01, hipw)
        sd = p + ("thigh.L" if lr > 0 else "thigh.R")
        g = min(1.0, abs(lr) * 1.3) * 0.55 * t
        return {hp: 1.0 - g, sd: g}
    loft(mb, rings, 12, ccell, torso_w, mask=cm, v0=0.0, v1=1.0)
    if C.get("fur"):
        zf = B["neck"] + 0.03 * k
        ring = []
        loft(mb, [dict(c=(X(0), 0.016 * k, zf - 0.035 * k), rx=0.085 * k, ry=0.083 * k, ax=(0, 0, 1)),
                  dict(c=(X(0), 0.02 * k, zf), rx=0.112 * k, ry=0.108 * k, ax=(0, 0, 1)),
                  dict(c=(X(0), 0.025 * k, zf + 0.04 * k), rx=0.085 * k, ry=0.083 * k, ax=(0, 0, 1))],
             10, cell("fur"), lambda i, c, pt: {p + "neck": 0.3, p + "chest": 0.7}, v0=0, v1=1)
    # ---------------- arms + hands
    hands_pockets = C.get("style", {}).get("hands_pockets")
    for side, sg in (("L", 1), ("R", -1)):
        sx = B["shx"] * sg
        ex, wx, hxx = sx + 0.025 * sg * k, sx + 0.04 * sg * k, sx + 0.045 * sg * k
        ua, fa, hd = "%supperarm.%s" % (p, side), "%sforearm.%s" % (p, side), "%shand.%s" % (p, side)
        sho = Vector((X(sx * 0.82), 0.01, B["shoulder"] - 0.01 * k))
        elb = Vector((X(ex), 0.025, B["elbow"]))
        wri = Vector((X(wx), 0.0, B["wrist"]))
        r_up = (0.056 if not B["kid"] else 0.05) * k + fat * 0.9
        r_lo = 0.046 * k + fat * 0.7
        cuff = 0.045 * k + fat * 0.5
        rings = [dict(c=sho + Vector((0, 0, 0.0)), rx=r_up * 1.15, ry=r_up * 1.2),
                 dict(c=sho.lerp(elb, 0.3), rx=r_up, ry=r_up * 1.05),
                 dict(c=sho.lerp(elb, 0.75), rx=r_up * 0.93, ry=r_up * 0.95),
                 dict(c=elb, rx=r_lo * 1.02, ry=r_lo * 1.05),
                 dict(c=elb.lerp(wri, 0.5), rx=r_lo * 0.95, ry=r_lo * 0.98),
                 dict(c=wri + (wri - elb).normalized() * 0.01 * k, rx=cuff, ry=cuff * 1.05),
                 dict(c=wri + (wri - elb).normalized() * 0.012 * k, rx=cuff * 0.55, ry=cuff * 0.55)]
        if puffer:
            mid1 = dict(c=sho.lerp(elb, 0.52), rx=r_up * 0.86, ry=r_up * 0.88)
            mid2 = dict(c=elb.lerp(wri, 0.25), rx=r_lo * 0.86, ry=r_lo * 0.88)
            rings = rings[:2] + [mid1] + rings[2:4] + [mid2] + rings[4:]
        for R in rings:
            R["ax"] = (wri - sho)
        chain = chain_weights([(sho, ua), (elb, fa), (wri, hd), (wri + (wri - elb).normalized() * 0.2, None)], blend=0.06 * k)
        sh_w = lambda i, c, pt, ch=chain, ua=ua, side=side: ({ua: 0.55, p + "shoulder." + side: 0.45} if i == 0 else ch(i, c, pt))
        # sleeves use a plain strip of the coat cell (no buttons / pockets / plackets)
        sleeve = (ccell[0] + 2, ccell[1], 12, ccell[3])
        loft(mb, rings, 8, sleeve, sh_w, mask=cm, v0=1.0, v1=0.0, inset=1)
        # hand (mitten + thumb), skin or gloves
        hrect = cell(C["gloves"]) if C.get("gloves") else skin_rect(C["face"])
        hmask = Z4 if C.get("gloves") else flagged(Z4, 4 if p == "k_" else 1)
        d = (wri - elb).normalized()
        hl = (B["wrist"] - B["hand"]) * 1.0
        hc = [(0.00, 0.022, 0.026), (0.30, 0.020, 0.040), (0.62, 0.018, 0.042), (0.90, 0.013, 0.032)]
        rings = [dict(c=wri + d * (t * hl), rx=a * k * 1.05, ry=b * k * 1.05, ax=d, ref=(0, 1, 0)) for t, a, b in hc]
        loft(mb, rings, 6, hrect, lambda i, c, pt, hd=hd, fa=fa: {hd: 1.0} if i > 0 else {hd: 0.7, fa: 0.3},
             mask=hmask, v0=0.0, v1=1.0, cap1=d * 0.012 * k, inset=1)
        tb = wri + d * (0.3 * hl) + Vector((0, -0.028 * k, 0))
        loft(mb, [dict(c=tb, rx=0.011 * k, ry=0.011 * k, ax=d + Vector((0, -0.7, 0))),
                  dict(c=tb + (d * 0.5 + Vector((0, -0.6, 0))).normalized() * 0.045 * k, rx=0.009 * k, ry=0.009 * k, ax=d + Vector((0, -0.7, 0)))],
             5, hrect, rigid(hd), mask=hmask, v0=0.0, v1=1.0, cap1=True, inset=1)
    # ---------------- head + hair + hat
    neck_w = lambda v: ({p + "neck": 0.5, p + "chest": 0.5} if v < 0.05 else ({p + "neck": 1.0} if v < 0.2 else {p + "head": 1.0}))
    face_flag = 4 if p == "k_" else 1
    add_head(mb, B, C["face"], neck_w, ox, fmask=flagged(Z4, face_flag))
    hw = lambda v: {p + "head": 1.0}
    hrect = cell("hairlight")
    hair = C.get("hair")
    hat = C.get("hat")
    HL = {"short": (0.40, 0.62, 0.83), "long": (0.34, 0.6, 0.86), "bob": (0.34, 0.6, 0.85), "braids": (0.34, 0.6, 0.86),
          "bun": (0.40, 0.6, 0.84), "short_curl": (0.42, 0.62, 0.82), "fade": (0.45, 0.68, 0.84), "balding": (0.4, 0.6, 0.9)}

    def hairline(th, hs=HL.get(hair, (0.4, 0.6, 0.83))):
        b, s, f = hs
        c = math.cos(th)            # 1 back, -1 front
        if c >= 0:
            return s + (b - s) * c
        return s + (f - s) * (-c) ** 1.4
    covered = hat in ("beanie", "beanie_pom", "hood", "flatcap")
    if hair in ("short", "long", "bob", "braids", "bun", "short_curl"):
        curl = hair == "short_curl"
        head_shell(mb, B, hrect, hw, HAIRM, hairline, rows=3, n=12, ox=ox,
                   infl_fn=lambda th, t, curl=curl: (0.005 + 0.012 * t + (0.006 * (0.5 + 0.5 * math.sin(th * 5 + t * 7)) if curl else 0.0)) * k)
    if hair in ("long", "braids", "bob"):
        # curtain of hair down the back
        lo = {"long": -0.55, "braids": -0.7, "bob": 0.18}[hair]
        n = 8
        tr = (-2.0, 2.0)
        rows = []
        vs = [0.62, 0.40, 0.15, -0.1, -0.35, lo] if hair != "bob" else [0.62, 0.42, 0.25, lo]
        vs = [v for v in vs if v >= lo]
        if vs[-1] != lo:
            vs.append(lo)
        span = B["crown"] - B["neck"]
        for v in vs:
            row = []
            for j in range(n + 1):
                th = tr[0] + (tr[1] - tr[0]) * j / n
                vv = max(v, 0.0)
                pnt = head_point(B, th, vv, (0.014 + 0.02 * max(0.0, 0.3 - v)) * k, ox)
                if v < 0:
                    pnt.z = B["neck"] + span * v
                    pnt.y += (-v) * 0.12 * k
                    pnt.x = ox + (pnt.x - ox) * (1 + (-v) * 0.6)
                wv = {p + "head": 1.0} if v > 0.1 else ({p + "head": 0.5, p + "neck": 0.5} if v > -0.2 else {p + "chest": 0.7, p + "neck": 0.3})
                row.append(mb.add_v(pnt, wv, HAIRM))
            rows.append(row)
        for i in range(len(vs) - 1):
            for j in range(n):
                q = (rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j])
                uv = (uvpx(hrect, j / n, 1 - i / len(vs)), uvpx(hrect, (j + 1) / n, 1 - i / len(vs)),
                      uvpx(hrect, (j + 1) / n, 1 - (i + 1) / len(vs)), uvpx(hrect, j / n, 1 - (i + 1) / len(vs)))
                mb.f.append((q, uv))
                mb.f.append((tuple(reversed(q)), tuple(reversed(uv))))   # two-sided
    if hair == "bun":
        c = head_point(B, 0.5, 0.86, 0.035 * k, ox)
        sphere(mb, c, 0.045 * k, hrect, hw, HAIRM, n=8, rings=5)
    if hat in ("beanie", "beanie_pom"):
        hm = flagged(MASKS[C.get("hat_mask")], 2)
        hc = cell(C["hat_cell"])
        line = lambda th: 0.62 if math.cos(th) > 0 else 0.62 + 0.14 * (-math.cos(th)) ** 1.5
        head_shell(mb, B, hc, hw, hm, line, rows=4, n=12, ox=ox, lift=0.03 * k,
                   infl_fn=lambda th, t: (0.02 + 0.012 * math.sin(t * math.pi)) * k)
        if hat == "beanie_pom":
            top = head_point(B, 0, 1.0, 0.0, ox) + Vector((0, 0.01 * k, 0.07 * k))
            sphere(mb, top, 0.04 * k, hc, hw, hm, n=8, rings=5)
    elif hat == "cap":
        hm = flagged(MASKS[C.get("hat_mask")], 2)
        hc = cell(C["hat_cell"])
        line = lambda th: 0.66 if math.cos(th) > 0 else 0.66 + 0.12 * (-math.cos(th)) ** 1.5
        head_shell(mb, B, hc, hw, hm, line, rows=3, n=12, ox=ox, infl_fn=lambda th, t: (0.021 + 0.004 * t) * k)
        # brim
        n = 6
        th0, th1 = math.pi - 1.0, math.pi + 1.0
        inner, outer = [], []
        for j in range(n + 1):
            th = th0 + (th1 - th0) * j / n
            a = head_point(B, th, 0.78, 0.021 * k, ox)
            dirv = Vector((a.x - ox, a.y - 0.01, 0)).normalized()
            b = a + dirv * 0.075 * k * (math.sin((j / n) * math.pi) ** 0.5) + Vector((0, 0, -0.012 * k))
            inner.append(mb.add_v(a, {p + "head": 1.0}, hm))
            outer.append(mb.add_v(b, {p + "head": 1.0}, hm))
        for j in range(n):
            q = (inner[j], inner[j + 1], outer[j + 1], outer[j])
            uv = (uvpx(hc, j / n, 0.3), uvpx(hc, (j + 1) / n, 0.3), uvpx(hc, (j + 1) / n, 0.0), uvpx(hc, j / n, 0.0))
            mb.f.append((q, uv))
            mb.f.append((tuple(reversed(q)), tuple(reversed(uv))))
    elif hat == "flatcap":
        hm = flagged(MASKS[C.get("hat_mask")], 2)
        hc = cell(C["hat_cell"])
        line = lambda th: 0.66 if math.cos(th) > 0 else 0.66 + 0.10 * (-math.cos(th)) ** 1.5

        def infl(th, t):
            fr = max(0.0, -math.cos(th))
            return (0.022 + 0.02 * t * fr + 0.008 * t) * k
        head_shell(mb, B, hc, hw, hm, line, rows=3, n=12, ox=ox, infl_fn=infl, top=0.97)
        n = 6
        th0, th1 = math.pi - 0.9, math.pi + 0.9
        inner, outer = [], []
        for j in range(n + 1):
            th = th0 + (th1 - th0) * j / n
            a = head_point(B, th, 0.76, 0.022 * k, ox)
            dirv = Vector((a.x - ox, a.y - 0.01, 0)).normalized()
            b = a + dirv * 0.05 * k * (math.sin((j / n) * math.pi) ** 0.5) + Vector((0, 0, -0.008 * k))
            inner.append(mb.add_v(a, {p + "head": 1.0}, hm))
            outer.append(mb.add_v(b, {p + "head": 1.0}, hm))
        for j in range(n):
            q = (inner[j], inner[j + 1], outer[j + 1], outer[j])
            uv = (uvpx(hc, j / n, 0.3), uvpx(hc, (j + 1) / n, 0.3), uvpx(hc, (j + 1) / n, 0.0), uvpx(hc, j / n, 0.0))
            mb.f.append((q, uv))
            mb.f.append((tuple(reversed(q)), tuple(reversed(uv))))
    elif hat == "hardhat":
        hm = flagged(Z4, 2)
        gx, gy, _, _ = cell("gear")
        hc = (gx, gy + 64, 64, 64)
        line = lambda th: 0.70
        head_shell(mb, B, hc, hw, hm, line, rows=3, n=12, ox=ox, lift=0.025 * k,
                   infl_fn=lambda th, t: (0.03 + 0.006 * math.sin(t * math.pi)) * k)
        n = 12
        inner, outer = [], []
        for j in range(n):
            th = TAU * j / n
            a = head_point(B, th, 0.70, 0.03 * k, ox)
            dirv = Vector((a.x - ox, a.y - 0.012, 0)).normalized()
            ext = (0.05 if math.cos(th) < -0.5 else 0.025) * k
            b = a + dirv * ext + Vector((0, 0, -0.008 * k))
            inner.append(mb.add_v(a, {p + "head": 1.0}, hm))
            outer.append(mb.add_v(b, {p + "head": 1.0}, hm))
        for j in range(n):
            j1 = (j + 1) % n
            q = (inner[j], inner[j1], outer[j1], outer[j])
            uv = (uvpx(hc, 0.2, 0.4), uvpx(hc, 0.8, 0.4), uvpx(hc, 0.8, 0.3), uvpx(hc, 0.2, 0.3))
            mb.f.append((q, uv))
            mb.f.append((tuple(reversed(q)), tuple(reversed(uv))))
    elif hat == "hood":
        # hood up: an open shell around the back/top of the head, open at the face
        n = 10
        tr = (-2.35, 2.35)
        line = lambda th: 0.12
        R = head_shell(mb, B, ccell, lambda v: {p + "head": 1.0} if v > 0.4 else {p + "head": 0.6, p + "neck": 0.4}, cm, line,
                       rows=4, n=n, ox=ox, theta_range=tr, infl_fn=lambda th, t: (0.03 + 0.012 * math.sin(t * math.pi)) * k, top=0.999)
        # make it two-sided at the face opening by duplicating faces reversed
        cnt = len(mb.f)
        for q, uv in mb.f[cnt - 4 * n:]:
            mb.f.append((tuple(reversed(q)), tuple(reversed(uv))))
    # ---------------- scarf
    if C.get("scarf"):
        sm = flagged(MASKS[C.get("scarf_mask")], 3)
        sc = cell(C["scarf"])
        zc = B["neck"] + 0.03 * k
        n = 10
        rings = []
        for j in range(n + 1):
            a = TAU * j / n
            c = Vector((X(math.sin(a) * 0.072 * k), 0.012 * k + math.cos(a) * 0.07 * k, zc + (0.012 * k if math.cos(a) < 0 else 0.0)))
            t = Vector((math.cos(a), -math.sin(a), 0))
            rings.append(dict(c=c, ax=t, ref=(0, 0, 1), rx=0.026 * k, ry=0.034 * k))
        loft(mb, rings[:-1] + [rings[0]], 6, sc, lambda i, c, pt: {p + "neck": 0.4, p + "chest": 0.6}, mask=sm, v0=0, v1=1)
        # hanging tail at front-left
        x0 = X(0.035 * k)
        tail = [dict(c=(x0, -0.075 * k, zc - 0.02 * k), rx=0.045 * k, ry=0.012 * k, ax=(0, 0, -1), ref=(0, 1, 0)),
                dict(c=(x0 + 0.004, -0.115 * k - fat, B["chest"]), rx=0.045 * k, ry=0.01 * k, ax=(0, 0, -1), ref=(0, 1, 0)),
                dict(c=(x0 + 0.008, -0.12 * k - fat, B["chest"] - 0.12 * k), rx=0.044 * k, ry=0.01 * k, ax=(0, 0, -1), ref=(0, 1, 0))]
        loft(mb, tail, 4, sc, lambda i, c, pt: {p + "chest": 1.0}, mask=sm, v0=1, v1=0, cap1=True)
    # ---------------- props
    for pr in C.get("props", []):
        add_prop(mb, pr, C, B, p, ox, fat)


def sphere(mb, c, r, rect, w_fn, mask, n=8, rings=5, scale=(1, 1, 1)):
    R = []
    for i in range(1, rings):
        a = math.pi * i / rings
        z = -math.cos(a)
        rr = math.sin(a)
        R.append(dict(c=(c.x, c.y, c.z + z * r * scale[2]), rx=rr * r * scale[0], ry=rr * r * scale[1], ax=(0, 0, 1)))
    loft(mb, R, n, rect, lambda i, cc, pt: w_fn(1.0), mask=mask, v0=0.1, v1=0.9,
         cap0=(0, 0, -(r * scale[2] - (c.z - R[0]["c"][2]) * 0) * 0.0 - (R[0]["c"][2] - (c.z - r * scale[2]))),
         cap1=(0, 0, (c.z + r * scale[2]) - R[-1]["c"][2]))


def box(mb, center, size, rect, w_fn, mask, ref=(0, 1, 0), segs=8, sqv=0.35, axis=(0, 0, 1), rings_n=3, taper=1.0):
    cx, cy, cz = center
    sx, sy, sz = size
    a = Vector(axis).normalized()
    rings = []
    for i in range(rings_n):
        t = i / (rings_n - 1)
        c = Vector(center) + a * (sz * (t - 0.5))
        f = 1.0 + (taper - 1.0) * t
        rings.append(dict(c=c, rx=sx / 2 * f, ry=sy / 2 * f, ax=a, ref=ref, sq=sqv))
    loft(mb, rings, segs, rect, w_fn, mask=mask, v0=0.0, v1=1.0, cap0=True, cap1=True)


def add_prop(mb, pr, C, B, p, ox, fat):
    k = B["k"]
    X = lambda x: x + ox
    name, _, side = pr.partition(".")
    sg = 1 if side == "L" else -1
    if name == "backpack":
        rect = cell("nylon")
        z0, z1 = B["waist"] - 0.02 * k, B["shoulder"] - 0.02 * k
        yb = 0.125 * k + fat + 0.06 * k
        box(mb, (X(0), yb, (z0 + z1) / 2), (0.27 * B["w"], 0.12 * k, z1 - z0), rect,
            lambda i, c, pt: {p + "chest": 0.8, p + "spine": 0.2}, MASKS["B"], ref=(0, -1, 0), segs=8, sqv=0.4, taper=0.95)
        for s in (1, -1):   # straps over the shoulders
            x = X(0.075 * s * k)
            loft(mb, [dict(c=(x, yb - 0.04 * k, z1 - 0.01), rx=0.02 * k, ry=0.006, ax=(0, -1, 0.3), ref=(0, 0, 1)),
                      dict(c=(x * 1.0 + 0.01 * s * k, 0.0, B["shoulder"] + 0.035 * k + fat * 0.6), rx=0.022 * k, ry=0.006, ax=(0, -1, 0), ref=(0, 0, 1)),
                      dict(c=(x + 0.02 * s * k, -0.13 * k - fat, B["chest"] + 0.04 * k), rx=0.02 * k, ry=0.006, ax=(0, 0, -1), ref=(0, 1, 0)),
                      dict(c=(x + 0.03 * s * k, -0.12 * k - fat, B["waist"]), rx=0.018 * k, ry=0.006, ax=(0, 0, -1), ref=(0, 1, 0))],
                 4, cell("leather_black"), lambda i, c, pt: {p + "chest": 1.0}, v0=0, v1=1)
    elif name == "cube":
        rect = cell("courier")
        z0, z1 = B["waist"] - 0.06 * k, B["shoulder"] + 0.06 * k
        yb = 0.125 * k + fat + 0.2 * k
        box(mb, (X(0), yb, (z0 + z1) / 2), (0.40 * k, 0.36 * k, z1 - z0), rect,
            lambda i, c, pt: {p + "chest": 0.85, p + "spine": 0.15}, Z4, ref=(0, -1, 0), segs=4, sqv=0.15)
        for s in (1, -1):
            x = X(0.08 * s * k)
            loft(mb, [dict(c=(x, yb - 0.17 * k, z1 - 0.12 * k), rx=0.02 * k, ry=0.006, ax=(0, -1, 0.3), ref=(0, 0, 1)),
                      dict(c=(x + 0.01 * s * k, 0.0, B["shoulder"] + 0.035 * k + fat * 0.6), rx=0.022 * k, ry=0.006, ax=(0, -1, 0), ref=(0, 0, 1)),
                      dict(c=(x + 0.02 * s * k, -0.13 * k - fat, B["chest"] + 0.04 * k), rx=0.02 * k, ry=0.006, ax=(0, 0, -1), ref=(0, 1, 0)),
                      dict(c=(x + 0.03 * s * k, -0.12 * k - fat, B["waist"]), rx=0.018 * k, ry=0.006, ax=(0, 0, -1), ref=(0, 1, 0))],
                 4, cell("leather_black"), lambda i, c, pt: {p + "chest": 1.0}, v0=0, v1=1)
    elif name == "tote":
        rect = cell("tote")
        x = X(sg * (B["shx"] + 0.05 * k + fat))
        zt = B["waist"] - 0.02 * k
        box(mb, (x, 0.02, zt - 0.17 * k), (0.07 * k, 0.32 * k, 0.34 * k), rect,
            lambda i, c, pt: {p + "spine": 0.6, p + "hips": 0.4}, Z4, ref=(sg, 0, 0), segs=8, sqv=0.3)
        for dy in (-0.09 * k, 0.09 * k):
            loft(mb, [dict(c=(x, 0.02 + dy, zt), rx=0.012 * k, ry=0.004, ax=(0, 0, 1)),
                      dict(c=(X(sg * (B["shx"] - 0.02 * k)), 0.02 + dy * 0.4, B["shoulder"] + 0.045 * k + fat), rx=0.014 * k, ry=0.004, ax=(-sg, 0, 1))],
                 4, rect, lambda i, c, pt: {p + "chest": 1.0} if i else {p + "spine": 0.6, p + "chest": 0.4}, v0=0.95, v1=0.98)
    elif name == "bag":
        rect = cell("paperbag")
        hd = p + "hand." + side
        wx = (B["shx"] + 0.045 * k) * sg
        hz = B["hand"] + 0.03 * k
        box(mb, (X(wx + 0.01 * sg), 0.0, hz - 0.20 * k), (0.11 * k, 0.30 * k, 0.32 * k), rect, rigid(hd), Z4,
            ref=(sg, 0, 0), segs=8, sqv=0.2)
        loft(mb, [dict(c=(X(wx + 0.01 * sg), -0.05 * k, hz - 0.04 * k), rx=0.006, ry=0.006, ax=(0, 0, 1)),
                  dict(c=(X(wx), 0.0, hz + 0.02 * k), rx=0.007, ry=0.007, ax=(0, 1, 0)),
                  dict(c=(X(wx + 0.01 * sg), 0.05 * k, hz - 0.04 * k), rx=0.006, ry=0.006, ax=(0, 0, -1))],
             4, cell("paperbag"), rigid(hd), v0=0.95, v1=0.99)
    elif name == "phone":
        hd = p + "hand." + side
        wx = (B["shx"] + 0.045 * sg * k) * 1
        c = (X(sg * (B["shx"] + 0.04 * k)), -0.025 * k, B["wrist"] - 0.07 * k)
        box(mb, c, (0.012, 0.075 * k, 0.15 * k), cell("phone"), rigid(hd), Z4, ref=(-sg, 0, 0), segs=4, sqv=0.15, rings_n=2)
    elif name == "cup":
        hd = p + "hand." + side
        c = (X(sg * (B["shx"] + 0.045 * k)), -0.04 * k, B["wrist"] - 0.08 * k)
        box(mb, c, (0.075 * k, 0.075 * k, 0.14 * k), cell("cup"), rigid(hd), Z4, ref=(0, 1, 0), segs=8, sqv=1.0, rings_n=3, taper=1.18)
    elif name == "messenger":
        rect = cell("leather_brown")
        x = X(-(B["shx"] + 0.02 * k))
        zt = B["pelvis"] + 0.06 * k
        box(mb, (x, -0.03, zt - 0.1 * k), (0.08 * k, 0.34 * k, 0.24 * k), rect,
            lambda i, c, pt: {p + "hips": 0.7, p + "spine": 0.3}, Z4, ref=(-1, 0, 0), segs=8, sqv=0.3)
        # strap across the chest from the left shoulder
        pts = [Vector((x, -0.06 * k, zt)), Vector((X(-0.05 * k), -0.14 * k - fat, B["waist"] + 0.05 * k)),
               Vector((X(0.11 * k), -0.11 * k - fat, B["chest"] + 0.08 * k)), Vector((X(0.15 * k), 0.0, B["shoulder"] + 0.04 * k)),
               Vector((X(0.08 * k), 0.13 * k, B["chest"] + 0.06 * k)), Vector((X(-0.10 * k), 0.13 * k, B["waist"] + 0.04 * k)),
               Vector((x, 0.0, zt))]
        rings = [dict(c=q, rx=0.02 * k, ry=0.004, ref=(0, 0, 1)) for q in pts]
        loft(mb, rings, 4, rect, lambda i, c, pt: {p + "chest": 1.0} if 1 < i < 5 else {p + "spine": 0.5, p + "chest": 0.5}, v0=0.95, v1=0.98)
    elif name == "camera":
        gx, gy, _, _ = cell("gear")
        body_r, lens_r = (gx, gy, 64, 64), (gx + 64, gy, 64, 64)
        cz = B["chest"] + 0.01 * k
        cy = -0.135 * k - fat - 0.035 * k
        box(mb, (X(0.02 * k), cy, cz), (0.13 * k, 0.07 * k, 0.085 * k), body_r, rigid(p + "chest"), Z4, ref=(0, 1, 0),
            segs=4, sqv=0.2, rings_n=2)
        loft(mb, [dict(c=(X(0.03 * k), cy - 0.03 * k, cz), rx=0.03 * k, ry=0.03 * k, ax=(0, -1, 0), ref=(0, 0, 1)),
                  dict(c=(X(0.03 * k), cy - 0.08 * k, cz), rx=0.028 * k, ry=0.028 * k, ax=(0, -1, 0), ref=(0, 0, 1))],
             8, lens_r, rigid(p + "chest"), v0=0.0, v1=0.5, cap1=True, cap_uv=(0.5, 0.5))
        for s in (1, -1):   # neck strap
            loft(mb, [dict(c=(X(0.02 * k + s * 0.06 * k), cy + 0.01, cz + 0.03 * k), rx=0.008 * k, ry=0.003, ax=(0, 0, 1)),
                      dict(c=(X(s * 0.07 * k), -0.09 * k - fat, B["neck"] + 0.01 * k), rx=0.008 * k, ry=0.003, ax=(0, 0.4, 1)),
                      dict(c=(X(s * 0.06 * k), 0.06 * k, B["neck"] + 0.05 * k), rx=0.008 * k, ry=0.003, ax=(0, 1, 0))],
                 3, body_r, rigid(p + "chest"), v0=0.1, v1=0.2)
    elif name == "stroller":
        # pushed at arm's length; rigid on its own bone so it glides without the walker's bob
        sc = cell("stroller")
        gx, gy, _, _ = cell("gear")
        rub = (gx + 64, gy + 64, 64, 64)
        mt = cell("metal")
        cart = p + "cart"
        hy, hz = -0.44 * k, 0.95 * k          # handlebar
        y0, y1 = -0.62 * k, -1.18 * k         # basket back/front
        zb = 0.42 * k
        box(mb, (X(0), (y0 + y1) / 2, zb + 0.14 * k), (0.42 * k, (y0 - y1), 0.30 * k), sc, rigid(cart), Z4,
            ref=(0, 1, 0), segs=8, sqv=0.35, axis=(0, 0, 1), rings_n=3, taper=1.08)
        # canopy: half shell over the back of the seat
        n = 6
        rows = []
        for i, a in enumerate((0.0, 0.5, 1.0, 1.4)):
            row = []
            for j in range(n + 1):
                th = math.pi * j / n
                r = 0.23 * k
                c = Vector((X(-math.cos(th) * r), y0 - 0.02 * k - math.sin(a) * 0.18 * k * 0.9,
                            zb + 0.29 * k + math.sin(th) * 0.24 * k * math.cos(a * 0.5)))
                row.append(mb.add_v(c, {cart: 1.0}, Z4))
            rows.append(row)
        for i in range(len(rows) - 1):
            for j in range(n):
                q = (rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j])
                uv = (uvpx(sc, j / n, 1 - i / 3), uvpx(sc, (j + 1) / n, 1 - i / 3), uvpx(sc, (j + 1) / n, 1 - (i + 1) / 3),
                      uvpx(sc, j / n, 1 - (i + 1) / 3))
                mb.f.append((q, uv))
                mb.f.append((tuple(reversed(q)), tuple(reversed(uv))))
        for s in (1, -1):
            x = X(0.2 * k * s)
            loft(mb, [dict(c=(x, hy, hz), rx=0.012, ry=0.012), dict(c=(x, y0 + 0.02 * k, zb + 0.12 * k), rx=0.012, ry=0.012),
                      dict(c=(x, y0 + 0.06 * k, 0.07 * k), rx=0.011, ry=0.011)], 4, mt, rigid(cart), v0=0.1, v1=0.9)
            loft(mb, [dict(c=(x, y1 + 0.06 * k, zb + 0.05 * k), rx=0.011, ry=0.011), dict(c=(x, y1 - 0.02 * k, 0.07 * k), rx=0.011, ry=0.011)],
                 4, mt, rigid(cart), v0=0.1, v1=0.9)
            for wy in (y0 + 0.06 * k, y1 - 0.02 * k):     # wheels
                box(mb, (x, wy, 0.07 * k), (0.035 * k, 0.13 * k, 0.13 * k), rub, rigid(cart), Z4, ref=(0, 0, 1),
                    segs=8, sqv=1.0, axis=(1, 0, 0), rings_n=2)
        loft(mb, [dict(c=(X(-0.23 * k), hy, hz), rx=0.016, ry=0.016, ax=(1, 0, 0), ref=(0, 0, 1)),
                  dict(c=(X(0.23 * k), hy, hz), rx=0.016, ry=0.016, ax=(1, 0, 0), ref=(0, 0, 1))], 6, rub, rigid(cart), v0=0.2, v1=0.8)
    elif name == "hold":
        pass


class _H:
    pass


H = _H()
H.loft, H.cell, H.chain_weights, H.rigid, H.half = loft, cell, chain_weights, rigid, AD.half
H.MASKS, H.Z4, H.HAIRM = MASKS, Z4, HAIRM


# ======================================================================================== blender objects
def make_armature(name, skel, iks):
    arm = bpy.data.armatures.new(name + "_rig")
    ob = bpy.data.objects.new(name + "_rig", arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    for bn, (h, t, par, deform) in skel.items():
        eb = arm.edit_bones.new(bn)
        eb.head = h
        eb.tail = t
        eb.roll = 0.0
        eb.use_deform = deform
    for bn, (h, t, par, deform) in skel.items():
        if par:
            arm.edit_bones[bn].parent = arm.edit_bones[par]
            arm.edit_bones[bn].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    # IK chains (2 bones) onto target bones; human feet also copy the target's rotation
    for low, tgt in iks:
        c = ob.pose.bones[low].constraints.new("IK")
        c.target = ob
        c.subtarget = tgt
        c.chain_count = 2
        c.use_stretch = False
        c.use_tail = True
        if "shin" in low:
            fb = ob.pose.bones[low.replace("shin", "foot")]
            cr = fb.constraints.new("COPY_ROTATION")
            cr.target = ob
            cr.subtarget = tgt
    for pb in ob.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return ob


def make_mesh(name, mb, arm_ob):
    # two-sided surfaces repeat a face with reversed winding: give the back face its own vertices
    seen = set()
    for i, (f, uvs) in enumerate(mb.f):
        key = tuple(sorted(f))
        if key in seen:
            nf = tuple(mb.add_v(mb.v[j].copy(), dict(mb.w[j]), mb.m[j]) for j in f)
            mb.f[i] = (nf, uvs)
        else:
            seen.add(key)
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in mb.v], [], [tuple(f) for f, _ in mb.f])
    me.validate(clean_customdata=False)
    uvl = me.uv_layers.new(name="UV")
    # validate() may drop degenerate faces; map by polygon index assuming none were removed
    assert len(me.polygons) == len(mb.f), (len(me.polygons), len(mb.f))
    li = 0
    for poly, (_, uvs) in zip(me.polygons, mb.f):
        for j, lidx in enumerate(poly.loop_indices):
            x, y = uvs[j]
            uvl.data[lidx].uv = (x / AW, 1.0 - y / AH)
    col = me.color_attributes.new("mask", "FLOAT_COLOR", "POINT")
    for i, m in enumerate(mb.m):
        col.data[i].color = (m[0], m[1], m[2], m[3])
    for poly in me.polygons:
        poly.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    groups = {}
    for i, w in enumerate(mb.w):
        tot = sum(w.values()) or 1.0
        for b, x in w.items():
            if x <= 0:
                continue
            if b not in groups:
                groups[b] = ob.vertex_groups.new(name=b)
            groups[b].add([i], x / tot, "REPLACE")
    mod = ob.modifiers.new("rig", "ARMATURE")
    mod.object = arm_ob
    ob.parent = arm_ob
    return ob


# ======================================================================================== animation
import importlib
import people_anim as PA
importlib.reload(PA)
from people_anim import Poser, Anim, DogAnim, DOGS, DOG_CLIPS, qx, qy, qz

CLIPS = [  # name, frames baked, seconds per cycle at the reference speed, loop
    ("walk", 24, 1.1, True),
    ("stroll", 24, 1.35, True),
    ("idle", 16, 3.6, True),
    ("flinch", 16, 1.1, False),
]


def key_clip(arm_ob, anims, clip, F, loop):
    act = bpy.data.actions.new("%s_%s" % (arm_ob.name, clip))
    arm_ob.animation_data_create()
    arm_ob.animation_data.action = act
    poser = anims[0].P
    last = F if loop else F - 1
    for f in range(0, last + 1):
        t = (f / F) if loop else (f / (F - 1))
        Q, T, D = {}, {}, {}
        for an in anims:
            q, tt, d = an.pose(clip, t % 1.0 if loop else t)
            Q.update(q)
            T.update(tt)
            D.update(d)
        # keep the IK legs within reach: lower the hips / body just enough
        Mp, P, W = poser.solve(Q, T, D)
        for an in anims:
            need = 0.0
            for hipb, ikb, L in an.legs():
                hip = P[hipb]
                ank = D[ikb].translation
                L *= 0.985
                if (hip - ank).length > L:
                    dz = hip.z - ank.z
                    hor2 = (hip - ank).length_squared - dz * dz
                    need = max(need, dz - math.sqrt(max(0.0, L * L - hor2)))
            if need > 0:
                T[an.root] = T.get(an.root, Vector()) + Vector((0, 0, -need))
        Mp, P, W = poser.solve(Q, T, D)
        poser.apply(Mp, f)
    return act


# ======================================================================================== export helpers
def to_three(a):
    """(N,3) blender -> three"""
    out = np.empty_like(a)
    out[:, 0] = a[:, 0]
    out[:, 1] = a[:, 2]
    out[:, 2] = -a[:, 1]
    return out


def read_eval(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    oe = ob.evaluated_get(dg)
    me = oe.to_mesh()
    n = len(me.vertices)
    co = np.empty(n * 3, np.float32)
    me.vertices.foreach_get("co", co)
    nr = np.empty(n * 3, np.float32)
    me.vertex_normals.foreach_get("vector", nr)
    oe.to_mesh_clear()
    return co.reshape(-1, 3), nr.reshape(-1, 3)


def oct_encode(n):
    n = n / np.maximum(1e-9, np.abs(n).sum(axis=1, keepdims=True))
    x, y, z = n[:, 0], n[:, 1], n[:, 2]
    ox = np.where(z >= 0, x, (1 - np.abs(y)) * np.sign(x + 1e-12))
    oy = np.where(z >= 0, y, (1 - np.abs(x)) * np.sign(y + 1e-12))
    qx_ = np.clip(np.round((ox * 0.5 + 0.5) * 255), 0, 255).astype(np.uint16)
    qy_ = np.clip(np.round((oy * 0.5 + 0.5) * 255), 0, 255).astype(np.uint16)
    return qx_ | (qy_ << 8)


def export_mesh_arrays(ob):
    """Unique (vertex, uv) pairs -> arrays for glTF. Returns dict."""
    me = ob.data
    uvl = me.uv_layers[0].data
    mask = me.color_attributes["mask"].data
    key2i = {}
    vid, uvs = [], []
    idx = []
    for poly in me.polygons:
        li = list(poly.loop_indices)
        corners = []
        for l in li:
            v = me.loops[l].vertex_index
            u = uvl[l].uv
            key = (v, round(u[0] * AW * 4), round(u[1] * AH * 4))
            if key not in key2i:
                key2i[key] = len(vid)
                vid.append(v)
                uvs.append((u[0], 1.0 - u[1]))
            corners.append(key2i[key])
        for j in range(1, len(corners) - 1):
            idx += [corners[0], corners[j], corners[j + 1]]
    vid = np.array(vid, np.int32)
    co = np.array([me.vertices[v].co[:] for v in vid], np.float32)
    nrm = np.array([me.vertices[v].normal[:] for v in vid], np.float32)
    col = np.array([mask[v].color[:4] for v in vid], np.float32)
    return dict(pos=to_three(co), nrm=to_three(nrm), uv=np.array(uvs, np.float32), col=col,
                vat=vid.astype(np.float32), idx=np.array(idx, np.uint32))


def write_glb(path, meshes):
    """meshes: list of (name, arrays). Minimal glTF 2.0 binary, one node per character."""
    bin_ = bytearray()
    views, accs, gl_meshes, nodes = [], [], [], []

    def add(arr, target, comp, typ, minmax=False, normalized=False):
        nonlocal bin_
        while len(bin_) % 4:
            bin_ += b"\0"
        off = len(bin_)
        b = arr.tobytes()
        bin_ += b
        views.append({"buffer": 0, "byteOffset": off, "byteLength": len(b), **({"target": target} if target else {})})
        acc = {"bufferView": len(views) - 1, "componentType": comp, "count": int(arr.shape[0]), "type": typ}
        if minmax:
            acc["min"] = [float(x) for x in arr.min(axis=0)]
            acc["max"] = [float(x) for x in arr.max(axis=0)]
        if normalized:
            acc["normalized"] = True
        accs.append(acc)
        return len(accs) - 1
    for name, A in meshes:
        # compact: no rest normals (the VAT carries them), 16-bit UVs, 8-bit mask, 16-bit VAT vertex id
        uv16 = np.clip(np.round(A["uv"] * 65535), 0, 65535).astype(np.uint16)
        col8 = np.clip(np.round(A["col"] * 255), 0, 255).astype(np.uint8)
        vat16 = A["vat"].astype(np.uint16).reshape(-1, 1)
        attrs = {
            "POSITION": add(A["pos"].astype(np.float32), 34962, 5126, "VEC3", minmax=True),
            "TEXCOORD_0": add(uv16, 34962, 5123, "VEC2", normalized=True),
            "COLOR_0": add(col8, 34962, 5121, "VEC4", normalized=True),
            "_VATID": add(vat16, 34962, 5123, "SCALAR"),
        }
        idx = A["idx"]
        ia = add(idx.astype(np.uint16) if idx.max() < 65535 else idx.astype(np.uint32), 34963, 5123 if idx.max() < 65535 else 5125, "SCALAR")
        gl_meshes.append({"name": name, "primitives": [{"attributes": attrs, "indices": ia, "mode": 4}]})
        nodes.append({"name": name, "mesh": len(gl_meshes) - 1})
    while len(bin_) % 4:
        bin_ += b"\0"
    gltf = {"asset": {"version": "2.0", "generator": "FFTT build_people.py"}, "scene": 0,
            "scenes": [{"nodes": list(range(len(nodes)))}], "nodes": nodes, "meshes": gl_meshes,
            "accessors": accs, "bufferViews": views, "buffers": [{"byteLength": len(bin_)}]}
    js = json.dumps(gltf, separators=(",", ":")).encode()
    while len(js) % 4:
        js += b" "
    total = 12 + 8 + len(js) + 8 + len(bin_)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack("<II", len(bin_), 0x004E4942))
        f.write(bin_)


# ======================================================================================== preview material
def preview_material(name, tintA, tintB, tintC=(0.25, 0.16, 0.1)):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = True       # match three.js, so inside-out faces show up in review
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.85
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(ATLAS, check_existing=True)
    tex.interpolation = "Linear"
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "mask"
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(attr.outputs["Color"], sep.inputs["Color"])
    bw = nt.nodes.new("ShaderNodeRGBToBW")
    nt.links.new(tex.outputs["Color"], bw.inputs["Color"])
    cur = tex.outputs["Color"]
    for ch, tint in (("Red", tintA), ("Green", tintB), ("Blue", tintC)):
        m1 = nt.nodes.new("ShaderNodeMix")
        m1.data_type = "RGBA"
        m1.blend_type = "MULTIPLY"
        m1.inputs["Factor"].default_value = 1.0
        nt.links.new(bw.outputs["Val"], m1.inputs[6])
        m1.inputs[7].default_value = (tint[0] * 1.7, tint[1] * 1.7, tint[2] * 1.7, 1)
        m2 = nt.nodes.new("ShaderNodeMix")
        m2.data_type = "RGBA"
        nt.links.new(sep.outputs[ch], m2.inputs["Factor"])
        nt.links.new(cur, m2.inputs[6])
        nt.links.new(m1.outputs[2], m2.inputs[7])
        cur = m2.outputs[2]
    nt.links.new(cur, bsdf.inputs["Base Color"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


TINTS_A = [(0.10, 0.12, 0.18), (0.45, 0.10, 0.10), (0.16, 0.22, 0.14), (0.35, 0.33, 0.30), (0.08, 0.08, 0.09), (0.55, 0.42, 0.25),
           (0.12, 0.20, 0.38), (0.30, 0.14, 0.22), (0.62, 0.58, 0.50), (0.20, 0.30, 0.32), (0.40, 0.28, 0.18), (0.70, 0.30, 0.12),
           (0.05, 0.25, 0.30)]
TINTS_B = [(0.70, 0.20, 0.15), (0.85, 0.70, 0.30), (0.15, 0.35, 0.60), (0.85, 0.85, 0.82), (0.30, 0.50, 0.30), (0.60, 0.30, 0.60),
           (0.90, 0.45, 0.15), (0.20, 0.20, 0.22), (0.75, 0.15, 0.30), (0.25, 0.45, 0.70), (0.80, 0.80, 0.30), (0.40, 0.20, 0.10),
           (0.95, 0.60, 0.70)]


def setup_render(res=(1600, 800)):
    s = bpy.context.scene
    try:
        s.render.engine = "BLENDER_EEVEE_NEXT"
    except Exception:
        s.render.engine = "BLENDER_EEVEE"
    s.render.resolution_x, s.render.resolution_y = res
    s.render.resolution_percentage = 100
    s.render.threads_mode = "FIXED"
    s.render.threads = 8
    s.view_settings.view_transform = "Standard"
    try:
        s.eevee.taa_render_samples = 16
    except Exception:
        pass
    world = bpy.data.worlds.new("winter")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.55, 0.6, 0.68, 1)
    bg.inputs["Strength"].default_value = 0.6
    s.world = world
    for loc, en, col, rot in (((0, 0, 10), 3.0, (1.0, 0.95, 0.88), (math.radians(50), 0, math.radians(-30))),
                              ((0, 0, 10), 1.0, (0.6, 0.7, 1.0), (math.radians(70), 0, math.radians(150)))):
        ld = bpy.data.lights.new("sun", "SUN")
        ld.energy = en
        ld.color = col
        lo = bpy.data.objects.new("sun", ld)
        lo.rotation_euler = rot
        s.collection.objects.link(lo)
    gm = bpy.data.meshes.new("ground")
    gm.from_pydata([(-50, -50, 0), (50, -50, 0), (50, 50, 0), (-50, 50, 0)], [], [(0, 1, 2, 3)])
    g = bpy.data.objects.new("ground", gm)
    gmat = bpy.data.materials.new("ground")
    gmat.use_nodes = True
    gmat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.45, 0.45, 0.46, 1)
    gm.materials.append(gmat)
    s.collection.objects.link(g)
    cam_d = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_d)
    s.collection.objects.link(cam)
    s.camera = cam
    return cam


def aim(cam, loc, target, lens=50, ortho=None):
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    if ortho:
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = ortho
    else:
        cam.data.type = "PERSP"
        cam.data.lens = lens


def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def contact_sheet(paths, cols, out):
    imgs = []
    for pth in paths:
        im = bpy.data.images.load(pth)
        w, h = im.size
        a = np.array(im.pixels[:], np.float32).reshape(h, w, 4)
        imgs.append(a)
        bpy.data.images.remove(im)
    h, w = imgs[0].shape[:2]
    rows = math.ceil(len(imgs) / cols)
    sheet = np.ones((rows * h, cols * w, 4), np.float32)
    for i, a in enumerate(imgs):
        r, c = divmod(i, cols)
        # blender pixel rows go bottom-up
        sheet[(rows - 1 - r) * h:(rows - r) * h, c * w:(c + 1) * w] = a
    im = bpy.data.images.new("sheet", cols * w, rows * h, alpha=True)
    im.pixels = sheet.ravel()
    im.filepath_raw = out
    im.file_format = "PNG"
    im.save()
    bpy.data.images.remove(im)
    for pth in paths:
        try:
            os.remove(pth)
        except OSError:
            pass


# ======================================================================================== main
def encode_block(blk):
    """blk: (F, V, 4) uint16 -> bytes. Five planes (x, y, z, normal-x byte, normal-y byte), each
    [frames][verts] as zigzag second-order frame deltas (mod 2^16), then a low-byte plane and a
    high-byte plane (gzip squeezes the smooth motion very well)."""
    x = np.concatenate([blk[:, :, :3].transpose(2, 0, 1), (blk[:, :, 3] & 255)[None], (blk[:, :, 3] >> 8)[None]]).astype(np.int64)
    d = x.copy()
    if x.shape[1] > 1:
        d[:, 1] = x[:, 1] - x[:, 0]
    if x.shape[1] > 2:
        d[:, 2:] = x[:, 2:] - 2 * x[:, 1:-1] + x[:, :-2]
    d = d % 65536
    d = np.where(d >= 32768, d - 65536, d)
    z = np.where(d >= 0, d * 2, -d * 2 - 1).astype(np.uint16).reshape(-1)
    b = z.view(np.uint8).reshape(-1, 2)
    return b[:, 0].tobytes() + b[:, 1].tobytes()


def anchor_vertex(ob, point, group=None):
    """index of the vertex nearest `point` (optionally restricted to a vertex group)."""
    gi = ob.vertex_groups[group].index if group and group in ob.vertex_groups else None
    best = None
    for v in ob.data.vertices:
        if gi is not None and not any(g.group == gi and g.weight > 0.5 for g in v.groups):
            continue
        d = (v.co - Vector(point)).length
        if best is None or d < best[0]:
            best = (d, v.index)
    return best[1]


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    prefs = bpy.context.preferences
    prefs.edit.keyframe_new_interpolation_type = "LINEAR"
    scn = bpy.context.scene
    scn.render.fps = 24
    built = []
    for ci, C in enumerate(CHARACTERS):
        if ONLY and C["name"] not in ONLY:
            continue
        B = body(C["H"], kid=C.get("kidbody", False), female=C["female"], build=C.get("build", 1.0))
        skel = make_skeleton(B)
        iks = [("shin." + s, "foot_ik." + s) for s in ("L", "R")]
        mb = MB()
        build_person(mb, C, B)
        anims_spec = [(C, B, "", 0.0)]
        if C.get("kid"):
            K = dict(C["kid"])
            K.setdefault("build", 1.0)
            KB = body(K["H"], kid=True, female=K.get("female", False))
            ox = K["ox"]
            skel.update(make_skeleton(KB, prefix="k_", ox=ox))
            iks += [("k_shin." + s, "k_foot_ik." + s) for s in ("L", "R")]
            build_person(mb, K, KB, p="k_", ox=ox)
            K["_kidcycles"] = 2
            # the two hands meet beside the parent's right hip
            C["_hold_target"] = K["_hold_target"] = (ox * 0.55, -0.08, 0.78 * B["k"])
            anims_spec.append((K, KB, "k_", ox))
        if any(pr.startswith("stroller") for pr in C.get("props", [])):
            skel["cart"] = ((0, -0.85 * B["k"], 0.3), (0, -0.85 * B["k"], 0.6), None, True)
        arm = make_armature(C["name"], skel, iks)
        ob = make_mesh(C["name"], mb, arm)
        poser = Poser(arm)
        anims = [Anim(c, b, poser, prefix=pp, ox=o) for c, b, pp, o in anims_spec]
        print("[people] %-11s tris=%d verts=%d" % (C["name"], mb.ntris(), len(mb.v)), flush=True)
        clips = {}
        for clip, F, secs, loop in CLIPS:
            clips[clip] = key_clip(arm, anims, clip, F, loop)
        # lead anchors: palm of each hand
        anchors = {}
        for s in ("L", "R"):
            hb = arm.data.bones["hand." + s]
            anchors["hand" + s] = anchor_vertex(ob, hb.head_local.lerp(hb.tail_local, 0.6), "hand." + s)
        built.append(dict(C=C, B=B, ob=ob, arm=arm, anims=anims, clips=clips, ci=ci, kind="person", cliplist=CLIPS,
                          anchors=anchors))
    for D in DOGS:
        if ONLY and D["name"] not in ONLY:
            continue
        skel, iks = PA.dog_skeleton(D)
        mb = MB()
        PA.build_dog(mb, D, H)
        arm = make_armature(D["name"], skel, iks)
        ob = make_mesh(D["name"], mb, arm)
        poser = Poser(arm)
        anims = [DogAnim(D, poser)]
        print("[people] %-11s tris=%d verts=%d" % (D["name"], mb.ntris(), len(mb.v)), flush=True)
        clips = {}
        for clip, F, secs, loop in DOG_CLIPS:
            clips[clip] = key_clip(arm, anims, clip, F, loop)
        built.append(dict(C=dict(name=D["name"], H=D["W"]), D=D, ob=ob, arm=arm, anims=anims, clips=clips, kind="dog",
                          cliplist=DOG_CLIPS, anchors={"collar": mb.anchors["collar"]}))
    # ------------------------------------------------------------------ bake
    W = 2048
    blocks, block_meta, meta_chars, meta_dogs, meshes = [], [], [], [], []
    texel = 0
    POS_BITS = 12
    QMAX = (1 << POS_BITS) - 1
    for E in built:
        C, ob, arm = E["C"], E["ob"], E["arm"]
        nv = len(ob.data.vertices)
        frames_all = {}
        for clip, F, secs, loop in E["cliplist"]:
            arm.animation_data.action = E["clips"][clip]
            P, N = [], []
            for f in range(F):
                scn.frame_set(f)
                co, nr = read_eval(ob)
                P.append(to_three(co))
                N.append(to_three(nr))
            frames_all[clip] = (np.array(P), np.array(N))
        allp = np.concatenate([v[0].reshape(-1, 3) for v in frames_all.values()])
        lo = allp.min(axis=0) - 1e-4
        hi = allp.max(axis=0) + 1e-4
        rng = hi - lo
        if E["kind"] == "person":
            Cc = C
            faces = [f["name"] for f in AD.FACES]
            cmeta = {"name": C["name"], "height": C["H"], "kid": bool(C.get("kidbody")), "pair": bool(C.get("kid")),
                     "old": bool(C.get("old")), "stroller": any(x.startswith("stroller") for x in C.get("props", [])),
                     "face": faces.index(C["face"]), "faceGroup": AD.GROUPS[C["face"]],
                     "kidFace": faces.index(C["kid"]["face"]) if C.get("kid") else -1,
                     "hat": bool(C.get("hat") and C.get("hat") != "hood"), "scarf": bool(C.get("scarf")),
                     "coatTint": C.get("coat_mask") == "A", "props": C.get("props", []),
                     "leadSide": (-1 if any(x.endswith(".L") or x == "hold.L" for x in C.get("props", [])) else 1),
                     "verts": nv, "boundsMin": [float(x) for x in lo], "boundsMax": [float(x) for x in hi],
                     "anchors": E["anchors"], "clips": {}}
        else:
            D = E["D"]
            cmeta = {"name": D["name"], "breed": D["breed"], "withers": D["W"], "furTint": bool(D.get("tint_fur")),
                     "coat": bool(D.get("coat")), "verts": nv, "boundsMin": [float(x) for x in lo],
                     "boundsMax": [float(x) for x in hi], "anchors": E["anchors"], "clips": {}}
        for clip, F, secs, loop in E["cliplist"]:
            P, N = frames_all[clip]
            q = np.clip(np.round((P - lo) / rng * QMAX), 0, QMAX).astype(np.uint16)     # F, nv, 3
            nn = oct_encode(N.reshape(-1, 3)).reshape(F, nv, 1)
            blk = np.concatenate([q, nn], axis=2)                                         # F, nv, 4
            blocks.append(blk)
            stride = E["anims"][0].stride(clip) if clip in ("walk", "stroll") else 0.0
            cmeta["clips"][clip] = {"base": texel, "frames": F, "loop": loop, "seconds": secs, "stride": round(stride, 4)}
            block_meta.append([texel, F, nv])
            texel += F * nv
        (meta_chars if E["kind"] == "person" else meta_dogs).append(cmeta)
        arm.animation_data.action = None
        for pb in arm.pose.bones:
            pb.location = (0, 0, 0)
            pb.rotation_quaternion = (1, 0, 0, 0)
        A = export_mesh_arrays(ob)
        meshes.append((C["name"], A))
        print("[people] %-13s export verts=%d tris=%d vat verts=%d" % (C["name"], len(A["pos"]), len(A["idx"]) // 3, nv), flush=True)
    Hh = int(math.ceil(texel / W))
    raw = bytearray()
    for blk in blocks:
        raw += encode_block(blk)
    vat_path = os.path.join(OUT, "people_vat.bin")
    with open(vat_path, "wb") as f:
        f.write(gzip.compress(bytes(raw), compresslevel=9, mtime=0))
    write_glb(os.path.join(OUT, "people.glb"), meshes)
    meta = {
        "version": 2,
        "glb": "people.glb", "vat": "people_vat.bin", "atlas": "people_atlas.png",
        "vatTexture": {"width": W, "height": Hh, "format": "RGBA16UI", "posBits": POS_BITS,
                       "texel": "x,y,z = position quantised to the mesh's bounds (0..2^posBits-1); w = octahedral normal (x low byte, y high byte)",
                       "file": "gzip; blocks in order (base texel, frames, verts); each block is 5 planes [x,y,z,nx,ny][frames][verts] "
                               "of uint16 zigzag second-order frame deltas (mod 2^16), stored as a low-byte plane then a high-byte plane",
                       "blocks": block_meta},
        "space": "three.js, metres, characters face +Z, feet at y=0",
        "mask": "COLOR_0: r = coat tint, g = accessory tint, b = hair tint, a*8 = flag (1 face, 2 optional hat, 3 scarf hue, 4 child face)",
        "tintGain": 1.65,
        "clips": {c: {"frames": F, "seconds": s_, "loop": l} for c, F, s_, l in CLIPS},
        "dogClips": {c: {"frames": F, "seconds": s_, "loop": l} for c, F, s_, l in DOG_CLIPS},
        "strideNote": "stride = metres covered by one full walk cycle (two steps) at the mesh's native size",
        "characters": meta_chars,
        "dogs": meta_dogs,
        "atlasLayout": AD.layout_json(),
    }
    with open(os.path.join(OUT, "people.json"), "w") as f:
        json.dump(meta, f, indent=1)
    print("[people] VAT texels=%d (%dx%d), file=%d bytes" % (texel, W, Hh, os.path.getsize(vat_path)), flush=True)
    previews(built)


def srgb2lin(c):
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


def previews(built):
    scn = bpy.context.scene
    cam = setup_render((1800, 700))
    people = [E for E in built if E["kind"] == "person"]
    dogs = [E for E in built if E["kind"] == "dog"]
    hair_of = {f["name"]: f["hair"] for f in AD.FACES}
    gap = 0.85
    n = len(people)
    for i, E in enumerate(built):
        ob, arm = E["ob"], E["arm"]
        ob.data.materials.clear()
        hc = hair_of.get(E["C"].get("face"), (0.3, 0.2, 0.1))
        ob.data.materials.append(preview_material("m_" + E["C"]["name"], srgb2lin(TINTS_A[i % len(TINTS_A)]),
                                                  srgb2lin(TINTS_B[i % len(TINTS_B)]), srgb2lin(hc)))
        arm.animation_data.action = E["clips"]["idle"]
    for i, E in enumerate(people):
        E["arm"].location = ((i - (n - 1) / 2) * gap, 0, 0)
    for i, E in enumerate(dogs):
        E["arm"].location = ((i - (len(dogs) - 1) / 2) * 1.0, -2.2, 0)
    scn.frame_set(0)
    for o in dogs:
        o["ob"].hide_render = True
    rows = [people[i:i + 9] for i in range(0, len(people), 9)]
    for ri, row in enumerate(rows):
        for o in people:
            o["ob"].hide_render = o not in row
        for i, E in enumerate(row):
            E["arm"].location = ((i - (len(row) - 1) / 2) * gap, 0, 0)
        span = 9 * gap
        d = span / 0.65 * 1.05
        aim(cam, (0, -d, 1.4), (0, 0, 0.92), lens=50)
        render(os.path.join(PREV, "lineup_front_%d.png" % (ri + 1)))
        aim(cam, (d * 0.45, -d * 0.85, 3.0), (0, 0, 0.8), lens=50)
        render(os.path.join(PREV, "lineup_three_quarter_%d.png" % (ri + 1)))
        for E in row:
            E["arm"].rotation_euler = (0, 0, math.pi)
        aim(cam, (0, -d, 1.4), (0, 0, 0.92), lens=50)
        render(os.path.join(PREV, "lineup_back_%d.png" % (ri + 1)))
        for E in row:
            E["arm"].rotation_euler = (0, 0, 0)
    for o in people:
        o["ob"].hide_render = False
    for i, E in enumerate(people):
        E["arm"].location = ((i - (n - 1) / 2) * gap, 0, 0)
    for o in built:
        o["ob"].hide_render = o["kind"] != "dog"
    if dogs:
        scn.render.resolution_x, scn.render.resolution_y = (1400, 600)
        aim(cam, (1.2, -6.4, 1.5), (0, -2.2, 0.25), lens=50)
        render(os.path.join(PREV, "dogs.png"))
    for o in built:
        o["ob"].hide_render = o["kind"] == "dog"
    # face close-ups
    paths = []
    scn.render.resolution_x, scn.render.resolution_y = (300, 300)
    for i, E in enumerate(people):
        x = E["arm"].location.x
        Hh = E["C"]["H"]
        zc = Hh - 0.12 * (Hh / 1.75)
        aim(cam, (x + 0.22, -0.72, zc + 0.04), (x, 0, zc), lens=85)
        pth = os.path.join(PREV, "_face_%02d.png" % i)
        render(pth)
        paths.append(pth)
    if paths:
        contact_sheet(paths, 6, os.path.join(PREV, "faces.png"))
    # walk cycle strips (side view): every 3rd of the 24 frames
    scn.render.resolution_x, scn.render.resolution_y = (280, 400)
    for E in built:
        for o in built:
            o["ob"].hide_render = o is not E
        x, y = E["arm"].location.x, E["arm"].location.y
        dog = E["kind"] == "dog"
        sel = ("walk", "idle") if dog else (("walk", "flinch", "idle") if E["C"]["name"] in ("commuter", "parent_kid", "gent", "tourist", "stroller") else ("walk",))
        for clip in sel:
            E["arm"].animation_data.action = E["clips"][clip]
            F = dict((c, f) for c, f, _, _ in E["cliplist"])[clip]
            paths = []
            for f in range(0, F, max(1, F // 8)):
                scn.frame_set(f)
                if dog:
                    sz = E["D"]["W"]
                    aim(cam, (x + 1.0 + sz * 3.0, y - 0.2, 0.35 + sz * 0.5), (x, y - 0.1, sz * 0.55), lens=50)
                elif E["C"].get("kid") or "stroller" in [q.partition(".")[0] for q in E["C"].get("props", [])]:
                    aim(cam, (x + 4.6, -0.9, 1.0), (x - 0.15, -0.35, 0.8), lens=50)
                else:
                    aim(cam, (x + 3.4, -0.6, 1.0), (x, 0, 0.85), lens=50)
                pth = os.path.join(PREV, "_w_%s_%02d.png" % (E["C"]["name"], f))
                render(pth)
                paths.append(pth)
            contact_sheet(paths, len(paths), os.path.join(PREV, "%s_%s.png" % (clip, E["C"]["name"])))
    for o in built:
        o["ob"].hide_render = False
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(PREV, "people_preview.blend"))


main()
