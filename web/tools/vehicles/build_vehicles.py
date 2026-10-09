"""
Procedural vehicle set for Far From the Tree (three.js).

Run headless:
  blender -b --python build_vehicles.py              # build + export GLB + previews
  blender -b --python build_vehicles.py -- --no-previews

Builds six vehicles (cab, sedan, suv, bus, truck, van) entirely from code, exports them to
web/public/models/vehicles.glb and renders EEVEE previews into ./previews.

Modelling space: metres, +X forward, +Y left, +Z up, origin on the ground under the centre.
Each finished mesh is rotated -90 deg about Z so the front faces Blender -Y, which the glTF
Y-up conversion turns into three.js +Z. Wheels touch z=0 (three.js y=0).

Every vehicle is one mesh with the material slots below (named exactly; the game instances
each primitive and tints `paint` per instance).
"""
import bpy, bmesh, math, os, sys, struct, zlib
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT_GLB = os.path.join(WEB, "public", "models", "vehicles.glb")
PREV_DIR = os.path.join(HERE, "previews")
ATLAS_PNG = os.path.join(HERE, "sign_atlas.png")
LIVERY_PNG = os.path.join(HERE, "livery_atlas.png")

MATS = ["paint", "glass", "trim", "tyre", "rim", "light_front", "light_rear", "sign", "livery", "chrome"]
MI = {n: i for i, n in enumerate(MATS)}


# ============================================================ small maths helpers

def lerp(a, b, t):
    return a + (b - a) * t


def table(tab, x):
    """Piecewise-linear lookup in a sorted [(x, v), ...] table, clamped at the ends."""
    if x <= tab[0][0]:
        return tab[0][1]
    for (x0, v0), (x1, v1) in zip(tab, tab[1:]):
        if x <= x1:
            t = (x - x0) / (x1 - x0) if x1 > x0 else 0.0
            return lerp(v0, v1, t)
    return tab[-1][1]


def smooth_table(tab, x):
    """Like table() but eased with smoothstep inside each span (softer hood/roof curves)."""
    if x <= tab[0][0]:
        return tab[0][1]
    for (x0, v0), (x1, v1) in zip(tab, tab[1:]):
        if x <= x1:
            t = (x - x0) / (x1 - x0) if x1 > x0 else 0.0
            t = t * t * (3 - 2 * t)
            return lerp(v0, v1, t)
    return tab[-1][1]


# ============================================================ mesh builder

class Builder:
    """Thin wrapper over a bmesh with per-face material + UV helpers."""

    def __init__(self):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")

    def v(self, co):
        return self.bm.verts.new(Vector(co))

    def face(self, verts, mat, out=None, uvfn=None):
        vs = []
        for v in verts:
            if v not in vs:
                vs.append(v)
        if len(vs) < 3:
            return None
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            return None
        f.material_index = MI[mat]
        f.smooth = True
        f.normal_update()
        if f.calc_area() < 1e-8:
            self.bm.faces.remove(f)
            return None
        if out is not None and f.normal.dot(Vector(out)) < 0:
            f.normal_flip()
        if uvfn:
            for lp in f.loops:
                lp[self.uv].uv = uvfn(lp.vert.co)
        return f

    def merge(self, other, M=Matrix.Identity(4)):
        flip = M.to_3x3().determinant() < 0
        vmap = {}
        for v in other.bm.verts:
            vmap[v] = self.v(M @ v.co)
        for f in other.bm.faces:
            vs = [vmap[l.vert] for l in f.loops]
            uvs = [l[other.uv].uv.copy() for l in f.loops]
            if flip:
                vs.reverse()
                uvs.reverse()
            try:
                nf = self.bm.faces.new(vs)
            except ValueError:
                continue
            nf.material_index = f.material_index
            nf.smooth = f.smooth
            for lp, uv in zip(nf.loops, uvs):
                lp[self.uv].uv = uv

    def tris(self):
        return sum(len(f.verts) - 2 for f in self.bm.faces)


def rbox(B, center, size, mat, bevel=0.02, segs=1, mat_fn=None, M=None, uvfn=None):
    """Bevelled box. mat_fn(local_normal) -> material name overrides `mat` per face."""
    T = Builder()
    bmesh.ops.create_cube(T.bm, size=1.0)
    for v in T.bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    if bevel > 0:
        b = min(bevel, min(size) * 0.49)
        bmesh.ops.bevel(T.bm, geom=list(T.bm.edges), offset=b, offset_type='OFFSET', segments=segs,
                        profile=0.5, affect='EDGES', clamp_overlap=True)
    bmesh.ops.recalc_face_normals(T.bm, faces=list(T.bm.faces))
    for f in T.bm.faces:
        f.smooth = True
        f.normal_update()
        f.material_index = MI[mat_fn(f.normal) if mat_fn else mat]
        if uvfn:
            for lp in f.loops:
                lp[T.uv].uv = uvfn(lp.vert.co, f.normal)
    Mt = Matrix.Translation(Vector(center))
    if M is not None:
        Mt = Mt @ M
    B.merge(T, Mt)


def tube(B, a, b, radius, mat, segs=6):
    """Thin prism (cylinder) from a to b, for rails, arms and bike-rack bars."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    s = d.cross(up).normalized()
    u = s.cross(d).normalized()
    ra, rb = [], []
    for i in range(segs):
        ang = 2 * math.pi * i / segs
        off = (s * math.cos(ang) + u * math.sin(ang)) * radius
        ra.append(B.v(a + off))
        rb.append(B.v(b + off))
    for i in range(segs):
        j = (i + 1) % segs
        mid = (ra[i].co + ra[j].co + rb[i].co + rb[j].co) / 4
        B.face([ra[i], ra[j], rb[j], rb[i]], mat, out=mid - (a + b) / 2 - d * d.dot(mid - (a + b) / 2))
    B.face(ra, mat, out=-d)
    B.face(rb, mat, out=d)


# ============================================================ wheels

def wheel(R, tw, segs=15, rim_frac=0.64, style="alloy"):
    """Wheel in local space: axle along Y, outer face at y=0, body side toward -y, centre at origin."""
    T = Builder()
    rr = R * rim_frac

    def ang(i):
        return 2 * math.pi * i / segs - math.pi / 2   # a vertex sits exactly at the contact patch

    def lathe(profile, outward_sign, mat_fn):
        rings = []
        for (r, y) in profile:
            if r < 1e-6:
                rings.append([T.v((0, y, 0))] * segs)
            else:
                rings.append([T.v((r * math.cos(ang(i)), y, r * math.sin(ang(i)))) for i in range(segs)])
        for k in range(len(profile) - 1):
            (r0, y0), (r1, y1) = profile[k], profile[k + 1]
            dr, dy = r1 - r0, y1 - y0
            nr, ny = (-dy * outward_sign, dr * outward_sign)
            for i in range(segs):
                j = (i + 1) % segs
                a = ang(i + 0.5)
                out = Vector((nr * math.cos(a), ny, nr * math.sin(a)))
                T.face([rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]], mat_fn(k, i), out=out)
        return rings

    tyre = [(rr + 0.004, -0.022), (R * 0.87, -0.003), (R, -0.032),
            (R, -(tw - 0.032)), (R * 0.87, -(tw - 0.003)), (rr + 0.004, -(tw - 0.022))]
    lathe(tyre, 1, lambda k, i: "tyre")

    if style == "alloy":
        rim = [(rr, -0.024), (rr * 0.93, -0.012), (rr * 0.82, -0.04), (rr * 0.3, -0.05), (0.0, -0.03)]

        def rim_mat(k, i):
            if k == 2 and i % 3 != 0:
                return "trim"
            return "rim"
    else:  # steel commercial wheel: deep dish, hand holes, big hub
        rim = [(rr, -0.03), (rr * 0.93, -0.02), (rr * 0.84, -0.075), (rr * 0.5, -0.075),
               (rr * 0.36, -0.05), (rr * 0.3, -0.02), (0.0, -0.02)]

        def rim_mat(k, i):
            if k == 3 and i % 2 == 0:
                return "trim"
            if k == 1:
                return "trim"
            return "rim"
    lathe(rim, -1, rim_mat)
    # inner closing disc so the wheel never shows a hole from underneath
    ring = [T.v((rr * math.cos(2 * math.pi * i / segs), -(tw - 0.03), rr * math.sin(2 * math.pi * i / segs)))
            for i in range(segs)]
    T.face(ring, "trim", out=(0, -1, 0))
    return T


def add_wheel(B, W, x, y_outer, R, side):
    """side=+1 puts the outer face toward +y (left), -1 toward -y (right)."""
    M = Matrix.Translation((x, y_outer * side, R))
    if side < 0:
        M = M @ Matrix.Scale(-1, 4, (0, 1, 0))
    B.merge(W, M)


# ============================================================ lofted body

class Body:
    """
    A body is a loft of cross-section rings along X. Each ring is a half profile (bottom-inner ->
    side -> shoulder -> top centre) mirrored to a closed loop. Ends can get a rounded/raked corner
    zone and are capped with a gridded fascia so lights and grilles can be assigned by region.
    """

    def __init__(self, P):
        self.P = P
        self.L = P["L"]
        self.xf, self.xr = P["L"] / 2, -P["L"] / 2
        self.w = P["W"] / 2 - P.get("bulge_max", 0.015)
        # corner zones: (x_start, x_end, rc, rk, rake_tab)
        self.zones = {}
        for end, sgn, xe in (("f", 1, self.xf), ("r", -1, self.xr)):
            c = P.get("corner_" + end)
            if c:
                rc, rk, rtab = c
                xs = xe - sgn * (rc + rk)
                self.zones[end] = (xs, xe, rc, rk, rtab, sgn)

    # ---------- profile lookups
    def zb(self, x):
        P = self.P
        z = table(P["zb_tab"], x)
        for (xa, Ra) in P["arches"]:
            dx = abs(x - xa)
            if dx <= Ra:
                z = max(z, P["R"] + math.sqrt(max(0.0, Ra * Ra - dx * dx)) - P.get("arch_drop", 0.0))
        return z

    def zt(self, x):
        return smooth_table(self.P["zt_tab"], x)

    def bulge(self, z):
        return table(self.P["bulge_tab"], z)

    def hw(self, x):
        """Body half-width at x (plan view), ignoring bulge and rake."""
        for (xs, xe, rc, rk, rtab, sgn) in self.zones.values():
            if (x - xs) * sgn > 0:
                s = min(1.0, (x - xs) / (xe - xs))
                u = math.asin(s) / (math.pi / 2)
                return self.w - rc + rc * math.cos(u * math.pi / 2)
        return self.w

    # ---------- ring
    def ring(self, st):
        """Half profile for a station. st = (x_nominal, zone or None, u)."""
        x, zone, u = st
        P = self.P
        zb, zt = self.zb(x), self.zt(x)
        h = max(zt - zb, 0.05)
        rb = min(P["rb"], h * 0.2)
        rt = min(P["rt"], h * 0.25)
        w = self.w
        pts = []
        wb = w + self.bulge(zb + rb)
        pts.append((wb - rb * 2.2, zb))
        pts.append((wb - rb * 0.29, zb + rb * 0.29))
        pts.append((wb, zb + rb))
        lo, hi = zb + rb, zt - rt
        br = P["breaks"]
        n = len(br)
        g = min(0.012, (hi - lo) / (n + 1))
        for k, zk in enumerate(br):
            zk = max(zk, lo + (k + 1) * g)
            zk = min(zk, hi - (n - k) * g)
            pts.append((w + self.bulge(zk), zk))
        ws = w + self.bulge(hi)
        pts.append((ws, hi))
        pts.append((ws - rt * 0.29, zt - rt * 0.29))
        pts.append((ws - rt, zt))
        cr = P["crown"]
        pts.append(((ws - rt) * 0.55, zt + cr * 0.8))
        pts.append((0.0, zt + cr))

        scale = 1.0
        xs_pts = [x] * len(pts)
        if zone:
            xs_, xe, rc, rk, rtab, sgn = self.zones[zone]
            scale = (w - rc + rc * math.cos(u * math.pi / 2)) / w
            su = math.sin(u * math.pi / 2)
            xs_pts = []
            for (y, z) in pts:
                hn = (z - zb) / h
                xs_pts.append(xs_ + sgn * (abs(xe - xs_) - table(rtab, hn)) * su)
        return [(xp, y * scale, z) for xp, (y, z) in zip(xs_pts, pts)]

    def stations(self, extra=()):
        P = self.P
        xs = set()
        lo = self.zones["r"][0] if "r" in self.zones else self.xr
        hi = self.zones["f"][0] if "f" in self.zones else self.xf
        xs.update([lo, hi])
        for (xa, Ra) in P["arches"]:
            for i in range(P.get("arch_steps", 8) + 1):
                a = math.pi * i / P.get("arch_steps", 8)
                xs.add(xa + Ra * math.cos(a))
            xs.add(xa + Ra + 0.003)
            xs.add(xa - Ra - 0.003)
        for (x, _) in P["zt_tab"]:
            xs.add(x)
        for x in P.get("seams", []):
            xs.add(x - 0.007)
            xs.add(x + 0.007)
        for x in extra:
            xs.add(x)
        xs = sorted(x for x in xs if lo - 1e-6 <= x <= hi + 1e-6)
        # merge near duplicates, then fill big gaps
        out = []
        for x in xs:
            if not out or x - out[-1] > 0.004:
                out.append(x)
        filled = [out[0]]
        step = P.get("max_step", 0.4)
        for x in out[1:]:
            gap = x - filled[-1]
            if gap > step:
                n = int(math.ceil(gap / step))
                x0 = filled[-1]
                for i in range(1, n):
                    filled.append(x0 + gap * i / n)
            filled.append(x)
        sts = []
        if "r" in self.zones:
            us = P.get("corner_us", [1.0, 0.8, 0.6, 0.4, 0.2])
            xs_, xe = self.zones["r"][0], self.zones["r"][1]
            for u in us:
                sts.append((xs_ + (xe - xs_) * math.sin(u * math.pi / 2), "r", u))
        for x in filled:
            sts.append((x, None, 0.0))
        if "f" in self.zones:
            us = P.get("corner_us", [1.0, 0.8, 0.6, 0.4, 0.2])
            xs_, xe = self.zones["f"][0], self.zones["f"][1]
            for u in reversed(us):
                sts.append((xs_ + (xe - xs_) * math.sin(u * math.pi / 2), "f", u))
        return sts

    def build(self, B, mat_fn, cap_fn, cap_bps, cap_uv=None, extra_stations=()):
        sts = self.stations(extra_stations)
        rings = []
        for st in sts:
            half = self.ring(st)
            n = len(half) - 1
            left = [B.v(p) for p in half]
            right = [B.v((p[0], -p[1], p[2])) for p in half[:-1]]
            # full loop: top centre, down the left side, across the bottom, up the right side
            loop = [(left[j], j, 1) for j in range(n, -1, -1)] + [(right[j], j, -1) for j in range(0, n)]
            rings.append((st, half, left, right, loop))
        flip_all = None
        faces = []
        for i in range(len(rings) - 1):
            st0, h0, _, _, L0 = rings[i]
            st1, h1, _, _, L1 = rings[i + 1]
            m = len(L0)
            for k in range(m):
                k2 = (k + 1) % m
                va, ja, sa = L0[k]
                vb, jb, sb = L0[k2]
                vc, vd = L1[k2][0], L1[k][0]
                if ja == 0 and jb == 0:
                    seg, side = -1, 0
                else:
                    seg = min(ja, jb)
                    side = sb if ja == n else sa
                c = (va.co + vb.co + vc.co + vd.co) / 4
                zone = st0[1] or st1[1]
                u = max(st0[2], st1[2])
                info = dict(seg=seg, side=side, zone=zone, u=u, x0=st0[0], x1=st1[0], n=n,
                            zb=self.zb((st0[0] + st1[0]) / 2), zt=self.zt((st0[0] + st1[0]) / 2))
                mat = mat_fn(c, info)
                uvc = None
                if isinstance(mat, tuple):
                    mat, uvc = mat
                f = B.face([va, vb, vc, vd], mat, uvfn=(lambda co, q=uvc: q) if uvc else None)
                if f:
                    faces.append((f, c, seg))
        # global orientation: the left side faces must point +y
        test = [f for (f, c, seg) in faces if seg > 2 and c.y > 0.1]
        if test and sum(f.normal.y for f in test) < 0:
            for (f, _, _) in faces:
                f.normal_flip()
        # caps
        for end, idx, sgn in (("r", 0, -1), ("f", len(rings) - 1, 1)):
            st, half, left, right, loop = rings[idx]
            self.cap(B, half, left, right, sgn, lambda y, z, e=end: cap_fn(e, y, z), cap_bps.get(end, []),
                     (lambda co, e=end: cap_uv(e, co)) if cap_uv else None)
        return rings

    def cap(self, B, half, left, right, sgn, mat_fn, bps, uvfn):
        n = len(half) - 1
        rows = []
        for j in range(n + 1):
            x, y, z = half[j]
            if j == n:
                rows.append([(0.0, left[n])])
                continue
            row = [(-y, right[j])]
            for yb in sorted(set(bps)):
                if abs(yb) < y - 0.012:
                    row.append((yb, B.v((x, yb, z))))
            row.append((y, left[j]))
            rows.append(row)
        out = Vector((sgn, 0, 0))
        for j in range(n):
            A, C = rows[j], rows[j + 1]
            i = k = 0
            while i < len(A) - 1 or k < len(C) - 1:
                if i < len(A) - 1 and k < len(C) - 1 and abs(A[i + 1][0] - C[k + 1][0]) < 1e-4:
                    vs = [A[i][1], A[i + 1][1], C[k + 1][1], C[k][1]]
                    i += 1
                    k += 1
                elif k >= len(C) - 1 or (i < len(A) - 1 and A[i + 1][0] <= C[k + 1][0]):
                    vs = [A[i][1], A[i + 1][1], C[k][1]]
                    i += 1
                else:
                    vs = [A[i][1], C[k + 1][1], C[k][1]]
                    k += 1
                c = sum((v.co for v in vs), Vector()) / len(vs)
                mat = mat_fn(c.y, c.z)
                fn = uvfn
                if isinstance(mat, tuple):
                    mat, q = mat
                    fn = (lambda co, q=q: q)
                B.face(vs, mat, out=out, uvfn=fn)

    def end_x(self, z, end):
        """Fascia x at height z on the end cap ('f' or 'r'), plus the fascia slope dx/dz there."""
        xs_, xe, rc, rk, rtab, sgn = self.zones[end]
        half = self.ring((xe, end, 1.0))
        for (x0, y0, z0), (x1, y1, z1) in zip(half[2:], half[3:]):
            if z0 <= z <= z1 and z1 > z0:
                t = (z - z0) / (z1 - z0)
                return lerp(x0, x1, t), (x1 - x0) / (z1 - z0)
        return xe, 0.0

    def side_y(self, x, z):
        """Outer surface y (left side) at x, z, from the ring polyline."""
        half = self.ring((x, None, 0.0))
        best = None
        for (x0, y0, z0), (x1, y1, z1) in zip(half, half[1:]):
            if min(z0, z1) <= z <= max(z0, z1) and abs(z1 - z0) > 1e-6:
                t = (z - z0) / (z1 - z0)
                y = lerp(y0, y1, t)
                best = y if best is None else max(best, y)
        return best if best is not None else self.w

    def top_z(self, x, y):
        top = self.ring((x, None, 0.0))[-3:]
        for (x0, y0, z0), (x1, y1, z1) in zip(top, top[1:]):
            if y1 <= abs(y) <= y0:
                return lerp(z0, z1, (y0 - abs(y)) / (y0 - y1))
        return top[0][2]


# ============================================================ greenhouse (cabin glass + roof)

def fillet_outline(ctrl, radii, samples=4):
    """ctrl: [(x,z)...]; radii per interior corner. Returns points + the straight segment each belongs to."""
    pts, tags = [Vector(ctrl[0])], [0]
    for i in range(1, len(ctrl) - 1):
        P = Vector(ctrl[i])
        a = (Vector(ctrl[i - 1]) - P)
        b = (Vector(ctrl[i + 1]) - P)
        r = radii[i - 1]
        q0 = P + a.normalized() * min(r, a.length * 0.45)
        q2 = P + b.normalized() * min(r, b.length * 0.45)
        for s in range(samples + 1):
            t = s / samples
            p = (1 - t) ** 2 * q0 + 2 * (1 - t) * t * P + t * t * q2
            pts.append(p)
            tags.append(i - 1 if s == 0 else (i if s == samples else -1))
    pts.append(Vector(ctrl[-1]))
    tags.append(len(ctrl) - 2)
    return pts, tags


def inset_poly(poly, dists):
    """Inset a convex polygon (list of 2D Vectors, CCW) with per-edge distances."""
    n = len(poly)
    lines = []
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        d = (b - a).normalized()
        nrm = Vector((-d.y, d.x))  # left normal = inward for CCW
        lines.append((a + nrm * dists[i], d))
    out = []
    for i in range(n):
        (p1, d1), (p2, d2) = lines[i - 1], lines[i]
        den = d1.x * d2.y - d1.y * d2.x
        if abs(den) < 1e-6:
            out.append(p2.copy())
            continue
        t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / den
        out.append(p1 + d1 * t)
    return out


def greenhouse(B, body, G):
    """
    G: ctrl (x,z) outline front-base -> ... -> rear-base, radii, z_base, inset, tumble, r (edge radius),
       pillar (windscreen pillar width), crown, glass_front, glass_rear (bools), pillars [(x_bottom, x_top, width)],
       frame (side window frame width).
    """
    pts, tags = fillet_outline(G["ctrl"], G["radii"], G.get("samples", 4))
    nseg = len(G["ctrl"]) - 1
    z0 = G["z_base"]
    r = G["r"]
    # 2D outward normals (outline runs front -> rear, i.e. x decreasing)
    segn = []
    for i in range(len(pts) - 1):
        d = (pts[i + 1] - pts[i]).normalized()
        segn.append(Vector((d.y, -d.x)))
    nrm = []
    for i in range(len(pts)):
        if i == 0:
            nn = segn[0]
        elif i == len(pts) - 1:
            nn = segn[-1]
        else:
            nn = (segn[i - 1] + segn[i]).normalized()
        nrm.append(nn)

    def halfw(x, z):
        return body.hw(x) - G["inset"] - G["tumble"] * (z - z0)

    rows = []
    for p, nn in zip(pts, nrm):
        w = halfw(p.x, p.y)
        wg = w - r - G["pillar"]
        cr = G["crown"]
        prof = [(w, -r), (w - r + r * 0.707, -r + r * 0.707), (w - r, cr * 0.15),
                (wg, cr * (1 - (wg / w) ** 2) + cr * 0.15), (wg * 0.5, cr * 0.8), (0.0, cr)]
        row = []
        for (y, off) in prof[:-1]:
            row.append(B.v((p.x + nn.x * off, -y, p.y + nn.y * off)))
        row.append(B.v((p.x + nn.x * prof[-1][1], 0.0, p.y + nn.y * prof[-1][1])))
        for (y, off) in reversed(prof[:-1]):
            row.append(B.v((p.x + nn.x * off, y, p.y + nn.y * off)))
        rows.append(row)
    ncol = len(rows[0])
    faces = []
    for i in range(len(rows) - 1):
        ta, tb = tags[i], tags[i + 1]
        glass_row = (ta == tb == 0 and G.get("glass_front", True)) or                     (ta == tb == nseg - 1 and G.get("glass_rear", True))
        for k in range(ncol - 1):
            a, b, c, d = rows[i][k], rows[i][k + 1], rows[i + 1][k + 1], rows[i + 1][k]
            mat = "paint"
            if glass_row and 3 <= k < ncol - 4:
                mat = "glass"
            f = B.face([a, b, c, d], mat)
            if f:
                faces.append(f)
    # roof faces must point up
    mid = len(rows) // 2
    if sum(f.normal.z for f in faces) < 0:
        for f in faces:
            f.normal_flip()
    # windscreen / rear glass flattened shading is handled by material-boundary sharpening

    # side windows: polygon of edge verts (+y side uses last column, -y uses first)
    for side, col in ((1, ncol - 1), (-1, 0)):
        outer = [rows[i][col] for i in range(len(rows))]
        poly = [Vector((v.co.x, v.co.z)) for v in outer]
        # make it CCW in (x, z): outline goes front->rear across the top, so reverse
        ccw = poly            # front-base -> over the top -> rear-base is CCW in (x, z)
        verts_ccw = outer
        nP = len(ccw)
        # edge i goes ccw[i] -> ccw[i+1]; the last edge (rear-base -> ... wait) closes front-base -> rear-base
        dists = [G["frame"]] * nP
        dists[-1] = G.get("frame_bottom", r + 0.012)
        inner = inset_poly(ccw, dists)
        recess = 0.008
        iv = []
        for p in inner:
            y = halfw(p.x, p.y) - recess
            iv.append(B.v((p.x, y * side, p.y)))
        outdir = (0, side, 0)
        for i in range(nP):
            j = (i + 1) % nP
            B.face([verts_ccw[i], verts_ccw[j], iv[j], iv[i]], G.get("frame_mat", "trim"), out=outdir)
        B.face(iv, "glass", out=outdir)
        # pillars across the glass (B / C pillars), as trim strips sitting at frame level
        for (xb, xt, pw) in G.get("pillars", []):
            # find z range of inner polygon near xb/xt
            def z_span(x):
                zs = []
                for i in range(nP):
                    a, b = inner[i], inner[(i + 1) % nP]
                    if (a.x - x) * (b.x - x) <= 0 and abs(b.x - a.x) > 1e-6:
                        t = (x - a.x) / (b.x - a.x)
                        zs.append(lerp(a.y, b.y, t))
                return (min(zs), max(zs)) if len(zs) >= 2 else (z0, z0 + 0.3)
            zl, _ = z_span(xb)
            _, zh = z_span(xt)
            zl -= 0.01
            zh += 0.01
            quad = []
            for (x, z) in ((xb - pw / 2, zl), (xb + pw / 2, zl), (xt + pw / 2, zh), (xt - pw / 2, zh)):
                y = halfw(x, z) + 0.002
                quad.append(B.v((x, y * side, z)))
            B.face(quad, G.get("pillar_mat", "trim"), out=outdir)
    return pts


# ============================================================ texture atlases

GLYPHS = {
    "T": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
    "A": [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "X": ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
    "I": [".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
    "D": ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
    "O": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    "W": ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
    "N": ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
    "P": ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
    "L": ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
    "C": [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
    "E": ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
    "M": ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
    "B": ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
    "U": ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    "S": [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
    "H": ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "R": ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
    "F": ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
    "Y": ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
    " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
}


def write_png(path, w, h, px):
    raw = b"".join(b"\x00" + bytes(px[y * w * 3:(y + 1) * w * 3]) for y in range(h))

    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    data += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(data)


class Canvas:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.px = [0] * (w * h * 3)

    def put(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            o = (y * self.w + x) * 3
            self.px[o:o + 3] = c

    def fill(self, x0, y0, x1, y1, c):
        for y in range(int(y0), int(y1)):
            for x in range(int(x0), int(x1)):
                self.put(x, y, c)

    def text(self, text, cx, y0, cell, ink, gap=1):
        """Blocky 5x7 text centred on cx. Returns the pixel bounds (x0, y0, x1, y1)."""
        adv = (5 + gap) * cell
        tw = len(text) * adv - gap * cell
        x0 = int(cx - tw / 2)
        for ci, ch in enumerate(text):
            for r, line in enumerate(GLYPHS[ch]):
                for c, on in enumerate(line):
                    if on == "#":
                        self.fill(x0 + ci * adv + c * cell, y0 + r * cell,
                                  x0 + ci * adv + (c + 1) * cell, y0 + (r + 1) * cell, ink)
        return (x0, y0, x0 + tw, y0 + 7 * cell)

    def uv(self, x0, y0, x1, y1):
        """Pixel rect -> (u0, v0, u1, v1) with v up."""
        return (x0 / self.w, 1 - y1 / self.h, x1 / self.w, 1 - y0 / self.h)

    def save(self, path):
        write_png(path, self.w, self.h, self.px)


# sign atlas regions (filled by build_atlas)
TAXI_UV = (0.0, 0.75, 1.0, 1.0)
TAXI_BG_UV = (0.03, 0.985)
DEST_UV = (0.0, 0.5, 1.0, 0.75)
SG = {}                     # lamp swatches: red, blue, amber, white -> (u, v)
STOP_C = (32 / 256, 32 / 256)   # STOP octagon centre (u, v)
STOP_APOTHEM = 30 / 256         # octagon apothem in UV units
# livery atlas regions (filled by build_livery)
LV = {}                     # swatches -> (u, v)
LVT = {}                    # text panels -> ((u0, v0, u1, v1), aspect w/h)
LV_REG = {}                 # "awning", "chevron" -> (u0, v0, u1, v1)


def build_atlas():
    """
    sign_atlas.png 256x256 (rows from the top):
      0-63 lit TAXI panel | 64-127 amber LED "DOWNTOWN" | 128-191 red/blue/amber/white lamp swatches
      192-255 STOP octagon (stop arm) in the first 64x64 cell
    """
    C = Canvas(256, 256)
    C.fill(0, 0, 256, 64, (255, 238, 185))
    cell = 7
    gw = 4 * 5 * cell + 3 * cell * 1.4
    x0, y0 = int((256 - gw) / 2), int((64 - 7 * cell) / 2)
    for ci, ch in enumerate("TAXI"):
        gx = x0 + int(ci * (5 * cell + cell * 1.4))
        for r, line in enumerate(GLYPHS[ch]):
            for c, on in enumerate(line):
                if on == "#":
                    C.fill(gx + c * cell, y0 + r * cell, gx + (c + 1) * cell, y0 + (r + 1) * cell, (28, 22, 16))
    # LED destination sign
    C.fill(0, 64, 256, 128, (6, 5, 4))
    text, cell = "DOWNTOWN", 5
    cols = len(text) * 6 - 1
    x0, y0 = (256 - cols * cell) // 2, 64 + (64 - 7 * cell) // 2
    for row in range(-2, 9):
        for col in range(-2, cols + 2):
            lit = False
            ci, cc = divmod(col, 6)
            if 0 <= row < 7 and 0 <= col < cols and cc < 5 and ci < len(text):
                lit = GLYPHS[text[ci]][row][cc] == "#"
            C.fill(x0 + col * cell, y0 + row * cell, x0 + col * cell + cell - 1, y0 + row * cell + cell - 1,
                   (255, 150, 25) if lit else (48, 26, 6))
    # lamp swatches
    for i, (name, col) in enumerate((("red", (255, 30, 25)), ("blue", (40, 90, 255)),
                                     ("amber", (255, 150, 20)), ("white", (255, 250, 240)))):
        C.fill(i * 64, 128, (i + 1) * 64, 192, col)
        SG[name] = ((i * 64 + 32) / 256, 1 - 160 / 256)
    # STOP octagon (white rim, red face, white letters)
    C.fill(0, 192, 256, 256, (20, 20, 20))
    a = 30
    for y in range(192, 256):
        for x in range(0, 64):
            dx, dy = abs(x + 0.5 - 32), abs(y + 0.5 - 224)
            if dx <= a and dy <= a and dx + dy <= a * 1.4142:
                inner = dx <= a - 3 and dy <= a - 3 and dx + dy <= (a - 3) * 1.4142
                C.put(x, y, (205, 18, 18) if inner else (255, 255, 255))
    C.text("STOP", 32, 224 - 7, 2, (255, 255, 255))
    C.save(ATLAS_PNG)


def build_livery():
    """
    livery_atlas.png 256x256, non-tinted decals (32 px bands from the top):
      0 swatches | 1 POLICE | 2 AMBULANCE | 3 SCHOOL BUS | 4 CITY TOURS | 5 STREET FOOD
      6 awning stripes | 7 hazard chevrons
    """
    C = Canvas(256, 256)
    sw = [("navy", (20, 34, 96)), ("red", (196, 22, 24)), ("white", (245, 245, 242)), ("black", (16, 16, 18)),
          ("yellow", (246, 178, 20)), ("jacket", (38, 52, 40)), ("blue", (34, 76, 170)), ("orange", (232, 104, 20))]
    for i, (name, col) in enumerate(sw):
        C.fill(i * 32, 0, (i + 1) * 32, 32, col)
        LV[name] = ((i * 32 + 16) / 256, 1 - 16 / 256)
    panels = [("POLICE", (255, 255, 255), (20, 34, 96)), ("AMBULANCE", (196, 22, 24), (245, 245, 242)),
              ("SCHOOL BUS", (16, 16, 18), (246, 178, 20)), ("CITY TOURS", (250, 206, 40), (16, 16, 18)),
              ("STREET FOOD", (255, 255, 255), (196, 22, 24))]
    for i, (text, ink, bg) in enumerate(panels):
        y0 = 32 * (i + 1)
        C.fill(0, y0, 256, y0 + 32, bg)
        x0, ty0, x1, ty1 = C.text(text, 128, y0 + 5, 3, ink)
        rect = C.uv(x0 - 4, ty0 - 3, x1 + 4, ty1 + 3)
        LVT[text] = (rect, (x1 - x0 + 8) / (ty1 - ty0 + 6))
    for y in range(192, 224):
        for x in range(256):
            C.put(x, y, (200, 24, 24) if (x // 16) % 2 == 0 else (245, 242, 230))
    LV_REG["awning"] = C.uv(0, 196, 256, 220)
    for y in range(224, 256):
        for x in range(256):
            C.put(x, y, (210, 20, 20) if ((x + y) // 16) % 2 == 0 else (245, 245, 240))
    LV_REG["chevron"] = C.uv(0, 226, 256, 254)
    C.save(LIVERY_PNG)


def sgn_uv(name):
    return lambda co, n=None: SG[name]


def lv_uv(name):
    return lambda co, n=None: LV[name]


# ============================================================ vehicles

def shut_strip(B, body, xs, y, width=0.012, lift=0.003, mat="trim"):
    """Thin trim strip lying on the top surface along x at lateral offset y (both sides)."""
    for s in (1, -1):
        prev = None
        for x in xs:
            z = body.top_z(x, y) + lift
            a = B.v((x, s * (y - width / 2), z))
            b = B.v((x, s * (y + width / 2), z))
            if prev:
                B.face([prev[0], prev[1], b, a], mat, out=(0, 0, 1))
            prev = (a, b)


def seam_strip(B, body, x, sides=(1, -1), z_lo=None, z_hi=None, width=0.012):
    """Dark door shut-line lying on the body side at x (follows the ring from sill to shoulder)."""
    half = body.ring((x, None, 0.0))
    nb = len(body.P["breaks"])
    side_pts = half[2:2 + nb + 2]
    if z_lo is not None:
        side_pts = [p for p in side_pts if p[2] >= z_lo - 1e-4]
    if z_hi is not None:
        side_pts = [p for p in side_pts if p[2] <= z_hi + 1e-4]
    for s in sides:
        prev = None
        for (_, y, z) in side_pts:
            a = B.v((x - width / 2, s * (y + 0.0025), z))
            b = B.v((x + width / 2, s * (y + 0.0025), z))
            if prev:
                B.face([prev[0], prev[1], b, a], "trim", out=(0, s, 0))
            prev = (a, b)


def grille(B, body, z0, z1, w, bars=1, depth=0.05, bevel=0.022):
    """Grille plate on the front fascia: dark face, chrome (rim) bevelled surround and slats."""
    zm = (z0 + z1) / 2
    x, slope = body.end_x(zm, "f")
    ang = math.atan(slope)
    M = Matrix.Rotation(ang, 4, "Y")
    rbox(B, (x - depth / 2 + 0.02, 0, zm), (depth, 2 * w, z1 - z0), "trim", bevel=bevel,
         mat_fn=lambda n: "trim" if n.x > 0.85 else "chrome", M=M)
    for i in range(bars):
        zb = z0 + (z1 - z0) * (i + 1) / (bars + 1)
        xb, _ = body.end_x(zb, "f")
        rbox(B, (xb + 0.022, 0, zb), (0.02, 2 * w - 0.05, 0.022), "chrome", bevel=0.0, M=M)


def lamp(B, x, y, z, size, lens="light_front", housing="trim", facing=1):
    """Separate lamp unit: dark housing with a lens sitting proud of it."""
    hx, hy, hz = size
    rbox(B, (x, y, z), (hx, hy + 0.04, hz + 0.04), housing, bevel=0.015)
    rbox(B, (x + facing * hx / 2, y, z), (0.02, hy, hz), lens, bevel=0.006)


def door_handle(B, body, x, z, w=0.13):
    for s in (1, -1):
        y = body.side_y(x, z)
        rbox(B, (x, s * (y + 0.008), z), (w, 0.03, 0.03), "trim", bevel=0.0)


def mirror(B, x, y, z, s, size=(0.09, 0.2, 0.12), arm=0.08):
    hx, hy, hz = size
    rbox(B, (x, s * (y + arm + hy / 2), z), size, "paint", bevel=0.025, segs=1,
         mat_fn=lambda n: "glass" if n.x < -0.8 else "paint")
    rbox(B, (x + 0.01, s * (y + arm / 2), z - 0.03), (0.05, arm + 0.02, 0.03), "trim", bevel=0.008)


def car(name, P, G, extras=None):
    B = Builder()
    body = Body(P)
    L2 = P["L"] / 2
    hl, tl, gr, it = P["head"], P["tail"], P["grille"], P["intake"]
    seams = P.get("seams", [])
    clad = P.get("cladding", 0.0)

    def mat_fn(c, info):
        seg, zone, u = info["seg"], info["zone"], info["u"]
        if seg <= 0:
            return "trim"
        if P.get("mat_hook"):
            r = P["mat_hook"](c, info, body)
            if r:
                return r
        if seg == 1 and clad > 0:
            return "trim"
        if zone == "f" and u >= hl.get("u", 0.5) and hl["z0"] <= c.z <= hl["z1"]:
            return "light_front"
        if zone == "r" and u >= tl.get("u", 0.45) and tl["z0"] <= c.z <= tl["z1"]:
            return "light_rear"
        if zone and c.z < P.get("valance", 0.0):
            return "trim"
        if clad > 0 and c.z < info["zb"] + clad and abs(c.y) > 0.3:
            return "trim"
        for sx in seams:
            if abs((info["x0"] + info["x1"]) / 2 - sx) < 0.004 and abs(c.y) > body.w - 0.1 and \
                    info["zb"] + 0.03 < c.z < P["belt"] - 0.02:
                return "trim"
        return "paint"

    def cap_fn(end, y, z):
        ay = abs(y)
        if P.get("cap_hook"):
            r = P["cap_hook"](end, y, z)
            if r:
                return r
        if end == "f":
            if hl["z0"] <= z <= hl["z1"] and ay > hl["y_in"]:
                return "light_front"
            if gr["z0"] <= z <= gr["z1"] and ay < gr["w"]:
                return "trim"
            if it["z0"] <= z <= it["z1"] and ay < it["w"]:
                return "trim"
            if z < P.get("valance", 0.0):
                return "trim"
        else:
            if tl["z0"] <= z <= tl["z1"] and ay > tl["y_in"]:
                return "light_rear"
            if z < P.get("valance", 0.0):
                return "trim"
            if P.get("plate") and P["plate"][0] <= z <= P["plate"][1] and ay < 0.27:
                return "trim"
        return "paint"

    bps_f = [hl["y_in"], gr["w"], it["w"]] + P.get("extra_bps", {}).get("f", [])
    bps_r = [tl["y_in"]] + ([0.27] if P.get("plate") else []) + P.get("extra_bps", {}).get("r", [])
    bps = {"f": sorted(set([b for b in bps_f] + [-b for b in bps_f])),
           "r": sorted(set([b for b in bps_r] + [-b for b in bps_r]))}
    body.build(B, mat_fn, cap_fn, bps)
    print(f"[vehicles]   {name} body loft: {B.tris()}")
    t0 = B.tris()

    if G:
        greenhouse(B, body, G)
        mx = G["ctrl"][0][0] - 0.16
        mz = G["z_base"] + 0.1
        for s in (1, -1):
            mirror(B, mx, body.hw(mx) - G["inset"] + 0.01, mz, s)
    for (x, z) in P.get("handles", []):
        door_handle(B, body, x, z)
    for sx in P.get("seam_strips", []):
        seam_strip(B, body, sx)
    if P.get("grille_bars") is not None:
        grille(B, body, gr["z0"] + 0.015, gr["z1"] - 0.015, gr["w"] - 0.01, bars=P["grille_bars"])
    if P.get("hood_lines"):
        x0, x1 = P["hood_lines"]
        xs = [lerp(x0, x1, i / 6) for i in range(7)]
        shut_strip(B, body, xs, body.w - 0.13)

    print(f"[vehicles]   {name} greenhouse+details: {B.tris() - t0}")
    W = wheel(P["R"], P["tw"], segs=P.get("wheel_segs", 15), style=P.get("wheel_style", "alloy"),
              rim_frac=P.get("rim_frac", 0.64))
    print(f"[vehicles]   {name} wheel: {W.tris()} each")
    yo = body.w + 0.01
    for (xa, _) in P["arches"]:
        for s in (1, -1):
            add_wheel(B, W, xa, yo, P["R"], s)
    if extras:
        extras(B, body)
    return B


# ------------------------------------------------------------ sedan

def sedan_params(L=4.6, W=1.85, belt=0.96, R=0.33):
    xf = L / 2
    ax_f, ax_r = xf - 0.95, xf - 0.95 - 2.75
    return dict(
        L=L, W=W, R=R, tw=0.225, belt=belt,
        arches=[(ax_f, R + 0.075), (ax_r, R + 0.075)],
        zb_tab=[(-xf, 0.32), (-xf + 0.45, 0.24), (xf - 0.45, 0.24), (xf, 0.30)],
        zt_tab=[(-xf, 0.90), (-xf + 0.22, 0.99), (-1.6, 1.0), (-1.3, belt), (0.9, belt), (1.5, 0.89),
                (xf - 0.25, 0.83), (xf, 0.76)],
        bulge_tab=[(0.2, -0.03), (0.42, 0.0), (0.64, 0.016), (0.84, 0.012), (1.0, -0.012)],
        bulge_max=0.016,
        rb=0.07, rt=0.06, crown=0.035,
        breaks=[0.40, 0.48, 0.62, 0.74],
        corner_f=(0.32, 0.16, [(0.0, 0.07), (0.25, 0.0), (0.55, 0.03), (1.0, 0.16)]),
        corner_r=(0.30, 0.08, [(0.0, 0.07), (0.3, 0.0), (0.75, 0.0), (1.0, 0.08)]),
        head=dict(z0=0.62, z1=0.74, y_in=0.40, u=0.6),
        tail=dict(z0=0.74, z1=0.92, y_in=0.36, u=0.6),
        grille=dict(z0=0.48, z1=0.74, w=0.34),
        intake=dict(z0=0.30, z1=0.40, w=0.62),
        valance=0.30, plate=(0.48, 0.62),
        seam_strips=[0.93, -0.02, -0.98], grille_bars=1, arch_steps=6,
        handles=[(0.62, 0.86), (-0.38, 0.86)],
        hood_lines=(0.98, xf - 0.30),
        max_step=0.5,
    )


def sedan_gh(belt=0.96, top=1.405, ws=(1.0, 0.12), rear=(-0.92, -1.55), body_w=1.85):
    return dict(
        ctrl=[(ws[0], belt - 0.01), (ws[1], top), (rear[0], top + 0.005), (rear[1], belt + 0.03)],
        radii=[0.22, 0.30], z_base=belt - 0.01, inset=0.075, tumble=0.32, r=0.05, pillar=0.07,
        crown=0.03, frame=0.035, pillars=[(-0.02, 0.0, 0.075)],
    )


def build_sedan():
    P = sedan_params()
    G = sedan_gh()
    return car("sedan", P, G)


# ------------------------------------------------------------ cab (NYC taxi-style sedan)

def build_cab():
    L, W, belt = 4.95, 1.9, 0.98
    P = sedan_params(L=L, W=W, belt=belt, R=0.335)
    xf = L / 2
    ax_f, ax_r = xf - 1.0, xf - 1.0 - 2.9
    P["arches"] = [(ax_f, 0.41), (ax_r, 0.41)]
    P["zt_tab"] = [(-xf, 0.92), (-xf + 0.22, 1.01), (-1.75, 1.02), (-1.42, belt), (0.95, belt), (1.6, 0.90),
                   (xf - 0.25, 0.84), (xf, 0.77)]
    P["seam_strips"] = [0.98, -0.05, -1.08]
    P["handles"] = [(0.66, 0.88), (-0.42, 0.88)]
    P["hood_lines"] = (1.05, xf - 0.30)
    G = sedan_gh(belt=belt, top=1.50, ws=(1.05, 0.16), rear=(-1.02, -1.70))
    G["radii"] = [0.22, 0.28]

    def extras(B, body):
        # roof light box ("TAXI" both ways), on a trim base
        zr = 1.50 + 0.03
        rbox(B, (-0.25, 0, zr + 0.02), (0.20, 0.62, 0.04), "trim", bevel=0.012)
        bw, bd, bh = 0.78, 0.17, 0.22

        def uv(co, n):
            # front/back faces show TAXI; everything else samples the lit background
            if abs(n.x) > 0.7:
                u = (co.y / bw + 0.5) if n.x > 0 else (0.5 - co.y / bw)
                v = co.z / bh + 0.5
                u0, v0, u1, v1 = TAXI_UV
                return (lerp(u0, u1, min(max(u, 0), 1)), lerp(v0, v1, min(max(v, 0), 1)))
            return TAXI_BG_UV
        rbox(B, (-0.25, 0, zr + 0.04 + bh / 2), (bd, bw, bh), "sign", bevel=0.03, segs=2,
             mat_fn=lambda n: "trim" if n.z < -0.5 else "sign", uvfn=uv)
    return car("cab", P, G, extras)


# ------------------------------------------------------------ SUV

def build_suv():
    L, W, R = 4.9, 1.95, 0.375
    xf = L / 2
    belt = 1.13
    ax_f, ax_r = xf - 0.92, xf - 0.92 - 2.95
    P = dict(
        L=L, W=W, R=R, tw=0.25, belt=belt,
        arches=[(ax_f, R + 0.085), (ax_r, R + 0.085)],
        zb_tab=[(-xf, 0.42), (-xf + 0.4, 0.33), (xf - 0.4, 0.33), (xf, 0.42)],
        zt_tab=[(-xf, 1.08), (-xf + 0.2, belt), (1.05, belt), (1.6, 1.07), (xf - 0.25, 1.02), (xf, 0.95)],
        bulge_tab=[(0.3, -0.02), (0.5, 0.0), (0.75, 0.018), (1.0, 0.012), (1.15, -0.01)],
        bulge_max=0.018,
        rb=0.07, rt=0.06, crown=0.03,
        breaks=[0.50, 0.58, 0.78, 0.92, 1.03],
        corner_f=(0.30, 0.12, [(0.0, 0.06), (0.3, 0.0), (0.6, 0.02), (1.0, 0.12)]),
        corner_r=(0.26, 0.05, [(0.0, 0.05), (0.25, 0.0), (1.0, 0.03)]),
        head=dict(z0=0.78, z1=0.92, y_in=0.50, u=0.6),
        tail=dict(z0=0.78, z1=1.03, y_in=0.62, u=0.5),
        grille=dict(z0=0.58, z1=0.92, w=0.46),
        intake=dict(z0=0.42, z1=0.50, w=0.66),
        valance=0.50, plate=(0.58, 0.76),
        cladding=0.10,
        seam_strips=[1.00, 0.0, -1.03], grille_bars=2, arch_steps=6,
        handles=[(0.70, 1.03), (-0.36, 1.03)],
        hood_lines=(1.12, xf - 0.30),
        max_step=0.5,
    )
    G = dict(
        ctrl=[(1.12, belt - 0.01), (0.30, 1.735), (-1.95, 1.745), (-2.30, belt + 0.02)],
        radii=[0.20, 0.16], z_base=belt - 0.01, inset=0.08, tumble=0.18, r=0.055, pillar=0.075,
        crown=0.025, frame=0.035, pillars=[(0.03, 0.05, 0.08), (-1.20, -1.20, 0.1)],
    )

    def extras(B, body):
        # roof rails
        for s in (1, -1):
            y = 0.62
            tube(B, (0.15, s * y, 1.755), (-1.85, s * y, 1.755), 0.018, "trim", segs=5)
            for x in (0.1, -0.85, -1.8):
                rbox(B, (x, s * y, 1.74), (0.08, 0.04, 0.05), "trim", bevel=0.01)
    return car("suv", P, G, extras)


# ------------------------------------------------------------ van (delivery)

def build_van():
    L, W, R = 5.5, 2.0, 0.36
    xf = L / 2
    belt = 1.18
    ax_f, ax_r = xf - 0.95, xf - 0.95 - 3.66
    roof = 2.34
    P = dict(
        L=L, W=W, R=R, tw=0.235, belt=belt,
        arches=[(ax_f, R + 0.08), (ax_r, R + 0.08)], arch_steps=6,
        zb_tab=[(-xf, 0.40), (-xf + 0.4, 0.34), (xf - 0.4, 0.34), (xf, 0.40)],
        zt_tab=[(-xf, roof - 0.04), (-xf + 0.15, roof), (0.55, roof), (0.95, 2.12), (1.62, 1.20),
                (2.30, 1.06), (xf, 0.95)],
        bulge_tab=[(0.3, -0.015), (0.55, 0.0), (0.9, 0.018), (1.2, 0.012), (2.4, -0.10)],
        bulge_max=0.018,
        rb=0.06, rt=0.10, crown=0.04,
        breaks=[0.52, 0.62, 0.80, 0.96, 1.18, 1.96],
        corner_f=(0.30, 0.10, [(0.0, 0.05), (0.25, 0.0), (0.6, 0.02), (1.0, 0.10)]),
        corner_r=(0.14, 0.02, [(0.0, 0.03), (0.2, 0.0), (1.0, 0.02)]),
        corner_us=[1.0, 0.75, 0.5, 0.25],
        head=dict(z0=0.80, z1=0.96, y_in=0.52, u=0.6),
        tail=dict(z0=0.80, z1=1.96, y_in=0.86, u=0.5),
        grille=dict(z0=0.62, z1=0.96, w=0.44),
        intake=dict(z0=0.40, z1=0.52, w=0.70),
        valance=0.52,
        cladding=0.10,
        handles=[(1.05, 1.08), (0.40, 1.08)],
        max_step=0.45,
    )
    body = Body(P)
    B = Builder()
    rw = (0.10, 0.84)   # rear door windows |y| range
    sw = (0.60, 1.52)   # front door glass x range

    def mat_fn(c, info):
        seg, zone, u = info["seg"], info["zone"], info["u"]
        xm = (info["x0"] + info["x1"]) / 2
        if seg <= 1:
            return "trim"
        if zone == "f" and u >= 0.6 and 0.80 <= c.z <= 0.96:
            return "light_front"
        if zone == "r" and u >= 0.5 and 0.80 <= c.z <= 1.96 and abs(c.y) > 0.86:
            return "light_rear"
        if zone and c.z < 0.52:
            return "trim"
        if c.z < info["zb"] + 0.10 and abs(c.y) > 0.3:
            return "trim"
        # windscreen: top faces on the sloped section
        if 0.95 < xm < 1.62 and c.z > 1.22 and abs(c.y) < body.w - 0.16:
            return "glass"
        # cab door glass
        if sw[0] < xm < sw[1] and belt + 0.02 < c.z < 1.96 and abs(c.y) > body.w - 0.2:
            return "glass"
        return "paint"

    def cap_fn(end, y, z):
        ay = abs(y)
        if end == "f":
            if 0.80 <= z <= 0.96 and ay > 0.52:
                return "light_front"
            if 0.62 <= z <= 0.96 and ay < 0.44:
                return "trim"
            if z < 0.52:
                return "trim"
            return "paint"
        if z < 0.52:
            return "trim"
        if ay < 0.006:
            return "trim"
        if 0.80 <= z <= 1.96 and ay > 0.86:
            return "light_rear"
        if 1.18 <= z <= 1.96 and rw[0] < ay < rw[1]:
            return "glass"
        return "paint"
    bps = {"f": [-0.52, -0.44, 0.44, 0.52], "r": [-0.86, -0.84, -0.10, -0.006, 0.006, 0.10, 0.84, 0.86]}
    body.build(B, mat_fn, cap_fn, bps, extra_stations=[0.95, 1.62, 0.60, 1.52])
    for (x, z) in P["handles"]:
        door_handle(B, body, x, z)
    seam_strip(B, body, 1.56, z_hi=1.3)
    seam_strip(B, body, 0.60, z_hi=2.0)
    seam_strip(B, body, -0.95, sides=(-1,), z_hi=2.0)
    grille(B, body, 0.64, 0.94, 0.43, bars=2)
    # sliding door rail
    y = body.side_y(-0.4, 1.96)
    rbox(B, (-1.5, -(y + 0.006), 1.97), (1.1, 0.025, 0.03), "trim", bevel=0.008)
    # mirrors (big commercial ones)
    for s in (1, -1):
        mirror(B, 1.30, body.w - 0.04, 1.42, s, size=(0.08, 0.16, 0.26), arm=0.12)
    # protective side mouldings between the arches
    xa0, xa1 = P["arches"][1][0] + 0.5, P["arches"][0][0] - 0.5
    for s in (1, -1):
        y = body.side_y((xa0 + xa1) / 2, 0.72)
        rbox(B, ((xa0 + xa1) / 2, s * (y + 0.006), 0.72), (xa1 - xa0, 0.03, 0.09), "trim", bevel=0.012)
    # rear step bumper
    rbox(B, (-L / 2 + 0.05, 0, 0.42), (0.18, 1.6, 0.10), "trim", bevel=0.02)
    Wh = wheel(R, 0.235, segs=15, style="steel")
    for (xa, _) in P["arches"]:
        for s in (1, -1):
            add_wheel(B, Wh, xa, body.w + 0.005, R, s)
    return B


# ------------------------------------------------------------ bus

def build_bus():
    L, W, R = 12.0, 2.6, 0.50
    xf = L / 2
    ax_f, ax_r = xf - 2.65, xf - 2.65 - 6.0
    roof = 2.96
    win = (1.20, 2.48)
    P = dict(
        L=L, W=W, R=R, tw=0.30,
        arches=[(ax_f, R + 0.09), (ax_r, R + 0.09)], arch_steps=8,
        zb_tab=[(-xf, 0.42), (-xf + 0.5, 0.34), (xf - 0.5, 0.33), (xf, 0.38)],
        zt_tab=[(-xf, roof - 0.04), (-xf + 0.2, roof), (xf - 0.3, roof), (xf, roof - 0.06)],
        bulge_tab=[(0.3, -0.01), (0.6, 0.0), (1.2, 0.012), (2.5, 0.0), (3.0, -0.03)],
        bulge_max=0.012,
        rb=0.06, rt=0.16, crown=0.03,
        breaks=[0.62, 0.95, win[0], win[1], 2.62, 2.80],
        corner_f=(0.22, 0.14, [(0.0, 0.05), (0.12, 0.0), (0.4, 0.0), (0.8, 0.10), (1.0, 0.14)]),
        corner_r=(0.22, 0.03, [(0.0, 0.03), (0.15, 0.0), (1.0, 0.02)]),
        corner_us=[1.0, 0.7, 0.4],
        max_step=1.6,
    )
    body = Body(P)
    B = Builder()
    # window pillars (x positions) and doors
    pillars = [-5.25, -3.95, -2.55, -1.2, 1.0, 2.25, 3.4] + [4.45]
    door_f = (4.05, 5.30)   # front door ahead of the front wheel arch
    door_r = (-0.62, 0.62)
    extra = []
    for p in pillars:
        extra += [p - 0.06, p + 0.06]
    for d in (door_f, door_r):
        extra += [d[0], d[1], (d[0] + d[1]) / 2 - 0.01, (d[0] + d[1]) / 2 + 0.01]
    extra += [xf - 0.9]

    def in_door(xm, c):
        for (a, b) in (door_f, door_r):
            if a < xm < b and c.y < 0:
                return (a, b)
        return None

    def mat_fn(c, info):
        seg, zone, u = info["seg"], info["zone"], info["u"]
        xm = (info["x0"] + info["x1"]) / 2
        if seg <= 1:
            return "trim"
        side = abs(c.y) > body.w - 0.12
        if zone == "r" and u >= 0.6 and 0.95 <= c.z <= win[0]:
            return "light_rear"
        if c.z < 0.62 and zone:
            return "trim"
        d = in_door(xm, c)
        if d and side and c.z < 2.62:
            if abs(xm - d[0]) < 0.02 or abs(xm - d[1]) < 0.02 or abs(xm - (d[0] + d[1]) / 2) < 0.012:
                return "trim"
            return "glass" if c.z > 0.95 else "trim"
        if side and win[0] <= c.z <= win[1]:
            for p in pillars:
                if abs(xm - p) < 0.065:
                    return "paint"
            if zone == "f" and u > 0.3:
                return "glass"
            if xm < -xf + 0.3:
                return "paint"
            return "glass"
        if zone == "f" and u >= 0.7 and 0.95 < c.z < 2.62:
            return "glass"
        return "paint"

    sign_w = 0.82

    def cap_fn(end, y, z):
        ay = abs(y)
        if end == "f":
            if 2.62 <= z <= 2.80 and ay < sign_w:
                return "sign"
            if 0.95 <= z <= 2.62 and ay < body.w - 0.14:
                return "glass"
            if z < 0.62:
                return "trim"
            return "paint"
        if z < 0.62:
            return "trim"
        if 0.95 <= z <= win[0] and ay > 0.9:
            return "light_rear"
        if 1.80 <= z <= win[1] and ay < 0.95:
            return "glass"
        if 0.62 <= z <= win[0] and ay < 0.75:
            return "trim"   # engine grille
        return "paint"

    def cap_uv(end, co):
        if end == "f":
            u0, v0, u1, v1 = DEST_UV
            u = (co.y + sign_w) / (2 * sign_w)
            v = (co.z - 2.62) / 0.18
            return (lerp(u0, u1, min(max(u, 0), 1)), lerp(v0, v1, min(max(v, 0), 1)))
        return (0.0, 0.0)
    bps = {"f": [-1.16, -sign_w, -0.84, 0.84, sign_w, 1.16], "r": [-0.95, -0.9, -0.75, 0.75, 0.9, 0.95]}
    body.build(B, mat_fn, cap_fn, bps, cap_uv=cap_uv, extra_stations=extra)

    # headlight clusters either side of the front, below the windscreen
    for s in (1, -1):
        x, _ = body.end_x(0.78, "f")
        rbox(B, (x - 0.01, s * 0.86, 0.78), (0.06, 0.40, 0.24), "trim", bevel=0.03)
        for dy in (-0.09, 0.09):
            rbox(B, (x + 0.02, s * (0.86 + dy), 0.79), (0.03, 0.15, 0.13), "light_front", bevel=0.02)
    # roof AC pod
    rbox(B, (-3.2, 0, roof + 0.14), (2.6, 1.7, 0.26), "paint", bevel=0.08, segs=2)
    rbox(B, (2.6, 0, roof + 0.06), (0.9, 0.9, 0.1), "trim", bevel=0.03)   # roof hatch
    # bike rack (folded down in front of the bumper)
    xb = xf + 0.05
    for s in (1, -1):
        tube(B, (xb, s * 0.45, 0.55), (xb + 0.30, s * 0.45, 0.62), 0.022, "trim", segs=5)
        tube(B, (xb + 0.30, s * 0.45, 0.62), (xb + 0.30, s * 0.45, 0.98), 0.022, "trim", segs=5)
    tube(B, (xb + 0.30, -0.45, 0.98), (xb + 0.30, 0.45, 0.98), 0.022, "trim", segs=5)
    for zz, xx in ((0.64, 0.12), (0.66, 0.24)):
        rbox(B, (xb + xx, 0, zz), (0.07, 1.25, 0.03), "trim", bevel=0.008)
    # front bumper
    rbox(B, (xf - 0.02, 0, 0.47), (0.16, 2.3, 0.22), "trim", bevel=0.05, segs=2)
    rbox(B, (-xf + 0.02, 0, 0.50), (0.14, 2.4, 0.22), "trim", bevel=0.05, segs=2)
    # mirrors on arms out front
    for s in (1, -1):
        y0 = body.w - 0.05
        tube(B, (xf - 0.15, s * y0, 2.55), (xf + 0.25, s * (y0 + 0.18), 2.45), 0.02, "trim", segs=5)
        rbox(B, (xf + 0.28, s * (y0 + 0.2), 2.18), (0.07, 0.22, 0.42), "trim", bevel=0.03,
             mat_fn=lambda n: "glass" if n.x < -0.8 else "trim")
    # rub rail along both sides
    for s in (1, -1):
        y = body.side_y(0.0, 0.70)
        for (a, b) in ((ax_r + 0.72, ax_f - 0.72),):
            rbox(B, ((a + b) / 2, s * (y + 0.01), 0.70), (b - a, 0.03, 0.06), "trim", bevel=0.012)
    Wh = wheel(R, 0.30, segs=18, style="steel", rim_frac=0.6)
    for (xa, _) in P["arches"]:
        for s in (1, -1):
            add_wheel(B, Wh, xa, body.w - 0.01, R, s)
    return B


# ------------------------------------------------------------ box truck (cab-over)

def build_truck():
    L, Wbox, R = 8.5, 2.5, 0.44
    xf = L / 2
    cab_len, cab_w, cab_h = 2.05, 2.0, 2.55
    ax_f, ax_r = xf - 1.15, xf - 1.15 - 4.7
    xcr = xf - cab_len   # cab back
    P = dict(
        L=cab_len, W=cab_w, R=R, tw=0.25,
        arches=[(ax_f - (xf - cab_len / 2), R + 0.08)], arch_steps=8,
        zb_tab=[(-cab_len / 2, 0.62), (cab_len / 2 - 0.3, 0.62), (cab_len / 2, 0.48)],
        zt_tab=[(-cab_len / 2, cab_h), (cab_len / 2 - 0.3, cab_h), (cab_len / 2, cab_h - 0.05)],
        bulge_tab=[(0.4, -0.01), (0.8, 0.0), (1.5, 0.01), (2.6, -0.04)],
        bulge_max=0.01,
        rb=0.05, rt=0.14, crown=0.03,
        breaks=[0.68, 0.84, 1.00, 1.42, 1.50, 2.32],
        corner_f=(0.20, 0.18, [(0.0, 0.05), (0.12, 0.0), (0.45, 0.02), (0.6, 0.06), (1.0, 0.18)]),
        corner_us=[1.0, 0.7, 0.4],
        max_step=0.5,
    )
    cab = Body(P)
    B = Builder()
    belt = 1.50
    c2 = cab_len / 2

    def mat_fn(c, info):
        seg, zone, u = info["seg"], info["zone"], info["u"]
        xm = (info["x0"] + info["x1"]) / 2
        if seg <= 1:
            return "trim"
        side = abs(c.y) > cab.w - 0.12
        if zone == "f" and u >= 0.7 and 1.50 <= c.z <= 2.32:
            return "glass"
        if c.z < 0.84 and (zone or side):
            return "trim"
        if side and -0.62 < xm < 0.55 and belt <= c.z <= 2.32:
            return "glass"
        if side and abs(xm - (-0.66)) < 0.012 and c.z > info["zb"]:
            return "trim"
        return "paint"

    def cap_fn(end, y, z):
        ay = abs(y)
        if end == "f":
            if 1.50 <= z <= 2.32 and ay < cab.w - 0.16:
                return "glass"
            if 0.84 <= z <= 1.42 and ay < 0.55:
                return "trim"
            if z < 0.84:
                return "trim"
        return "paint"
    bps = {"f": [-0.84, -0.62, -0.55, 0.55, 0.62, 0.84], "r": []}
    cab.build(B, mat_fn, cap_fn, bps, extra_stations=[-0.62, 0.55, -0.678, -0.654])
    # mirrors
    for s in (1, -1):
        tube(B, (c2 - 0.25, s * (cab.w - 0.02), 1.95), (c2 - 0.1, s * (cab.w + 0.22), 1.95), 0.016, "trim", 5)
        tube(B, (c2 - 0.25, s * (cab.w - 0.02), 1.55), (c2 - 0.1, s * (cab.w + 0.22), 1.6), 0.016, "trim", 5)
        rbox(B, (c2 - 0.1, s * (cab.w + 0.24), 1.78), (0.07, 0.18, 0.40), "trim", bevel=0.025,
             mat_fn=lambda n: "glass" if n.x < -0.8 else "trim")
    door_handle(B, cab, -0.5, 1.38)
    for s in (1, -1):
        x, _ = cab.end_x(0.92, "f")
        rbox(B, (x - 0.01, s * 0.74, 0.92), (0.06, 0.30, 0.18), "trim", bevel=0.025)
        rbox(B, (x + 0.02, s * 0.74, 0.92), (0.03, 0.24, 0.12), "light_front", bevel=0.02)
    grille(B, cab, 1.06, 1.40, 0.53, bars=3)
    # front bumper + step
    rbox(B, (c2 + 0.02, 0, 0.62), (0.18, cab_w + 0.04, 0.24), "trim", bevel=0.05, segs=2)
    for s in (1, -1):
        rbox(B, (-0.05, s * (cab.w - 0.05), 0.48), (0.55, 0.22, 0.06), "trim", bevel=0.015)
    # move cab into place
    Mcab = Matrix.Translation((xf - c2, 0, 0))
    bmesh.ops.transform(B.bm, matrix=Mcab, verts=list(B.bm.verts))

    # cargo box
    box_x0, box_x1 = -xf, xcr - 0.12
    bz0, bz1 = 1.08, 3.4
    rbox(B, ((box_x0 + box_x1) / 2, 0, (bz0 + bz1) / 2), (box_x1 - box_x0, Wbox, bz1 - bz0), "paint",
         bevel=0.05, segs=2)
    # box details: bottom rail, corner posts, roll-up door slats
    for s in (1, -1):
        rbox(B, ((box_x0 + box_x1) / 2, s * (Wbox / 2 + 0.005), bz0 + 0.06), (box_x1 - box_x0 - 0.04, 0.03, 0.12),
             "trim", bevel=0.01)
        rbox(B, ((box_x0 + box_x1) / 2, s * (Wbox / 2 + 0.003), bz1 - 0.04), (box_x1 - box_x0 - 0.04, 0.02, 0.06),
             "trim", bevel=0.008)
        rbox(B, (box_x0 + 0.04, s * (Wbox / 2 - 0.03), (bz0 + bz1) / 2), (0.1, 0.08, bz1 - bz0 + 0.01), "trim",
             bevel=0.015)
    for i in range(1, 8):
        z = bz0 + 0.12 + i * (bz1 - bz0 - 0.2) / 8
        rbox(B, (box_x0 - 0.004, 0, z), (0.02, Wbox - 0.2, 0.025), "trim", bevel=0.006)
    rbox(B, (box_x0 - 0.01, 0, bz0 + 0.25), (0.03, 0.3, 0.06), "trim", bevel=0.01)   # door handle bar
    # chassis rails, fuel tank, battery box
    for s in (1, -1):
        rbox(B, ((-xf + 0.2 + xcr) / 2, s * 0.45, 0.82), (xcr + xf - 0.2, 0.09, 0.22), "trim", bevel=0.01)
    rbox(B, (0.4, -1.0, 0.72), (0.9, 0.42, 0.42), "chrome", bevel=0.12, segs=2)   # fuel tank
    rbox(B, (0.4, 1.0, 0.75), (0.6, 0.38, 0.4), "trim", bevel=0.03)
    # underride bumper + tail lights
    rbox(B, (-xf + 0.12, 0, 0.62), (0.14, Wbox - 0.2, 0.14), "trim", bevel=0.03)
    for s in (1, -1):
        rbox(B, (-xf + 0.04, s * 0.95, 0.92), (0.06, 0.32, 0.12), "light_rear", bevel=0.02)
        rbox(B, (-xf + 0.06, s * 0.95, 0.92), (0.06, 0.38, 0.18), "trim", bevel=0.02)
        rbox(B, (-xf - 0.004, s * (Wbox / 2 - 0.08), bz1 - 0.12), (0.03, 0.08, 0.05), "light_rear", bevel=0.01)
        # mud flaps behind rear wheels
        rbox(B, (ax_r - 0.62, s * 1.0, 0.45), (0.02, 0.45, 0.55), "trim", bevel=0.005)
        # rear fenders over duals
        rbox(B, (ax_r, s * 1.0, 1.0), (1.2, 0.5, 0.06), "trim", bevel=0.02)
    # side marker lights on the box
    for s in (1, -1):
        rbox(B, (box_x0 + 0.3, s * (Wbox / 2 + 0.008), bz0 + 0.2), (0.08, 0.02, 0.04), "light_rear", bevel=0.008)

    Wf = wheel(R, 0.25, segs=18, style="steel", rim_frac=0.6)
    Wr = wheel(R, 0.46, segs=18, style="steel", rim_frac=0.6)
    for s in (1, -1):
        add_wheel(B, Wf, ax_f, cab_w / 2 - 0.02, R, s)
        add_wheel(B, Wr, ax_r, Wbox / 2 - 0.04, R, s)
    return B


# ============================================================ second batch: helpers

def quad_uv(B, pts, uvs, mat, out=None):
    """One quad with explicit per-corner UVs (decals, stop sign)."""
    vs = [B.v(p) for p in pts]
    f = B.face(vs, mat, out=out)
    if f:
        m = {v: uv for v, uv in zip(vs, uvs)}
        for lp in f.loops:
            lp[B.uv].uv = m[lp.vert]
    return f


def rect_uvs(r):
    u0, v0, u1, v1 = r
    return [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]


def side_text(B, text, xc, zc, h, y_fn, sides=(1, -1), lift=0.006):
    """Livery text decal on a vehicle side, readable from outside on both sides."""
    rect, asp = LVT[text]
    w = h * asp
    x0, x1, z0, z1 = xc - w / 2, xc + w / 2, zc - h / 2, zc + h / 2
    for s in sides:
        cs = [(x1, z0), (x0, z0), (x0, z1), (x1, z1)] if s > 0 else [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]
        quad_uv(B, [(x, s * (y_fn(x, z) + lift), z) for x, z in cs], rect_uvs(rect), "livery", out=(0, s, 0))
    return w


def end_text(B, text, x, zc, h, facing, yc=0.0, lift=0.006, rect=None, w=None):
    """Livery decal on a front (facing=+1) or rear (-1) face."""
    if rect is None:
        rect, asp = LVT[text]
        w = h * asp
    y0, y1, z0, z1 = yc - w / 2, yc + w / 2, zc - h / 2, zc + h / 2
    xx = x + facing * lift
    cs = [(y0, z0), (y1, z0), (y1, z1), (y0, z1)] if facing > 0 else [(y1, z0), (y0, z0), (y0, z1), (y1, z1)]
    quad_uv(B, [(xx, y, z) for y, z in cs], rect_uvs(rect), "livery", out=(facing, 0, 0))


def limb(B, a, b, t, mat, bevel=0.03, segs=1, uvfn=None, tz=None):
    """Bevelled box spanning a -> b (arms, legs)."""
    a, b = Vector(a), Vector(b)
    d = b - a
    M = d.to_track_quat("X", "Z").to_matrix().to_4x4()
    rbox(B, (a + b) / 2, (d.length + t * 0.3, t, tz or t), mat, bevel=bevel, segs=segs, M=M, uvfn=uvfn)


def prism(B, poly, hw, edge_mats, cap_mat="paint"):
    """Convex side-view polygon [(x, z)...] extruded across +-hw. edge_mats[i] is the face poly[i]->poly[i+1]."""
    L = [B.v((x, hw, z)) for x, z in poly]
    R = [B.v((x, -hw, z)) for x, z in poly]
    B.face(L, cap_mat, out=(0, 1, 0))
    B.face(R, cap_mat, out=(0, -1, 0))
    cx = sum(p[0] for p in poly) / len(poly)
    cz = sum(p[1] for p in poly) / len(poly)
    for i in range(len(poly)):
        j = (i + 1) % len(poly)
        mx, mz = (poly[i][0] + poly[j][0]) / 2, (poly[i][1] + poly[j][1]) / 2
        B.face([L[i], L[j], R[j], R[i]], edge_mats[i], out=(mx - cx, 0, mz - cz))


def stop_sign(B, x, y, z, r, s):
    """Octagonal STOP sign facing s*y (folded stop arm), textured from the sign atlas."""
    Rc = r / math.cos(math.pi / 8)
    pts, uvs = [], []
    for k in range(8):
        a = math.pi / 8 + k * math.pi / 4
        dx, dz = Rc * math.cos(a), Rc * math.sin(a)
        pts.append((x + dx, y, z + dz))
        su = -dx if s > 0 else dx
        uvs.append((STOP_C[0] + su / r * STOP_APOTHEM, STOP_C[1] + dz / r * STOP_APOTHEM))
    vs = [B.v(p) for p in pts]
    f = B.face(vs, "sign", out=(0, s, 0))
    if f:
        m = {v: uv for v, uv in zip(vs, uvs)}
        for lp in f.loops:
            lp[B.uv].uv = m[lp.vert]
    B.face([B.v((p[0], y - s * 0.012, p[2])) for p in pts], "trim", out=(0, -s, 0))


def light_bar(B, x, z, width, cols, depth=0.24):
    """Roof light bar: trim base with emissive lenses (sign swatches) from +y to -y."""
    rbox(B, (x, 0, z + 0.03), (depth + 0.04, width + 0.06, 0.06), "trim", bevel=0.015)
    n = len(cols)
    seg = width / n
    for i, col in enumerate(cols):
        yy = width / 2 - seg * (i + 0.5)
        rbox(B, (x, yy, z + 0.105), (depth, seg - 0.02, 0.09), "sign", bevel=0.025, uvfn=sgn_uv(col))


# ============================================================ second batch: cars

def build_police():
    L, W, belt, R = 5.0, 1.9, 0.97, 0.335
    xf = L / 2
    ax_f = xf - 1.0
    ax_r = ax_f - 2.92
    P = sedan_params(L=L, W=W, belt=belt, R=R)
    P["arches"] = [(ax_f, 0.41), (ax_r, 0.41)]
    P["zt_tab"] = [(-xf, 0.92), (-xf + 0.22, 1.01), (ax_r - 0.33, 1.02), (ax_r, belt), (ax_f - 0.52, belt),
                   (ax_f + 0.12, 0.90), (xf - 0.25, 0.84), (xf, 0.77)]
    P["seam_strips"] = [ax_f - 0.5, -0.05, ax_r + 0.35]
    P["handles"] = [(0.66, 0.88), (-0.42, 0.88)]
    P["hood_lines"] = (1.05, xf - 0.30)
    P["wheel_style"] = "steel"

    def mat_hook(c, info, body):
        # dark blue side stripe along the doors
        xm = (info["x0"] + info["x1"]) / 2
        if ax_r + 0.42 < xm < ax_f - 0.42 and abs(c.y) > body.w - 0.1 and 0.62 <= c.z <= 0.74:
            return ("livery", LV["navy"])
        return None
    P["mat_hook"] = mat_hook
    G = sedan_gh(belt=belt, top=1.42, ws=(1.05, 0.16), rear=(-1.02, -1.70))
    G["radii"] = [0.22, 0.28]

    def extras(B, body):
        side_text(B, "POLICE", 0.42, 0.805, 0.095, body.side_y)
        light_bar(B, -0.32, 1.445, 1.16, ["red", "red", "white", "blue", "blue"])
        # push bumper
        xg, _ = body.end_x(0.55, "f")
        for s in (1, -1):
            rbox(B, (xg + 0.13, s * 0.32, 0.60), (0.05, 0.06, 0.40), "trim", bevel=0.01)
            rbox(B, (xg + 0.05, s * 0.32, 0.46), (0.16, 0.05, 0.05), "trim", bevel=0.0)
        for z in (0.50, 0.74):
            rbox(B, (xg + 0.13, 0, z), (0.05, 0.70, 0.05), "trim", bevel=0.01)
        # A-pillar spotlight
        rbox(B, (0.95, 0.86, 1.06), (0.12, 0.08, 0.08), "chrome", bevel=0.03)
    return car("police", P, G, extras)


def build_hatch():
    L, W, belt, R = 4.0, 1.75, 0.95, 0.31
    xf = L / 2
    ax_f = xf - 0.85
    ax_r = ax_f - 2.48
    P = sedan_params(L=L, W=W, belt=belt, R=R)
    P["arches"] = [(ax_f, R + 0.07), (ax_r, R + 0.07)]
    P["zt_tab"] = [(-xf, 0.98), (-xf + 0.16, belt + 0.03), (0.75, belt), (1.25, 0.88), (xf - 0.22, 0.82), (xf, 0.76)]
    P["corner_r"] = (0.22, 0.04, [(0.0, 0.04), (0.3, 0.0), (1.0, 0.03)])
    P["corner_f"] = (0.30, 0.14, [(0.0, 0.07), (0.25, 0.0), (0.55, 0.03), (1.0, 0.14)])
    P["seam_strips"] = [0.80, -0.22, -0.96]
    P["handles"] = [(0.50, 0.85), (-0.52, 0.85)]
    P["hood_lines"] = (0.85, xf - 0.28)
    P["tail"] = dict(z0=0.74, z1=0.95, y_in=0.40, u=0.5)
    G = dict(ctrl=[(0.85, belt - 0.01), (0.02, 1.455), (-1.42, 1.46), (-1.88, belt + 0.03)], radii=[0.20, 0.16],
             z_base=belt - 0.01, inset=0.07, tumble=0.30, r=0.05, pillar=0.07, crown=0.03, frame=0.035,
             pillars=[(-0.22, -0.20, 0.075), (-1.10, -1.10, 0.13)])

    def extras(B, body):
        rbox(B, (-1.52, 0, 1.475), (0.24, 1.10, 0.035), "paint", bevel=0.012)   # roof spoiler
    return car("hatch", P, G, extras)


def build_sports():
    L, W, belt, R = 4.5, 1.9, 0.84, 0.33
    xf = L / 2
    ax_f = xf - 0.98
    ax_r = ax_f - 2.62
    P = sedan_params(L=L, W=W, belt=belt, R=R)
    P.update(
        tw=0.27, rim_frac=0.72,
        arches=[(ax_f, R + 0.06), (ax_r, R + 0.065)],
        zb_tab=[(-xf, 0.24), (-xf + 0.4, 0.17), (xf - 0.4, 0.17), (xf, 0.20)],
        zt_tab=[(-xf, 0.78), (-xf + 0.2, 0.87), (-1.45, 0.88), (-1.0, belt), (0.55, belt), (1.25, 0.77),
                (xf - 0.25, 0.70), (xf, 0.645)],
        bulge_tab=[(0.15, -0.03), (0.32, 0.0), (0.5, 0.03), (0.7, 0.022), (0.9, -0.02)], bulge_max=0.03,
        breaks=[0.30, 0.38, 0.47, 0.56],
        head=dict(z0=0.47, z1=0.56, y_in=0.42, u=0.55), tail=dict(z0=0.56, z1=0.82, y_in=0.30, u=0.5),
        grille=dict(z0=0.30, z1=0.47, w=0.40), intake=dict(z0=0.21, z1=0.30, w=0.72), valance=0.21,
        plate=(0.38, 0.47),
        corner_f=(0.36, 0.22, [(0.0, 0.08), (0.25, 0.0), (0.55, 0.06), (1.0, 0.22)]),
        corner_r=(0.32, 0.06, [(0.0, 0.06), (0.3, 0.0), (1.0, 0.06)]),
        seam_strips=[0.60, -0.62], handles=[(-0.44, 0.76)], hood_lines=(0.62, xf - 0.32))
    G = dict(ctrl=[(0.72, belt - 0.01), (-0.14, 1.205), (-0.70, 1.215), (-1.72, belt + 0.02)], radii=[0.18, 0.42],
             z_base=belt - 0.01, inset=0.10, tumble=0.45, r=0.05, pillar=0.07, crown=0.025, frame=0.03,
             pillars=[(-0.66, -0.58, 0.07)])

    def extras(B, body):
        zd = body.zt(-2.02) + 0.03
        rbox(B, (-2.04, 0, zd + 0.10), (0.20, 1.46, 0.03), "paint", bevel=0.012)
        for s in (1, -1):
            rbox(B, (-2.0, s * 0.55, zd + 0.045), (0.08, 0.035, 0.11), "trim", bevel=0.0)
            tube(B, (-xf + 0.08, s * 0.42, 0.26), (-xf - 0.05, s * 0.42, 0.26), 0.038, "chrome", segs=8)
            # side intake ahead of the rear wheel
            rbox(B, (ax_r + 0.62, s * (body.side_y(ax_r + 0.62, 0.45) + 0.0), 0.45), (0.34, 0.02, 0.10),
                 "trim", bevel=0.0)
    return car("sports", P, G, extras)


def build_limo():
    L, W, belt, R = 8.5, 1.9, 0.97, 0.335
    xf = L / 2
    ax_f = xf - 1.0
    ax_r = -xf + 1.05
    P = sedan_params(L=L, W=W, belt=belt, R=R)
    P["arches"] = [(ax_f, 0.41), (ax_r, 0.41)]
    P["zt_tab"] = [(-xf, 0.92), (-xf + 0.22, 1.01), (ax_r - 0.33, 1.02), (ax_r, belt), (ax_f - 0.52, belt),
                   (ax_f + 0.12, 0.90), (xf - 0.25, 0.84), (xf, 0.77)]
    P["seam_strips"] = [ax_f - 0.5, ax_f - 1.55, -2.05, ax_r + 0.36]
    P["handles"] = [(ax_f - 0.85, 0.88), (-2.35, 0.88)]
    P["hood_lines"] = (ax_f - 0.45, xf - 0.30)
    P["max_step"] = 0.7
    G = sedan_gh(belt=belt, top=1.42, ws=(ax_f - 0.45, ax_f - 1.30), rear=(ax_r + 0.42, ax_r - 0.26))
    G["radii"] = [0.22, 0.28]
    G["pillars"] = [(ax_f - 1.55, ax_f - 1.53, 0.08), (0.35, 0.35, 0.9), (-1.25, -1.25, 0.22), (-2.05, -2.05, 0.08)]

    def extras(B, body):
        x0, x1 = ax_r + 0.30, ax_f - 0.48
        for s in (1, -1):
            y = body.hw(0.0) - G["inset"] + 0.004
            rbox(B, ((x0 + x1) / 2, s * y, belt + 0.004), (x1 - x0, 0.014, 0.022), "chrome", bevel=0.0)
            yy = body.side_y(0.0, 0.40) + 0.004
            rbox(B, (0.0, s * yy, 0.40), (2 * xf - 2.6, 0.012, 0.025), "chrome", bevel=0.0)
    return car("limo", P, G, extras)


def build_pickup():
    L, W, R = 5.6, 2.0, 0.40
    xf = L / 2
    belt = 1.18
    bed_z = 1.22
    ax_f = xf - 0.95
    ax_r = ax_f - 3.55

    def mat_hook(c, info, body):
        xm = (info["x0"] + info["x1"]) / 2
        if xm < -0.49 and c.z > bed_z - 0.035 and abs(c.y) < body.w - 0.075:
            return "trim"   # tonneau cover over the bed + the cab/bed gap
        return None
    P = dict(
        L=L, W=W, R=R, tw=0.27, belt=belt,
        arches=[(ax_f, R + 0.09), (ax_r, R + 0.09)], arch_steps=6,
        zb_tab=[(-xf, 0.56), (-xf + 0.3, 0.46), (xf - 0.4, 0.46), (xf, 0.54)],
        zt_tab=[(-xf, bed_z - 0.04), (-xf + 0.1, bed_z), (-0.62, bed_z), (-0.50, belt), (1.15, belt),
                (1.6, 1.17), (xf - 0.25, 1.13), (xf, 1.06)],
        bulge_tab=[(0.4, -0.02), (0.6, 0.0), (0.9, 0.022), (1.1, 0.016), (1.25, -0.01)], bulge_max=0.022,
        rb=0.07, rt=0.06, crown=0.02,
        breaks=[0.64, 0.72, 0.86, 0.98],
        corner_f=(0.22, 0.08, [(0.0, 0.04), (0.25, 0.0), (1.0, 0.08)]),
        corner_r=(0.10, 0.02, [(0.0, 0.02), (1.0, 0.02)]),
        head=dict(z0=0.86, z1=0.98, y_in=0.56, u=0.6),
        tail=dict(z0=0.72, z1=1.14, y_in=0.80, u=0.5),
        grille=dict(z0=0.72, z1=0.98, w=0.52), intake=dict(z0=0.56, z1=0.64, w=0.70),
        valance=0.64, plate=(0.72, 0.86),
        seam_strips=[1.13, 0.02], handles=[(0.85, 1.08), (-0.30, 1.08)], hood_lines=(1.2, xf - 0.3),
        grille_bars=2, max_step=0.5, mat_hook=mat_hook,
    )
    G = dict(ctrl=[(1.20, belt - 0.01), (0.45, 1.82), (-0.34, 1.83), (-0.52, belt + 0.02)], radii=[0.16, 0.08],
             z_base=belt - 0.01, inset=0.08, tumble=0.15, r=0.055, pillar=0.075, crown=0.02, frame=0.035,
             pillars=[(0.02, 0.05, 0.08)])

    def extras(B, body):
        xg, _ = body.end_x(0.62, "f")
        rbox(B, (xg + 0.04, 0, 0.62), (0.16, 2.0, 0.18), "chrome", bevel=0.04, segs=1)
        rbox(B, (-xf - 0.02, 0, 0.60), (0.18, 1.92, 0.15), "chrome", bevel=0.04, segs=1)
        # tailgate shut line and handle
        xr, _ = body.end_x(1.0, "r")
        rbox(B, (xr - 0.004, 0, 1.0), (0.01, 0.22, 0.05), "trim", bevel=0.0)
        # bed rail caps
        for s in (1, -1):
            rbox(B, ((-xf + 0.08 - 0.62) / 2, s * (body.w - 0.04), bed_z + 0.022),
                 (xf - 0.70, 0.07, 0.025), "trim", bevel=0.0)
    return car("pickup", P, G, extras)


# ============================================================ second batch: scooter + rider

def build_scooter():
    B = Builder()
    R, tw = 0.23, 0.10
    Wh = wheel(R, tw, segs=12, rim_frac=0.6, style="alloy")
    for x in (0.66, -0.62):
        add_wheel(B, Wh, x, tw / 2, R, 1)
    # front fork, fender, leg shield, headset
    for s in (1, -1):
        tube(B, (0.66, s * 0.07, 0.23), (0.51, s * 0.07, 0.90), 0.022, "chrome", segs=5)
    rbox(B, (0.64, 0, 0.50), (0.40, 0.15, 0.05), "paint", bevel=0.02, M=Matrix.Rotation(math.radians(10), 4, "Y"))
    rbox(B, (0.43, 0, 0.70), (0.16, 0.44, 0.64), "paint", bevel=0.06, segs=2,
         M=Matrix.Rotation(math.radians(-14), 4, "Y"))
    rbox(B, (0.50, 0, 1.00), (0.22, 0.28, 0.15), "paint", bevel=0.05)
    rbox(B, (0.615, 0, 1.00), (0.03, 0.15, 0.09), "light_front", bevel=0.015)
    # handlebar, grips, mirrors
    tube(B, (0.48, -0.33, 1.06), (0.48, 0.33, 1.06), 0.016, "chrome", segs=5)
    for s in (1, -1):
        tube(B, (0.48, s * 0.27, 1.06), (0.48, s * 0.355, 1.06), 0.024, "trim", segs=6)
        tube(B, (0.47, s * 0.21, 1.07), (0.43, s * 0.27, 1.30), 0.008, "chrome", segs=4)
        rbox(B, (0.43, s * 0.28, 1.32), (0.03, 0.10, 0.065), "trim", bevel=0.012,
             mat_fn=lambda n: "glass" if n.x < -0.7 else "trim")
    # floorboard, rear body, seat, tail light, engine, exhaust
    rbox(B, (0.10, 0, 0.36), (0.50, 0.36, 0.07), "trim", bevel=0.02)
    rbox(B, (-0.45, 0, 0.56), (0.78, 0.38, 0.38), "paint", bevel=0.12, segs=2)
    rbox(B, (-0.30, 0, 0.79), (0.62, 0.30, 0.10), "trim", bevel=0.04)
    rbox(B, (-0.855, 0, 0.62), (0.04, 0.14, 0.07), "light_rear", bevel=0.015)
    rbox(B, (-0.40, -0.06, 0.30), (0.40, 0.16, 0.18), "trim", bevel=0.03)
    tube(B, (-0.35, -0.16, 0.27), (-0.84, -0.16, 0.34), 0.035, "chrome", segs=6)
    # rack + delivery box
    rbox(B, (-0.70, 0, 0.84), (0.40, 0.34, 0.03), "trim", bevel=0.0)
    rbox(B, (-0.70, 0, 1.10), (0.46, 0.44, 0.48), "paint", bevel=0.03)
    rbox(B, (-0.70, 0, 1.345), (0.48, 0.46, 0.03), "trim", bevel=0.01)

    # rider: dark trousers, boots, winter puffer jacket, scarf, gloves, helmet with visor
    J = lv_uv("jacket")
    for s in (1, -1):
        limb(B, (-0.24, s * 0.11, 0.90), (0.14, s * 0.15, 0.86), 0.15, "trim", bevel=0.05)
        limb(B, (0.14, s * 0.15, 0.86), (0.21, s * 0.14, 0.46), 0.12, "trim", bevel=0.045)
        rbox(B, (0.25, s * 0.14, 0.44), (0.23, 0.10, 0.09), "tyre", bevel=0.03)
    rbox(B, (-0.19, 0, 1.13), (0.34, 0.44, 0.52), "livery", bevel=0.13, segs=2, uvfn=J,
         M=Matrix.Rotation(math.radians(14), 4, "Y"))
    for s in (1, -1):
        limb(B, (-0.10, s * 0.21, 1.31), (0.13, s * 0.26, 1.13), 0.12, "livery", bevel=0.05, uvfn=J)
        limb(B, (0.13, s * 0.26, 1.13), (0.44, s * 0.30, 1.07), 0.10, "livery", bevel=0.04, uvfn=J)
        rbox(B, (0.48, s * 0.31, 1.06), (0.08, 0.07, 0.075), "trim", bevel=0.025)
    rbox(B, (-0.08, 0, 1.40), (0.17, 0.19, 0.07), "livery", bevel=0.025, uvfn=lv_uv("red"))
    rbox(B, (-0.04, 0, 1.51), (0.28, 0.25, 0.25), "paint", bevel=0.11, segs=2)
    rbox(B, (0.095, 0, 1.50), (0.03, 0.19, 0.09), "glass", bevel=0.012)
    return B


# ============================================================ second batch: box-bodied trucks

def cutaway_cab(Wc=2.05, R=0.36, Lc=2.55, roof=2.24, belt=1.18):
    """Van-style front (bonnet, windscreen, cab doors) for box bodies. Local x centred on the cab."""
    xf = Lc / 2
    ax = xf - 0.95
    P = dict(L=Lc, W=Wc, R=R, tw=0.235, belt=belt,
             arches=[(ax, R + 0.08)], arch_steps=6,
             zb_tab=[(-xf, 0.44), (xf - 0.4, 0.40), (xf, 0.42)],
             zt_tab=[(-xf, roof), (-0.55, roof), (-0.22, roof - 0.07), (0.42, 1.22), (xf - 0.45, 1.06), (xf, 0.95)],
             bulge_tab=[(0.3, -0.015), (0.55, 0.0), (0.9, 0.018), (1.2, 0.012), (2.3, -0.08)],
             bulge_max=0.018, rb=0.06, rt=0.10, crown=0.04,
             breaks=[0.52, 0.62, 0.80, 0.96, belt, 2.0],
             corner_f=(0.30, 0.10, [(0.0, 0.05), (0.25, 0.0), (0.6, 0.02), (1.0, 0.10)]),
             corner_us=[1.0, 0.75, 0.5, 0.25], max_step=0.5)
    body = Body(P)
    T = Builder()
    gx = (-1.12, 0.32)

    def mat_fn(c, info):
        seg, zone, u = info["seg"], info["zone"], info["u"]
        xm = (info["x0"] + info["x1"]) / 2
        if seg <= 1:
            return "trim"
        if zone == "f" and u >= 0.6 and 0.80 <= c.z <= 0.96:
            return "light_front"
        if zone and c.z < 0.52:
            return "trim"
        if c.z < info["zb"] + 0.10 and abs(c.y) > 0.3:
            return "trim"
        if -0.22 < xm < 0.42 and c.z > 1.24 and abs(c.y) < body.w - 0.16:
            return "glass"
        if gx[0] < xm < gx[1] and belt + 0.02 < c.z < 2.0 and abs(c.y) > body.w - 0.2:
            return "glass"
        return "paint"

    def cap_fn(end, y, z):
        ay = abs(y)
        if end == "f":
            if 0.80 <= z <= 0.96 and ay > 0.52:
                return "light_front"
            if 0.62 <= z <= 0.96 and ay < 0.44:
                return "trim"
            if z < 0.52:
                return "trim"
        return "paint"
    body.build(T, mat_fn, cap_fn, {"f": [-0.52, -0.44, 0.44, 0.52], "r": []},
               extra_stations=[-0.22, 0.42, gx[0], gx[1]])
    seam_strip(T, body, 0.36, z_hi=1.3)
    seam_strip(T, body, -1.17, z_hi=2.05)
    door_handle(T, body, -0.95, 1.08)
    grille(T, body, 0.64, 0.94, 0.43, bars=2)
    for s in (1, -1):
        mirror(T, 0.14, body.w - 0.04, 1.40, s, size=(0.08, 0.16, 0.26), arm=0.12)
    return T, body, ax


def box_rear(B, x0, Wb, z0, z1, door_split=True, windows=True):
    """Rear doors, lights and step for a box body whose rear face is at x0."""
    yb = Wb / 2
    if door_split:
        rbox(B, (x0 - 0.004, 0, (z0 + z1) / 2), (0.014, 0.025, z1 - z0 - 0.2), "trim", bevel=0.0)
    for s in (1, -1):
        if windows:
            rbox(B, (x0 - 0.005, s * 0.5, z1 - 0.62), (0.012, 0.62, 0.52), "glass", bevel=0.0)
        rbox(B, (x0 - 0.01, s * 0.12, z0 + 0.65), (0.02, 0.14, 0.03), "trim", bevel=0.0)
        rbox(B, (x0 - 0.012, s * (yb - 0.12), z0 + 0.18), (0.03, 0.15, 0.32), "trim", bevel=0.01)
        rbox(B, (x0 - 0.03, s * (yb - 0.12), z0 + 0.18), (0.02, 0.11, 0.27), "light_rear", bevel=0.008)
    rbox(B, (x0 + 0.04, 0, z0 - 0.32), (0.32, Wb - 0.2, 0.10), "trim", bevel=0.02)


def build_ambulance():
    L, Wb, R = 6.5, 2.3, 0.36
    xf = L / 2
    Lc = 2.55
    T, cab, axl = cutaway_cab(R=R, Lc=Lc)
    B = Builder()
    cx = xf - Lc / 2
    B.merge(T, Matrix.Translation((cx, 0, 0)))
    ax_f, ax_r = cx + axl, -1.45
    x0, x1 = -xf, cx - Lc / 2 + 0.06
    z0, z1 = 0.92, 2.80
    xm, yb = (x0 + x1) / 2, Wb / 2
    rbox(B, (xm, 0, (z0 + z1) / 2), (x1 - x0, Wb, z1 - z0), "paint", bevel=0.06, segs=2)
    red = lv_uv("red")
    for s in (1, -1):
        # lower skirts around the rear wheels
        for (a, b) in ((ax_r + 0.50, x1 - 0.05), (x0 + 0.05, ax_r - 0.50)):
            rbox(B, ((a + b) / 2, s * (yb - 0.03), 0.78), (b - a, 0.06, 0.30), "paint", bevel=0.02)
        rbox(B, (xm, s * (yb + 0.003), 1.32), (x1 - x0 - 0.12, 0.012, 0.16), "livery", bevel=0.0, uvfn=red)
        rbox(B, (xm, s * (yb + 0.003), 2.58), (x1 - x0 - 0.12, 0.012, 0.06), "livery", bevel=0.0, uvfn=red)
        side_text(B, "AMBULANCE", -1.90, 1.78, 0.22, lambda x, z: yb, sides=(s,))
        for xx in (x0 + 0.22, x1 - 0.22):
            rbox(B, (xx, s * (yb + 0.012), 2.66), (0.20, 0.03, 0.12), "sign", bevel=0.012, uvfn=sgn_uv("red"))
    rbox(B, (x0 - 0.003, 0, 1.32), (0.012, Wb - 0.12, 0.16), "livery", bevel=0.0, uvfn=red)
    box_rear(B, x0, Wb, z0, z1)
    for s in (1, -1):
        rbox(B, (x0 - 0.012, s * (yb - 0.16), 2.64), (0.03, 0.2, 0.12), "sign", bevel=0.012, uvfn=sgn_uv("red"))
    light_bar(B, x1 - 0.2, z1, 1.7, ["red", "white", "red"])
    # kerb-side door with window
    dx0, dx1, yk = -0.95, 0.30, -(yb + 0.004)
    for xx in (dx0, dx1):
        rbox(B, (xx, yk, 1.72), (0.02, 0.012, 1.5), "trim", bevel=0.0)
    rbox(B, ((dx0 + dx1) / 2, yk, 2.47), (dx1 - dx0, 0.012, 0.02), "trim", bevel=0.0)
    rbox(B, ((dx0 + dx1) / 2, yk - 0.002, 2.05), (0.75, 0.012, 0.45), "glass", bevel=0.0)
    rbox(B, (dx1 - 0.15, yk - 0.006, 1.70), (0.03, 0.02, 0.14), "trim", bevel=0.0)
    for s in (1, -1):
        rbox(B, (xm, s * 0.45, 0.72), (x1 - x0 - 0.4, 0.09, 0.2), "trim", bevel=0.0)
        rbox(B, (ax_r - 0.48, s * (yb - 0.17), 0.45), (0.02, 0.36, 0.42), "trim", bevel=0.0)
    Wf = wheel(R, 0.235, segs=15, style="steel")
    Wr = wheel(R, 0.42, segs=15, style="steel")
    for s in (1, -1):
        add_wheel(B, Wf, ax_f, cab.w + 0.005, R, s)
        add_wheel(B, Wr, ax_r, yb - 0.07, R, s)
    return B


def build_foodtruck():
    L, Wb, R = 7.0, 2.4, 0.37
    xf = L / 2
    Lc = 2.55
    T, cab, axl = cutaway_cab(R=R, Lc=Lc, Wc=2.1)
    B = Builder()
    cx = xf - Lc / 2
    B.merge(T, Matrix.Translation((cx, 0, 0)))
    ax_f, ax_r = cx + axl, -1.95
    x0, x1 = -xf, cx - Lc / 2 + 0.06
    z0, z1 = 0.95, 2.86
    xm, yb = (x0 + x1) / 2, Wb / 2
    rbox(B, (xm, 0, (z0 + z1) / 2), (x1 - x0, Wb, z1 - z0), "paint", bevel=0.08, segs=2)
    for s in (1, -1):
        for (a, b) in ((ax_r + 0.52, x1 - 0.05), (x0 + 0.05, ax_r - 0.52)):
            rbox(B, ((a + b) / 2, s * (yb - 0.03), 0.80), (b - a, 0.06, 0.32), "paint", bevel=0.02)
        rbox(B, (xm, s * (yb + 0.004), z0 + 0.06), (x1 - x0 - 0.1, 0.02, 0.06), "chrome", bevel=0.0)
    # serving hatch on the kerb side (-y): dark interior, chrome frame + counter, striped awning on struts
    hx0, hx1, hz0, hz1 = -2.45, 0.05, 1.42, 2.28
    yk = -(yb + 0.003)
    rbox(B, ((hx0 + hx1) / 2, yk, (hz0 + hz1) / 2), (hx1 - hx0, 0.012, hz1 - hz0), "trim", bevel=0.0)
    for (cxp, cz, sx, sz) in (((hx0 + hx1) / 2, hz1, hx1 - hx0 + 0.06, 0.04), ((hx0 + hx1) / 2, hz0, hx1 - hx0 + 0.06, 0.04),
                              (hx0, (hz0 + hz1) / 2, 0.04, hz1 - hz0), (hx1, (hz0 + hz1) / 2, 0.04, hz1 - hz0)):
        rbox(B, (cxp, yk - 0.006, cz), (sx, 0.02, sz), "chrome", bevel=0.0)
    rbox(B, ((hx0 + hx1) / 2, -(yb + 0.17), hz0 - 0.02), (hx1 - hx0, 0.34, 0.04), "chrome", bevel=0.01)
    # menu board inside the hatch
    rbox(B, (-1.6, yk + 0.002, 2.0), (0.9, 0.01, 0.4), "livery", bevel=0.0, uvfn=lv_uv("black"))
    ang, aw_d, aw_l = math.radians(14), 0.95, hx1 - hx0 + 0.3
    M = Matrix.Rotation(ang, 4, "X")
    cy = -(yb + 0.02 + aw_d / 2 * math.cos(ang))
    cz = hz1 + 0.07 - aw_d / 2 * math.sin(ang)
    ua0, va0, ua1, va1 = LV_REG["awning"]

    def awn_uv(co, n):
        t = min(max(co.x / aw_l + 0.5, 0.0), 1.0)
        return (lerp(ua0, ua1, t), (va0 + va1) / 2)
    rbox(B, ((hx0 + hx1) / 2, cy, cz), (aw_l, aw_d, 0.035), "livery", bevel=0.0, uvfn=awn_uv, M=M)
    ye = -(yb + 0.02 + aw_d * math.cos(ang)) + 0.04
    ze = hz1 + 0.07 - aw_d * math.sin(ang) - 0.02
    for xx in (hx0 + 0.1, hx1 - 0.1):
        tube(B, (xx, -yb, hz0 + 0.15), (xx, ye, ze), 0.015, "chrome", segs=4)
    side_text(B, "STREET FOOD", xm, 1.95, 0.34, lambda x, z: yb, sides=(1,))
    side_text(B, "STREET FOOD", (hx0 + hx1) / 2, 2.6, 0.2, lambda x, z: yb, sides=(-1,))
    # roof kit
    rbox(B, (-0.9, 0, z1 + 0.11), (0.75, 0.75, 0.22), "trim", bevel=0.04)
    rbox(B, (-2.6, 0.4, z1 + 0.07), (0.45, 0.45, 0.14), "chrome", bevel=0.03)
    tube(B, (-2.6, -0.5, z1), (-2.6, -0.5, z1 + 0.16), 0.05, "chrome", segs=8)
    box_rear(B, x0, Wb, z0, z1, door_split=False, windows=False)
    rbox(B, (x0 + 0.35, 0.55, 0.62), (0.5, 0.7, 0.36), "trim", bevel=0.04)   # generator under the floor
    end_text(B, "STREET FOOD", x0, 2.4, 0.16, -1)
    for s in (1, -1):
        rbox(B, (xm, s * 0.45, 0.75), (x1 - x0 - 0.4, 0.09, 0.2), "trim", bevel=0.0)
    Wf = wheel(R, 0.235, segs=15, style="steel")
    Wr = wheel(R, 0.42, segs=15, style="steel")
    for s in (1, -1):
        add_wheel(B, Wf, ax_f, cab.w + 0.005, R, s)
        add_wheel(B, Wr, ax_r, yb - 0.07, R, s)
    return B


def cabover(cab_len, cab_w, cab_h, R, ax_local, glass_x, seam_x, belt=1.50, zb=0.62, handles=(),
            bumper_mat="trim"):
    """Flat-fronted (cab-over) truck cab, local x centred on the cab."""
    c2 = cab_len / 2
    wt = cab_h - 0.25
    zl = zb + 0.22
    P = dict(L=cab_len, W=cab_w, R=R, tw=0.28,
             arches=[(ax_local, R + 0.08)], arch_steps=8,
             zb_tab=[(-c2, zb), (c2 - 0.3, zb), (c2, zb - 0.12)],
             zt_tab=[(-c2, cab_h), (c2 - 0.3, cab_h), (c2, cab_h - 0.05)],
             bulge_tab=[(0.4, -0.01), (0.8, 0.0), (1.5, 0.01), (cab_h + 0.1, -0.04)], bulge_max=0.01,
             rb=0.05, rt=0.14, crown=0.03,
             breaks=[zb + 0.06, zl, belt - 0.5, belt - 0.08, belt, wt],
             corner_f=(0.20, 0.18, [(0.0, 0.05), (0.12, 0.0), (0.45, 0.02), (0.6, 0.06), (1.0, 0.18)]),
             corner_us=[1.0, 0.7, 0.4], max_step=0.5)
    cab = Body(P)
    T = Builder()

    def mat_fn(c, info):
        seg, zone, u = info["seg"], info["zone"], info["u"]
        xm = (info["x0"] + info["x1"]) / 2
        if seg <= 1:
            return "trim"
        side = abs(c.y) > cab.w - 0.12
        if zone == "f" and u >= 0.7 and belt <= c.z <= wt:
            return "glass"
        if c.z < zl and (zone or side):
            return "trim"
        if side and belt <= c.z <= wt and any(a < xm < b for a, b in glass_x):
            return "glass"
        if side and any(abs(xm - sx) < 0.012 for sx in seam_x) and c.z > info["zb"]:
            return "trim"
        return "paint"

    def cap_fn(end, y, z):
        ay = abs(y)
        if end == "f":
            if belt <= z <= wt and ay < cab.w - 0.16:
                return "glass"
            if zl <= z <= belt - 0.08 and ay < 0.55:
                return "trim"
            if z < zl:
                return "trim"
        return "paint"
    extra = [v for ab in glass_x for v in ab] + [sx + d for sx in seam_x for d in (-0.012, 0.012)]
    cab.build(T, mat_fn, cap_fn, {"f": [-0.55, 0.55], "r": []}, extra_stations=extra)
    for s in (1, -1):
        za, zb2 = wt - 0.35, belt + 0.08
        tube(T, (c2 - 0.25, s * (cab.w - 0.02), za), (c2 - 0.1, s * (cab.w + 0.22), za), 0.016, "trim", 5)
        tube(T, (c2 - 0.25, s * (cab.w - 0.02), zb2), (c2 - 0.1, s * (cab.w + 0.22), zb2), 0.016, "trim", 5)
        rbox(T, (c2 - 0.1, s * (cab.w + 0.24), (za + zb2) / 2), (0.07, 0.18, 0.42), "trim", bevel=0.025,
             mat_fn=lambda n: "glass" if n.x < -0.8 else "trim")
        rbox(T, (-0.05, s * (cab.w - 0.05), zb - 0.14), (0.55, 0.22, 0.06), "trim", bevel=0.015)
    for hx in handles:
        door_handle(T, cab, hx, belt - 0.12)
    zlamp = zl + 0.08
    for s in (1, -1):
        x, _ = cab.end_x(zlamp, "f")
        rbox(T, (x - 0.01, s * (cab.w - 0.30), zlamp), (0.06, 0.30, 0.18), "trim", bevel=0.025)
        rbox(T, (x + 0.02, s * (cab.w - 0.30), zlamp), (0.03, 0.24, 0.12), "light_front", bevel=0.02)
    grille(T, cab, belt - 0.44, belt - 0.10, 0.53, bars=3)
    rbox(T, (c2 + 0.02, 0, zb), (0.18, cab_w + 0.04, 0.24), bumper_mat, bevel=0.05, segs=2)
    return T, cab


def build_firetruck():
    L, W, R = 10.5, 2.5, 0.5
    xf = L / 2
    cab_len, cab_w, cab_h = 3.0, 2.45, 2.9
    cc = xf - cab_len / 2
    ax_f = xf - 1.3
    ax_r = ax_f - 6.35
    T, cab = cabover(cab_len, cab_w, cab_h, R, ax_f - cc, glass_x=[(0.15, 0.95), (-1.30, -0.12)],
                     seam_x=[1.05, 0.03, -1.40], belt=1.62, zb=0.70, handles=(0.22, -1.2), bumper_mat="chrome")
    B = Builder()
    B.merge(T, Matrix.Translation((cc, 0, 0)))
    xb0, xb1 = -xf + 0.05, xf - cab_len - 0.08
    z0, z1 = 1.08, 2.45
    yb = W / 2
    rbox(B, ((xb0 + xb1) / 2, 0, (z0 + z1) / 2), (xb1 - xb0, W, z1 - z0), "paint", bevel=0.04)
    doors = [(xb1 - 1.0, xb1 - 0.1), (ax_r + 0.65, xb1 - 1.2), (xb0 + 0.1, ax_r - 0.65)]
    for s in (1, -1):
        y = s * (yb + 0.005)
        for (lo, hi) in doors:
            rbox(B, ((lo + hi) / 2, y, 1.72), (hi - lo, 0.014, 1.15), "chrome", bevel=0.0)
            for zz in (1.40, 1.72, 2.04):
                rbox(B, ((lo + hi) / 2, y + s * 0.008, zz), (hi - lo - 0.04, 0.008, 0.02), "trim", bevel=0.0)
        rbox(B, ((xb0 + xb1) / 2, s * (yb + 0.004), 2.36), (xb1 - xb0 - 0.1, 0.012, 0.08), "livery", bevel=0.0,
             uvfn=lv_uv("white"))
        for xx in (xb1 - 0.15, xb0 + 0.15):
            rbox(B, (xx, s * (yb + 0.012), 2.2), (0.16, 0.03, 0.1), "sign", bevel=0.01, uvfn=sgn_uv("red"))
        rbox(B, ((xb0 + xb1) / 2, s * 0.45, 0.85), (xb1 - xb0 - 0.4, 0.1, 0.22), "trim", bevel=0.0)
        rbox(B, (ax_r - 0.68, s * (yb - 0.17), 0.55), (0.02, 0.36, 0.45), "trim", bevel=0.0)
    # aerial ladder, turntable, front rest
    lz, lx0, lx1 = 3.18, -4.95, 4.85
    for s in (1, -1):
        rbox(B, ((lx0 + lx1) / 2, s * 0.42, lz), (lx1 - lx0, 0.06, 0.13), "chrome", bevel=0.0)
    n = int((lx1 - lx0) / 0.42)
    for i in range(n + 1):
        rbox(B, (lx0 + 0.1 + i * (lx1 - lx0 - 0.2) / n, 0, lz), (0.035, 0.80, 0.035), "chrome", bevel=0.0)
    rbox(B, (-4.3, 0, z1 + 0.15), (1.1, 1.3, 0.3), "trim", bevel=0.05)
    rbox(B, (-4.3, 0, z1 + 0.45), (0.5, 0.95, 0.35), "paint", bevel=0.05)
    rbox(B, (1.9, 0, (z1 + lz) / 2), (0.18, 0.9, lz - z1), "trim", bevel=0.02)
    light_bar(B, xf - 0.45, cab_h + 0.03, 2.0, ["red", "white", "red", "white", "red"])
    # rear: chevrons, lights, step
    end_text(B, None, xb0, 1.72, 1.0, -1, rect=LV_REG["chevron"], w=2.2)
    for s in (1, -1):
        rbox(B, (xb0 - 0.02, s * 0.95, 1.25), (0.04, 0.2, 0.25), "light_rear", bevel=0.02)
        rbox(B, (xb0 - 0.02, s * 1.0, 2.3), (0.04, 0.15, 0.12), "sign", bevel=0.02, uvfn=sgn_uv("red"))
    rbox(B, (xb0 - 0.1, 0, 0.88), (0.3, W - 0.3, 0.12), "chrome", bevel=0.02)
    Wf = wheel(R, 0.30, segs=18, style="steel", rim_frac=0.6)
    Wr = wheel(R, 0.50, segs=18, style="steel", rim_frac=0.6)
    for s in (1, -1):
        add_wheel(B, Wf, ax_f, cab.w - 0.0, R, s)
        add_wheel(B, Wr, ax_r, yb - 0.04, R, s)
    return B


def build_garbage():
    L, W, R = 9.0, 2.5, 0.5
    xf = L / 2
    cab_len, cab_w, cab_h = 2.3, 2.45, 2.6
    cc = xf - cab_len / 2
    ax_f = xf - 1.25
    T, cab = cabover(cab_len, cab_w, cab_h, R, ax_f - cc, glass_x=[(-0.85, 0.62)], seam_x=[0.70, -0.95],
                     belt=1.55, zb=0.62, handles=(-0.70,))
    B = Builder()
    B.merge(T, Matrix.Translation((cc, 0, 0)))
    cb0, cb1 = -3.0, xf - cab_len - 0.1
    z0, z1 = 1.12, 3.30
    rbox(B, ((cb0 + cb1) / 2, 0, (z0 + z1) / 2), (cb1 - cb0, W, z1 - z0), "paint", bevel=0.16, segs=2)
    for s in (1, -1):
        for i in range(6):
            x = cb0 + 0.45 + i * (cb1 - cb0 - 0.9) / 5
            rbox(B, (x, s * (W / 2 + 0.012), (z0 + z1) / 2), (0.09, 0.03, z1 - z0 - 0.3), "paint", bevel=0.0)
        rbox(B, ((cb0 + cb1) / 2, s * (W / 2 + 0.01), z0 + 0.08), (cb1 - cb0 - 0.1, 0.03, 0.12), "trim", bevel=0.0)
        rbox(B, ((cb0 + cb1) / 2 + 0.6, s * 0.45, 0.85), (cb1 - cb0 + 1.6, 0.1, 0.22), "trim", bevel=0.0)
    # rear-loader compactor tailgate
    poly = [(-3.0, 1.02), (-3.0, 3.40), (-3.45, 3.40), (-4.1, 2.95), (-4.5, 1.80), (-4.5, 1.30), (-4.15, 1.02)]
    prism(B, poly, W / 2 - 0.03, ["paint", "paint", "paint", "paint", "trim", "trim", "trim"])
    p0, p1 = Vector((-4.5, 1.80)), Vector((-4.1, 2.95))
    d = (p1 - p0).normalized()
    nrm = Vector((-d.y, d.x))
    a_, b_ = p0 + d * 0.06 + nrm * 0.006, p0 + d * 0.58 + nrm * 0.006
    quad_uv(B, [(a_.x, 1.0, a_.y), (a_.x, -1.0, a_.y), (b_.x, -1.0, b_.y), (b_.x, 1.0, b_.y)],
            rect_uvs(LV_REG["chevron"]), "livery", out=(nrm.x, 0, nrm.y))
    for s in (1, -1):
        tube(B, (-3.15, s * (W / 2 + 0.03), 1.40), (-3.95, s * (W / 2 + 0.03), 2.75), 0.05, "chrome", segs=6)
        rbox(B, (-4.53, s * 1.05, 1.55), (0.04, 0.16, 0.36), "light_rear", bevel=0.01)
        rbox(B, (-4.30, s * 0.85, 0.86), (0.30, 0.45, 0.05), "trim", bevel=0.01)
        rbox(B, (-3.75, s * (W / 2 - 0.02), 3.25), (0.1, 0.03, 0.08), "light_rear", bevel=0.01)
    rbox(B, (xf - 0.7, 0, cab_h + 0.04), (0.25, 0.25, 0.05), "trim", bevel=0.01)
    rbox(B, (xf - 0.7, 0, cab_h + 0.12), (0.16, 0.16, 0.12), "sign", bevel=0.04, uvfn=sgn_uv("amber"))
    rbox(B, (1.2, -1.0, 0.75), (0.8, 0.42, 0.42), "chrome", bevel=0.12, segs=2)
    Wf = wheel(R, 0.30, segs=18, style="steel", rim_frac=0.6)
    Wr = wheel(R, 0.50, segs=18, style="steel", rim_frac=0.6)
    for s in (1, -1):
        add_wheel(B, Wf, ax_f, cab.w - 0.0, R, s)
        for ax in (-1.35, -2.45):
            add_wheel(B, Wr, ax, W / 2 - 0.04, R, s)
    return B


# ============================================================ second batch: buses

def build_schoolbus():
    L, W, R = 11.0, 2.5, 0.5
    xf = L / 2
    xbf = 3.55                      # main body front, behind the bonnet
    ax_f, ax_r = 4.2, -2.3
    Lb = xbf + xf
    cb = (xbf - xf) / 2             # main body centre (global x)
    roof = 3.12
    win = (1.78, 2.50)
    pillars = [2.45 - i * 0.82 for i in range(10)]
    door = (2.62, 3.36)             # kerb side (-y)
    P = dict(L=Lb, W=W, R=R, tw=0.30,
             arches=[(ax_r - cb, R + 0.09)], arch_steps=8,
             zb_tab=[(-Lb / 2, 0.80), (Lb / 2, 0.80)],
             zt_tab=[(-Lb / 2, roof - 0.03), (-Lb / 2 + 0.2, roof), (Lb / 2, roof)],
             bulge_tab=[(0.8, -0.01), (1.2, 0.01), (2.5, 0.0), (3.1, -0.03)], bulge_max=0.012,
             rb=0.05, rt=0.30, crown=0.05,
             breaks=[1.05, 1.68, win[0], win[1]],
             corner_f=(0.10, 0.04, [(0.0, 0.0), (1.0, 0.04)]),
             corner_r=(0.12, 0.02, [(0.0, 0.02), (1.0, 0.02)]),
             corner_us=[1.0, 0.6], max_step=1.6)
    body = Body(P)
    T = Builder()
    dm = (door[0] + door[1]) / 2

    def mat_fn(c, info):
        seg = info["seg"]
        xg = (info["x0"] + info["x1"]) / 2 + cb
        if seg <= 1:
            return "trim"
        side = abs(c.y) > body.w - 0.12
        if not side:
            return "paint"
        if c.z < info["zb"] + 0.12:
            return "trim"
        if c.y < 0 and door[0] < xg < door[1] and c.z < win[1] + 0.01:
            if abs(xg - door[0]) < 0.03 or abs(xg - door[1]) < 0.03 or abs(xg - dm) < 0.012:
                return "trim"
            return "glass" if c.z > 1.05 else "trim"
        if 1.68 <= c.z <= win[0]:
            return "trim"
        if win[0] <= c.z <= win[1]:
            if xg < -xf + 0.35:
                return "paint"
            for p in pillars:
                if abs(xg - p) < 0.05:
                    return "trim"
            return "glass"
        return "paint"

    def cap_fn(end, y, z):
        ay = abs(y)
        if end == "f":
            if 1.68 <= z <= win[1] and ay < body.w - 0.14:
                return "trim" if ay < 0.03 else "glass"
            return "paint"
        if win[0] <= z <= win[1] and ay < body.w - 0.16:
            return "trim" if 0.45 <= ay <= 0.52 else "glass"
        if 1.05 <= z <= win[1] and 0.45 <= ay <= 0.52:
            return "trim"
        if 1.68 <= z <= win[0]:
            return "trim"
        return "paint"
    extra = []
    for p in pillars:
        extra += [p - 0.05 - cb, p + 0.05 - cb]
    for v in (door[0], door[0] + 0.03, door[1] - 0.03, door[1], dm - 0.012, dm + 0.012, -xf + 0.35):
        extra.append(v - cb)
    bw = body.w
    body.build(T, mat_fn, cap_fn, {"f": [-(bw - 0.14), -0.03, 0.03, bw - 0.14],
                                    "r": [-(bw - 0.16), -0.52, -0.45, 0.45, 0.52, bw - 0.16]},
               extra_stations=extra)
    # stop arm (driver side), rub rails, text, warning lights - in body-local x
    stop_sign(T, 2.22 - cb, body.side_y(2.22 - cb, 1.38) + 0.035, 1.38, 0.2, 1)
    rbox(T, (2.45 - cb, body.side_y(2.45 - cb, 1.38) + 0.02, 1.38), (0.08, 0.04, 0.12), "trim", bevel=0.0)
    for s in (1, -1):
        for zz in (1.05, 1.36):
            y = body.side_y(0.0, zz) + 0.008
            x0r, x1r = -Lb / 2 + 0.15, Lb / 2 - 0.12
            rbox(T, ((x0r + x1r) / 2, s * y, zz), (x1r - x0r, 0.02, 0.05), "trim", bevel=0.0)
    for end, fac in (("f", 1), ("r", -1)):
        xe, _ = body.end_x(2.66, end)
        end_text(T, "SCHOOL BUS", xe, 2.66, 0.2, fac)
        for s in (1, -1):
            rbox(T, (xe, s * 0.82, 2.68), (0.06, 0.14, 0.14), "sign", bevel=0.03, uvfn=sgn_uv("red"))
            rbox(T, (xe, s * 1.0, 2.68), (0.06, 0.14, 0.14), "sign", bevel=0.03, uvfn=sgn_uv("amber"))
    xr, _ = body.end_x(1.25, "r")
    for s in (1, -1):
        rbox(T, (xr - 0.01, s * 0.95, 1.25), (0.05, 0.2, 0.34), "trim", bevel=0.02)
        rbox(T, (xr - 0.03, s * 0.95, 1.25), (0.03, 0.15, 0.28), "light_rear", bevel=0.015)
    for xx in (-2.0, 1.5):
        rbox(T, (xx, 0, roof + 0.05), (0.7, 0.7, 0.06), "trim", bevel=0.02)
    B = Builder()
    B.merge(T, Matrix.Translation((cb, 0, 0)))

    # bonnet
    Lh = 2.1
    ch = xf - Lh / 2
    HP = dict(L=Lh, W=2.2, R=R, tw=0.30,
              arches=[(ax_f - ch, R + 0.09)], arch_steps=8,
              zb_tab=[(-Lh / 2, 0.62), (Lh / 2 - 0.3, 0.62), (Lh / 2, 0.66)],
              zt_tab=[(-Lh / 2, 1.62), (0.2, 1.60), (Lh / 2 - 0.15, 1.52), (Lh / 2, 1.44)],
              bulge_tab=[(0.6, 0.0), (1.6, 0.0)], bulge_max=0.0,
              rb=0.05, rt=0.10, crown=0.04,
              breaks=[0.80, 0.92, 1.30],
              corner_f=(0.16, 0.10, [(0.0, 0.0), (0.4, 0.02), (1.0, 0.10)]),
              corner_us=[1.0, 0.7, 0.4], max_step=0.5)
    hood = Body(HP)
    H = Builder()

    def hmat(c, info):
        if info["seg"] <= 1:
            return "trim"
        if info["zone"] and c.z < 0.80:
            return "trim"
        return "paint"

    def hcap(end, y, z):
        if end == "f":
            if 0.92 <= z <= 1.30 and abs(y) < 0.48:
                return "trim"
            if z < 0.80:
                return "trim"
        return "paint"
    hood.build(H, hmat, hcap, {"f": [-0.48, 0.48], "r": []})
    grille(H, hood, 0.94, 1.28, 0.47, bars=3)
    for s in (1, -1):
        x, _ = hood.end_x(1.10, "f")
        rbox(H, (x - 0.01, s * 0.78, 1.10), (0.06, 0.26, 0.18), "trim", bevel=0.03)
        rbox(H, (x + 0.02, s * 0.78, 1.10), (0.03, 0.2, 0.13), "light_front", bevel=0.02)
    B.merge(H, Matrix.Translation((ch, 0, 0)))
    rbox(B, (xf + 0.04, 0, 0.68), (0.2, 2.45, 0.22), "trim", bevel=0.04)
    rbox(B, (-xf - 0.06, 0, 0.78), (0.2, 2.45, 0.22), "trim", bevel=0.04)
    for s in (1, -1):
        tube(B, (xf - 0.15, s * 1.0, 1.55), (xf + 0.1, s * 1.05, 1.95), 0.018, "trim", segs=5)
        rbox(B, (xf + 0.12, s * 1.05, 2.02), (0.16, 0.16, 0.16), "trim", bevel=0.06,
             mat_fn=lambda n: "glass" if n.x > 0.5 else "trim")
        tube(B, (xbf - 0.02, s * (W / 2 - 0.02), 2.35), (xbf + 0.15, s * (W / 2 + 0.2), 2.28), 0.016, "trim", 5)
        rbox(B, (xbf + 0.15, s * (W / 2 + 0.24), 2.05), (0.06, 0.16, 0.38), "trim", bevel=0.02,
             mat_fn=lambda n: "glass" if n.x < -0.8 else "trim")
    Wf = wheel(R, 0.30, segs=18, style="steel", rim_frac=0.6)
    Wr = wheel(R, 0.42, segs=18, style="steel", rim_frac=0.6)
    for s in (1, -1):
        add_wheel(B, Wf, ax_f, hood.w - 0.0, R, s)
        add_wheel(B, Wr, ax_r, body.w - 0.02, R, s)
    return B


def build_tourbus():
    L, W, R = 12.0, 2.6, 0.5
    xf = L / 2
    ax_f, ax_r = xf - 2.6, xf - 2.6 - 6.0
    deck = 2.45
    win = (1.05, 2.15)
    pillars = [-4.8, -3.5, -2.2, -0.9, 0.4, 1.7, 2.95]
    door = (4.15, 5.25)
    P = dict(L=L, W=W, R=R, tw=0.30,
             arches=[(ax_f, R + 0.09), (ax_r, R + 0.09)], arch_steps=8,
             zb_tab=[(-xf, 0.42), (-xf + 0.5, 0.34), (xf - 0.5, 0.33), (xf, 0.38)],
             zt_tab=[(-xf, deck), (xf, deck)],
             bulge_tab=[(0.3, -0.01), (0.6, 0.0), (1.2, 0.012), (2.5, 0.0)], bulge_max=0.012,
             rb=0.06, rt=0.08, crown=0.0,
             breaks=[0.62, 0.95, win[0], win[1], 2.30],
             corner_f=(0.22, 0.10, [(0.0, 0.04), (0.12, 0.0), (0.5, 0.0), (1.0, 0.10)]),
             corner_r=(0.22, 0.03, [(0.0, 0.03), (0.15, 0.0), (1.0, 0.02)]),
             corner_us=[1.0, 0.7, 0.4], max_step=1.6)
    body = Body(P)
    B = Builder()
    dm = (door[0] + door[1]) / 2

    def mat_fn(c, info):
        seg, zone, u = info["seg"], info["zone"], info["u"]
        xm = (info["x0"] + info["x1"]) / 2
        if seg <= 1:
            return "trim"
        side = abs(c.y) > body.w - 0.12
        if c.z > deck - 0.03 and abs(c.y) < body.w - 0.1:
            return "trim"   # upper-deck floor
        if zone == "r" and u >= 0.6 and 0.62 <= c.z <= 0.95:
            return "light_rear"
        if c.z < 0.62 and zone:
            return "trim"
        if side and c.y < 0 and door[0] < xm < door[1] and c.z < 2.30:
            if abs(xm - door[0]) < 0.02 or abs(xm - door[1]) < 0.02 or abs(xm - dm) < 0.012:
                return "trim"
            return "glass" if c.z > 0.95 else "trim"
        if side and win[0] <= c.z <= win[1]:
            for p in pillars:
                if abs(xm - p) < 0.06:
                    return "trim"
            if xm < -xf + 0.3:
                return "paint"
            return "glass"
        if zone == "f" and u >= 0.7 and 0.95 < c.z < 2.30:
            return "glass"
        return "paint"

    def cap_fn(end, y, z):
        ay = abs(y)
        if end == "f":
            if 0.95 <= z <= 2.30:
                return "glass"
            if z < 0.62:
                return "trim"
            return "paint"
        if z < 0.62:
            return "trim"
        if 0.62 <= z <= 0.95 and ay > 0.9:
            return "light_rear"
        if 0.95 <= z <= 2.15 and ay < 0.75:
            return "trim"
        return "paint"
    extra = []
    for p in pillars:
        extra += [p - 0.06, p + 0.06]
    for v in (door[0], door[0] + 0.02, door[1] - 0.02, door[1], dm - 0.012, dm + 0.012, -xf + 0.3):
        extra.append(v)
    body.build(B, mat_fn, cap_fn, {"f": [], "r": [-0.9, -0.75, 0.75, 0.9]}, extra_stations=extra)

    # upper deck: walls, front canopy + screen, railing, seats
    yw = body.w - 0.04
    x_back, x_front = -xf + 0.12, xf - 0.36
    zt_w = 3.45
    for s in (1, -1):
        rbox(B, ((x_back + x_front) / 2, s * yw, (deck + zt_w) / 2 - 0.02), (x_front - x_back, 0.08, zt_w - deck + 0.04),
             "paint", bevel=0.03)
    rbox(B, (x_front + 0.02, 0, deck + 0.2), (0.08, 2.3, 0.44), "paint", bevel=0.03)
    rbox(B, (x_back, 0, (deck + zt_w) / 2 - 0.02), (0.08, 2.5, zt_w - deck + 0.04), "paint", bevel=0.03)
    cx0, cx1 = 3.7, x_front + 0.04
    rbox(B, ((cx0 + cx1) / 2, 0, 4.22), (cx1 - cx0 + 0.1, 2.56, 0.08), "paint", bevel=0.03)
    rbox(B, (x_front + 0.02, 0, (deck + 0.42 + 4.18) / 2), (0.04, 2.3, 4.18 - deck - 0.42), "glass", bevel=0.0)
    for s in (1, -1):
        rbox(B, ((cx0 + cx1) / 2, s * yw, (zt_w + 4.18) / 2), (cx1 - cx0 - 0.1, 0.03, 4.18 - zt_w), "glass", bevel=0.0)
        for xx in (cx0, cx1 - 0.02):
            rbox(B, (xx, s * yw, (zt_w + 4.2) / 2), (0.07, 0.07, 4.2 - zt_w), "paint", bevel=0.0)
    rz = 3.92
    for s in (1, -1):
        tube(B, (x_back, s * yw, rz), (cx0, s * yw, rz), 0.025, "chrome", segs=6)
        n = int((cx0 - x_back) / 1.05)
        for i in range(n + 1):
            x = x_back + i * (cx0 - x_back) / n
            tube(B, (x, s * yw, zt_w), (x, s * yw, rz), 0.018, "chrome", segs=4)
    tube(B, (x_back, -yw, rz), (x_back, yw, rz), 0.025, "chrome", segs=6)
    blue = lv_uv("blue")
    x = -5.45
    while x < 5.0:
        for s in (1, -1):
            rbox(B, (x, s * 0.64, deck + 0.24), (0.42, 0.92, 0.48), "livery", bevel=0.0, uvfn=blue)
            rbox(B, (x - 0.21, s * 0.64, deck + 0.70), (0.08, 0.92, 0.46), "livery", bevel=0.0, uvfn=blue)
        x += 0.92
    side_text(B, "CITY TOURS", -0.8, 2.96, 0.40, lambda x, z: yw + 0.04)
    # front lamps, bumpers, mirrors
    for s in (1, -1):
        x, _ = body.end_x(0.78, "f")
        rbox(B, (x - 0.01, s * 0.82, 0.78), (0.06, 0.40, 0.24), "trim", bevel=0.03)
        for dy in (-0.09, 0.09):
            rbox(B, (x + 0.02, s * (0.82 + dy), 0.79), (0.03, 0.15, 0.13), "light_front", bevel=0.02)
        tube(B, (xf - 0.15, s * (body.w - 0.05), 2.2), (xf + 0.25, s * (body.w + 0.13), 2.1), 0.02, "trim", segs=5)
        rbox(B, (xf + 0.28, s * (body.w + 0.15), 1.85), (0.07, 0.22, 0.42), "trim", bevel=0.03,
             mat_fn=lambda n: "glass" if n.x < -0.8 else "trim")
        y = body.side_y(0.0, 0.70)
        rbox(B, ((ax_r + ax_f) / 2, s * (y + 0.01), 0.70), (ax_f - ax_r - 1.44, 0.03, 0.06), "trim", bevel=0.012)
    rbox(B, (xf - 0.02, 0, 0.47), (0.16, 2.3, 0.22), "trim", bevel=0.05, segs=2)
    rbox(B, (-xf + 0.02, 0, 0.50), (0.14, 2.4, 0.22), "trim", bevel=0.05, segs=2)
    Wf = wheel(R, 0.30, segs=18, style="steel", rim_frac=0.6)
    Wr = wheel(R, 0.42, segs=18, style="steel", rim_frac=0.6)
    for s in (1, -1):
        add_wheel(B, Wf, ax_f, body.w - 0.01, R, s)
        add_wheel(B, Wr, ax_r, body.w - 0.01, R, s)
    return B


# ============================================================ materials, export, previews

def make_materials():
    def principled(name, base, rough, metal, emit=None, strength=1.0, image=None):
        m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = (*base, 1)
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = metal
        if emit:
            bsdf.inputs["Emission Color"].default_value = (*emit, 1)
            bsdf.inputs["Emission Strength"].default_value = strength
        if image:
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image = image
            tex.interpolation = "Linear"
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
            if strength > 0:
                nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = strength
        return m

    build_atlas()
    build_livery()
    img = bpy.data.images.load(ATLAS_PNG)
    img.name = "sign_atlas"
    img.pack()
    liv = bpy.data.images.load(LIVERY_PNG)
    liv.name = "livery_atlas"
    liv.pack()
    return {
        "paint": principled("paint", (0.85, 0.85, 0.85), 0.32, 0.0),
        "glass": principled("glass", (0.025, 0.035, 0.045), 0.06, 0.4),
        "trim": principled("trim", (0.025, 0.025, 0.028), 0.55, 0.0),
        "tyre": principled("tyre", (0.03, 0.03, 0.03), 0.92, 0.0),
        "rim": principled("rim", (0.62, 0.63, 0.65), 0.3, 0.9),
        "light_front": principled("light_front", (1.0, 0.95, 0.85), 0.2, 0.0, emit=(1.0, 0.92, 0.75)),
        "light_rear": principled("light_rear", (0.6, 0.02, 0.02), 0.25, 0.0, emit=(1.0, 0.05, 0.03)),
        "sign": principled("sign", (1, 1, 1), 0.4, 0.0, image=img),
        "livery": principled("livery", (1, 1, 1), 0.35, 0.0, image=liv, strength=0.0),
        "chrome": principled("chrome", (0.9, 0.9, 0.92), 0.12, 1.0),
    }


def finish(name, B, mats):
    bm = B.bm
    # front: modelled toward +X -> rotate to Blender -Y (three.js +Z after the Y-up conversion)
    bmesh.ops.rotate(bm, verts=list(bm.verts), cent=(0, 0, 0), matrix=Matrix.Rotation(-math.pi / 2, 3, "Z"))
    bm.normal_update()
    for e in bm.edges:
        if len(e.link_faces) == 2:
            f0, f1 = e.link_faces
            ang = f0.normal.angle(f1.normal, 0.0)
            if ang > math.radians(38) or f0.material_index != f1.material_index:
                e.smooth = False
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for mn in MATS:
        me.materials.append(mats[mn])
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def clean_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)


BUILDERS = [("cab", build_cab), ("sedan", build_sedan), ("suv", build_suv),
            ("bus", build_bus), ("truck", build_truck), ("van", build_van),
            ("police", build_police), ("ambulance", build_ambulance), ("firetruck", build_firetruck),
            ("garbage", build_garbage), ("schoolbus", build_schoolbus), ("tourbus", build_tourbus),
            ("foodtruck", build_foodtruck), ("pickup", build_pickup), ("hatch", build_hatch),
            ("limo", build_limo), ("sports", build_sports), ("scooter", build_scooter)]

PREVIEW_PAINT = {"cab": (0.95, 0.62, 0.02), "sedan": (0.05, 0.12, 0.30), "suv": (0.06, 0.06, 0.07),
                 "bus": (0.85, 0.86, 0.88), "truck": (0.86, 0.86, 0.86), "van": (0.40, 0.25, 0.12),
                 "police": (0.90, 0.90, 0.92), "ambulance": (0.92, 0.92, 0.92), "firetruck": (0.62, 0.03, 0.03),
                 "garbage": (0.12, 0.30, 0.14), "schoolbus": (0.95, 0.58, 0.02), "tourbus": (0.60, 0.04, 0.05),
                 "foodtruck": (0.05, 0.42, 0.45), "pickup": (0.35, 0.05, 0.05), "hatch": (0.45, 0.60, 0.25),
                 "limo": (0.02, 0.02, 0.025), "sports": (0.85, 0.20, 0.03), "scooter": (0.70, 0.08, 0.06)}

LINEUP_SMALL = ["scooter", "hatch", "sedan", "cab", "police", "sports", "suv", "pickup", "limo"]
LINEUP_BIG = ["van", "ambulance", "foodtruck", "truck", "garbage", "firetruck", "schoolbus", "bus", "tourbus"]


def export(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", use_selection=True, export_yup=True,
                              export_apply=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_animations=False)


def previews(objs, only=None):
    s = bpy.context.scene
    s.render.engine = "BLENDER_EEVEE"
    s.render.threads_mode = "FIXED"
    s.render.threads = 8
    s.view_settings.view_transform = "AgX"
    s.view_settings.look = "AgX - Medium High Contrast" if False else "None"
    s.render.film_transparent = False
    world = bpy.data.worlds.new("sky")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.55, 0.62, 0.72, 1)
    bg.inputs["Strength"].default_value = 0.9
    s.world = world
    bpy.ops.object.light_add(type="SUN", rotation=(math.radians(52), 0, math.radians(-35)))
    sun = bpy.context.object
    sun.data.energy = 3.2
    sun.data.angle = math.radians(3)
    sun.data.color = (1.0, 0.95, 0.88)
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, 0))
    ground = bpy.context.object
    gm = bpy.data.materials.new("ground")
    gm.use_nodes = True
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.23, 0.23, 0.24, 1)
    gm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
    ground.data.materials.append(gm)
    bpy.ops.object.camera_add()
    cam = bpy.context.object
    s.camera = cam
    cam.data.lens = 50
    cam.data.clip_end = 500
    os.makedirs(PREV_DIR, exist_ok=True)

    # per-object paint copies so each preview shows a typical colour
    for ob in objs:
        pm = ob.data.materials[0].copy()
        pm.name = "paint_prev_" + ob.name
        pm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*PREVIEW_PAINT[ob.name], 1)
        ob.material_slots[0].link = "OBJECT"
        ob.material_slots[0].material = pm

    def shoot(path, target, dist, yaw, elev, res=(1280, 800), lens=50):
        cam.data.lens = lens
        d = Vector((math.sin(math.radians(yaw)), -math.cos(math.radians(yaw)), math.tan(math.radians(elev))))
        cam.location = target + d.normalized() * dist
        cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
        s.render.resolution_x, s.render.resolution_y = res
        s.render.filepath = path
        bpy.ops.render.render(write_still=True)

    for ob in objs:
        for o2 in objs:
            o2.hide_render = o2 is not ob
        dims = ob.dimensions
        size = max(dims.x, dims.y, dims.z)
        tgt = Vector((0, 0, dims.z * 0.42))
        if only and ob.name not in only:
            continue
        shoot(os.path.join(PREV_DIR, f"{ob.name}.png"), tgt, size * 1.75 + 1.5, 35, 14)
        shoot(os.path.join(PREV_DIR, f"{ob.name}_rear.png"), tgt, size * 1.75 + 1.5, -150, 16)
        shoot(os.path.join(PREV_DIR, f"{ob.name}_side.png"), tgt, size * 1.6 + 1.5, 90, 2, lens=50)
    if only:
        return
    # lineups: small vehicles in front, big ones behind, all facing the camera
    by = {ob.name: ob for ob in objs}

    def place(names, y):
        x = 0.0
        for n in names:
            ob = by[n]
            w = ob.dimensions.x
            ob.location = (x + w / 2, y, 0)
            x += w + 1.0
        total = x - 1.0
        for n in names:
            by[n].location.x -= total / 2
        return total

    for ob in objs:
        ob.hide_render = True
    ws = place(LINEUP_SMALL, -6.0)
    wb = place(LINEUP_BIG, 8.0)
    for n in LINEUP_SMALL:
        by[n].hide_render = False
    shoot(os.path.join(PREV_DIR, "lineup_small.png"), Vector((0, -6.0, 0.8)), ws * 1.55, 8, 14, res=(1800, 600))
    for ob in objs:
        ob.hide_render = ob.name not in LINEUP_BIG
    shoot(os.path.join(PREV_DIR, "lineup_big.png"), Vector((0, 8.0, 1.6)), wb * 1.4, 8, 14, res=(1800, 600))
    for ob in objs:
        ob.hide_render = False
    shoot(os.path.join(PREV_DIR, "lineup.png"), Vector((0, 2.0, 1.2)), max(ws, wb) * 1.45, 8, 22, res=(2000, 1000))
    for ob in objs:
        ob.location = (0, 0, 0)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    clean_scene()
    mats = make_materials()
    objs = []
    for name, fn in BUILDERS:
        B = fn()
        print(f"[vehicles] {name}: {B.tris()} tris")
        objs.append(finish(name, B, mats))
    export(objs)
    print("[vehicles] exported", OUT_GLB, os.path.getsize(OUT_GLB), "bytes")
    if "--no-previews" not in argv:
        only = None
        if "--only" in argv:
            only = argv[argv.index("--only") + 1].split(",")
        previews(objs, only)


main()
