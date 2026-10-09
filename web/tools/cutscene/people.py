"""Battery Park passers-by for the intro: pixel sprites with 2-frame walk/run loops.

Called from build.py: people.make(B) -> (lawn_layers, promenade_layers, bench_layers)
Every character is a Group (feet at its origin) holding one sub-group per pose frame;
a per-character JS 'brain' st(t) -> [x, y, facing, frame] drives position, facing and
which frame is visible. Summer/lapse characters run on 'world time' W(t), which races
during the time-lapse so they zip past in fast-forward.
"""
import json, math, random

# ----------------------------------------------------------------------------- world time
def lapse_f(B, t):
    return 1 + 7 * B.ss(5.5, 8.0, t) * (1 - B.ss(13.0, 16.0, t))


def world_table(B):
    vals, w = [0.0], 0.0
    n = int((B.DUR + 0.3) / 0.01)
    for i in range(n):
        w += lapse_f(B, i * 0.01 + 0.005) * 0.01
        vals.append(w)
    return vals


# ----------------------------------------------------------------------------- sprites
WALK_A = ["..HHH..", "..HSS..", "..HSS..", "...S...", "..TTT..", ".TTTTT.", ".TTTTT.", "S.TTT.S",
          "..BBB..", "..L.L..", ".L...L.", ".L...L.", "L.....L", "FF...FF"]
WALK_B = ["..HHH..", "..HSS..", "..HSS..", "...S...", "..TTT..", "..TTT..", "..TTT..", "..TST..",
          "..BBB..", "..LL...", "..LL...", "..LL...", "..LL...", "..FFF.."]
HUG = ["..HHH..", "..HSS..", "..HSS..", "...S...", "..TTTTT", "..TTTTS", "..TTT..", "..TTT..",
       "..BBB..", "..LL...", "..LL...", "..LL...", "..LL...", "..FFF.."]
WATCH = ["..HHH..", "..HHS..", "..HSS..", "...S...", "..TTT..", "..TTTGS", "..TTT..", "..TTT..",
         "..BBB..", "..LL...", "..LL...", "..LL...", "..LL...", "..FFF.."]
RUN_A = ["...HH..", "..HSS..", "..HSS..", "...S...", "..TTT.S", ".TTTTT.", "S.TTT..", "..TTT..",
         "..BBB..", ".BB.BB.", ".L...L.", "L.....L", "L......", "F......"]
RUN_B = ["...HH..", "..HSS..", "..HSS..", "...S...", "..TTTS.", "..TTT..", ".STTT..", "..TTT..",
         "..BBB..", "..BLL..", "..L.L..", "..L..L.", "..F....", "......."]
KID_RUN = [".HH..", ".HSS.", "STTT.", ".TTTS", ".TTT.", ".BBB.", "L...L", "F...F"]
KID_PASS = [".HH..", ".HSS.", ".TTT.", ".TTT.", ".TST.", ".BBB.", "..LL.", "..FF."]
KID_JUMP = ["S...S", "SHH.S", "THSST", ".TTT.", ".TTT.", ".BBB.", "LL.LL", "F...F"]
KID_KICK = [".HH..", ".HSS.", "STTT.", ".TTT.", ".TTT.", ".BBB.", ".L.LL", ".F..F"]
SIT_A = ["..HHH..", "..HSS..", "..HSS..", "..TNNN.", "..TNnN.", "..TTT..", "..BBBB.", ".....L.",
         ".....L.", ".....L.", ".....L.", ".....FF"]
SIT_B = ["..HHH..", "..HSS..", "..HSS..", "..TTT..", "..TNNN.", "..TNnN.", "..BBBB.", ".....L.",
         ".....L.", ".....L.", ".....L.", ".....FF"]
DOG_A = ["....EE", "D.DDDD", ".DDDD.", ".D..D."]
DOG_B = ["....EE", "D.DDDD", ".DDDD.", "..DD.."]
HEART = ["R.R", "RRR", ".R."]
BALL = ["WW", "WK"]


def put(rows, x, y, ch):
    rows = list(rows)
    while y >= len(rows):
        rows.append("." * len(rows[0]))
    r = list(rows[y].ljust(x + 1, "."))
    r[x] = ch
    rows[y] = "".join(r)
    return rows


def widen(rows, w):
    return [r.ljust(w, ".") for r in rows]


def long_hair(rows):
    rows = put(rows, 1, 1, "H")
    rows = put(rows, 1, 2, "H")
    return put(rows, 2, 3, "H")


def suit(rows, case_x=4, case_y=8):
    rows = put(rows, 4, 4, "W")
    rows = put(rows, 4, 5, "R") if rows[5][4] == "T" else rows
    for dx in range(3):
        for dy in range(2):
            rows = put(rows, case_x + dx, case_y + dy, "K")
    return rows


def coat(rows):
    """Long winter coat + scarf."""
    rows = list(rows)
    rows[8] = rows[8].replace("B", "T")
    rows[9] = "".join("T" if c in "LB" else c for c in rows[9])
    rows = put(rows, 2, 3, "R")
    rows = put(rows, 3, 3, "R")
    rows = put(rows, 4, 3, "R")
    rows = put(rows, 4, 4, "R")
    return rows


def dog_walker(walk, dog, hand):
    rows = widen(walk, 19)
    for r, line in enumerate(dog):
        for c, ch in enumerate(line):
            if ch != ".":
                rows = put(rows, 12 + c, 10 + r, ch)
    # leash from the hand to the dog's collar
    (x0, y0), (x1, y1) = hand, (16, 11)
    n = max(abs(x1 - x0), abs(y1 - y0))
    for i in range(1, n):
        x = round(x0 + (x1 - x0) * i / n)
        y = round(y0 + (y1 - y0) * i / n + 0.8 * math.sin(math.pi * i / n))
        if rows[y][x] == ".":
            rows = put(rows, x, y, "Q")
    return rows


# ----------------------------------------------------------------------------- palette
SKIN = [(0.96, 0.80, 0.66), (0.82, 0.60, 0.44), (0.56, 0.37, 0.25), (0.99, 0.87, 0.76)]
HAIR = [(0.17, 0.11, 0.09), (0.42, 0.25, 0.12), (0.93, 0.78, 0.40), (0.08, 0.08, 0.10), (0.72, 0.72, 0.74)]
TOPS = [(0.20, 0.62, 0.62), (0.95, 0.45, 0.42), (0.98, 0.82, 0.22), (0.35, 0.55, 0.95), (0.92, 0.92, 0.88),
        (0.55, 0.30, 0.65), (0.30, 0.72, 0.38), (0.95, 0.60, 0.20)]
BOTS = [(0.18, 0.22, 0.38), (0.30, 0.38, 0.60), (0.20, 0.20, 0.22), (0.66, 0.60, 0.44), (0.40, 0.30, 0.22)]
SHOES = [(0.14, 0.12, 0.13), (0.92, 0.92, 0.90), (0.45, 0.28, 0.15)]


def pal(H, S, T, B, L=None, F=SHOES[0], **extra):
    p = {"H": H, "S": S, "T": T, "B": B, "L": L or B, "F": F,
         "W": (0.97, 0.97, 0.95), "R": (0.86, 0.16, 0.16), "K": (0.42, 0.26, 0.12), "G": (1.0, 0.82, 0.3),
         "N": (0.92, 0.90, 0.82), "n": (0.45, 0.45, 0.48), "D": (0.82, 0.60, 0.30), "E": (0.50, 0.32, 0.16),
         "Q": (0.80, 0.18, 0.18)}
    p.update(extra)
    return p


# ----------------------------------------------------------------------------- builder
class People:
    def __init__(self, B):
        self.B = B
        self.W = world_table(B)
        tab = [round(self.W[min(int(round(i * 10)), len(self.W) - 1)], 4) for i in range(int((B.DUR + 0.2) * 10) + 1)]
        self.WJS = ("var WT=%s;function W(t){return tab(WT,t);}"
                    "function wf(w,r){return Math.floor(w*r)%%2;}") % json.dumps(tab)

    def w_at(self, t):
        return self.W[min(int(t / 0.01), len(self.W) - 1)]

    def t_of_w(self, w):
        for i, v in enumerate(self.W):
            if v >= w:
                return i * 0.01
        return self.B.DUR

    def sprite_frame(self, rows, palette, dur, ox=None):
        B = self.B
        h = len(rows)
        w = len(rows[0])
        ox = w / 2.0 if ox is None else ox
        by_col = {}
        for r, line in enumerate(rows):
            c = 0
            while c < len(line):
                ch = line[c]
                if ch == ".":
                    c += 1
                    continue
                c2 = c
                while c2 + 1 < len(line) and line[c2 + 1] == ch:
                    c2 += 1
                by_col.setdefault(ch, []).append((c - ox, r - h, c2 - c + 1, 1))
                c = c2 + 1
        layers = [B.rects("px %s" % ch, boxes, tuple(palette[ch]) + (1,), dur=dur) for ch, boxes in by_col.items()]
        return layers

    def character(self, name, frames, palette, brain, t0, t1, ox=None, shadow=True, desc=None, palettes=None):
        """frames: list of row-lists; palettes: optional per-frame palette override."""
        B = self.B
        t1 = min(t1, B.DUR)
        dur = t1 - t0
        if dur <= 0.05:
            return None
        pre = B.JS_HELPERS + self.WJS + brain + "var t=input.time.seconds+%f;var s=st(t);" % t0
        kids = []
        for k, rows in enumerate(frames):
            fid = B.nid()
            kids.append(B.group("frame %d" % k, self.sprite_frame(rows, (palettes or [palette] * len(frames))[k], dur, ox),
                                dur=dur, gid=fid))
            B.anim(fid, "opacity", "return s[3]==%d?100:0;" % k, pre)
        if shadow:
            kids.append(B.rect("shadow", -2.5, -0.4, 5, 0.8, (0.0, 0.0, 0.0, 1), dur=dur, op=22))
        gid = B.nid()
        g = B.group(name, kids, start=t0, dur=dur, gid=gid, desc=desc)
        B.anim(gid, "positionX", "return s[0]*%d;" % B.S, pre)
        B.anim(gid, "positionY", "return s[1]*%d;" % B.S, pre)
        B.anim(gid, "scaleX", "return s[2]*100;", pre)
        B.anim(gid, "opacity", "return s[3]<0?0:100;", pre)
        g["_y"] = brain_y = 0
        return g


def make(B):
    P = People(B)
    rnd = random.Random(2024)
    lawn, prom, bench = [], [], []

    def add(lst, g, lane):
        if g:
            g["_lane"] = lane
            g.pop("_y", None)
            lst.append(g)

    W_END = P.w_at(16.5)

    # ---------------- the couple: meet, hug, walk off hand in hand (summer, into the lapse)
    p1 = pal(HAIR[1], SKIN[1], (0.20, 0.62, 0.62), (0.18, 0.22, 0.38))
    p2 = pal(HAIR[2], SKIN[0], (0.95, 0.45, 0.42), (0.95, 0.45, 0.42), L=SKIN[0])
    end_w = 4.6 + 150 / 9.0
    b1 = ("function st(t){var w=W(t);if(w<2.9)return[168+9*w,138.5,1,wf(w,8)];"
          "if(w<4.6)return[194.5,138.5,1,2];return[194.5+9*(w-4.6),138.5,1,wf(w,8)];}")
    b2 = ("function st(t){var w=W(t);if(w<2.9)return[228-9.5*w,138.5,-1,wf(w+0.06,8)];"
          "if(w<4.6)return[200,138.5,-1,2];return[200+9*(w-4.6),138.5,1,wf(w+0.06,8)];}")
    add(prom, P.character("Couple: partner A", [WALK_A, WALK_B, HUG], p1, b1, 0, P.t_of_w(end_w)), 138.5)
    lh = [long_hair(f) for f in (WALK_A, WALK_B, HUG)]
    add(prom, P.character("Couple: partner B", lh, p2, b2, 0, P.t_of_w(end_w)), 138.4)
    add(prom, P.character("Couple: heart", [HEART], pal(0, 0, 0, 0, R=(0.95, 0.25, 0.35)),
                          "function st(t){var w=W(t);if(w<3.15||w>4.55)return[0,0,1,-1];return[197.3+1.5,124.5-(w-3.15)*2.2,1,0];}",
                          0, 5.5, ox=0, shadow=False), 120)

    # ---------------- summer runner (shorts), zips off in the lapse
    run_s = pal(HAIR[3], SKIN[2], (0.90, 0.25, 0.22), (0.12, 0.12, 0.15), L=SKIN[2], F=SHOES[1])
    add(prom, P.character("Runner (summer, shorts)", [RUN_A, RUN_B], run_s,
                          "function st(t){var w=W(t);var f=wf(w,10);return[-8+30*w,141-f,1,f];}",
                          0, P.t_of_w(345 / 30.0)), 141)

    # ---------------- dog walker
    dw = pal(HAIR[4], SKIN[0], (0.62, 0.52, 0.78), (0.66, 0.60, 0.44), F=SHOES[2])
    frames = [dog_walker(WALK_A, DOG_A, (6, 7)), dog_walker(WALK_B, DOG_B, (3, 7))]
    add(prom, P.character("Dog walker + dog", frames, dw, "function st(t){var w=W(t);return[14+7*w,139.5,1,wf(w,5.5)];}",
                          0, P.t_of_w((340 - 14) / 7.0), ox=3.5), 139.5)

    # ---------------- kids chasing each other round the lawn (summer + lapse)
    for name, ph, col in (("Kid A (chased)", 0.0, pal(HAIR[2], SKIN[3], (0.30, 0.75, 0.35), (0.25, 0.40, 0.80), L=SKIN[3], F=(0.85, 0.2, 0.2))),
                          ("Kid B (chasing)", -0.9, pal(HAIR[0], SKIN[2], (0.98, 0.60, 0.20), (0.30, 0.38, 0.60), L=SKIN[2], F=SHOES[1]))):
        brain = ("function st(t){var w=W(t);var a=1.15*w+%f;var x=232+40*Math.cos(a);var y=165+6*Math.sin(a);"
                 "var d=Math.sin(a)>0?-1:1;var f=wf(w,9);return[x,y-f*0.6,d,f];}") % ph
        add(lawn, P.character(name, [KID_RUN, KID_PASS], col, brain, 0, 12.3), 165 + (0.1 if ph else 0))

    # ---------------- kid kicking a ball back and forth (summer + lapse)
    kc = pal(HAIR[1], SKIN[1], (0.35, 0.55, 0.95), (0.95, 0.95, 0.92), L=SKIN[1])
    kick = ("function per(w){var n=Math.floor(w/5);var u=w-5*n;var ev=(n%2==0);return{u:u,xk:ev?140:184,d:ev?1:-1};}")
    kb = kick + ("function st(t){var w=W(t);var p=per(w);var s0=p.xk-2.5*p.d;if(p.u<0.35)return[s0,171,p.d,2];"
                 "var x=s0+p.d*49.5*(1-Math.exp(-1.0*(p.u-0.35)));if(p.u>3.4)return[x,171,p.d,1];return[x,171,p.d,wf(w,9)];}")
    add(lawn, P.character("Kid C (ball)", [KID_RUN, KID_PASS, KID_KICK], kc, kb, 0, 11.6), 171)
    ballb = kick + ("function st(t){var w=W(t);var p=per(w);var x=p.xk+p.d*44*(1-Math.exp(-1.5*p.u));"
                    "var y=171-Math.abs(Math.sin(p.u*5))*3.5*Math.exp(-1.3*p.u);return[x+p.d*1.5,y,1,0];}")
    add(lawn, P.character("Ball", [BALL], pal(0, 0, 0, 0, W=(0.97, 0.97, 0.95), K=(0.2, 0.2, 0.25)), ballb, 0, 11.6, ox=1, shadow=False), 171.5)

    # ---------------- bench sitters: one reads in summer, others pop on and off in the lapse
    sit_pal = [pal(HAIR[4], SKIN[0], (0.92, 0.92, 0.88), (0.40, 0.30, 0.22)),
               pal(HAIR[3], SKIN[2], (0.55, 0.30, 0.65), (0.20, 0.20, 0.22)),
               pal(HAIR[2], SKIN[3], (0.98, 0.82, 0.22), (0.30, 0.38, 0.60)),
               pal(HAIR[0], SKIN[1], (0.30, 0.72, 0.38), (0.18, 0.22, 0.38)),
               pal(HAIR[1], SKIN[0], (0.95, 0.60, 0.20), (0.66, 0.60, 0.44))]
    windows = [(0.0, 17.0), (21.0, 29.0), (34.0, 44.0), (49.0, 55.0), (60.0, 70.0)]
    for i, (w0, w1) in enumerate(windows):
        if w1 > W_END:
            break
        brain = "function st(t){var w=W(t);return[125+%f,131,%d,Math.floor(w/2.3+%d)%%2];}" % (rnd.uniform(-4, 4), 1 if i % 2 == 0 else -1, i)
        add(bench, P.character("Bench sitter %d" % (i + 1), [SIT_A, SIT_B], sit_pal[i], brain,
                               P.t_of_w(w0), P.t_of_w(w1), shadow=False), 131)

    # ---------------- fast-forward passers-by during the time-lapse
    w_a, w_b = P.w_at(5.9), P.w_at(14.8)
    for i in range(18):
        d = rnd.choice([1, -1])
        lane = rnd.choice([136.5, 137.5, 139, 140.5, 141.5])
        kind = rnd.choice(["walk", "walk", "walk", "suit", "run"])
        sp = {"walk": rnd.uniform(10, 13), "suit": rnd.uniform(11, 13), "run": rnd.uniform(24, 30)}[kind]
        last = w_b - 345 / sp          # everyone is off screen before the lapse ends
        w0 = w_a + (last - w_a) * (i + rnd.random() * 0.7) / 18
        p = pal(rnd.choice(HAIR), rnd.choice(SKIN), rnd.choice(TOPS), rnd.choice(BOTS), F=rnd.choice(SHOES))
        x0 = -10 if d > 0 else 330
        if kind == "run":
            fr, rate = [RUN_A, RUN_B], 10
            p["L"] = p["S"]
        elif kind == "suit":
            p.update(T=(0.16, 0.18, 0.28), B=(0.16, 0.18, 0.28), L=(0.16, 0.18, 0.28), H=HAIR[3])
            fr, rate = [suit(WALK_A, 4, 8), suit(WALK_B, 2, 8)], 9
        else:
            fr, rate = [WALK_A, WALK_B], 7
            if rnd.random() < 0.4:
                fr = [long_hair(f) for f in fr]
        brain = "function st(t){var w=W(t)-%f;return[%f+%f*w,%f,%d,wf(w,%f)];}" % (w0, x0, d * sp, lane, d, rate)
        add(prom, P.character("Passer-by %d (%s, fast-forward)" % (i + 1, kind), fr, p, brain,
                              P.t_of_w(w0), P.t_of_w(w0 + 345 / sp)), lane)

    # ---------------- autumn: businessman checks his watch and hurries on
    bm = pal(HAIR[3], SKIN[0], (0.16, 0.18, 0.28), (0.16, 0.18, 0.28))
    bfr = [suit(WALK_A, 4, 8), suit(WALK_B, 2, 8), suit(WATCH, 0, 8)]
    brain = ("function st(t){if(t<21.9)return[-10+28*(t-16.2),137,1,wf(t,9)];if(t<22.8)return[149.6,137,1,2];"
             "return[149.6+28*(t-22.8),137,1,wf(t,9)];}")
    add(prom, P.character("Businessman (briefcase, checks watch)", bfr, bm, brain, 16.2, 29.4), 137)

    # ---------------- autumn runner in a hoodie (hood up), right to left
    rh = pal((0.55, 0.57, 0.60), SKIN[2], (0.55, 0.57, 0.60), (0.20, 0.20, 0.24), F=SHOES[1])
    add(prom, P.character("Runner (autumn, hoodie)", [RUN_A, RUN_B], rh,
                          "function st(t){var f=wf(t,10);return[330-30*(t-16.8),140.5-f,-1,f];}", 16.8, 28.3), 140.5)

    # ---------------- autumn: kid runs and jumps into the leaf pile
    lk = pal(HAIR[1], SKIN[0], (0.98, 0.82, 0.18), (0.25, 0.35, 0.60), F=(0.85, 0.18, 0.15))
    brain = ("function st(t){if(t<21.4)return[-6+34*(t-16.9),168,1,wf(t,9)];"
             "if(t<21.9){var u=(t-21.4)/0.5;return[147+18*u,168-9*Math.sin(Math.PI*u),1,2];}"
             "if(t<22.6)return[166,168,1,-1];"
             "if(t<23.0){var v=(t-22.6)/0.4;return[166,168-6*Math.sin(Math.PI*v),1,2];}"
             "return[166+34*(t-23.0),168,1,wf(t,9)];}")
    add(lawn, P.character("Kid in raincoat (leaf pile jump)", [KID_RUN, KID_PASS, KID_JUMP], lk, brain, 16.9, 28.0), 168)
    # the pile itself
    r2 = random.Random(5)
    mound = [[(-9, 0), (-7, -2.5), (-3, -4.2), (2, -4.5), (6, -3), (9, 0)]]
    pid = B.nid()
    pile_kids = []
    for tone, polys in (("light", [[(x + r2.uniform(-6, 5), y - r2.uniform(0.5, 3.5)) for (x, y) in [(0, 0), (1, 0), (1, 1), (0, 1)]] for _ in range(14)]),
                        ("mid", [[(x * 0.8, y * 0.85 - 0.4) for (x, y) in mound[0]]]), ("dark", mound)):
        pile_kids.append(B.shape("Leaf pile %s" % tone, polys, B.ramp_py(tone, 0.85 if tone != "light" else 0.5), start=0, dur=B.DUR - 15.6))
    pile = B.group("Leaf pile", pile_kids, start=15.6, dur=B.DUR - 15.6, gid=pid,
                   transform=B.tr((168 * B.S, 169.5 * B.S)))
    B.anim(pid, "scaleX", "var t=input.time.seconds+15.6;return 100*ss(15.6,16.6,t)*(1-ss(22.6,23.6,t))+12*Math.sin(Math.min(1,Math.max(0,(t-21.9)/0.5))*3.14159);", B.JS_HELPERS)
    B.anim(pid, "scaleY", "var t=input.time.seconds+15.6;var sq=t>21.9&&t<22.7?(1-0.35*Math.sin((t-21.9)/0.8*3.14159)):1;return 100*ss(15.6,16.6,t)*(1-ss(22.6,23.6,t))*sq;", B.JS_HELPERS)
    pile["_lane"] = 168.5
    lawn.append(pile)
    # leaves bursting out of the pile
    for i in range(18):
        c = B.ramp_py(r2.choice(["mid", "light", "dark"]), r2.uniform(0.55, 0.95))
        lid = B.nid()
        vx, vy = r2.uniform(-14, 16), r2.uniform(-26, -12)
        lawn.append({"type": "Rect", "id": lid, "name": "Pile leaf", "blendMode": "normal", "_lane": 172,
                     "activeRange": B.rng_ms(21.9, 4.5), "transform": B.tr((168 * B.S, 166 * B.S), (B.S, B.S * 0.75)),
                     "rect": {"size": [2 * B.S, 1.5 * B.S], "fillColor": list(c)}})
        g = "var u=input.time.seconds;var g=Math.max(0,u-0.5);"
        B.anim(lid, "positionX", g + "return (168+%f*u+0.5*45*g*g+2*Math.sin(u*6+%d))*%d;" % (vx, i, B.S))
        B.anim(lid, "positionY", g + "return (166+%f*u+0.5*30*u*u-0.5*28*Math.min(u,1.2)*Math.min(u,1.2)*0.8)*%d;" % (vy, B.S))
        B.anim(lid, "rotation", "return input.time.seconds*%f;" % r2.uniform(-600, 600))

    # ---------------- winter: one bundled-up figure steps out from behind the trunk
    wf_pal = pal((0.20, 0.50, 0.55), SKIN[1], (0.35, 0.20, 0.30), (0.18, 0.16, 0.20))
    add(prom, P.character("Bundled-up walker (winter)", [coat(WALK_A), coat(WALK_B)], wf_pal,
                          "function st(t){return[92+7*(t-26.3),137.5,1,wf(t,5)];}", 26.3, 31.6), 137.5)

    order = lambda lst: [g for g in sorted(lst, key=lambda g: -g.get("_lane", 0))]
    out = []
    for lst in (lawn, prom, bench):
        lst = order(lst)
        for g in lst:
            g.pop("_lane", None)
        out.append(lst)
    return tuple(out)
