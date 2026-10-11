"""Far From the Tree - the landmark achievement snapshots.

Each landmark achievement (src/game/achievements.ts, snap: true) gets a little pixel-art "photo" of its
joke, shown on the polaroid card when it unlocks (src/game/snapshotCard.ts) and in the gallery
(src/game/achievementGallery.ts). Same cold late-November palette and flat pixel look as the intro and
ending films (tools/cutscene/build.py's C palette, the hero leaf's reds), drawn procedurally here at
128x96 art pixels, scaled x4 nearest-neighbour and saved as small palettised PNGs.

    python tools/achievements/snapshots.py            -> public/achievements/<id>.png
    python tools/achievements/snapshots.py empire     -> just that one
Needs only Pillow.
"""
import math, os, random, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "public", "achievements"))
W, H, SCALE = 128, 96, 4


def rgb(t):
    return tuple(int(round(v * 255)) for v in t[:3])


# ---------------------------------------------------------------------------- palette
# (from tools/cutscene/build.py C and the films' cold sky; 0-1 floats like there)
P = {
    "skyTop": rgb((0.58, 0.64, 0.72)), "skyBot": rgb((0.86, 0.87, 0.88)),
    "cloud": rgb((0.87, 0.88, 0.90)), "cloudSh": rgb((0.73, 0.75, 0.80)),
    "bldA": rgb((0.47, 0.55, 0.66)), "bldB": rgb((0.38, 0.45, 0.57)), "bldC": rgb((0.56, 0.62, 0.70)),
    "bldEdge": rgb((0.70, 0.76, 0.82)), "win": rgb((0.30, 0.36, 0.46)), "winLit": rgb((1.0, 0.82, 0.45)),
    "stone": rgb((0.80, 0.76, 0.64)), "stone2": rgb((0.62, 0.59, 0.52)), "stoneHi": rgb((0.88, 0.86, 0.78)),
    "pave": rgb((0.74, 0.70, 0.64)), "pave2": rgb((0.64, 0.60, 0.56)),
    "bark": rgb((0.24, 0.17, 0.13)), "bark2": rgb((0.36, 0.26, 0.19)),
    "snow": (240, 243, 247), "snowSh": (206, 214, 226),
    "red": (186, 58, 38), "orange": (214, 110, 58), "vein": (118, 32, 24), "stem": (92, 62, 40),
    "bronze": (108, 76, 44), "bronzeHi": (156, 114, 66), "bronzeSh": (70, 48, 30),
    "gold": (226, 184, 74), "goldHi": (255, 232, 150), "goldSh": (160, 112, 40),
    "copper": rgb((0.50, 0.74, 0.65)), "copper2": rgb((0.33, 0.54, 0.50)),
    "skin": (232, 190, 160), "ink": (34, 30, 40), "white": (250, 250, 250),
    "pigeon": (128, 132, 150), "pigeonSh": (92, 96, 114), "pigeonHi": (170, 176, 192), "neck": (110, 150, 140),
    "stepRed": (200, 40, 36), "stepHi": (246, 92, 70), "stepSh": (128, 20, 26),
}


class Canvas:
    def __init__(self, bg=(0, 0, 0)):
        self.img = Image.new("RGB", (W, H), bg)
        self.d = ImageDraw.Draw(self.img)
        self.px = self.img.load()

    def put(self, x, y, c):
        x, y = int(x), int(y)
        if 0 <= x < W and 0 <= y < H:
            self.px[x, y] = c

    def get(self, x, y):
        return self.px[int(x), int(y)]

    def rect(self, x, y, w, h, c):
        if w <= 0 or h <= 0:
            return
        self.d.rectangle([int(x), int(y), int(x + w - 1), int(y + h - 1)], fill=c)

    def poly(self, pts, c):
        self.d.polygon([(int(round(a)), int(round(b))) for a, b in pts], fill=c)

    def line(self, pts, c, w=1):
        self.d.line([(int(round(a)), int(round(b))) for a, b in pts], fill=c, width=w)

    def ellipse(self, x0, y0, x1, y1, c):
        self.d.ellipse([int(x0), int(y0), int(x1), int(y1)], fill=c)

    def blend(self, x, y, c, a):
        """mix a colour over a pixel (for light glows: used sparingly, then quantised away)"""
        x, y = int(x), int(y)
        if 0 <= x < W and 0 <= y < H:
            o = self.px[x, y]
            self.px[x, y] = tuple(int(o[i] + (c[i] - o[i]) * a) for i in range(3))

    def save(self, name):
        os.makedirs(OUT, exist_ok=True)
        big = self.img.resize((W * SCALE, H * SCALE), Image.NEAREST)
        # few colours: a palettised PNG is tiny. No dithering (the art's own dithers are drawn in)
        pal = big.quantize(colors=48, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        path = os.path.join(OUT, name + ".png")
        pal.save(path, optimize=True)
        return path


# ---------------------------------------------------------------------------- pieces
BAYER = [[0, 2], [3, 1]]


def mix(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def sky(cv, stops, y0=0, y1=H, bands=7):
    """a vertical gradient in flat bands with a 2x2 checker dither at each step (the films' look).
    stops: [(t, colour)] with t from 0 (top) to 1 (bottom)"""
    def at(t):
        for (ta, ca), (tb, cb) in zip(stops, stops[1:]):
            if t <= tb:
                return mix(ca, cb, (t - ta) / max(1e-6, tb - ta))
        return stops[-1][1]
    for y in range(y0, y1):
        t = (y - y0) / max(1, (y1 - y0 - 1))
        f = t * bands
        i = int(f)
        frac = f - i
        ca, cb = at(i / bands), at(min(1, (i + 1) / bands))
        for x in range(W):
            th = (BAYER[y % 2][x % 2] + 0.5) / 4
            # only the last quarter of each band dithers into the next one
            cv.px[x, y] = cb if (frac - 0.75) * 4 > th else ca


def cloud(cv, x, y, w, rnd, c=None, sh=None):
    c = c or P["cloud"]
    sh = sh or P["cloudSh"]
    xs = x
    while xs < x + w:
        bw = rnd.randint(5, 11)
        bh = rnd.randint(2, 4)
        cv.rect(xs, y - bh, bw, bh, c)
        xs += bw - rnd.randint(1, 3)
    cv.rect(x - 2, y, w + 4, 2, c)
    cv.rect(x, y + 2, w, 1, sh)


def snow(cv, n, rnd, y0=0, y1=H, c=None):
    for _ in range(n):
        x, y = rnd.randrange(W), rnd.randrange(y0, y1)
        cv.put(x, y, c or P["snow"])


def windows(cv, x, y, w, h, rnd, lit=0.12, dx=3, dy=3, c=None, litc=None):
    for yy in range(y + 1, y + h - 1, dy):
        for xx in range(x + 1, x + w - 1, dx):
            if rnd.random() < 0.82:
                cv.put(xx, yy, (litc or P["winLit"]) if rnd.random() < lit else (c or P["win"]))


def skyline(cv, base, rnd, cols=("bldA", "bldB", "bldC"), hmin=14, hmax=40, lit=0.08, x0=-4, x1=W + 4):
    x = x0
    while x < x1:
        w = rnd.randint(8, 18)
        h = rnd.randint(hmin, hmax)
        col = P[rnd.choice(cols)]
        cv.rect(x, base - h, w, h, col)
        cv.rect(x, base - h, 1, h, P["bldEdge"])
        windows(cv, x, base - h + 2, w, h - 2, rnd, lit)
        x += w + rnd.randint(0, 2)


# the hero leaf: the films' two-tone maple (darker red half, orange half, a dark midrib), stem down
LEAF_BIG = [
    ".....r.....",
    "....rro....",
    ".r..rro..o.",
    ".rr.rdo.oo.",
    "rrrrrdoooo.",
    ".rrrrdooo..",
    "..rrrdoo...",
    ".rrrrdoooo.",
    "....rdo....",
    ".....d.....",
    ".....s.....",
]
LEAF_SMALL = [
    "...r...",
    ".r.ro.o",
    "rrrdooo",
    ".rrdoo.",
    "rrrdooo",
    "...d...",
    "...s...",
]
LEAF_KEY = {"r": "red", "o": "orange", "d": "vein", "s": "stem"}


def sprite(rows, key, scale=1, rot=0, flip=False, outline=None):
    w, h = len(rows[0]), len(rows)
    im = Image.new("RGBA", (w + 2, h + 2), (0, 0, 0, 0))
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch in key:
                c = key[ch]
                im.putpixel((x + 1, y + 1), (P[c] if isinstance(c, str) else c) + (255,))
    if outline:
        src = im.copy()
        for y in range(h + 2):
            for x in range(w + 2):
                if src.getpixel((x, y))[3]:
                    continue
                if any(0 <= x + a < w + 2 and 0 <= y + b < h + 2 and src.getpixel((x + a, y + b))[3] for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                    im.putpixel((x, y), outline + (255,))
    if flip:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    if rot:
        im = im.rotate(rot, resample=Image.NEAREST, expand=True)
    if scale != 1:
        im = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
    return im


def stamp(cv, im, cx, cy):
    cv.img.paste(im, (int(cx - im.width / 2), int(cy - im.height / 2)), im)
    cv.px = cv.img.load()


def leaf(cv, cx, cy, big=False, scale=1, rot=0, flip=False, outline=None):
    stamp(cv, sprite(LEAF_BIG if big else LEAF_SMALL, LEAF_KEY, scale, rot, flip, outline), cx, cy)


def streaks(cv, x, y, n=3, length=8, c=None, dx=-1):
    for i in range(n):
        yy = y - n + i * 2
        xx = x + dx * (2 + (i % 2) * 2)
        cv.line([(xx, yy), (xx + dx * (length - i * 2), yy)], c or P["snow"])


def person(cv, x, feet, coat, scale=1, hat=None, legs=None, facing=1):
    """a little figure (the films' walkers): 4 wide, 11 tall at scale 1"""
    s = scale
    legs = legs or P["ink"]
    cv.rect(x, feet - 4 * s, 1 * s, 4 * s, legs)
    cv.rect(x + 2 * s, feet - 4 * s, 1 * s, 4 * s, legs)
    cv.rect(x - 0 * s, feet - 9 * s, 3 * s, 5 * s, coat)
    cv.rect(x + (3 * s if facing > 0 else -1 * s), feet - 8 * s, 1 * s, 3 * s, coat)  # an arm
    cv.rect(x, feet - 12 * s, 3 * s, 3 * s, P["skin"])
    if hat:
        cv.rect(x, feet - 13 * s, 3 * s, 1 * s, hat)


FONT = {
    "A": ["010", "101", "111", "101", "101"], "B": ["110", "101", "110", "101", "110"], "C": ["011", "100", "100", "100", "011"],
    "D": ["110", "101", "101", "101", "110"], "E": ["111", "100", "110", "100", "111"], "F": ["111", "100", "110", "100", "100"],
    "I": ["111", "010", "010", "010", "111"], "K": ["101", "101", "110", "101", "101"], "L": ["100", "100", "100", "100", "111"],
    "N": ["101", "111", "111", "101", "101"], "O": ["010", "101", "101", "101", "010"], "P": ["110", "101", "110", "100", "100"],
    "R": ["110", "101", "110", "101", "101"], "S": ["011", "100", "010", "001", "110"], "T": ["111", "010", "010", "010", "010"],
    "U": ["101", "101", "101", "101", "111"], "Y": ["101", "101", "010", "010", "010"], "Z": ["111", "001", "010", "100", "111"],
    "V": ["101", "101", "101", "101", "010"], "W": ["101", "101", "111", "111", "101"], "H": ["101", "101", "111", "101", "101"],
    "1": ["010", "110", "010", "010", "111"], "?": ["110", "001", "010", "000", "010"], "!": ["010", "010", "010", "000", "010"],
    ".": ["000", "000", "000", "000", "010"], " ": ["000", "000", "000", "000", "000"], "z": ["000", "111", "001", "010", "111"],
}


def text(cv, x, y, s, c, scale=1):
    for ch in s:
        g = FONT[ch]
        for yy, row in enumerate(g):
            for xx, v in enumerate(row):
                if v == "1":
                    cv.rect(x + xx * scale, y + yy * scale, scale, scale, c)
        x += 4 * scale


def text_w(s, scale=1):
    return len(s) * 4 * scale - scale


def sparkle(cv, x, y, c=None, r=2):
    c = c or P["white"]
    for i in range(-r, r + 1):
        cv.put(x + i, y, c)
        cv.put(x, y + i, c)


def puff(cv, x, y, r, c=None, sh=None):
    c = c or P["snow"]
    cv.ellipse(x - r, y - r, x + r, y + r, sh or P["snowSh"])
    cv.ellipse(x - r, y - r - 1, x + r - 1, y + r - 2, c)


COLD = [(0, P["skyTop"]), (1, P["skyBot"])]


# ---------------------------------------------------------------------------- the scenes
def empire():
    """Don't Leave Me Waiting: dusk at the top of the Empire State; someone's been waiting with flowers
    for ages (snow on their hat); the last leaf blows past"""
    cv = Canvas()
    rnd = random.Random(7)
    sky(cv, [(0, (46, 52, 92)), (0.45, (98, 92, 138)), (0.75, (178, 140, 156)), (1, (232, 172, 138))], 0, 78, bands=8)
    for _ in range(18):
        x, y = rnd.randrange(W), rnd.randrange(0, 30)
        cv.put(x, y, (220, 220, 240) if rnd.random() < 0.6 else (160, 160, 200))
    # the city far below: dark roofs with lit windows
    x = -2
    while x < W:
        w, h = rnd.randint(5, 12), rnd.randint(2, 10)
        cv.rect(x, 78 + 10 - h, w, h + 10, rnd.choice([(44, 48, 74), (54, 58, 86), (38, 42, 66)]))
        for yy in range(78 + 11 - h, H, 2):
            for xx in range(x + 1, x + w - 1, 2):
                if rnd.random() < 0.3:
                    cv.put(xx, yy, P["winLit"])
        x += w
    cv.rect(0, 77, W, 1, (210, 160, 140))
    # the tower: the top setback, the mast's drum and the needle, a red beacon
    stone, shade, hi = (118, 118, 150), (82, 82, 116), (170, 166, 190)
    cv.rect(30, 46, 30, 24, stone); cv.rect(30, 46, 3, 24, hi); cv.rect(55, 46, 5, 24, shade)
    for xx in range(35, 55, 4):
        cv.rect(xx, 48, 1, 22, shade)
    for yy in range(50, 68, 3):
        for xx in range(37, 54, 4):
            cv.put(xx, yy, P["winLit"] if rnd.random() < 0.6 else P["win"])
    cv.rect(34, 34, 22, 12, stone); cv.rect(34, 34, 2, 12, hi); cv.rect(52, 34, 4, 12, shade)
    for xx in range(38, 52, 3):
        cv.rect(xx, 35, 1, 10, shade)
    cv.rect(38, 24, 14, 10, stone); cv.rect(38, 24, 2, 10, hi); cv.rect(49, 24, 3, 10, shade)
    cv.rect(41, 14, 8, 10, (200, 200, 220)); cv.rect(47, 14, 2, 10, shade)
    cv.rect(43, 6, 4, 8, stone); cv.rect(44, 0, 2, 6, (210, 210, 228))
    cv.rect(44, 3, 2, 2, (255, 70, 60)); cv.blend(43, 3, (255, 90, 80), 0.5); cv.blend(46, 3, (255, 90, 80), 0.5)
    # the observation deck: a floor and its high railing
    cv.rect(0, 70, W, 8, (96, 96, 128)); cv.rect(0, 70, W, 1, (150, 148, 176))
    cv.rect(0, 76, W, 2, (70, 70, 100))
    for xx in range(0, W, 4):
        cv.rect(xx, 52, 1, 18, (60, 62, 90))
    cv.rect(0, 52, W, 1, (60, 62, 90)); cv.rect(0, 60, W, 1, (60, 62, 90))
    cv.rect(0, 69, W, 1, (190, 192, 210))  # a line of snow along the deck
    # the one waiting: coat, scarf, a hat with snow on it, and a bunch of flowers
    x0, feet = 82, 70
    person(cv, x0, feet, (64, 74, 110), scale=2, hat=(40, 40, 60))
    cv.rect(x0, feet - 18, 6, 2, (196, 64, 70))           # scarf
    cv.rect(x0 - 1, feet - 28, 8, 2, (40, 40, 60))        # the hat's crown
    cv.rect(x0, feet - 29, 6, 1, P["snow"])               # with snow on it: they've been here a while
    # the flowers held out (stems, then blooms)
    for i, (a, b) in enumerate([(-3, -1), (-2, 0), (-4, 1)]):
        cv.line([(x0 - 1, feet - 13), (x0 + a, feet - 19 + b)], (70, 120, 70))
    for (a, b, c) in [(-4, -21, (230, 80, 110)), (-2, -22, (250, 210, 90)), (-5, -19, (240, 120, 150)), (-1, -20, (230, 80, 110)), (-3, -18, (250, 240, 240))]:
        cv.rect(x0 + a, feet + b, 2, 2, c)
    # waiting...: a thought bubble with a clock
    cv.ellipse(94, 22, 116, 40, P["white"]); cv.put(92, 44, P["white"]); cv.rect(90, 46, 2, 2, P["white"])
    cv.ellipse(99, 25, 111, 37, (60, 60, 80)); cv.ellipse(100, 26, 110, 36, (250, 248, 240))
    cv.line([(105, 31), (105, 27)], (60, 60, 80)); cv.line([(105, 31), (108, 31)], (60, 60, 80))
    # the leaf blowing past, the wind behind it
    leaf(cv, 74, 26, big=True, outline=(250, 200, 170))
    streaks(cv, 64, 28, n=3, length=10, c=(214, 206, 230))
    snow(cv, 40, rnd)
    return cv


def bull():
    """Seeing Red: the bronze bull at Bowling Green snorts at the red leaf landed on its nose"""
    cv = Canvas()
    rnd = random.Random(3)
    sky(cv, COLD, 0, 60)
    cloud(cv, 6, 16, 40, rnd); cloud(cv, 82, 10, 34, rnd)
    skyline(cv, 66, rnd, hmin=24, hmax=56)
    # cobbles and a railing behind (the Bowling Green fence)
    cv.rect(0, 66, W, 30, P["pave2"])
    for y in range(68, H, 3):
        for x in range((y // 3) % 2 * 3, W, 6):
            cv.rect(x, y, 4, 1, P["pave"])
    cv.rect(0, 58, W, 1, P["ink"])
    for x in range(1, W, 3):
        cv.rect(x, 56, 1, 10, P["ink"]); cv.put(x, 55, P["ink"])
    cv.rect(0, 64, W, 1, P["ink"])
    # the bull, side on, head down, charging right
    B, Bh, Bs = P["bronze"], P["bronzeHi"], P["bronzeSh"]
    cv.ellipse(18, 40, 86, 76, B)                        # body
    cv.ellipse(56, 36, 92, 70, B)                        # shoulders and hump
    cv.ellipse(22, 42, 70, 52, Bh)                       # the light along its back
    cv.ellipse(18, 58, 86, 76, Bs)
    cv.ellipse(20, 44, 84, 72, B)
    # the head, lowered to charge: a broad brow, the muzzle down low
    cv.poly([(80, 44), (96, 46), (108, 60), (110, 74), (100, 80), (88, 76), (80, 64)], B)
    cv.poly([(84, 46), (96, 48), (104, 58), (98, 60), (86, 54)], Bh)
    cv.ellipse(98, 70, 112, 82, Bs)                        # muzzle
    cv.rect(106, 74, 2, 2, P["ink"])                       # nostril
    # the horns: thick at the root, sweeping out and forward to points
    cv.line([(86, 48), (90, 42), (95, 39)], Bs, 3)                      # the far horn, mostly hidden
    cv.line([(92, 50), (100, 47), (108, 44), (114, 39)], Bh, 3)         # the near one, out and forward
    cv.line([(114, 39), (117, 35)], (210, 196, 160), 2)
    # angry eye and brow
    cv.rect(98, 58, 3, 2, (255, 120, 60)); cv.line([(95, 54), (102, 57)], P["ink"], 2)
    # legs
    for x, y0 in [(26, 70), (36, 72), (66, 70), (78, 70)]:
        cv.rect(x, y0, 5, 86 - y0, Bs if x in (36, 78) else B)
        cv.rect(x - 1, 85, 7, 2, P["ink"])
    # tail whipping up
    cv.line([(20, 52), (12, 44), (10, 36), (14, 32)], B, 2)
    cv.rect(12, 30, 4, 3, Bs)
    # snow on its back
    cv.line([(30, 41), (44, 38), (60, 36), (74, 37)], P["snow"], 2)
    # steam snorting out of the nose, and the leaf right on the tip of it
    for i, (x, y, r) in enumerate([(116, 78, 3), (121, 82, 4), (113, 84, 2)]):
        puff(cv, x, y, r)
    leaf(cv, 116, 66, big=True, outline=P["vein"])
    # !
    cv.rect(121, 26, 3, 9, (220, 40, 40)); cv.rect(121, 37, 3, 3, (220, 40, 40))
    snow(cv, 30, rnd, 0, 66)
    return cv


def cityhall():
    """Leaf of Absence: the leaf asleep on City Hall's roof; the door says CLOSED"""
    cv = Canvas()
    rnd = random.Random(11)
    sky(cv, COLD, 0, H)
    cloud(cv, 4, 20, 36, rnd); cloud(cv, 90, 14, 30, rnd)
    skyline(cv, 52, rnd, hmin=10, hmax=30, cols=("bldC", "bldA"))
    S, S2, Hi = P["stone"], P["stone2"], P["stoneHi"]
    # wings and the centre block
    cv.rect(4, 52, 120, 34, S)
    cv.rect(4, 52, 120, 2, Hi); cv.rect(4, 50, 120, 2, S2)          # cornice, balustrade
    for x in range(5, 123, 3):
        cv.rect(x, 47, 1, 3, S2)
    cv.rect(4, 46, 120, 1, S2)
    cv.rect(4, 45, 120, 1, P["snow"])                                 # snow along the roof
    for wx in list(range(9, 44, 7)) + list(range(86, 121, 7)):
        cv.rect(wx, 58, 3, 8, P["win"]); cv.rect(wx, 72, 3, 8, P["win"])
    # the portico: columns and a pediment-less top
    cv.rect(44, 54, 40, 32, Hi)
    for x in range(46, 84, 5):
        cv.rect(x, 56, 2, 28, S2)
    cv.rect(44, 54, 40, 2, S2)
    cv.rect(58, 72, 12, 14, (70, 60, 52))                             # the door
    # the sign on the door
    cv.rect(51, 74, 26, 9, P["white"]); cv.rect(51, 74, 26, 1, P["ink"])
    text(cv, 53, 76, "CLOSED", (200, 40, 40))
    cv.line([(58, 74), (64, 70), (70, 74)], P["ink"])
    cv.rect(51, 82, 26, 1, P["ink"])
    # the cupola with its clock and a little statue
    cv.rect(54, 30, 20, 16, S); cv.rect(54, 30, 2, 16, Hi); cv.rect(71, 30, 3, 16, S2)
    cv.rect(52, 28, 24, 2, S2)
    cv.ellipse(59, 33, 68, 42, P["white"]); cv.put(63, 35, P["ink"]); cv.put(63, 36, P["ink"]); cv.put(64, 37, P["ink"]); cv.put(65, 37, P["ink"])
    cv.ellipse(56, 18, 72, 32, S)
    cv.rect(56, 25, 17, 3, S)
    cv.rect(62, 10, 4, 9, P["copper2"]); cv.rect(63, 7, 2, 3, P["copper"])
    cv.rect(57, 18, 14, 1, P["snow"])
    # the leaf, flat out on the roof, asleep
    leaf(cv, 30, 42, big=True, rot=90)
    text(cv, 34, 30, "z", P["white"]); text(cv, 39, 24, "Z", P["white"]); text(cv, 45, 16, "Z", P["white"], 2)
    # snow on the ground, a lamppost
    cv.rect(0, 86, W, 10, P["snow"]); cv.rect(0, 86, W, 1, P["snowSh"])
    cv.rect(110, 70, 1, 16, P["ink"]); cv.rect(108, 68, 5, 2, P["ink"]); cv.put(110, 70, P["winLit"])
    snow(cv, 34, rnd, 0, 86)
    return cv


def arch():
    """Arch Nemesis: the leaf and a pigeon face off on top of the Washington Square arch"""
    cv = Canvas()
    rnd = random.Random(5)
    sky(cv, COLD, 0, H)
    cloud(cv, 10, 14, 30, rnd); cloud(cv, 84, 8, 36, rnd)
    # Fifth Avenue through the arch
    skyline(cv, 96, rnd, hmin=20, hmax=46)
    S, S2, Hi = P["stone"], P["stone2"], P["stoneHi"]
    # piers and the arch opening
    cv.rect(0, 52, W, 44, S)
    sub = Canvas()
    rnd2 = random.Random(9)
    sky(sub, COLD, 0, H)
    skyline(sub, 112, rnd2, hmin=30, hmax=60)
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).ellipse([32, 60, 96, 132], fill=255)
    cv.img.paste(sub.img, (0, 0), mask); cv.px = cv.img.load()
    cv.d = ImageDraw.Draw(cv.img)
    for a in range(0, 181, 15):                                      # voussoirs
        r = math.radians(a)
        cv.line([(64 + 32 * math.cos(r), 96 - 36 * math.sin(r)), (64 + 36 * math.cos(r), 96 - 40 * math.sin(r))], S2)
    for a in range(0, 181, 2):
        r = math.radians(a)
        cv.put(64 + 36 * math.cos(r), 96 - 40 * math.sin(r), S2)
    cv.rect(0, 52, 6, 44, Hi); cv.rect(122, 52, 6, 44, S2)
    # the attic: frieze, cornice, snow
    cv.rect(0, 34, W, 18, S)
    cv.rect(0, 34, W, 2, Hi); cv.rect(0, 49, W, 3, S2)
    for x in range(4, W, 8):
        cv.rect(x, 39, 4, 6, S2)
    cv.rect(0, 31, W, 3, S2); cv.rect(0, 30, W, 1, P["snow"])
    # the leaf (left) and the pigeon (right), glaring
    leaf(cv, 34, 20, big=True, scale=2, flip=True)
    cv.rect(30, 17, 2, 2, P["ink"]); cv.rect(37, 17, 2, 2, P["ink"])             # its glare
    cv.line([(29, 14), (32, 16)], P["ink"]); cv.line([(39, 14), (36, 16)], P["ink"])
    px0, py0 = 96, 30
    pg, ps, ph = P["pigeon"], P["pigeonSh"], P["pigeonHi"]
    cv.ellipse(px0 - 10, py0 - 14, px0 + 12, py0, pg)                    # body, puffed up
    cv.ellipse(px0 - 8, py0 - 10, px0 + 8, py0, ph)
    cv.poly([(px0 + 10, py0 - 10), (px0 + 22, py0 - 4), (px0 + 10, py0 - 3)], ps)   # tail
    cv.ellipse(px0 - 12, py0 - 24, px0, py0 - 12, pg)                    # head
    cv.rect(px0 - 10, py0 - 14, 8, 3, P["neck"])                         # the green-purple neck
    cv.poly([(px0 - 12, py0 - 19), (px0 - 17, py0 - 17), (px0 - 12, py0 - 16)], (90, 80, 80))  # beak
    cv.rect(px0 - 9, py0 - 20, 2, 2, (230, 120, 40)); cv.put(px0 - 9, py0 - 20, P["ink"])        # eye
    cv.line([(px0 - 11, py0 - 23), (px0 - 6, py0 - 21)], P["ink"])                      # brow
    cv.rect(px0 - 4, py0, 1, 2, (200, 100, 100)); cv.rect(px0 + 2, py0, 1, 2, (200, 100, 100))
    # the spark between them
    cv.line([(58, 14), (64, 20), (60, 22), (68, 28)], (255, 210, 80), 2)
    sparkle(cv, 70, 12, (255, 230, 140))
    snow(cv, 36, rnd)
    return cv


def flatiron():
    """Pressing Matters: the Flatiron, steam up like an iron, presses the leaf flat on its tip"""
    cv = Canvas()
    rnd = random.Random(13)
    sky(cv, COLD, 0, H)
    cloud(cv, 4, 30, 26, rnd); cloud(cv, 100, 22, 30, rnd)
    S, S2, Hi = (210, 196, 170), (160, 146, 124), (232, 222, 200)
    # the wedge, seen from just off its tip: two faces running steeply back from a narrow rounded prow
    tip = 62
    def ytop(x):   # the roofline: highest at the prow, falling away on both sides
        return 30 + abs(x - tip) * (0.34 if x < tip else 0.30)
    for x in range(4, 124):
        y = int(ytop(x))
        col = S if x < tip - 2 else Hi if x <= tip + 2 else S2
        cv.rect(x, y, 1, H - y, col)
    # window rows, following the perspective (closer together further back)
    for k in range(12):
        for x in range(6, 122, 1):
            if abs(x - tip) < 3:
                continue
            d = abs(x - tip)
            step = 4 if d < 20 else 3 if d < 40 else 2
            if d % (step * 2) != 0:
                continue
            y = ytop(x) + 6 + k * (7 - d * 0.05)
            if y < H - 1:
                cv.rect(x, int(y), 1 if d > 30 else 2, 3 if d < 40 else 2, P["win"] if x < tip else (94, 102, 118))
    for k in range(12):
        cv.rect(tip - 1, 36 + k * 7, 2, 3, P["win"])
    # the cornice and a band of snow on it
    for x in range(2, 126):
        y = int(ytop(x))
        cv.rect(x, y - 3, 1, 3, S2 if x < tip else (128, 116, 98))
        cv.put(x, y - 4, P["snow"])
    # steam, as off an iron
    for (x, y, r) in [(40, 22, 4), (34, 15, 5), (44, 10, 3), (86, 20, 4), (92, 12, 5), (82, 8, 3)]:
        puff(cv, x, y, r)
    # the leaf on the prow: ironed flat, with crisp creases
    cv.rect(tip - 13, 22, 26, 4, P["red"]); cv.rect(tip, 22, 13, 4, P["orange"])
    cv.rect(tip - 15, 23, 30, 2, P["red"]); cv.rect(tip, 23, 15, 2, P["orange"])
    for x in (-11, -6, -1, 4, 9):
        cv.rect(tip + x, 22, 1, 4, P["vein"] if x < 0 else (180, 80, 40))
    cv.rect(tip - 17, 24, 2, 1, P["stem"])
    sparkle(cv, tip + 18, 16, P["white"]); sparkle(cv, tip - 19, 15, P["white"], 1)
    snow(cv, 30, rnd)
    return cv


def steps():
    """Stair Struck: the leaf takes a bow at the top of the red steps, in a spotlight, flashes going off"""
    cv = Canvas()
    rnd = random.Random(17)
    sky(cv, [(0, (30, 30, 58)), (1, (74, 62, 96))], 0, 60)
    # the screens around the square
    bld = [(0, 10, 30), (28, 4, 26), (52, 16, 24), (74, 0, 30), (102, 8, 28)]
    for x, y, w in bld:
        cv.rect(x, y, w, 70, (46, 46, 70))
    screens = [(2, 14, 24, 14, (232, 32, 58), "NYC", (255, 210, 58)), (31, 8, 20, 10, (26, 26, 46), "LEAF", (255, 138, 42)),
               (78, 4, 22, 14, (10, 106, 200), "LIVE", (255, 255, 255)), (104, 12, 22, 12, (255, 224, 43), "SALE", (26, 26, 26)),
               (54, 20, 20, 10, (106, 26, 160), "STAR", (255, 210, 58)), (4, 34, 20, 10, (200, 20, 20), "FIZZ", (255, 255, 255)),
               (104, 30, 22, 10, (42, 26, 106), "SHOW", (122, 240, 255))]
    for x, y, w, h, bg, word, fg in screens:
        cv.rect(x, y, w, h, bg)
        tw = text_w(word)
        text(cv, x + (w - tw) // 2, y + (h - 5) // 2, word, fg)
    # glow off the screens on the snow
    cv.rect(0, 70, W, 26, (70, 56, 80))
    # the red steps: rising to the right
    for i in range(7):
        x0 = 20 + i * 9
        y0 = 86 - i * 6
        cv.rect(x0, y0, W - x0, 6, P["stepRed"])
        cv.rect(x0, y0, W - x0, 1, P["stepHi"])
        cv.rect(x0, y0 + 5, W - x0, 1, P["stepSh"])
    # the spotlight from top left
    for y in range(0, 50):
        t = y / 50
        cx, half = 30 + t * 64, 2 + t * 12
        for x in range(int(cx - half), int(cx + half) + 1):
            cv.blend(x, y, (255, 244, 200), 0.22)
    cv.ellipse(80, 46, 108, 52, (255, 120, 100))
    # the leaf, centre stage, with a little bow
    leaf(cv, 94, 40, big=True, scale=2, outline=(255, 214, 160))
    for (x, y) in [(76, 30), (112, 26), (106, 44), (80, 18)]:
        sparkle(cv, x, y, (255, 230, 140))
    # the crowd below, phones up, flashes
    for i in range(14):
        x = 2 + i * 9 + rnd.randint(-2, 2)
        y = 88 + rnd.randint(-2, 2)
        cv.ellipse(x, y, x + 6, y + 6, (24, 20, 34))
        cv.rect(x - 1, y + 5, 8, 10, (24, 20, 34))
        if i % 2 == 0:
            cv.rect(x + 5, y - 6, 1, 6, (24, 20, 34)); cv.rect(x + 4, y - 9, 3, 4, (24, 20, 34))
            if i % 4 == 0:
                cv.put(x + 5, y - 8, P["white"]); sparkle(cv, x + 5, y - 8, P["white"], 1)
    return cv


def column():
    """Leaf Erikson: on top of the Columbus Circle column, the leaf has planted its flag first"""
    cv = Canvas()
    rnd = random.Random(19)
    sky(cv, COLD, 0, H)
    cloud(cv, 4, 20, 36, rnd); cloud(cv, 84, 12, 40, rnd)
    skyline(cv, H, rnd, hmin=20, hmax=40, lit=0.05, cols=("bldC", "bldA"))
    S, S2, Hi = P["stone"], P["stone2"], P["stoneHi"]
    # the shaft with its ships' prows, the capital
    cv.rect(52, 66, 24, 30, S); cv.rect(52, 66, 3, 30, Hi); cv.rect(72, 66, 4, 30, S2)
    for y in (74, 86):
        cv.poly([(52, y), (44, y + 2), (52, y + 5)], P["bronze"]); cv.poly([(76, y), (84, y + 2), (76, y + 5)], P["bronzeSh"])
    cv.rect(42, 60, 44, 6, S); cv.rect(42, 60, 44, 1, Hi); cv.rect(42, 65, 44, 1, S2)
    cv.rect(46, 56, 36, 4, S2)
    cv.rect(42, 59, 44, 1, P["snow"])
    # Columbus: on his plinth, a cloak, an arm out, a puzzled look
    cv.rect(52, 52, 14, 4, S2)
    cv.rect(54, 30, 10, 22, (196, 192, 182)); cv.rect(54, 30, 3, 22, (226, 222, 212)); cv.rect(61, 30, 3, 22, (150, 146, 136))
    cv.rect(55, 22, 8, 8, (196, 192, 182)); cv.rect(55, 22, 2, 8, (226, 222, 212))
    cv.line([(54, 34), (44, 30), (40, 28)], (196, 192, 182), 2)
    cv.rect(55, 21, 8, 1, P["snow"])
    text(cv, 46, 12, "?", P["ink"], 2)
    # the leaf and its flag, on the capital's corner
    cv.rect(72, 22, 1, 38, P["stem"])
    cv.poly([(73, 22), (92, 27), (73, 33)], (230, 70, 50))
    text(cv, 75, 25, "1", P["white"])
    leaf(cv, 82, 47, big=True, scale=2)
    sparkle(cv, 98, 18, P["white"])
    snow(cv, 34, rnd)
    return cv


def maine():
    """Main Character: the leaf strikes the same pose as the gilded figure on top of the Maine monument"""
    cv = Canvas()
    rnd = random.Random(23)
    sky(cv, COLD, 0, H)
    cloud(cv, 0, 14, 40, rnd); cloud(cv, 92, 22, 36, rnd)
    # Central Park South behind, the park's bare trees
    skyline(cv, 74, rnd, hmin=20, hmax=50, lit=0.1)
    for x in range(-4, W, 11):
        h = rnd.randint(14, 22)
        cv.line([(x, 82), (x, 82 - h)], P["bark"])
        for k in range(3):
            y = 82 - h + 3 + k * 4
            cv.line([(x, y), (x - 4 - k, y - 4)], P["bark2"]); cv.line([(x, y + 2), (x + 4 + k, y - 2)], P["bark2"])
    cv.rect(0, 82, W, 14, P["snow"])
    # the pylon top
    S, S2, Hi = P["stone"], P["stone2"], P["stoneHi"]
    cv.rect(42, 62, 44, 34, S); cv.rect(42, 62, 4, 34, Hi); cv.rect(81, 62, 5, 34, S2)
    cv.rect(38, 58, 52, 4, S2); cv.rect(38, 57, 52, 1, P["snow"])
    # the gilded group: the shell chariot, the figure with her arms up
    G, Gh, Gs = P["gold"], P["goldHi"], P["goldSh"]
    cv.ellipse(46, 44, 80, 60, Gs); cv.ellipse(48, 44, 78, 56, G)
    for x in range(50, 78, 4):
        cv.line([(x, 46), (63, 58)], Gs)
    cv.rect(58, 22, 9, 24, G); cv.rect(58, 22, 3, 24, Gh); cv.rect(64, 22, 3, 24, Gs)
    cv.rect(59, 14, 7, 8, G); cv.rect(59, 14, 2, 8, Gh)
    cv.line([(58, 24), (52, 14), (50, 8)], G, 2); cv.line([(66, 24), (72, 14), (74, 8)], Gs, 2)
    # the leaf beside her, same pose: stick arms up
    lx, ly = 98, 42
    cv.line([(lx - 4, ly), (lx - 10, ly - 10)], P["stem"]); cv.line([(lx + 4, ly), (lx + 10, ly - 10)], P["stem"])
    leaf(cv, lx, ly, big=True, scale=2)
    cv.line([(lx, ly + 11), (lx - 3, ly + 16)], P["stem"]); cv.line([(lx, ly + 11), (lx + 3, ly + 16)], P["stem"])
    # the shine
    for (x, y) in [(46, 10), (80, 6), (112, 26), (86, 30), (40, 34)]:
        sparkle(cv, x, y, Gh)
    snow(cv, 30, rnd, 0, 82)
    return cv


SCENES = {"empire": empire, "bull": bull, "cityhall": cityhall, "arch": arch, "flatiron": flatiron,
          "steps": steps, "column": column, "maine": maine}

if __name__ == "__main__":
    names = sys.argv[1:] or list(SCENES)
    total = 0
    for n in names:
        path = SCENES[n]().save(n)
        size = os.path.getsize(path)
        total += size
        print(f"{n:9s} {size / 1024:6.1f} KB  {path}")
    print(f"total {total / 1024:.1f} KB")
