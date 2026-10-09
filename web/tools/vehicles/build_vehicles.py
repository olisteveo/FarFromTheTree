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

MATS = ["paint", "glass", "trim", "tyre", "rim", "light_front", "light_rear", "sign"]
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

    def lathe(profile, outward_sign, mat_fn):
        rings = []
        for (r, y) in profile:
            if r < 1e-6:
                rings.append([T.v((0, y, 0))] * segs)
            else:
                rings.append([T.v((r * math.cos(2 * math.pi * i / segs), y, r * math.sin(2 * math.pi * i / segs)))
                              for i in range(segs)])
        for k in range(len(profile) - 1):
            (r0, y0), (r1, y1) = profile[k], profile[k + 1]
            dr, dy = r1 - r0, y1 - y0
            nr, ny = (-dy * outward_sign, dr * outward_sign)
            for i in range(segs):
                j = (i + 1) % segs
                a = 2 * math.pi * (i + 0.5) / segs
                out = Vector((nr * math.cos(a), ny, nr * math.sin(a)))
                T.face([rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]], mat_fn(k, i), out=out)
        return rings

    tyre = [(rr + 0.004, -0.022), (R * 0.82, -0.002), (R * 0.965, -0.014), (R, -0.05),
            (R, -(tw - 0.05)), (R * 0.965, -(tw - 0.014)), (R * 0.82, -(tw - 0.002)), (rr + 0.004, -(tw - 0.022))]
    lathe(tyre, 1, lambda k, i: "tyre")

    if style == "alloy":
        rim = [(rr, -0.024), (rr * 0.95, -0.014), (rr * 0.86, -0.04), (rr * 0.36, -0.052),
               (rr * 0.24, -0.03), (0.0, -0.028)]

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
                f = B.face([va, vb, vc, vd], mat)
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
                B.face(vs, mat_fn(c.y, c.z), out=out, uvfn=uvfn)

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


# ============================================================ sign atlas texture

GLYPHS = {
    "T": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
    "A": [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "X": ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
    "I": [".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
    "D": ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
    "O": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    "W": ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
    "N": ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
    " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
}
ATLAS_W, ATLAS_H = 256, 128


def write_png(path, w, h, px):
    raw = b"".join(b"\x00" + bytes(px[y * w * 3:(y + 1) * w * 3]) for y in range(h))

    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    data += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(data)


def build_atlas():
    """Top half (v 0.5-1): lit TAXI panel. Bottom half (v 0-0.5): amber LED destination sign."""
    W, H = ATLAS_W, ATLAS_H
    px = [0] * (W * H * 3)

    def put(x, y, c):
        if 0 <= x < W and 0 <= y < H:
            o = (y * W + x) * 3
            px[o:o + 3] = c
    # TAXI panel, rows 0..63 of the image (top)
    bg, ink = (255, 238, 185), (28, 22, 16)
    for y in range(0, 64):
        for x in range(W):
            put(x, y, bg)
    text, cell = "TAXI", 7
    gw = len(text) * 5 * cell + (len(text) - 1) * cell * 1.4
    x0, y0 = int((W - gw) / 2), int((64 - 7 * cell) / 2)
    for ci, ch in enumerate(text):
        gx = x0 + int(ci * (5 * cell + cell * 1.4))
        for r, line in enumerate(GLYPHS[ch]):
            for c, on in enumerate(line):
                if on == "#":
                    for yy in range(cell):
                        for xx in range(cell):
                            put(gx + c * cell + xx, y0 + r * cell + yy, ink)
    # LED destination sign, rows 64..127
    off, on, dim = (6, 5, 4), (255, 150, 25), (48, 26, 6)
    for y in range(64, 128):
        for x in range(W):
            put(x, y, off)
    text, cell = "DOWNTOWN", 5
    cols = len(text) * 6 - 1
    x0, y0 = (W - cols * cell) // 2, 64 + (64 - 7 * cell) // 2
    for row in range(-2, 9):
        for col in range(-2, cols + 2):
            lit = False
            ci, cc = divmod(col, 6)
            if 0 <= row < 7 and 0 <= col < cols and cc < 5 and ci < len(text):
                lit = GLYPHS[text[ci]][row][cc] == "#"
            colr = on if lit else dim
            for yy in range(cell - 1):
                for xx in range(cell - 1):
                    put(x0 + col * cell + xx, y0 + row * cell + yy, colr)
    write_png(ATLAS_PNG, W, H, px)


# UV regions in the atlas (u, v with v up)
TAXI_UV = (0.0, 0.5, 1.0, 1.0)
TAXI_BG_UV = (0.03, 0.97)
DEST_UV = (0.0, 0.0, 1.0, 0.5)


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


def door_handle(B, body, x, z, w=0.13):
    for s in (1, -1):
        y = body.side_y(x, z)
        rbox(B, (x, s * (y + 0.008), z), (w, 0.03, 0.03), "trim", bevel=0.008)


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

    bps_f = [hl["y_in"], gr["w"], it["w"]]
    bps_r = [tl["y_in"]] + ([0.27] if P.get("plate") else [])
    bps = {"f": sorted(set([b for b in bps_f] + [-b for b in bps_f])),
           "r": sorted(set([b for b in bps_r] + [-b for b in bps_r]))}
    body.build(B, mat_fn, cap_fn, bps)

    if G:
        greenhouse(B, body, G)
        mx = G["ctrl"][0][0] - 0.16
        mz = G["z_base"] + 0.1
        for s in (1, -1):
            mirror(B, mx, body.hw(mx) - G["inset"] + 0.01, mz, s)
    for (x, z) in P.get("handles", []):
        door_handle(B, body, x, z)
    if P.get("hood_lines"):
        x0, x1 = P["hood_lines"]
        xs = [lerp(x0, x1, i / 6) for i in range(7)]
        shut_strip(B, body, xs, body.w - 0.13)

    W = wheel(P["R"], P["tw"], segs=P.get("wheel_segs", 15), style=P.get("wheel_style", "alloy"))
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
        breaks=[0.40, 0.48, 0.62, 0.74, 0.86],
        corner_f=(0.32, 0.16, [(0.0, 0.07), (0.25, 0.0), (0.55, 0.03), (1.0, 0.16)]),
        corner_r=(0.30, 0.08, [(0.0, 0.07), (0.3, 0.0), (0.75, 0.0), (1.0, 0.08)]),
        head=dict(z0=0.62, z1=0.74, y_in=0.40, u=0.6),
        tail=dict(z0=0.74, z1=0.86, y_in=0.36, u=0.6),
        grille=dict(z0=0.48, z1=0.74, w=0.34),
        intake=dict(z0=0.30, z1=0.40, w=0.62),
        valance=0.30, plate=(0.48, 0.62),
        seams=[0.93, -0.02, -0.98],
        handles=[(0.62, 0.86), (-0.38, 0.86)],
        hood_lines=(0.98, xf - 0.30),
        max_step=0.35,
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
    P["seams"] = [0.98, -0.05, -1.08]
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
        seams=[1.00, 0.0, -1.03],
        handles=[(0.70, 1.03), (-0.36, 1.03)],
        hood_lines=(1.12, xf - 0.30),
        max_step=0.35,
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
        arches=[(ax_f, R + 0.08), (ax_r, R + 0.08)],
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
        seams=[1.55, 0.62, -0.95],
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
        for sx in P["seams"]:
            if abs(xm - sx) < 0.004 and abs(c.y) > body.w - 0.15 and info["zb"] + 0.03 < c.z < 2.2:
                if sx == -0.95 and c.y > 0:
                    continue   # sliding door only on the kerb side
                return "trim"
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
    # sliding door rail
    y = body.side_y(-0.4, 1.96)
    rbox(B, (-1.5, -(y + 0.006), 1.97), (1.1, 0.025, 0.03), "trim", bevel=0.008)
    # mirrors (big commercial ones)
    for s in (1, -1):
        mirror(B, 1.55, body.w - 0.02, 1.62, s, size=(0.08, 0.16, 0.26), arm=0.12)
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
        breaks=[0.62, 0.80, win[0], win[1], 2.62, 2.80],
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
        if zone == "f" and u >= 0.65 and 0.62 <= c.z <= 0.80:
            return "light_front"
        if zone == "r" and u >= 0.6 and 0.80 <= c.z <= win[0]:
            return "light_rear"
        if c.z < 0.62 and (zone or side):
            return "trim" if c.z < info["zb"] + 0.2 or zone else "paint"
        d = in_door(xm, c)
        if d and side and c.z < 2.62:
            if abs(xm - d[0]) < 0.02 or abs(xm - d[1]) < 0.02 or abs(xm - (d[0] + d[1]) / 2) < 0.012:
                return "trim"
            return "glass" if c.z > 0.80 else "trim"
        if side and win[0] <= c.z <= win[1]:
            for p in pillars:
                if abs(xm - p) < 0.065:
                    return "trim"
            if zone == "f" and u > 0.3:
                return "glass"
            if xm < -xf + 0.3:
                return "paint"
            return "glass"
        if zone == "f" and u >= 0.7 and win[0] - 0.4 < c.z < 2.62:
            return "glass"
        return "paint"

    sign_w = 0.82

    def cap_fn(end, y, z):
        ay = abs(y)
        if end == "f":
            if 2.62 <= z <= 2.80 and ay < sign_w:
                return "sign"
            if 0.80 <= z <= 2.62 and ay < body.w - 0.14:
                return "glass" if z > win[0] else "paint"
            if 0.62 <= z <= 0.80 and ay > 0.84:
                return "light_front"
            if z < 0.62:
                return "trim"
            return "paint"
        if z < 0.62:
            return "trim"
        if 0.80 <= z <= win[0] and ay > 0.9:
            return "light_rear"
        if 1.80 <= z <= win[1] and ay < 0.95:
            return "glass"
        if 0.80 <= z <= win[0] and ay < 0.75:
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
        if zone == "f" and u >= 0.6 and 0.84 <= c.z <= 1.0:
            return "light_front"
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
            if 0.84 <= z <= 1.00 and ay > 0.62:
                return "light_front"
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
    rbox(B, (0.4, -1.0, 0.72), (0.9, 0.42, 0.42), "rim", bevel=0.12, segs=2)   # fuel tank (chrome-ish)
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
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = strength
        return m

    build_atlas()
    img = bpy.data.images.load(ATLAS_PNG)
    img.name = "sign_atlas"
    img.pack()
    return {
        "paint": principled("paint", (0.85, 0.85, 0.85), 0.32, 0.0),
        "glass": principled("glass", (0.025, 0.035, 0.045), 0.06, 0.4),
        "trim": principled("trim", (0.025, 0.025, 0.028), 0.55, 0.0),
        "tyre": principled("tyre", (0.03, 0.03, 0.03), 0.92, 0.0),
        "rim": principled("rim", (0.62, 0.63, 0.65), 0.3, 0.9),
        "light_front": principled("light_front", (1.0, 0.95, 0.85), 0.2, 0.0, emit=(1.0, 0.92, 0.75)),
        "light_rear": principled("light_rear", (0.6, 0.02, 0.02), 0.25, 0.0, emit=(1.0, 0.05, 0.03)),
        "sign": principled("sign", (1, 1, 1), 0.4, 0.0, image=img),
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
            ("bus", build_bus), ("truck", build_truck), ("van", build_van)]

PREVIEW_PAINT = {"cab": (0.95, 0.62, 0.02), "sedan": (0.05, 0.12, 0.30), "suv": (0.06, 0.06, 0.07),
                 "bus": (0.85, 0.86, 0.88), "truck": (0.86, 0.86, 0.86), "van": (0.40, 0.25, 0.12)}


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
        shoot(os.path.join(PREV_DIR, f"{ob.name}.png"), tgt, size * 1.75 + 1.5, 140, 14)
        shoot(os.path.join(PREV_DIR, f"{ob.name}_rear.png"), tgt, size * 1.75 + 1.5, -30, 16)
        shoot(os.path.join(PREV_DIR, f"{ob.name}_side.png"), tgt, size * 1.6 + 1.5, 90, 2, lens=50)
    if only:
        return
    # lineup: side by side, all facing the camera-ish
    x = 0.0
    for ob in objs:
        ob.hide_render = False
        w = ob.dimensions.x
        ob.location = (x + w / 2, 0, 0)
        x += w + 1.2
    total = x - 1.2
    tgt = Vector((total / 2, 0, 1.2))
    shoot(os.path.join(PREV_DIR, "lineup.png"), tgt, total * 1.25, 150, 12, res=(1800, 700), lens=50)
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
