"""Far From the Tree - the bridge district's facades, as an editable Tesseract composition.

Imported by chinatown_design.py (which adds DISTRICT_DOCS to its DOCS). One 1024x1024 atlas whose cells
repeat (the game's shader wraps each wall's UVs inside its cell):

  tenement_red  512x512  4 bays x 4 floors of a red-brick walk-up (10.4 x 12.4 m): sash windows with stone
                         lintels and sills, the odd lit window, curtains, an air conditioner, a fire escape
                         down the middle two bays (balconies, railings, the drop ladders)
  tenement_tan  512x512  the same in buff brick with green trim, no fire escape
  project       512x512  NYCHA brick: 4 bays x 4 floors (12 x 10.8 m) of small paired windows
  modern        512x256  concrete bands and ribbon windows, 2 floors (12 x 6 m)
  store_a/b     512x128  ground floors (16 x 4 m): three shops each, Chinese signboards, lit windows,
                         half-down roll gates
"""
import math
from chinatown_design import Doc, T, mul, mix, HAN, LATIN, GOLD

DR = {
    "tenement_red": (0, 0, 512, 512),
    "tenement_tan": (512, 0, 512, 512),
    "project": (0, 512, 512, 512),
    "modern": (512, 512, 512, 256),
    "store_a": (512, 768, 512, 128),
    "store_b": (512, 896, 512, 128),
}
# metres covered by one repeat of each cell (the runtime's UV scale)
DR_METRES = {"tenement_red": [10.4, 12.4], "tenement_tan": [10.4, 12.4], "project": [12.0, 10.8], "modern": [12.0, 6.0], "store_a": [16.0, 4.0], "store_b": [16.0, 4.0]}


def brick(d, w, h, base, course=8, var=0.08, seed=0):
    r = d.rng
    L = [d.rect(0, 0, w, h, base), d.noise(w, h, op=35, scale=5, kind="turbulentSmooth", seed=seed)]
    for y in range(0, h, course):
        L.append(d.rect(0, y, w, 1.4, mul(base, 0.62), op=55))
    for _ in range(140):   # odd darker / lighter bricks
        x, y = r.random() * w, (r.randrange(h // course)) * course + 1.5
        L.append(d.rect(x, y, 14, course - 2, mul(base, 1 + (r.random() - 0.5) * 2 * var * 3), op=55))
    return L


def window(d, x, y, ww, wh, frame, lit, r, curtain=None, ac=False):
    L = [d.rect(x - 3, y - 3, ww + 6, wh + 6, frame)]
    if lit:
        L.append(d.rect(x, y, ww, wh, (0.95, 0.74, 0.40), grad=d.lin(0, 0, 0, wh, [(0, (1.0, 0.86, 0.55)), (1, (0.85, 0.55, 0.25))])))
    else:
        L.append(d.rect(x, y, ww, wh, (0.10, 0.12, 0.15), grad=d.lin(0, 0, ww, wh, [(0, (0.36, 0.42, 0.50)), (0.45, (0.12, 0.14, 0.18)), (1, (0.07, 0.08, 0.10))])))
    if curtain:
        L.append(d.rect(x, y, ww * 0.35, wh, curtain, op=85))
        L.append(d.rect(x + ww * 0.65, y, ww * 0.35, wh, curtain, op=85))
    L.append(d.rect(x, y + wh / 2 - 2, ww, 4, frame))             # the meeting rail
    L.append(d.rect(x + ww / 2 - 1.5, y, 3, wh, frame, op=80))    # sash bars
    if ac:
        L.append(d.rect(x + 4, y + wh / 2 + 4, ww - 8, wh * 0.28, (0.78, 0.78, 0.74)))
        for k in range(5):
            L.append(d.rect(x + 7, y + wh / 2 + 7 + k * 4, ww - 14, 1.5, (0.5, 0.5, 0.48)))
    return L


def tenement(d, w, h, red=True):
    r = d.rng
    base = (0.46, 0.20, 0.13) if red else (0.70, 0.58, 0.40)
    frame = (0.86, 0.84, 0.78) if red else (0.16, 0.30, 0.22)
    L = brick(d, w, h, base, seed=3 if red else 4)
    bw, fh = w / 4, h / 4
    for fl in range(4):
        for b in range(4):
            x0, y0 = b * bw, fl * fh
            ww, wh = bw * 0.40, fh * 0.56
            x, y = x0 + (bw - ww) / 2, y0 + fh * 0.2
            L.append(d.rect(x - 8, y - 14, ww + 16, 11, (0.78, 0.74, 0.66)))          # lintel
            L.append(d.rect(x - 6, y + wh + 3, ww + 12, 7, (0.72, 0.68, 0.60)))       # sill
            lit = r.random() < 0.18
            cur = r.choice([None, None, (0.85, 0.80, 0.70), (0.70, 0.30, 0.25), (0.40, 0.55, 0.70)])
            L += window(d, x, y, ww, wh, frame, lit, r, cur, ac=(not lit and r.random() < 0.18))
    # grime and rain streaks under the sills
    for _ in range(20):
        x = r.random() * w
        L.append(d.line([(x, r.random() * h), (x + 2, r.random() * h)], (0.1, 0.08, 0.07), 6 + r.random() * 8, op=14, effects=[d.blur(5)]))
    if red:
        # the fire escape over the middle two bays: a balcony at each floor, railings, ladders between
        iron = (0.07, 0.07, 0.08)
        x0, x1 = bw * 0.55, bw * 3.45
        for fl in range(4):
            y = fl * fh + fh * 0.80
            L.append(d.rect(x0, y, x1 - x0, 6, iron))                                   # the platform
            L.append(d.rect(x0, y - 34, x1 - x0, 3, iron))                              # top rail
            L.append(d.rect(x0, y - 17, x1 - x0, 2, iron, op=80))
            for x in range(int(x0), int(x1) + 1, 10):
                L.append(d.rect(x, y - 34, 2, 34, iron, op=85))                         # balusters
        # the stairs between the platforms, zig-zagging (drawn for the floor above the cell too, so it tiles)
        for fl in range(-1, 4):
            y = fl * fh + fh * 0.80
            a, b = (x0 + 26, x1 - 36) if fl % 2 == 0 else (x1 - 36, x0 + 26)
            L.append(d.line([(a, y + 4), (b, y + fh)], iron, 5, op=90))
            for k in range(1, 9):
                f = k / 9
                xx, yy = a + (b - a) * f, y + 4 + (fh - 4) * f
                L.append(d.rect(xx - 7, yy - 1, 14, 2.5, iron, op=85))
        L.append(d.noise(w, h, op=8, scale=8, seed=9))
    return L


def project(d, w, h):
    r = d.rng
    base = (0.40, 0.18, 0.12)
    L = brick(d, w, h, base, course=7, seed=6)
    bw, fh = w / 4, h / 4
    for fl in range(4):
        for b in range(4):
            x0, y0 = b * bw, fl * fh
            for k in (0, 1):
                ww, wh = bw * 0.26, fh * 0.48
                x = x0 + bw * 0.18 + k * bw * 0.36
                y = y0 + fh * 0.26
                L.append(d.rect(x - 2, y + wh, ww + 4, 5, (0.62, 0.60, 0.55)))
                L += window(d, x, y, ww, wh, (0.70, 0.70, 0.66), r.random() < 0.16, r, None, ac=r.random() < 0.12)
    # the floor slab lines (NYCHA towers show a lighter band at each floor in places)
    for fl in range(4):
        L.append(d.rect(0, fl * fh + fh - 4, w, 4, (0.34, 0.16, 0.11), op=60))
    return L


def modern(d, w, h):
    r = d.rng
    base = (0.66, 0.65, 0.62)
    L = [d.rect(0, 0, w, h, base), d.noise(w, h, op=25, scale=12, seed=8)]
    fh = h / 2
    for fl in range(2):
        y = fl * fh + fh * 0.28
        L.append(d.rect(0, y, w, fh * 0.48, (0.12, 0.15, 0.18), grad=d.lin(0, 0, w, fh * 0.48, [(0, (0.38, 0.45, 0.52)), (0.5, (0.12, 0.15, 0.19)), (1, (0.20, 0.24, 0.28))])))
        for x in range(0, w, 32):
            L.append(d.rect(x, y, 4, fh * 0.48, (0.30, 0.30, 0.30)))
            if r.random() < 0.15:
                L.append(d.rect(x + 4, y, 28, fh * 0.48, (0.95, 0.78, 0.48), op=70))
        L.append(d.rect(0, fl * fh + fh - 6, w, 6, mul(base, 0.8)))
    return L


SHOPS_A = [("中國超市", "MARKET", (0.70, 0.08, 0.06), (1.0, 0.86, 0.3)), ("海鮮", "SEAFOOD", (0.05, 0.30, 0.55), (1, 1, 1)), ("麵包西餅", "BAKERY", (0.95, 0.80, 0.20), (0.6, 0.05, 0.05))]
SHOPS_B = [("藥材行", "HERBS", (0.10, 0.36, 0.20), (1.0, 0.86, 0.3)), ("茶葉", "TEA", (0.45, 0.10, 0.08), (1.0, 0.82, 0.4)), ("金鋪", "JEWELRY", (0.06, 0.06, 0.06), (1.0, 0.80, 0.25))]


def storefront(d, w, h, shops):
    r = d.rng
    L = [d.rect(0, 0, w, h, (0.28, 0.24, 0.22))]
    sw = w / 3
    for k, (cn, en, bg, fg) in enumerate(shops):
        x0 = k * sw
        # the signboard
        L.append(d.rect(x0 + 3, 4, sw - 6, 34, bg))
        L.append(d.rect(x0 + 3, 4, sw - 6, 3, mul(bg, 0.6)))
        L.append(T(d, x0 + sw * 0.40, 32, cn, 24, fg, font=HAN))
        L.append(T(d, x0 + sw * 0.82, 30, en[:9], 9, fg, font=LATIN))
        # the window (lit, goods stacked inside) and the door; a roll gate half down over one side
        wx, wy, ww, wh = x0 + 8, 44, sw * 0.62, h - 50
        L.append(d.rect(wx, wy, ww, wh, (0.95, 0.80, 0.52), grad=d.lin(0, 0, 0, wh, [(0, (1.0, 0.92, 0.70)), (1, (0.75, 0.50, 0.28))])))
        for _ in range(22):
            gx, gy = wx + r.random() * (ww - 8), wy + wh * 0.45 + r.random() * wh * 0.5
            L.append(d.rect(gx, gy, 5 + r.random() * 6, 4 + r.random() * 5, r.choice([(0.9, 0.3, 0.1), (0.95, 0.8, 0.2), (0.8, 0.1, 0.1), (0.3, 0.6, 0.3), (0.9, 0.9, 0.85)])))
        L.append(d.rect(wx, wy, ww, 3, (0.15, 0.15, 0.15)))
        if r.random() < 0.6:
            gh = wh * (0.3 + r.random() * 0.4)
            L.append(d.rect(wx, wy, ww, gh, (0.55, 0.56, 0.56)))
            for y in range(int(wy), int(wy + gh), 3):
                L.append(d.rect(wx, y, ww, 1, (0.40, 0.41, 0.42)))
        L.append(d.rect(x0 + sw * 0.70, 46, sw * 0.24, h - 46, (0.20, 0.14, 0.10)))     # door
        L.append(d.rect(x0 + sw * 0.72, 50, sw * 0.20, h - 60, (0.85, 0.65, 0.40), op=70))
    L.append(d.noise(w, h, op=10, scale=10, seed=11))
    return L


def district_doc():
    d = Doc(41)
    painters = {
        "tenement_red": lambda d, w, h: tenement(d, w, h, True),
        "tenement_tan": lambda d, w, h: tenement(d, w, h, False),
        "project": project, "modern": modern,
        "store_a": lambda d, w, h: storefront(d, w, h, SHOPS_A),
        "store_b": lambda d, w, h: storefront(d, w, h, SHOPS_B),
    }
    layers = [d.rect(0, 0, 1024, 1024, (0.3, 0.3, 0.3))]
    for name, fn in painters.items():
        x, y, w, h = DR[name]
        layers.append(d.group(name, x, y, w, h, fn(d, w, h)))
    return 1024, 1024, (0.3, 0.3, 0.3, 1), layers, d


DISTRICT_DOCS = {"DistrictAtlas": district_doc}


def court_doc():
    """a NYC park basketball court, 31 x 19 m (the fenced pad) on 512 x 314: red-brown surround, the green
    court, white lines, the keys painted red, a few cracks and patched seams"""
    d = Doc(51)
    W, H = 512, 314
    k = W / 31.0                       # pixels a metre
    cx, cy = W / 2, H / 2
    white = (0.93, 0.93, 0.89)
    L = [d.rect(0, 0, W, H, (0.44, 0.21, 0.16)), d.noise(W, H, op=18, scale=14, seed=3)]
    L.append(d.rect(cx - 13 * k, cy - 7 * k, 26 * k, 14 * k, (0.16, 0.36, 0.27)))
    L.append(d.noise(W, H, op=10, scale=30, seed=5))
    lw = 2.2
    for sx in (-1, 1):
        bx = cx + sx * 13 * k
        # the key, painted, and its outline; the free throw circle; the three-point line
        x0 = bx - sx * 5.8 * k
        L.append(d.rect(min(bx, x0), cy - 2.45 * k, 5.8 * k, 4.9 * k, (0.62, 0.22, 0.16)))
        L.append(d.line([(bx, cy - 2.45 * k), (x0, cy - 2.45 * k), (x0, cy + 2.45 * k), (bx, cy + 2.45 * k)], white, lw))
        L.append(d.ellipse(x0, cy, 3.6 * k, 3.6 * k, (0, 0, 0), op=0))
        pts = [(x0 + sx * 0.0 + math.cos(a) * 1.8 * k * -sx, cy + math.sin(a) * 1.8 * k) for a in [i / 16 * math.pi - math.pi / 2 for i in range(17)]]
        L.append(d.line(pts, white, lw))
        hx = bx - sx * 1.6 * k
        arc = [(hx - sx * math.cos(a) * 6.7 * k, cy + math.sin(a) * 6.7 * k) for a in [-1.35 + i / 24 * 2.7 for i in range(25)]]
        L.append(d.line([(bx, arc[0][1])] + arc + [(bx, arc[-1][1])], white, lw))
    L.append(d.line([(cx - 13 * k, cy - 7 * k), (cx + 13 * k, cy - 7 * k), (cx + 13 * k, cy + 7 * k), (cx - 13 * k, cy + 7 * k), (cx - 13 * k, cy - 7 * k)], white, lw))
    L.append(d.line([(cx, cy - 7 * k), (cx, cy + 7 * k)], white, lw))
    L.append(d.line([(cx + math.cos(a) * 1.8 * k, cy + math.sin(a) * 1.8 * k) for a in [i / 24 * math.tau for i in range(25)]], white, lw))
    r = d.rng
    for _ in range(9):   # cracks
        x, y = r.random() * W, r.random() * H
        pts = [(x, y)]
        for _ in range(5):
            pts.append((pts[-1][0] + (r.random() - 0.5) * 50, pts[-1][1] + (r.random() - 0.5) * 30))
        L.append(d.line(pts, (0.08, 0.08, 0.08), 1.0, op=60))
    return W, H, (0.4, 0.2, 0.15, 1), L, d


DISTRICT_DOCS["Court"] = court_doc
