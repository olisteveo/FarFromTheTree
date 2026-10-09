"""Far From the Tree - pedestrian and dog animation (procedural keys) and the dog builder.
Imported by people_blender.py inside Blender."""
import math
from mathutils import Vector, Matrix, Quaternion

TAU = math.tau


def qx(deg):
    return Quaternion((1, 0, 0), math.radians(deg))


def qy(deg):
    return Quaternion((0, 1, 0), math.radians(deg))


def qz(deg):
    return Quaternion((0, 0, 1), math.radians(deg))


def smooth01(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def Q_angle_x(q):
    return math.degrees(q.to_euler("XYZ").x)


class Poser:
    """Mini FK in armature space. Q[bone] is a delta rotation (armature axes: X = character's left,
    Y = back, Z = up) applied at the bone's head in the parent's posed frame; T[bone] adds a
    translation; direct[bone] pins a bone's armature-space matrix (IK targets)."""

    def __init__(self, arm_ob):
        self.ob = arm_ob
        self.rest = {b.name: b.matrix_local.copy() for b in arm_ob.data.bones}
        self.tail = {b.name: b.tail_local.copy() for b in arm_ob.data.bones}
        self.head = {b.name: b.head_local.copy() for b in arm_ob.data.bones}
        self.order = []
        seen = set()

        def visit(b):
            if b.name in seen:
                return
            if b.parent:
                visit(b.parent)
            seen.add(b.name)
            self.order.append(b.name)
        for b in arm_ob.data.bones:
            visit(b)
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in arm_ob.data.bones}

    def solve(self, Q, T, direct):
        W, P, Mp = {}, {}, {}
        for bn in self.order:
            R = self.rest[bn]
            rot_rest = R.to_quaternion()
            h_rest = R.translation
            par = self.parent[bn]
            if bn in direct:
                Mp[bn] = direct[bn]
                W[bn] = Quaternion()
                P[bn] = direct[bn].translation
                continue
            q = Q.get(bn, Quaternion())
            if par:
                Wp = W[par]
                head = P[par] + Wp @ (h_rest - self.rest[par].translation)
                Wb = Wp @ q
            else:
                head = h_rest.copy()
                Wb = q
            head = head + T.get(bn, Vector())
            W[bn] = Wb
            P[bn] = head
            Mp[bn] = Matrix.Translation(head) @ (Wb @ rot_rest).to_matrix().to_4x4()
        return Mp, P, W

    def apply(self, Mp, frame):
        for bn in self.order:
            pb = self.ob.pose.bones[bn]
            par = self.parent[bn]
            R = self.rest[bn]
            if par:
                basis = (self.rest[par].inverted() @ R).inverted() @ Mp[par].inverted() @ Mp[bn]
            else:
                basis = R.inverted() @ Mp[bn]
            loc, rot, _ = basis.decompose()
            pb.location = loc
            pb.rotation_quaternion = rot
            pb.keyframe_insert("location", frame=frame)
            pb.keyframe_insert("rotation_quaternion", frame=frame)


def foot_track(p, L, stance=0.62, lift=0.11, back=0.07, roll=True):
    """Foot motion relative to the hips for local phase p (0 = heel strike), stride L per cycle.
    Returns (dy, lift_z, pitch_deg): dy along +Y (backward), pitch > 0 = heel up."""
    D = L * stance
    if p < stance:
        s = p / stance
        dy = -D / 2 + D * s
        z = 0.0
        if p < 0.08:
            pitch = -16 * (1 - p / 0.08) ** 1.5
        elif p < 0.36:
            pitch = 0.0
        else:
            pitch = 34 * smooth01((p - 0.36) / (stance - 0.36)) ** 1.3
    else:
        s = (p - stance) / (1 - stance)
        e = 0.5 - 0.5 * math.cos(math.pi * s)
        dy = D / 2 - D * e
        z = lift * (math.sin(math.pi * s) ** 1.1) * (1.15 - 0.3 * s)
        if s < 0.3:
            pitch = 34 * (1 - s / 0.3) + 5 * (s / 0.3)
        elif s < 0.75:
            pitch = 5 - 13 * ((s - 0.3) / 0.45)
        else:
            pitch = -8 - 8 * ((s - 0.75) / 0.25)
    if not roll:
        pitch = 0.0
    return dy + back * L, z, pitch


# ============================================================================================ humans
class Anim:
    def __init__(self, C, B, poser, prefix="", ox=0.0):
        self.C, self.B, self.P, self.p, self.ox = C, B, poser, prefix, ox
        self.st = C.get("style", {})
        self._reach = {}

    root = property(lambda self: self.p + "hips")

    def legs(self):
        p = self.p
        out = []
        for s in ("L", "R"):
            th, sh = p + "thigh." + s, p + "shin." + s
            L = (self.P.tail[th] - self.P.head[th]).length + (self.P.tail[sh] - self.P.head[sh]).length
            out.append((th, p + "foot_ik." + s, L))
        return out

    def foot_target(self, side, dy, lift, pitch, yaw=0.0, dx=0.0):
        """Matrix for the foot_ik bone: ankle position after rolling about the heel or toe."""
        B, p = self.B, self.p
        R = self.P.rest[p + "foot_ik." + side]
        ank = R.translation.copy()
        ank.y += dy
        ank.x += dx
        k = B["k"]
        heel = Vector((ank.x, ank.y + 0.05 * k, 0.0))
        toe = Vector((ank.x, ank.y - B["foot"] * 0.68, 0.0))
        q = Quaternion((1, 0, 0), math.radians(-pitch))
        piv = toe if pitch > 0 else heel
        ank2 = piv + q @ (ank - piv)
        ank2.z += lift
        rot = qz(yaw) @ q
        return Matrix.Translation(ank2) @ (rot @ R.to_quaternion()).to_matrix().to_4x4()

    def reach(self, side, target):
        """Upper-arm pitch/roll + elbow bend that put the palm at `target` (torso at rest)."""
        key = (side, tuple(round(x, 4) for x in target))
        if key in self._reach:
            return self._reach[key]
        p, P = self.p, self.P
        ua, fa, hd = p + "upperarm." + side, p + "forearm." + side, p + "hand." + side
        h_ua, h_fa, h_hd, t_hd = P.head[ua], P.head[fa], P.head[hd], P.tail[hd]
        tgt = Vector(target)
        sg = 1 if side == "L" else -1

        def tip(a, b, c):
            Wu = qx(a) @ qy(b)
            fa_h = h_ua + Wu @ (h_fa - h_ua)
            Wf = Wu @ qx(c)
            hd_h = fa_h + Wf @ (h_hd - h_fa)
            return hd_h + Wf @ ((t_hd - h_hd) * 0.5)

        def err(a, b, c):
            return (tip(a, b, c) - tgt).length + 0.00004 * abs(b) + 0.00002 * abs(c)
        best = None
        for a in range(-110, 45, 6):
            for b in range(-80, 81, 6):
                for c in range(-130, 1, 6):
                    e = err(a, b, c)
                    if best is None or e < best[0]:
                        best = (e, a, b, c)
        _, a0, b0, c0 = best
        for a in range(a0 - 6, a0 + 7):
            for b in range(b0 - 6, b0 + 7):
                for c in range(c0 - 6, min(0, c0 + 6) + 1):
                    e = err(a, b, c)
                    if e < best[0]:
                        best = (e, a, b, c)
        self._reach[key] = best[1:]
        print("[people] reach %s%s -> err %.3f m" % (p, side, best[0]), flush=True)
        return best[1:]

    def torso(self, Q, T, a, stroll, lean_extra=0.0, yaw_scale=1.0):
        B, p, st = self.B, self.p, self.st
        k = B["k"]
        hunch = st.get("hunch", 0)
        lean = st.get("lean", 4) * (1.0 if not stroll else 0.7) + lean_extra
        bob = (0.022 if not stroll else 0.015) * k
        sway = (0.020 if not stroll else 0.024) * k
        yawA = (7 if not stroll else 5) * yaw_scale
        rollA = 4 if not stroll else 3
        T[p + "hips"] = Vector((sway * math.sin(a), 0.0, -bob * math.cos(2 * a) - 0.008 * k))
        Q[p + "hips"] = qz(-yawA * math.cos(a)) @ qy(-rollA * math.sin(a)) @ qx(2 + lean * 0.3)
        Q[p + "spine"] = qz(yawA * 0.7 * math.cos(a)) @ qy(rollA * 0.5 * math.sin(a)) @ qx(lean * 0.4 + 0.8 * math.cos(2 * a))
        Q[p + "chest"] = qz(yawA * 0.9 * math.cos(a)) @ qy(rollA * 0.3 * math.sin(a)) @ qx(lean * 0.5 + hunch * 0.8)
        tot = 2 + lean * 1.2 + hunch * 0.8
        hd = st.get("head_down", 0)
        look = (7 if stroll else 0) * math.sin(a)
        Q[p + "neck"] = qz(-yawA * 0.4 * math.cos(a)) @ qx(-tot * 0.45 + hd * 0.4 + hunch * 0.3)
        Q[p + "head"] = (qz(-yawA * 0.6 * math.cos(a) + look) @ qx(-tot * 0.45 + hd * 0.6 - hunch * 0.2 + 1.2 * math.cos(2 * a))
                         @ qy(-rollA * 0.4 * math.sin(a)))

    def pose(self, clip, t):
        """t in [0,1) of the clip. Returns (Q, T, direct)."""
        B, p, st = self.B, self.p, self.st
        k = B["k"]
        Q, T, D = {}, {}, {}
        hunch = st.get("hunch", 0)
        swing = st.get("swing", 16)
        props = [x.partition(".")[0] for x in self.C.get("props", [])]
        pushing = "stroller" in props
        if clip in ("walk", "stroll"):
            cyc = self.C.get("_kidcycles", 1)
            ph = (t * cyc) % 1.0
            L = self.stride(clip) / cyc
            stroll = clip == "stroll"
            a = TAU * ph
            self.torso(Q, T, a, stroll, lean_extra=(4 if pushing else 0), yaw_scale=(0.4 if pushing else 1.0))
            sw = swing * (1.0 if not stroll else 0.6)
            for side, sg, off in (("L", 1, 0.0), ("R", -1, 0.5)):
                pf = (ph + off) % 1.0
                dy, lift, pitch = foot_track(pf, L, lift=(0.10 if not stroll else 0.075) * k * (1.1 if B["kid"] else 1.0))
                D[p + "foot_ik." + side] = self.foot_target(side, dy, lift, pitch, yaw=-4 * sg)
                fwd = math.cos(TAU * pf)                  # +1 when this side's leg is forward -> arm back
                arm = sw * fwd
                Q[p + "shoulder." + side] = qz(sg * 3 * fwd * sw / 16) @ qy(sg * 2)
                Q[p + "upperarm." + side] = qx(arm * 0.95 + 3) @ qy(-sg * (7 + (3 if self.C["coat"].startswith("puffer") else 0)))
                bend = 14 + max(0.0, -fwd) * sw * 0.9 + (6 if stroll else 0)
                Q[p + "forearm." + side] = qx(-bend)
                Q[p + "hand." + side] = qx(-6) @ qz(sg * 10)
            self.arm_overrides(Q, clip, t, a)
        elif clip == "idle":
            a = TAU * t
            sh = 0.03 * k * math.sin(a)
            gawk = st.get("gawk")
            T[p + "hips"] = Vector((sh, 0.0, -0.006 * k * (1 + math.cos(2 * a)) - 0.004 * k))
            Q[p + "hips"] = qy(-3.5 * math.sin(a)) @ qz(3 * math.sin(a + 0.6)) @ qx(2 + hunch * 0.2)
            breath = math.sin(TAU * t * 3)
            Q[p + "spine"] = qy(2.0 * math.sin(a)) @ qx(1 + 0.8 * breath + hunch * 0.3 - (4 if gawk else 0))
            Q[p + "chest"] = qy(1.2 * math.sin(a)) @ qx(1.0 * breath + hunch * 0.8 - (3 if gawk else 0))
            hd = st.get("head_down", 0)
            look = 16 * math.sin(a * 2 + 0.4) * 0.6 + 8 * math.sin(a + 1.3)
            up = (-16 - 8 * math.sin(a * 2)) if gawk else 0
            Q[p + "neck"] = qz(look * 0.35 * (1.6 if gawk else 1)) @ qx(-1 + hd * 0.4 + up * 0.4)
            Q[p + "head"] = qz(look * 0.65 * (1.6 if gawk else 1)) @ qx(-2 + hd * 0.7 - hunch * 0.3 + up * 0.6 + 3 * math.sin(a * 3)) @ qy(1.5 * math.sin(a))
            for side, sg in (("L", 1), ("R", -1)):
                D[p + "foot_ik." + side] = self.foot_target(side, (0.05 * sg) * k, 0.0, 0.0, yaw=-9 * sg)
                Q[p + "shoulder." + side] = qy(sg * 1.0 * breath)
                Q[p + "upperarm." + side] = qx(2 + 2 * math.sin(a + sg)) @ qy(-sg * (6 + (3 if self.C["coat"].startswith("puffer") else 0) + 1.5 * math.sin(a)))
                Q[p + "forearm." + side] = qx(-12 - 4 * math.sin(a + 0.5 * sg))
                Q[p + "hand." + side] = qx(-6) @ qz(sg * 12)
            self.arm_overrides(Q, clip, t, a)
        elif clip == "flinch":
            # 0..1: startle -> duck -> look up after the leaf -> settle
            s1 = smooth01(t / 0.12)
            s2 = smooth01((t - 0.18) / 0.3)
            s3 = smooth01((t - 0.72) / 0.28)
            duck = s1 * (1 - s2 * 0.6) * (1 - s3)
            up = s2 * (1 - s3 * 0.8)
            T[p + "hips"] = Vector((0.0, 0.035 * k * duck, -0.05 * k * duck - 0.01 * k))
            Q[p + "hips"] = qx(8 * duck + 2)
            Q[p + "spine"] = qx(9 * duck - 6 * up)
            Q[p + "chest"] = qx(10 * duck - 8 * up + hunch * 0.5)
            turn = 22 * up * math.sin(min(1.0, t * 2.2) * math.pi * 0.8)
            Q[p + "neck"] = qx(10 * duck - 12 * up) @ qz(turn * 0.4)
            Q[p + "head"] = qx(8 * duck - 22 * up) @ qz(turn * 0.6)
            for side, sg in (("L", 1), ("R", -1)):
                D[p + "foot_ik." + side] = self.foot_target(side, (0.06 * sg) * k, 0.0, 0.0, yaw=-14 * sg, dx=0.04 * sg * k)
                Q[p + "shoulder." + side] = qy(sg * -14 * duck)
                guard = duck + 0.35 * up
                Q[p + "upperarm." + side] = qx(-75 * guard) @ qy(-sg * (8 + 22 * guard))
                Q[p + "forearm." + side] = qx(-12 - 95 * guard)
                Q[p + "hand." + side] = qx(-10 * guard) @ qz(sg * 20 * guard)
            if pushing:      # keep at least one hand on the stroller
                self.arm_overrides(Q, clip, t, 0.0, only=("stroller",))
        return Q, T, D

    def arm_overrides(self, Q, clip, t, a, only=None):
        p, C, B = self.p, self.C, self.B
        k = B["k"]
        for pr in C.get("props", []):
            name, _, side = pr.partition(".")
            if only and name not in only:
                continue
            sg = 1 if side == "L" else -1
            if name == "phone":
                Q[p + "upperarm." + side] = qx(-28 + 2 * math.sin(a)) @ qy(sg * 14)
                Q[p + "forearm." + side] = qx(-82)
                Q[p + "hand." + side] = qx(-18) @ qz(-sg * 30)
            elif name == "cup":
                Q[p + "upperarm." + side] = qx(Q_angle_x(Q[p + "upperarm." + side]) * 0.4 - 4) @ qy(-sg * 6)
                Q[p + "forearm." + side] = qx(-72)
                Q[p + "hand." + side] = qx(22) @ qz(sg * 10)
            elif name == "bag":
                Q[p + "upperarm." + side] = qx(Q_angle_x(Q[p + "upperarm." + side]) * 0.5) @ qy(-sg * 14)
                Q[p + "forearm." + side] = qx(-6)
                Q[p + "hand." + side] = qx(0)
            elif name == "tote":
                Q[p + "upperarm." + side] = qx(-12 + 3 * math.sin(a)) @ qy(-sg * 12)
                Q[p + "forearm." + side] = qx(-70)
                Q[p + "hand." + side] = qx(-20) @ qz(sg * 40)
            elif name == "hold":
                tgt = self.C.get("_hold_target")
                ang = self.reach(side, tgt)
                wob = 3 * math.sin(a * (2 if p == "k_" else 1))
                Q[p + "upperarm." + side] = qx(ang[0] + wob) @ qy(ang[1])
                Q[p + "forearm." + side] = qx(ang[2])
                Q[p + "hand." + side] = qz(sg * 10)
            elif name == "stroller":
                for s2, g2 in (("L", 1), ("R", -1)):
                    ang = self.reach(s2, (g2 * 0.19 * k + self.ox, -0.44 * k, 0.95 * k))
                    Q[p + "shoulder." + s2] = Quaternion()
                    Q[p + "upperarm." + s2] = qx(ang[0]) @ qy(ang[1])
                    Q[p + "forearm." + s2] = qx(ang[2])
                    Q[p + "hand." + s2] = qx(20) @ qz(g2 * 70)
        if C.get("style", {}).get("hands_pockets"):
            for side, sg in (("L", 1), ("R", -1)):
                Q[p + "upperarm." + side] = qx(4 + 3 * math.sin(a + sg)) @ qy(-sg * 12)
                Q[p + "forearm." + side] = qx(-48)
                Q[p + "hand." + side] = qz(sg * 15)

    def stride(self, clip):
        B = self.B
        base = 1.30 if clip == "walk" else 1.02
        if B["kid"]:
            base = 0.98 if clip == "walk" else 0.80
            return base * B["H"] / 1.2
        if self.C.get("old"):
            base *= 0.88
        return base * B["H"] / 1.75


# ============================================================================================ dogs
DOGS = [
    dict(name="dog_lab", breed="labrador", W=0.55, Lb=0.58, r=0.165, leg_r=0.036, hs=0.098, sl=0.10, snout_w=0.66,
         ears="flop", ear_len=0.10, tail="long", cell="dog_golden", head="dog_golden_head", tint_fur=True, stride=0.80),
    dict(name="dog_terrier", breed="terrier", W=0.28, Lb=0.30, r=0.095, leg_r=0.03, hs=0.066, sl=0.045, snout_w=0.7,
         ears="up", ear_len=0.05, tail="up", cell="dog_white", head="dog_white_head", stride=0.40),
    dict(name="dog_dachshund", breed="dachshund", W=0.24, Lb=0.46, r=0.075, leg_r=0.024, hs=0.058, sl=0.085, snout_w=0.6,
         ears="flop", ear_len=0.08, tail="long_thin", cell="dog_doxie", head="dog_doxie_head", stride=0.34),
    dict(name="dog_pug", breed="pug", W=0.31, Lb=0.30, r=0.115, leg_r=0.034, hs=0.082, sl=0.022, snout_w=0.9,
         ears="fold", ear_len=0.04, tail="curl", cell="dog_fawn", head="dog_fawn_head", coat=True, stride=0.42),
]


def dog_geometry(D):
    r, W, Lb = D["r"], D["W"], D["Lb"]
    zc = W - r * 0.95
    yR, yC = Lb / 2, -Lb / 2
    hs = D["hs"]
    Hb = Vector((0, yC - 0.35 * r - hs * 0.3, W + hs * 0.35))
    S = Hb + Vector((0, -hs * 0.45, hs * 0.25))
    nose = Vector((0, S.y - hs * 0.85 - D["sl"], S.z - 0.3 * hs))
    g = dict(zc=zc, yR=yR, yC=yC, Hb=Hb, S=S, nose=nose)
    legs = {}
    for side, sg in (("L", 1), ("R", -1)):
        x = sg * r * 0.55
        sh = Vector((x, yC + 0.25 * r, zc - 0.15 * r))
        el = Vector((x, yC + 0.38 * r, zc * 0.48))
        pf = Vector((x * 1.02, yC + 0.20 * r, D["leg_r"] * 1.1))
        hp = Vector((x * 1.05, yR - 0.15 * r, zc - 0.05 * r))
        st = Vector((x * 1.08, yR - 0.45 * r, zc * 0.52))
        ph = Vector((x * 1.05, yR + 0.0 * r, D["leg_r"] * 1.1))
        legs[side] = dict(sh=sh, el=el, pf=pf, hp=hp, st=st, ph=ph)
    g["legs"] = legs
    g["tail0"] = Vector((0, yR + 0.25 * r, zc + 0.55 * r))
    tl = {"long": Vector((0, 0.30, -0.10)), "long_thin": Vector((0, 0.24, -0.04)), "up": Vector((0, 0.05, 0.13)),
          "curl": Vector((0, -0.02, 0.07))}[D["tail"]]
    g["tail1"] = g["tail0"] + tl * (1.0 if D["tail"] != "curl" else 1.0)
    return g


def dog_skeleton(D):
    g = dog_geometry(D)
    S = {}
    S["body"] = ((0, g["yR"], g["zc"]), (0, 0, g["zc"]), None, True)
    S["chest"] = ((0, 0, g["zc"]), (0, g["yC"], g["zc"]), "body", True)
    S["neck"] = ((0, g["yC"], g["zc"] + 0.3 * D["r"]), tuple(g["Hb"]), "chest", True)
    S["head"] = (tuple(g["Hb"]), tuple(g["nose"]), "neck", True)
    S["tail"] = (tuple(g["tail0"]), tuple(g["tail1"]), "body", True)
    hs = D["hs"]
    for side, sg in (("L", 1), ("R", -1)):
        L = g["legs"][side]
        S["fu." + side] = (tuple(L["sh"]), tuple(L["el"]), "chest", True)
        S["fl." + side] = (tuple(L["el"]), tuple(L["pf"]), "fu." + side, True)
        S["fpaw_ik." + side] = (tuple(L["pf"]), tuple(L["pf"] + Vector((0, -0.05, 0))), None, False)
        S["hu." + side] = (tuple(L["hp"]), tuple(L["st"]), "body", True)
        S["hl." + side] = (tuple(L["st"]), tuple(L["ph"]), "hu." + side, True)
        S["hpaw_ik." + side] = (tuple(L["ph"]), tuple(L["ph"] + Vector((0, -0.05, 0))), None, False)
        ea = g["S"] + Vector((sg * hs * 0.62, hs * 0.15, hs * 0.55))
        S["ear." + side] = (tuple(ea), tuple(ea + Vector((sg * 0.02, 0, -0.04 if D["ears"] != "up" else 0.04))), "head", True)
    iks = [("fl." + s, "fpaw_ik." + s) for s in ("L", "R")] + [("hl." + s, "hpaw_ik." + s) for s in ("L", "R")]
    return S, iks


def build_dog(mb, D, H):
    """H: helper namespace from people_blender (loft, cell, chain_weights, rigid, half, masks...)."""
    g = dog_geometry(D)
    r, hs = D["r"], D["hs"]
    body_c = H.half(D["cell"], True)
    limb_c = H.half(D["cell"], False)
    fur = H.HAIRM if D.get("tint_fur") else H.Z4
    zc, yR, yC = g["zc"], g["yR"], g["yC"]

    def bw(i, c, p):
        t = max(0.0, min(1.0, (p.y - yC * 0.4) / (yR * 0.8 - yC * 0.4)))
        return {"body": t, "chest": 1 - t}
    prof = [(yR + 0.28 * r, 0.50, 0.50, 0.12), (yR, 0.84, 0.88, 0.05), ((yR + 0) / 2, 0.84, 0.80, 0.12),
            (0.0, 0.9, 0.92, 0.0), (yC, 0.95, 1.0, -0.06), (yC - 0.3 * r, 0.72, 0.78, 0.12)]
    rings = [dict(c=(0, y, zc + dz * r), rx=rx * r, ry=ry * r, ax=(0, -1, 0), ref=(0, 0, -1)) for y, rx, ry, dz in prof]
    H.loft(mb, rings, 10, body_c, bw, mask=fur, v0=0.0, v1=1.0, cap0=True, cap1=True)
    if D.get("coat"):
        cr = [dict(c=(0, y, zc + dz * r), rx=rx * r + 0.014, ry=ry * r + 0.014, ax=(0, -1, 0), ref=(0, 0, -1))
              for y, rx, ry, dz in prof[1:5]]
        H.loft(mb, cr, 8, H.cell("dog_coat"), bw, mask=H.MASKS["A"], v0=0.0, v1=1.0, theta_range=(1.1, TAU - 1.1))
        H.loft(mb, cr, 8, H.cell("dog_coat"), bw, mask=H.MASKS["A"], v0=0.0, v1=1.0, theta_range=(1.1, TAU - 1.1), flip=True)
    # neck
    n0 = Vector((0, yC + 0.05 * r, zc + 0.35 * r))
    nr = [dict(c=n0, rx=0.55 * r, ry=0.6 * r), dict(c=n0.lerp(g["Hb"], 0.5), rx=0.5 * r, ry=0.52 * r),
          dict(c=g["Hb"] + Vector((0, 0.02, -0.01)), rx=0.45 * r, ry=0.47 * r)]
    for R in nr:
        R["ax"] = g["Hb"] - n0
        R["ref"] = (0, 1, 0)
    H.loft(mb, nr, 8, limb_c, H.chain_weights([(n0, "chest"), (n0.lerp(g["Hb"], 0.3), "neck"), (g["Hb"], "head"), (g["nose"], None)], 0.03),
           mask=fur, v0=1.0, v1=0.6)
    # collar (accessory tint)
    cc = n0.lerp(g["Hb"], 0.45)
    H.loft(mb, [dict(c=cc + Vector((0, 0.0, -0.012)), rx=0.56 * r, ry=0.58 * r, ax=g["Hb"] - n0, ref=(0, 1, 0)),
                dict(c=cc + Vector((0, 0.0, 0.012)), rx=0.56 * r, ry=0.58 * r, ax=g["Hb"] - n0, ref=(0, 1, 0))],
           8, H.cell("nylon"), lambda i, c, p: {"neck": 0.7, "chest": 0.3}, mask=H.MASKS["B"], v0=0.2, v1=0.3)
    mb.anchors["collar"] = len(mb.v) - 1
    # head: skull -> stop -> snout -> nose (u=0 under the jaw, .5 on top)
    S = g["S"]
    sw = D["snout_w"]
    hp = [(hs * 0.85, 0.55, 0.55, 0.0, 0.0), (hs * 0.3, 0.95, 0.9, 0.0, 0.22), (-hs * 0.35, 0.92, 0.85, -0.02, 0.48),
          (-hs * 0.8, 0.62 * sw / 0.62, 0.62, -0.22, 0.62), (-hs * 0.8 - D["sl"] * 0.6, 0.5 * sw / 0.62, 0.46, -0.28, 0.82),
          (-hs * 0.8 - D["sl"], 0.36 * sw / 0.62, 0.34, -0.3, 0.96)]
    if D["sl"] < 0.03:   # flat face (pug)
        hp[3] = (-hs * 0.72, 0.85, 0.8, -0.1, 0.62)
        hp[4] = (-hs * 0.8 - D["sl"] * 0.6, 0.7, 0.62, -0.2, 0.82)
        hp[5] = (-hs * 0.8 - D["sl"], 0.45, 0.4, -0.25, 0.96)
    hr = [dict(c=(0, S.y + dy, S.z + dz * hs), rx=rx * hs, ry=ry * hs, ax=(0, -1, 0), ref=(0, 0, -1), v=v) for dy, rx, ry, dz, v in hp]
    H.loft(mb, hr, 10, H.cell(D["head"]), H.rigid("head"), mask=fur, cap0=True, cap1=True, cap_uv=(0.5, 1.0))
    # ears
    for side, sg in (("L", 1), ("R", -1)):
        ea = S + Vector((sg * hs * 0.62, hs * 0.15, hs * 0.55))
        el = D["ear_len"]
        if D["ears"] == "up":
            er = [dict(c=ea, rx=0.022, ry=0.012), dict(c=ea + Vector((sg * 0.01, 0.005, el * 0.6)), rx=0.014, ry=0.008),
                  dict(c=ea + Vector((sg * 0.014, 0.008, el)), rx=0.003, ry=0.003)]
            for R in er:
                R["ax"] = (sg * 0.2, 0.1, 1)
                R["ref"] = (0, 1, 0)
        elif D["ears"] == "fold":
            er = [dict(c=ea, rx=0.018, ry=0.006), dict(c=ea + Vector((sg * 0.03, -0.01, -0.01)), rx=0.016, ry=0.005),
                  dict(c=ea + Vector((sg * 0.04, -0.02, -0.03)), rx=0.008, ry=0.004)]
            for R in er:
                R["ax"] = (sg, -0.3, -0.5)
                R["ref"] = (0, 0, 1)
        else:
            er = [dict(c=ea, rx=0.026, ry=0.007), dict(c=ea + Vector((sg * 0.022, -0.005, -el * 0.5)), rx=0.032, ry=0.008),
                  dict(c=ea + Vector((sg * 0.026, -0.008, -el)), rx=0.02, ry=0.007)]
            for R in er:
                R["ax"] = (sg * 0.25, 0, -1)
                R["ref"] = (sg, 0, 0)
        H.loft(mb, er, 6, limb_c, lambda i, c, p, s=side: {"head": 1.0} if i == 0 else {"ear." + s: 1.0}, mask=fur, v0=0.6, v1=0.9,
               cap1=True)
    # tail
    t0, t1 = g["tail0"], g["tail1"]
    tr = [0.032, 0.026, 0.016, 0.008] if D["tail"] == "long" else ([0.016, 0.013, 0.009, 0.005] if D["tail"] == "long_thin" else [0.024, 0.02, 0.014, 0.008])
    pts = [t0.lerp(t1, f) for f in (0.0, 0.35, 0.7, 1.0)]
    if D["tail"] == "curl":
        pts = [t0, t0 + Vector((0, 0.03, 0.045)), t0 + Vector((0.01, -0.01, 0.07)), t0 + Vector((0.015, -0.035, 0.05))]
    ring = [dict(c=p, rx=rr * (D["r"] / 0.15) ** 0.3, ry=rr * (D["r"] / 0.15) ** 0.3) for p, rr in zip(pts, tr)]
    H.loft(mb, ring, 6, limb_c, lambda i, c, p: {"body": 1.0} if i == 0 else {"tail": 1.0}, mask=fur, v0=0.9, v1=0.6, cap1=True)
    # legs
    lr = D["leg_r"]
    for side, sg in (("L", 1), ("R", -1)):
        L = g["legs"][side]
        for top, mid, paw, ub, lb, par in ((L["sh"], L["el"], L["pf"], "fu." + side, "fl." + side, "chest"),
                                           (L["hp"], L["st"], L["ph"], "hu." + side, "hl." + side, "body")):
            rr = [dict(c=top + Vector((0, 0, 0.25 * r)), rx=lr * 1.9, ry=lr * 2.2), dict(c=top.lerp(mid, 0.5), rx=lr * 1.35, ry=lr * 1.5),
                  dict(c=mid, rx=lr * 1.05, ry=lr * 1.1), dict(c=mid.lerp(paw, 0.6), rx=lr * 0.9, ry=lr * 0.92),
                  dict(c=paw + Vector((0, -lr * 0.2, lr * 0.4)), rx=lr * 1.05, ry=lr * 1.15)]
            for R in rr:
                R["ax"] = (0, 0, -1)
                R["ref"] = (0, 1, 0)
            ch = H.chain_weights([(top, ub), (mid, lb), (paw, None)], blend=lr * 1.5)
            H.loft(mb, rr, 6, limb_c, lambda i, c, p, ch=ch, ub=ub, par=par: {par: 0.5, ub: 0.5} if i == 0 else ch(i, c, p),
                   mask=fur, v0=0.55, v1=0.0, cap1=(0, -lr * 0.6, -lr * 1.2))
    return g


class DogAnim:
    def __init__(self, D, poser):
        self.D, self.P = D, poser
        self.p = ""
        self.root = "body"
        self.ox = 0.0

    def legs(self):
        out = []
        for s in ("L", "R"):
            for u, l, ik in (("fu.", "fl.", "fpaw_ik."), ("hu.", "hl.", "hpaw_ik.")):
                L = (self.P.tail[u + s] - self.P.head[u + s]).length + (self.P.tail[l + s] - self.P.head[l + s]).length
                out.append((u + s, ik + s, L))
        return out

    def stride(self, clip):
        return self.D["stride"] if clip == "walk" else 0.0

    def paw(self, name, dy, lift):
        R = self.P.rest[name]
        return Matrix.Translation(R.translation + Vector((0, dy, lift))) @ R.to_quaternion().to_matrix().to_4x4()

    def pose(self, clip, t):
        D = self.D
        r = D["r"]
        Q, T, Dd = {}, {}, {}
        if clip == "walk":
            a = TAU * t
            L = D["stride"]
            lift = D["W"] * 0.16
            for name, off in (("hpaw_ik.L", 0.0), ("fpaw_ik.R", 0.04), ("hpaw_ik.R", 0.5), ("fpaw_ik.L", 0.54)):
                dy, z, _ = foot_track((t + off) % 1.0, L, stance=0.52, lift=lift, back=0.0, roll=False)
                Dd[name] = self.paw(name, dy, z)
            T["body"] = Vector((0, 0, -0.012 * (r / 0.15) * math.cos(2 * a) - 0.004))
            Q["body"] = qy(2.5 * math.sin(a)) @ qz(2.5 * math.cos(a))
            Q["chest"] = qy(-2.0 * math.sin(a)) @ qz(-3.0 * math.cos(a))
            Q["neck"] = qx(-2 + 3 * math.cos(2 * a + 0.6))
            Q["head"] = qx(-2 * math.cos(2 * a + 0.6)) @ qz(2 * math.sin(a))
            wag = 26 if D["tail"] != "curl" else 8
            Q["tail"] = qz(wag * math.sin(a * 2)) @ qx(-6 if D["tail"] == "up" else 0)
            for s, sg in (("L", 1), ("R", -1)):
                Q["ear." + s] = qy(-sg * 10 * math.sin(2 * a + 1.0)) if D["ears"] != "up" else qx(3 * math.sin(2 * a))
        else:  # idle: sniffing the pavement
            a = TAU * t
            for name in ("fpaw_ik.L", "fpaw_ik.R", "hpaw_ik.L", "hpaw_ik.R"):
                Dd[name] = self.paw(name, 0.0, 0.0)
            sniff = math.sin(TAU * t * 7) * smooth01(math.sin(a) * 0.5 + 0.5)
            down = 0.75 + 0.25 * math.sin(a)
            T["body"] = Vector((0.006 * math.sin(a), 0.0, -0.01 * down))
            Q["body"] = qy(1.5 * math.sin(a))
            Q["chest"] = qx(6 * down)
            Q["neck"] = qx(34 * down) @ qz(14 * math.sin(a * 2))
            Q["head"] = qx(16 * down + 4 * sniff) @ qz(10 * math.sin(a * 2 + 0.5))
            Q["tail"] = qz(16 * math.sin(a * 4)) @ qx(-8 if D["tail"] == "up" else 0)
            for s, sg in (("L", 1), ("R", -1)):
                Q["ear." + s] = qy(-sg * 6 * math.sin(a * 2))
        return Q, T, Dd


DOG_CLIPS = [("walk", 24, 0.55, True), ("idle", 16, 3.0, True)]
