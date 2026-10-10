"""Far From the Tree - the bridge district's ground: a painted street plan for the land east of the Bowery.

    python web/tools/chinatown/district_ground.py      (after `npx tsx tools/chinatown/district.ts`)

The open data only has the corridor's streets, so the plan is read off the buildings: everything within
3.2 m of a building is sidewalk (concrete flags, a curb at the edge), the gaps between blocks are asphalt
streets, the big open spaces between the housing towers are paved plazas and parking lots, and along the
East River run the esplanade and the FDR Drive (lanes, a median barrier). The corridor's own ground
(ground.ts) and the water stay transparent. Also places the street furniture: lamps on the curbs, parked
cars, cars in the lots, the esplanade railing and lamps, the FDR's median barrier.

Reads tools/chinatown/district_src.json; writes public/textures/chinatown/district_ground.webp (2048) and
district_ground_1k.webp, and adds `props` to public/models/ct_district.json. Standard library + Pillow.
"""
import json, math, os, random
from PIL import Image, ImageDraw, ImageFilter, ImageChops

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.abspath(os.path.join(HERE, "..", ".."))
SRC = json.load(open(os.path.join(HERE, "district_src.json")))
OUTJ = os.path.join(WEB, "public", "models", "ct_district.json")
TEX = os.path.join(WEB, "public", "textures", "chinatown")
PREV = os.path.join(HERE, "previews")
N = 2048
B = SRC["box"]
SIZE = B["x1"] - B["x0"]
MPP = SIZE / N                        # metres per pixel (~0.53)
rng = random.Random(77)


def px(x, z):
    """world -> pixel. u runs with x (x0 at the left), v with z (z0 at the top): the runtime maps uv the same way"""
    return ((x - B["x0"]) / MPP, (z - B["z0"]) / MPP)


def world(i, j):
    return (B["x0"] + (i + 0.5) * MPP, B["z0"] + (j + 0.5) * MPP)


def mask(rings, base=None):
    m = base or Image.new("L", (N, N), 0)
    d = ImageDraw.Draw(m)
    for r in rings:
        pts = [px(r[k], r[k + 1]) for k in range(0, len(r) - 1, 2)]
        if len(pts) >= 3:
            d.polygon(pts, fill=255)
    return m


def grow(m, metres):
    n = max(1, round(metres / MPP))
    for _ in range(n):
        m = m.filter(ImageFilter.MaxFilter(3))
    return m


def shrink(m, metres):
    n = max(1, round(metres / MPP))
    for _ in range(n):
        m = m.filter(ImageFilter.MinFilter(3))
    return m


AND = ImageChops.multiply
def NOT(m):
    return ImageChops.invert(m)
def OR(a, b):
    return ImageChops.lighter(a, b)


print("masks...", flush=True)
land = mask(SRC["land"])
zone = AND(mask([SRC["zone"]]), land)
covered = mask(SRC["covered"])
bld = mask(SRC["buildings"])
paint = AND(zone, NOT(covered))
# sidewalks hug the buildings; streets are the gaps; big gaps are plazas and parking lots
side = AND(grow(bld, 3.2), NOT(bld))
far_from = NOT(grow(OR(bld, covered), 14.0))
open_ = AND(grow(far_from, 11.0), NOT(grow(bld, 3.2)))

# ---- the streets through the big open spaces (the housing campuses): the open data has no street plan out
# here, so lay a grid on the blocks' own bearing (the dominant footprint edge angle), spaced like the Lower
# East Side's (~75 m between the long streets, ~120 m between the cross streets), phased to run along the
# gaps the real streets leave between the buildings; paint it only through open ground.
# two street grids meet here: Manhattan's (the blocks north of the bridge) and the older one turned to the
# river (Two Bridges): find both bearings, and which one each 128 px tile follows
def bearings(rings):
    h = [0.0] * 90
    for r in rings:
        for k in range(0, len(r) - 2, 2):
            dx, dz = r[k + 2] - r[k], r[k + 3] - r[k + 1]
            l = math.hypot(dx, dz)
            if l > 4:
                h[int(math.degrees(math.atan2(dz, dx)) % 90)] += l
    return h
def peak(h, avoid=None):
    def sm(a):
        return sum(h[(a + d) % 90] for d in (-2, -1, 0, 1, 2))
    cands = [a for a in range(90) if avoid is None or min(abs(a - avoid), 90 - abs(a - avoid)) > 20]
    return max(cands, key=sm)
H = bearings(SRC["buildings"])
th1 = peak(H)
th2 = peak(H, th1)
TILE = 128
tiles_g = {}
cent = []
for r in SRC["buildings"]:
    cx = sum(r[0::2]) / (len(r) // 2); cz = sum(r[1::2]) / (len(r) // 2)
    cent.append((cx, cz, r))
for tj in range(N // TILE):
    for ti in range(N // TILE):
        x, z = world(ti * TILE + TILE // 2, tj * TILE + TILE // 2)
        near = [r for (cx, cz, r) in cent if abs(cx - x) < 160 and abs(cz - z) < 160]
        h = bearings(near)
        s1 = sum(h[(th1 + d) % 90] for d in range(-4, 5)); s2 = sum(h[(th2 + d) % 90] for d in range(-4, 5))
        tiles_g[(ti, tj)] = 0 if s1 >= s2 else 1
gap = AND(AND(paint, NOT(grow(bld, 3.0))), NOT(open_)).resize((N // 8, N // 8))
bl8 = bld.resize((N // 8, N // 8))
GP, BP = gap.load(), bl8.load()
def score(th, which, axis, sp, ph):
    ca, sa = math.cos(math.radians(th)), math.sin(math.radians(th))
    sc = 0
    for j in range(N // 8):
        for i in range(N // 8):
            if tiles_g[(i * 8 // TILE, j * 8 // TILE)] != which:
                continue
            x, z = world(i * 8, j * 8)
            u = (x * ca + z * sa) if axis == 0 else (-x * sa + z * ca)
            if abs(((u - ph) % sp) - sp / 2) > sp / 2 - 4:
                sc += (1 if GP[i, j] > 128 else 0) - (2 if BP[i, j] > 128 else 0)
    return sc
road_l, walk_l, centre_l = Image.new("L", (N, N), 0), Image.new("L", (N, N), 0), Image.new("L", (N, N), 0)
for which, th in enumerate((th1, th2)):
    ca, sa = math.cos(math.radians(th)), math.sin(math.radians(th))
    tmask = Image.new("L", (N, N), 0)
    td = ImageDraw.Draw(tmask)
    for (ti, tj), w in tiles_g.items():
        if w == which:
            td.rectangle([ti * TILE, tj * TILE, ti * TILE + TILE - 1, tj * TILE + TILE - 1], fill=255)
    rl, wl, cl = Image.new("L", (N, N), 0), Image.new("L", (N, N), 0), Image.new("L", (N, N), 0)
    for axis in (0, 1):
        best = None
        for sp in (68, 74, 80, 110, 120, 130):
            for ph in range(0, sp, 4):
                v = score(th, which, axis, sp, ph)
                if best is None or v > best[0]:
                    best = (v, sp, ph)
        _, sp, ph = best
        print("grid %d (bearing %d): axis %d every %d m, phase %d" % (which, th, axis, sp, ph), flush=True)
        for kk in range(-40, 41):
            u = ph + kk * sp
            if axis == 0:
                p0 = (u * ca - 3000 * sa, u * sa + 3000 * ca); p1 = (u * ca + 3000 * sa, u * sa - 3000 * ca)
            else:
                p0 = (-u * sa - 3000 * ca, u * ca - 3000 * sa); p1 = (-u * sa + 3000 * ca, u * ca + 3000 * sa)
            a0, a1 = px(*p0), px(*p1)
            ImageDraw.Draw(wl).line([a0, a1], fill=255, width=int(16.0 / MPP))
            ImageDraw.Draw(rl).line([a0, a1], fill=255, width=int(10.0 / MPP))
            ImageDraw.Draw(cl).line([a0, a1], fill=255, width=max(1, int(0.35 / MPP)))
    road_l = OR(road_l, AND(rl, tmask)); walk_l = OR(walk_l, AND(wl, tmask)); centre_l = OR(centre_l, AND(cl, tmask))
syn_road = AND(road_l, open_)
syn_walk = AND(AND(walk_l, NOT(road_l)), open_)
syn_centre = AND(centre_l, open_)
side = OR(side, syn_walk)
open_ = AND(open_, NOT(walk_l))
water = NOT(land)
d_esp = grow(water, 9.0)              # the esplanade: the first 9 m of land
d_fdr = grow(water, 31.0)             # the FDR: the next 22 m
esp = AND(AND(d_esp, land), paint)
fdr = AND(AND(d_fdr, NOT(d_esp)), land)
# lane lines of the FDR: thin iso-distance bands from the water
lanes = []
for dm in (13.0, 16.5, 20.0, 23.0, 26.5):
    a, b = grow(water, dm), grow(water, dm + 0.4)
    lanes.append(AND(b, NOT(a)))
median = AND(grow(water, 20.6), NOT(grow(water, 19.6)))

print("painting...", flush=True)
img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
pa = img.load()
L = {k: v.load() for k, v in dict(paint=paint, side=side, open=open_, esp=esp, fdr=fdr, bld=bld, median=median, centre=syn_centre).items()}
LN = [m.load() for m in lanes]
# open spaces: label connected pieces coarsely (16 m cells) as plaza or parking
# the open spaces: label the connected pieces (on a 4-pixel grid) and give each one a use: the ones by the
# bridge plaza and the Bowery, and some big ones, are building sites (like the old parks along the route:
# dirt behind plywood hoardings, a tower crane); the rest parking lots or paved plazas
G4 = 4
gw = N // G4
OP = L["open"]
label = [[-1] * gw for _ in range(gw)]
regions = []
for gj in range(gw):
    for gi in range(gw):
        if label[gj][gi] >= 0 or not OP[gi * G4, gj * G4] or not L["paint"][gi * G4, gj * G4]:
            continue
        rid = len(regions)
        stack, cells = [(gi, gj)], []
        label[gj][gi] = rid
        while stack:
            a, b = stack.pop()
            cells.append((a, b))
            for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                c, d = a + da, b + db
                if 0 <= c < gw and 0 <= d < gw and label[d][c] < 0 and OP[c * G4, d * G4] and L["paint"][c * G4, d * G4]:
                    label[d][c] = rid
                    stack.append((c, d))
        area = len(cells) * (G4 * MPP) ** 2
        cx = sum(c[0] for c in cells) / len(cells); cz = sum(c[1] for c in cells) / len(cells)
        wx, wz = world(cx * G4, cz * G4)
        by_bridge = -1090 < wx < -880 and 1900 < wz < 2120
        roll = rng.random()
        kind = "site" if (by_bridge and area > 1500) or (area > 5000 and roll < 0.14) else ("lot" if roll < 0.42 else "plaza")
        regions.append({"kind": kind, "area": area, "cells": cells, "c": (wx, wz)})
print("open regions", len(regions), {k: sum(1 for r in regions if r["kind"] == k) for k in ("site", "lot", "plaza")})

def kind_at(i, j):
    r = label[min(gw - 1, j // G4)][min(gw - 1, i // G4)]
    return regions[r]["kind"] if r >= 0 else "plaza"

def noise(i, j, s=1.0):
    return (math.sin(i * 0.37 + j * 0.11) * 0.5 + math.sin(i * 0.071 - j * 0.093) * 0.8 + math.sin(i * 1.7 + j * 2.3) * 0.25) * s

for j in range(N):
    for i in range(N):
        if not L["paint"][i, j]:
            continue
        x, z = world(i, j)
        n = noise(i, j)
        if L["esp"][i, j]:
            # hexagonal-ish pavers: grey-brown with a joint grid at 0.6 m
            g = 0.52 + n * 0.03 + (0.06 if (int(x / 0.6) + int(z / 0.6)) % 2 else 0)
            c = (g * 0.98, g * 0.94, g * 0.88)
        elif L["fdr"][i, j]:
            g = 0.20 + n * 0.02
            c = (g, g, g * 1.02)
            if L["median"][i, j]:
                c = (0.62, 0.62, 0.60)
            for k, m in enumerate(LN):
                if m[i, j] and (k in (2,) or (int((x * 0.57 + z * 0.82) / 3.0) % 2 == 0)):
                    c = (0.78, 0.72, 0.42) if k == 2 else (0.80, 0.80, 0.78)
        elif L["side"][i, j] or L["bld"][i, j]:
            # concrete flags 1.5 m, darker joints, the odd stain
            g = 0.56 + n * 0.025
            if (x % 1.5) < MPP or (z % 1.5) < MPP:
                g -= 0.06
            c = (g, g * 0.99, g * 0.96)
        elif L["open"][i, j]:
            if kind_at(i, j) == "lot":
                g = 0.24 + n * 0.02
                c = (g, g, g)
                # parking stalls: white lines every 2.6 m across, rows every 12 m
                if (x % 2.6) < MPP and (z % 12.0) < 5.2:
                    c = (0.74, 0.74, 0.72)
                if abs((z % 12.0) - 5.4) < MPP * 0.6:
                    c = (0.74, 0.74, 0.72)
            elif kind_at(i, j) == "site":
                # churned clay, tyre ruts, puddles, a gravel haul road
                g = 0.36 + n * 0.05 + 0.03 * math.sin(x * 0.9 + math.sin(z * 0.2) * 3)
                c = (g * 1.12, g * 0.92, g * 0.70)
                if abs(math.sin(x * 0.05 + z * 0.031) * 30 - (z % 60) + 30) < 2.5:
                    c = (0.50, 0.48, 0.44)
                if noise(i * 0.7, j * 0.7) > 1.05:
                    c = (0.22, 0.24, 0.26)
            else:
                g = 0.47 + n * 0.03
                c = (g * 1.02, g * 0.97, g * 0.92) if (int(x / 3) + int(z / 3)) % 2 else (g * 0.94, g * 0.92, g * 0.9)
        elif L["centre"][i, j]:
            c = (0.78, 0.66, 0.22)
        else:
            # the streets: asphalt, patched and stained
            g = 0.215 + n * 0.018
            if (int(x / 9.3) * 7 + int(z / 7.1) * 13) % 23 == 0:
                g += 0.03                     # a patch
            c = (g, g, g * 1.03)
        pa[i, j] = (int(c[0] * 255), int(c[1] * 255), int(c[2] * 255), 255)

# curbs: the sidewalk's edge toward the street gets a light top and a dark gutter line
edge = AND(AND(grow(side, 0.6), NOT(side)), AND(paint, NOT(OR(bld, OR(esp, fdr)))))
E = edge.load()
for j in range(N):
    for i in range(N):
        if E[i, j]:
            r, g, b, a = pa[i, j]
            pa[i, j] = (int(r * 0.6), int(g * 0.6), int(b * 0.6), a)

print("props...", flush=True)
# ---- street furniture
props = {"lamps": [], "cars": [], "lot_cars": [], "rail": [], "esp_lamps": [], "barrier": []}
S, O, P_ = L["side"], L["open"], L["paint"]

def street_dir(i, j, r=5):
    """the curb's outward normal at (i, j): away from the sidewalk and buildings around it (unit vector, or None)"""
    sx = sz = 0.0
    for dj in range(-r, r + 1):
        for di in range(-r, r + 1):
            ii, jj = i + di, j + dj
            if 0 <= ii < N and 0 <= jj < N and (S[ii, jj] or L["bld"][ii, jj]):
                sx += di; sz += dj
    l = math.hypot(sx, sz)
    if l < 1e-6:
        return None
    return (-sx / l, -sz / l)

# curb points on a jittered grid
CELL = 26.0
nc = int(SIZE / CELL)
for cj in range(nc):
    for ci in range(nc):
        cx, cz = B["x0"] + (ci + 0.5) * CELL, B["z0"] + (cj + 0.5) * CELL
        i0, j0 = [int(v) for v in px(cx, cz)]
        best = None
        R = int(CELL / MPP / 2)
        for dj in range(-R, R + 1, 2):
            for di in range(-R, R + 1, 2):
                i, j = i0 + di, j0 + dj
                if 0 <= i < N and 0 <= j < N and E[i, j]:
                    d = di * di + dj * dj
                    if best is None or d < best[0]:
                        best = (d, i, j)
        if not best:
            continue
        _, i, j = best
        dv = street_dir(i, j)
        if not dv:
            continue
        x, z = world(i, j)
        nx, nz = dv[0], dv[1]                 # toward the street (pixels map x, z directly)
        props["lamps"].append([round(x - nx * 0.5, 1), round(z - nz * 0.5, 1), round(math.atan2(nx, nz), 2)])
        # a few parked cars along this curb either side of the lamp, nose along the curb
        tx, tz = -nz, nx
        for k in (-2, -1, 1, 2, 3):
            if rng.random() < 0.55:
                continue
            px_, pz_ = x + nx * 1.4 + tx * k * 5.6, z + nz * 1.4 + tz * k * 5.6
            ii, jj = [int(v) for v in px(px_, pz_)]
            if not (0 <= ii < N and 0 <= jj < N) or not P_[ii, jj] or S[ii, jj] or L["bld"][ii, jj] or O[ii, jj] or L["fdr"][ii, jj]:
                continue
            props["cars"].append([round(px_, 1), round(pz_, 1), round(math.atan2(tx, tz) + (math.pi if rng.random() < 0.5 else 0), 2), rng.randrange(6)])
# cars in the parking lots: along the stall rows
for j in range(0, N, int(2.6 / MPP)):
    for i in range(0, N, int(2.6 / MPP)):
        if O[i, j] and P_[i, j] and kind_at(i, j) == "lot":
            x, z = world(i, j)
            zz = z % 12.0
            if 1.0 < zz < 4.4 and rng.random() < 0.5:
                props["lot_cars"].append([round(x - (x % 2.6) + 1.3, 1), round(z - zz + 2.6, 1), 0.0 if rng.random() < 0.5 else 3.14, rng.randrange(6)])
rng.shuffle(props["lot_cars"])
props["lot_cars"] = props["lot_cars"][:700]
# the esplanade railing at the water's edge, lamps along it, the FDR's median barrier: walk the shore
shore = AND(AND(grow(water, 0.6), land), zone)
SH = shore.load()
pts = [(i, j) for j in range(0, N, 3) for i in range(0, N, 3) if SH[i, j]]
pts.sort(key=lambda p: (p[0] * 0.57 + p[1] * 0.82))
prev = None
for k, (i, j) in enumerate(pts):
    x, z = world(i, j)
    if prev and math.hypot(x - prev[0], z - prev[1]) < 6:
        continue
    if prev and math.hypot(x - prev[0], z - prev[1]) < 14:
        props["rail"].append([round(prev[0], 1), round(prev[1], 1), round(x, 1), round(z, 1)])
    if len(props["rail"]) % 4 == 0:
        props["esp_lamps"].append([round(x, 1), round(z, 1)])
    prev = (x, z)
MD = median.load()
mpts = [(i, j) for j in range(0, N, 4) for i in range(0, N, 4) if MD[i, j] and L["fdr"][i, j]]
mpts.sort(key=lambda p: (p[0] * 0.57 + p[1] * 0.82))
prev = None
for (i, j) in mpts:
    x, z = world(i, j)
    if prev and math.hypot(x - prev[0], z - prev[1]) < 5:
        continue
    if prev and math.hypot(x - prev[0], z - prev[1]) < 12:
        props["barrier"].append([round(prev[0], 1), round(prev[1], 1), round(x, 1), round(z, 1)])
    prev = (x, z)
props["hoardings"], props["cranes"], props["cabins"], props["fences"] = [], [], [], []
for r in regions:
    if r["kind"] not in ("site", "lot"):
        continue
    cs = set(r["cells"])
    # boundary cells: an open neighbour that isn't this region; the panel faces out of the region
    lot = r["kind"] == "lot"
    pc = rng.randrange(4)                                    # one paint colour per site
    for (a, b) in r["cells"]:
        if lot and (a + b) % 2:
            continue                                         # chain-link every other cell (it's 2.4 m long)
        if all((a + da, b + db) in cs for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            continue                                         # not on the edge
        # the outward normal from the missing cells round it (a 5x5 window, so corners come out smooth)
        ox = oz = 0
        for db in range(-2, 3):
            for da in range(-2, 3):
                if (a + da, b + db) not in cs:
                    ox += da; oz += db
        if not (ox or oz):
            continue
        l = math.hypot(ox, oz)
        x, z = world(a * G4, b * G4)
        yaw = math.atan2(-oz / l, ox / l) + math.pi / 2     # panel's +x along the edge
        props["hoardings" if r["kind"] == "site" else "fences"].append([round(x, 1), round(z, 1), round(yaw, 2), pc])
    if r["kind"] == "site":
        # the crane at the middle cell nearest the centre (outside the playable corridor), a couple of cabins
        best = min(r["cells"], key=lambda c: (world(c[0] * G4, c[1] * G4)[0] - r["c"][0]) ** 2 + (world(c[0] * G4, c[1] * G4)[1] - r["c"][1]) ** 2)
        x, z = world(best[0] * G4, best[1] * G4)
        if r["area"] > 3000 and x < -950:
            props["cranes"].append([round(x, 1), round(z, 1), round(rng.random() * 6.28, 2), round(48 + rng.random() * 20, 1)])
        for _ in range(2):
            a, b = rng.choice(r["cells"])
            x, z = world(a * G4, b * G4)
            props["cabins"].append([round(x, 1), round(z, 1), round(rng.random() * 6.28, 2)])
for k, v in props.items():
    print(k, len(v))

os.makedirs(TEX, exist_ok=True)
img.save(os.path.join(TEX, "district_ground.webp"), "WEBP", quality=88, method=6)
img.resize((1024, 1024), Image.LANCZOS).save(os.path.join(TEX, "district_ground_1k.webp"), "WEBP", quality=85, method=6)
img.resize((512, 512), Image.LANCZOS).save(os.path.join(TEX, "district_ground_512.webp"), "WEBP", quality=85, method=6)
os.makedirs(PREV, exist_ok=True)
prev_img = Image.new("RGB", (N, N), (40, 70, 90))
prev_img.paste(img, (0, 0), img)
prev_img.resize((1024, 1024)).save(os.path.join(PREV, "district_ground.png"))
j = json.load(open(OUTJ))
j["props"] = props
json.dump(j, open(OUTJ, "w"))
print("done", os.path.getsize(os.path.join(TEX, "district_ground.webp")) // 1024, "KB")
