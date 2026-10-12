"""Far From the Tree - the achievement snapshots: a pixel-art instant photo for every achievement.

Each one is a snapshot someone took at the moment it happened (the leaf on the landmark, in the tunnel,
pegged on the washing line...), in the intro and ending films' cold late-November palette and flat pixel
style (tools/cutscene/build.py's C palette, the hero leaf's two-tone maple). The photo is drawn at
120x90 art pixels, given a film look (grade, flash bloom, light leak, vignette, grain; the backgrounds are
drawn softer and hazier than the subject), then mounted in an off-white polaroid frame with the pun
written along the bottom in a felt-tip pixel hand, with a soft drop shadow. Scaled x4 nearest-neighbour
and saved as small palettised PNGs: public/achievements/<id>.png. Also draws the photo album's pixel
art (cover, paper, photo corners, arrows, icons) into public/achievements/album/.
Shown by src/game/snapshotCard.ts (the unlock card) and src/game/achievementGallery.ts (the album).

    python tools/achievements/snapshots.py            -> everything
    python tools/achievements/snapshots.py empire bull -> just those
Needs only Pillow.
"""
import math, os, random, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "public", "achievements"))
W, H, SCALE = 120, 90, 4      # the photo, in art pixels


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


# ---------------------------------------------------------------------------- pieces
BAYER = [[0, 2], [3, 1]]


def mix(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def sky(cv, stops, y0=0, y1=H, bands=7, x0=0, x1=W):
    """a vertical gradient in flat bands with a 2x2 checker dither at each step (the films' look).
    stops: [(t, colour)] with t from 0 (top) to 1 (bottom)"""
    def at(t):
        for (ta, ca), (tb, cb) in zip(stops, stops[1:]):
            if t <= tb:
                return mix(ca, cb, (t - ta) / max(1e-6, tb - ta))
        return stops[-1][1]
    for y in range(max(0, y0), min(H, y1)):
        t = (y - y0) / max(1, (y1 - y0 - 1))
        f = t * bands
        i = int(f)
        frac = f - i
        ca, cb = at(i / bands), at(min(1, (i + 1) / bands))
        for x in range(max(0, x0), min(W, x1)):
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
    "G": ["011", "100", "101", "101", "011"], "M": ["101", "111", "111", "101", "101"],
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


# ---------------------------------------------------------------------------- more pieces
HAZE = (190, 198, 210)


def hz(c, t, to=HAZE):
    """push a colour toward the air: distant things are paler and flatter (the soft background focus)"""
    return mix(c, to, t)


def leaf_im(scale=2, rot=0, flip=False, outline=None, big=True):
    im = sprite(LEAF_BIG if big else LEAF_SMALL, LEAF_KEY, scale, rot, flip, outline)
    return im.crop(im.getbbox())


def place(cv, im, cx, bottom):
    """paste a sprite centred on cx, standing on y = bottom"""
    cv.img.paste(im, (int(cx - im.width / 2), int(bottom - im.height)), im)
    cv.px = cv.img.load()


def leaf_on(cv, cx, bottom, scale=2, rot=0, flip=False, outline=None, big=True):
    place(cv, leaf_im(scale, rot, flip, outline, big), cx, bottom)


def glow(cv, x, y, r, c, a):
    for yy in range(int(y - r), int(y + r) + 1):
        for xx in range(int(x - r), int(x + r) + 1):
            d = math.hypot(xx - x, yy - y) / r
            if d < 1:
                cv.blend(xx, yy, c, a * (1 - d) ** 2)


def disc(cv, x, y, r, c, a=1.0):
    for yy in range(int(y - r - 1), int(y + r) + 2):
        for xx in range(int(x - r - 1), int(x + r) + 2):
            if math.hypot(xx - x, yy - y) <= r:
                cv.blend(xx, yy, c, a)


def snowfall(cv, rnd, far=30, near=5, y0=0, y1=H):
    for _ in range(far):
        cv.blend(rnd.randrange(W), rnd.randrange(y0, y1), (240, 244, 250), 0.85)
    for _ in range(near):   # flakes close to the lens: big, soft, out of focus
        x, y = rnd.randrange(W), rnd.randrange(y0, y1)
        disc(cv, x, y, 1.6, (236, 240, 248), 0.45)
        cv.blend(x, y, (250, 252, 255), 0.5)


def steam(cv, pts, rnd, c=(236, 238, 242), a0=0.7, a1=0.15):
    """puffs along a path, swelling and thinning: pts = [(x, y, r)]"""
    n = len(pts)
    for i, (x, y, r) in enumerate(pts):
        a = a0 + (a1 - a0) * i / max(1, n - 1)
        disc(cv, x + rnd.uniform(-1, 1), y, r, c, a)
        disc(cv, x - r * 0.3, y - r * 0.3, r * 0.6, (250, 250, 252), a * 0.6)


def bricks(cv, x0, y0, x1, y1, base, mortar, rnd, bw=6, bh=3):
    cv.rect(x0, y0, x1 - x0, y1 - y0, base)
    for row, y in enumerate(range(y0, y1, bh)):
        cv.rect(x0, y, x1 - x0, 1, mortar)
        off = (row % 2) * (bw // 2)
        for x in range(x0 - off, x1, bw):
            if x0 <= x < x1:
                cv.put(x, y + 1, mortar)
                if bh > 2:
                    cv.put(x, y + 2, mortar)
            if rnd.random() < 0.12:
                cv.rect(max(x0, x + 1), y + 1, min(bw - 1, x1 - x - 1), bh - 1, mix(base, (0, 0, 0), 0.12))


def window(cv, x, y, w, h, frame, glass, lit=None):
    cv.rect(x - 1, y - 1, w + 2, h + 2, frame)
    cv.rect(x, y, w, h, lit or glass)
    cv.rect(x, y + h // 2, w, 1, frame)
    cv.rect(x + w // 2, y, 1, h, frame)


def tree(cv, x, base, h, c, rnd, spread=1.0, w=2):
    """a bare winter tree: trunk and forking twigs"""
    def branch(x0, y0, ang, ln, wd, depth):
        x1, y1 = x0 + math.cos(ang) * ln, y0 - math.sin(ang) * ln
        cv.line([(x0, y0), (x1, y1)], c, max(1, int(wd)))
        if depth > 0:
            for da in (-0.5 * spread, 0.45 * spread):
                branch(x1, y1, ang + da + rnd.uniform(-0.2, 0.2), ln * rnd.uniform(0.6, 0.78), wd * 0.6, depth - 1)
    branch(x, base, math.pi / 2 + rnd.uniform(-0.08, 0.08), h * 0.42, w, 4)


def cab(cv, x, y, s=1, flip=False):
    """a yellow cab, side on (x, y = left, wheels' bottom); 22 x 10 at s = 1"""
    Y, Ys, G, K = (242, 192, 44), (196, 146, 24), (64, 76, 98), (30, 28, 32)
    def R(a, b, w, h, c):
        a = 22 - a - w if flip else a
        cv.rect(x + a * s, y - b * s - h * s, w * s, h * s, c)
    R(0, 2, 22, 4, Y); R(0, 2, 22, 1, Ys); R(5, 6, 12, 3, Y); R(6, 6, 4, 2, G); R(11, 6, 5, 2, G)
    R(9, 9, 4, 1, (250, 240, 200)); R(21, 4, 1, 1, (255, 250, 220)); R(0, 4, 1, 1, (220, 40, 40))
    R(3, 0, 4, 3, K); R(15, 0, 4, 3, K); R(4, 1, 2, 1, (130, 130, 130)); R(16, 1, 2, 1, (130, 130, 130))


def pigeon(cv, x, y, s=1, flip=False, puffed=False):
    """side-on pigeon facing left, x, y = between its feet; about 16 x 15 at s = 1"""
    g, gs, gh, nk = P["pigeon"], P["pigeonSh"], P["pigeonHi"], P["neck"]
    p = 2 if puffed else 0
    def X(a):
        return x + (-a if flip else a) * s
    def E(a, b, c, d, col):
        xa, xc = sorted((X(a), X(c)))
        cv.ellipse(xa, y + b * s, xc, y + d * s, col)
    cv.line([(X(4), y - 6 * s), (X(11), y - 3 * s)], gs, 2 * s)              # tail
    E(-5 - p, -10 - p, 6, -1, g)                                              # body
    E(-6 - p, -10 - p, 0, -2, gh)                                             # chest, puffed out
    E(-1, -8, 5, -3, gs)                                                      # wing
    E(-8, -16 - p, -2, -10 - p, g)                                            # head
    E(-7, -12 - p, -1, -8 - p, nk)                                            # neck sheen
    cv.line([(X(-8), y + (-13 - p) * s), (X(-11), y + (-12 - p) * s)], (70, 60, 60), s)   # beak
    cv.rect(X(-6) - (s if not flip else 0), y + (-14 - p) * s, s, s, (232, 120, 40))      # eye
    cv.line([(X(-1), y - s), (X(-1), y)], (200, 100, 100), s)
    cv.line([(X(2), y - s), (X(2), y)], (200, 100, 100), s)


# ---------------------------------------------------------------------------- the film look
def finish(cv, rnd, tint=(80, 100, 150), tint_a=0.06, vig=0.4, bloom=None, leak=None, grain=0.1, desat=0.0):
    """grade, flash bloom, light leak, vignette (dithered steps) and a little grain"""
    px = cv.px
    for y in range(H):
        for x in range(W):
            c = px[x, y]
            if desat:
                l = (c[0] * 3 + c[1] * 6 + c[2]) / 10
                c = mix(c, (l, l, l), desat)
            if tint_a:
                c = mix(c, tint, tint_a)
            px[x, y] = c
    if bloom:
        bx, by, br, ba = bloom
        glow(cv, bx, by, br, (255, 250, 236), ba)
    if leak:
        corner, col, a = leak
        cx = 0 if "l" in corner else W - 1
        cy = 0 if "t" in corner else H - 1
        glow(cv, cx, cy, 60, col, a)
    for y in range(H):
        for x in range(W):
            dx, dy = (x - W / 2 + 0.5) / (W / 2), (y - H / 2 + 0.5) / (H / 2)
            d = math.sqrt(dx * dx * 0.9 + dy * dy * 1.1)
            k = vig * max(0.0, min(1.0, (d - 0.55) / 0.75)) ** 1.5
            step = int(k * 6 + (BAYER[y % 2][x % 2] + 0.5) / 4) / 6
            c = px[x, y]
            if step:
                c = mix(c, (10, 8, 16), step)
            if rnd.random() < grain:
                n = rnd.choice((-9, -6, 6, 9))
                c = tuple(max(0, min(255, v + n)) for v in c)
            px[x, y] = c


# ---------------------------------------------------------------------------- the polaroid
# a felt-tip hand: 8 rows (0-1 ascenders, 2-6 the x height, 7 descenders)
HAND = {
    "a": ["....", "....", ".##.", "...#", ".###", "#..#", ".###", "...."],
    "b": ["#...", "#...", "###.", "#..#", "#..#", "#..#", "###.", "...."],
    "c": ["...", "...", ".##", "#..", "#..", "#..", ".##", "..."],
    "d": ["...#", "...#", ".###", "#..#", "#..#", "#..#", ".###", "...."],
    "e": ["....", "....", ".##.", "#..#", "####", "#...", ".###", "...."],
    "f": ["..#", ".#.", "###", ".#.", ".#.", ".#.", ".#.", "..."],
    "g": ["....", "....", ".###", "#..#", "#..#", ".###", "...#", ".##."],
    "h": ["#...", "#...", "###.", "#..#", "#..#", "#..#", "#..#", "...."],
    "i": [".", "#", ".", "#", "#", "#", "#", "."],
    "k": ["#..", "#..", "#.#", "##.", "#..", "##.", "#.#", "..."],
    "l": ["#.", "#.", "#.", "#.", "#.", "#.", ".#", ".."],
    "m": [".....", ".....", "####.", "#.#.#", "#.#.#", "#.#.#", "#.#.#", "....."],
    "n": ["....", "....", "###.", "#..#", "#..#", "#..#", "#..#", "...."],
    "o": ["....", "....", ".##.", "#..#", "#..#", "#..#", ".##.", "...."],
    "p": ["....", "....", "###.", "#..#", "#..#", "###.", "#...", "#..."],
    "r": ["...", "...", "#.#", "##.", "#..", "#..", "#..", "..."],
    "s": ["...", "...", ".##", "#..", ".#.", "..#", "##.", "..."],
    "t": [".#.", ".#.", "###", ".#.", ".#.", ".#.", "..#", "..."],
    "u": ["....", "....", "#..#", "#..#", "#..#", "#..#", ".###", "...."],
    "v": [".....", ".....", "#...#", "#...#", ".#.#.", ".#.#.", "..#..", "....."],
    "w": [".....", ".....", "#...#", "#...#", "#.#.#", "#.#.#", ".#.#.", "....."],
    "y": ["....", "....", "#..#", "#..#", "#..#", ".###", "...#", ".##."],
    "'": ["#", "#", ".", ".", ".", ".", ".", "."],
    " ": ["..", "..", "..", "..", "..", "..", "..", ".."],
    "A": [".##.", "#..#", "#..#", "####", "#..#", "#..#", "#..#", "...."],
    "B": ["###.", "#..#", "#..#", "###.", "#..#", "#..#", "###.", "...."],
    "C": [".###", "#...", "#...", "#...", "#...", "#...", ".###", "...."],
    "D": ["###.", "#..#", "#..#", "#..#", "#..#", "#..#", "###.", "...."],
    "E": ["####", "#...", "#...", "###.", "#...", "#...", "####", "...."],
    "F": ["####", "#...", "#...", "###.", "#...", "#...", "#...", "...."],
    "G": [".###", "#...", "#...", "#.##", "#..#", "#..#", ".###", "...."],
    "H": ["#..#", "#..#", "#..#", "####", "#..#", "#..#", "#..#", "...."],
    "I": ["###", ".#.", ".#.", ".#.", ".#.", ".#.", "###", "..."],
    "J": ["..#", "..#", "..#", "..#", "..#", "#.#", ".#.", "..."],
    "K": ["#..#", "#.#.", "##..", "#...", "##..", "#.#.", "#..#", "...."],
    "L": ["#...", "#...", "#...", "#...", "#...", "#...", "####", "...."],
    "M": ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#", "....."],
    "N": ["#..#", "##.#", "##.#", "#.##", "#.##", "#..#", "#..#", "...."],
    "O": [".##.", "#..#", "#..#", "#..#", "#..#", "#..#", ".##.", "...."],
    "P": ["###.", "#..#", "#..#", "###.", "#...", "#...", "#...", "...."],
    "R": ["###.", "#..#", "#..#", "###.", "#.#.", "#..#", "#..#", "...."],
    "S": [".###", "#...", "#...", ".##.", "...#", "...#", "###.", "...."],
    "T": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#..", "....."],
    "V": ["#...#", "#...#", "#...#", ".#.#.", ".#.#.", ".#.#.", "..#..", "....."],
    "W": ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#", "....."],
    "Y": ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#..", "....."],
}
INK = (40, 50, 108)


def hand_width(s):
    return sum(len(HAND[ch][0]) + 1 for ch in s) - 1


def hand(img, x, y, s, c=INK, seed=1):
    """write in the felt-tip hand: a slight forward lean and a wandering baseline"""
    r = random.Random(seed)
    px = img.load()
    drift = 0
    for ch in s:
        if ch == " ":
            drift = r.choice((0, 0, 1, -1)) if drift == 0 else 0
        g = HAND[ch]
        for yy, row in enumerate(g):
            lean = 1 if yy < 3 else 0
            for xx, v in enumerate(row):
                if v == "#":
                    px[x + xx + lean, y + yy + drift] = c
        x += len(g[0]) + 1


FR_SIDE, FR_TOP, FR_BOT = 5, 5, 22
PAPER = (242, 238, 228)


def polaroid(photo, caption, seed):
    fw, fh = W + FR_SIDE * 2, H + FR_TOP + FR_BOT
    im = Image.new("RGBA", (fw + 2, fh + 3), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([1, 2, fw + 1, fh + 2], fill=(18, 12, 8, 56))      # the drop shadow
    d.rectangle([1, 1, fw, fh + 1], fill=(18, 12, 8, 46))
    d.rectangle([0, 0, fw - 1, fh - 1], fill=PAPER + (255,))
    r = random.Random(seed)
    px = im.load()
    for _ in range(int(fw * fh * 0.05)):                             # the card's texture
        x, y = r.randrange(fw), r.randrange(fh)
        px[x, y] = (232, 227, 214, 255) if r.random() < 0.7 else (250, 248, 242, 255)
    for x in range(fw):
        px[x, fh - 1] = (214, 208, 194, 255)
    for y in range(fh):
        px[fw - 1, y] = (222, 216, 202, 255)
    im.paste(photo, (FR_SIDE, FR_TOP))
    for x in range(FR_SIDE - 1, FR_SIDE + W + 1):                    # the photo sits a hair below the card
        px[x, FR_TOP - 1] = (206, 200, 186, 255)
    for y in range(FR_TOP, FR_TOP + H):
        px[FR_SIDE - 1, y] = (214, 208, 194, 255)
    tw = hand_width(caption)
    hand(im, (fw - tw) // 2, FR_TOP + H + 7, caption, INK, seed)
    return im


def save_png(img, name, sub="", colors=96):
    os.makedirs(os.path.join(OUT, sub), exist_ok=True)
    big = img.resize((img.width * SCALE, img.height * SCALE), Image.NEAREST)
    if big.mode == "RGBA":
        pal = big.quantize(colors=colors, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    else:
        pal = big.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    path = os.path.join(OUT, sub, name + ".png")
    pal.save(path, optimize=True)
    return path


COLD = [(0, (150, 162, 180)), (1, (214, 218, 222))]
DUSK = [(0, (40, 46, 86)), (0.5, (92, 86, 132)), (0.8, (170, 132, 150)), (1, (214, 160, 140))]
NIGHT = [(0, (18, 18, 34)), (1, (48, 40, 70))]


def soft_skyline(cv, base, rnd, t=0.5, hmin=10, hmax=30, lit=0.0, x0=-2, x1=W + 2, cols=None):
    cols = cols or [P["bldA"], P["bldB"], P["bldC"]]
    x = x0
    while x < x1:
        w, h = rnd.randint(7, 16), rnd.randint(hmin, hmax)
        c = hz(rnd.choice(cols), t)
        cv.rect(x, base - h, w, h + 40, c)
        if t < 0.7:
            for yy in range(base - h + 2, base, 3):
                for xx in range(x + 1, x + w - 1, 3):
                    if rnd.random() < 0.6:
                        cv.put(xx, yy, hz(P["winLit"], t) if rnd.random() < lit else hz(P["win"], t))
        x += w + rnd.randint(0, 1)


# ---------------------------------------------------------------------------- the scenes
# Each draws the photo (120 x 90) and returns it. The joke has to read at a glance at ~200 px wide.
def s_empire(rnd):
    """Don't Leave Me Waiting: on the observation deck at dusk someone waits with a drooping bunch of
    flowers and checks their watch again; the leaf on the parapet beside them is the only one who came"""
    cv = Canvas()
    sky(cv, DUSK, 0, 62, bands=7)
    for _ in range(14):
        cv.blend(rnd.randrange(W), rnd.randrange(0, 24), (230, 230, 250), 0.7)
    t, air = 0.35, (92, 86, 132)
    cv.rect(6, 12, 26, 52, hz((104, 100, 140), t, air))                   # the mast above the deck, soft
    cv.rect(11, 2, 16, 10, hz((112, 108, 148), t, air))
    cv.rect(17, -2, 4, 4, hz((150, 146, 180), t, air))
    for yy in range(16, 60, 4):
        for xx in range(9, 30, 4):
            cv.put(xx, yy, hz(P["winLit"], 0.45, air))
    for _ in range(46):                                                   # Midtown below, out of focus
        x, y = rnd.randrange(30, W), rnd.randrange(44, 58)
        disc(cv, x, y, rnd.choice((1, 1.4, 2)), rnd.choice([(255, 206, 120), (255, 236, 190), (250, 150, 120)]), 0.45)
    glow(cv, 80, 58, 40, (255, 190, 140), 0.25)
    for x in range(1, W, 6):                                              # the fence
        cv.rect(x, 10, 1, 48, (40, 40, 62))
    for y in (10, 30, 46):
        cv.rect(0, y, W, 1, (40, 40, 62))
    cv.rect(0, 58, W, 32, (108, 104, 132))                                # the parapet
    cv.rect(0, 58, W, 3, (166, 162, 186))
    cv.rect(0, 57, W, 1, (236, 238, 246))
    for y in (66, 76, 86):
        cv.rect(0, y, W, 1, (92, 88, 116))
    for x in range(10, W, 22):
        cv.rect(x, 61, 1, 29, (92, 88, 116))
    # the one waiting
    coat, coatSh, coatHi = (54, 62, 100), (38, 44, 76), (76, 86, 132)
    cv.rect(85, 68, 6, 22, (34, 34, 46)); cv.rect(93, 68, 6, 22, (30, 30, 42))
    cv.poly([(82, 28), (104, 28), (108, 72), (78, 72)], coat)
    cv.poly([(100, 28), (104, 28), (108, 72), (101, 72)], coatSh)
    cv.rect(82, 30, 2, 40, coatHi)
    cv.rect(83, 24, 19, 5, (188, 54, 60)); cv.rect(97, 29, 4, 12, (168, 44, 52))          # scarf
    cv.rect(85, 11, 13, 14, P["skin"]); cv.rect(84, 15, 1, 3, P["skin"])                  # face, looking down
    cv.rect(85, 22, 13, 2, (214, 168, 140))
    cv.put(87, 18, P["ink"]); cv.put(88, 18, P["ink"]); cv.rect(87, 21, 3, 1, (150, 90, 80))
    cv.rect(96, 15, 2, 3, (214, 168, 140))
    cv.rect(83, 5, 16, 7, (150, 48, 56)); cv.rect(83, 10, 16, 2, (120, 36, 44)); disc(cv, 91, 4, 2, (230, 220, 220))
    for x in (85, 88, 93, 96):
        cv.put(x, 5, (240, 244, 250))
    cv.rect(70, 31, 14, 6, coat); cv.rect(70, 31, 14, 1, coatHi)                           # the arm, raised
    cv.rect(66, 30, 5, 6, P["skin"])
    cv.rect(71, 29, 3, 3, (226, 230, 240)); cv.put(72, 30, (60, 60, 80))                  # the watch
    cv.rect(104, 44, 4, 5, P["skin"])                                                     # flowers, head down
    cv.poly([(103, 48), (109, 48), (113, 66), (99, 66)], (232, 222, 204))
    cv.poly([(106, 48), (109, 48), (113, 66), (108, 66)], (206, 194, 176))
    for (x, y, c) in [(101, 68, (220, 70, 100)), (105, 69, (246, 200, 80)), (109, 68, (236, 110, 140)), (103, 71, (220, 70, 100)), (108, 71, (250, 240, 236))]:
        disc(cv, x, y, 1.6, c)
    cv.rect(104, 82, 2, 1, (220, 70, 100)); cv.rect(110, 86, 2, 1, (236, 110, 140))
    leaf_on(cv, 52, 58, outline=(90, 30, 24))                              # the only one who turned up
    snowfall(cv, rnd, 34, 6)
    finish(cv, rnd, tint=(70, 80, 150), tint_a=0.06, vig=0.5, bloom=(60, 50, 46, 0.16), grain=0.1)
    return cv


def s_bull(rnd):
    """Seeing Red: low and close on the bronze bull's lowered head, the red leaf stuck on its nose, its
    nostrils steaming; tourists' legs blurred behind"""
    cv = Canvas()
    sky(cv, COLD, 0, 40)
    soft_skyline(cv, 52, rnd, t=0.55, hmin=24, hmax=52)
    cv.rect(0, 52, W, 38, hz(P["pave2"], 0.3))
    for y in range(56, H, 4):
        cv.rect(0, y, W, 1, hz(P["pave"], 0.3))
    for x, c in [(2, (70, 82, 120)), (14, (60, 60, 70)), (100, (90, 70, 60)), (111, (70, 82, 120))]:
        cc = hz(c, 0.45)
        cv.rect(x, 26, 3, 50, cc); cv.rect(x + 4, 26, 3, 50, cc)
        cv.rect(x - 1, 74, 5, 2, hz((30, 30, 30), 0.4)); cv.rect(x + 4, 74, 5, 2, hz((30, 30, 30), 0.4))
        cv.rect(x - 1, 8, 10, 18, hz(rnd.choice([(150, 50, 50), (60, 90, 70), (200, 180, 140)]), 0.45))
    B, Bh, Bs, Bd = P["bronze"], P["bronzeHi"], P["bronzeSh"], (52, 34, 22)
    # head on, lowered to charge: the broad brow, the horns sweeping out and forward
    cv.ellipse(14, 40, 106, 120, Bs)                                       # the shoulders behind
    for side in (-1, 1):
        X = lambda v: 60 + side * v
        cv.line([(X(24), 26), (X(40), 22), (X(50), 14), (X(52), 4)], Bh if side < 0 else B, 6)
        cv.line([(X(50), 12), (X(52), 2)], (220, 196, 140), 3)
        cv.poly([(X(26), 30), (X(38), 30), (X(34), 38)], Bs)                # ears
    cv.poly([(30, 22), (90, 22), (94, 40), (82, 70), (74, 84), (46, 84), (38, 70), (26, 40)], B)
    cv.poly([(30, 22), (60, 22), (60, 84), (46, 84), (38, 70), (26, 40)], mix(B, Bh, 0.5))
    cv.poly([(84, 30), (94, 40), (82, 70), (76, 72)], Bs)
    cv.rect(34, 22, 52, 4, Bh)                                             # the curls of the brow
    for x in range(36, 84, 6):
        cv.put(x, 24, Bs)
    # furious brows and eyes
    cv.line([(38, 38), (52, 44)], Bd, 3); cv.line([(82, 38), (68, 44)], Bd, 3)
    cv.rect(44, 45, 5, 3, Bd); cv.rect(71, 45, 5, 3, Bd)
    cv.rect(45, 45, 2, 1, (250, 200, 120)); cv.rect(73, 45, 2, 1, (250, 200, 120))
    # the muzzle, rubbed shiny by every tourist, nostrils flared
    cv.ellipse(38, 64, 82, 90, Bs); cv.ellipse(38, 62, 82, 86, (180, 140, 80))
    cv.ellipse(44, 64, 70, 74, (226, 192, 124))
    cv.ellipse(45, 74, 53, 82, Bd); cv.ellipse(67, 74, 75, 82, Bd)
    # the leaf, stuck right on the bridge of its nose
    leaf_on(cv, 60, 70, outline=(70, 24, 18))
    # breath in the cold
    steam(cv, [(46, 84, 2), (40, 87, 3), (32, 89, 5), (22, 90, 7)], rnd, a0=0.8, a1=0.3)
    steam(cv, [(74, 84, 2), (80, 87, 3), (88, 89, 5), (98, 90, 7)], rnd, a0=0.8, a1=0.3)
    snowfall(cv, rnd, 22, 3)
    finish(cv, rnd, vig=0.42, bloom=(60, 58, 36, 0.14), grain=0.1)
    return cv


def s_cityhall(rnd):
    """Leaf of Absence: asleep on the ledge of City Hall's cupola, a BACK IN SPRING sign propped beside it,
    the flag drooping; grey winter light"""
    cv = Canvas()
    sky(cv, [(0, (156, 160, 168)), (1, (204, 206, 210))], 0, H)
    soft_skyline(cv, 92, rnd, t=0.6, hmin=14, hmax=34)
    S, S2, Hi = (214, 206, 186), (176, 166, 146), (232, 226, 210)
    cv.rect(50, 0, 70, 60, S)
    cv.rect(50, 0, 3, 60, Hi); cv.rect(60, 0, 2, 60, S2); cv.rect(116, 0, 4, 60, S2)
    disc(cv, 89, 28, 16, (150, 140, 120)); disc(cv, 89, 28, 14, (244, 240, 228))
    for k in range(12):
        a = k * math.pi / 6
        cv.put(89 + math.cos(a) * 12, 28 + math.sin(a) * 12, (60, 56, 60))
    cv.line([(89, 28), (89, 19)], (40, 36, 40), 2); cv.line([(89, 28), (96, 31)], (40, 36, 40), 1)
    cv.rect(0, 60, W, 2, Hi); cv.rect(0, 62, W, 6, S2)
    for x in range(1, W, 4):
        cv.rect(x, 66, 2, 2, (150, 140, 122))
    cv.rect(0, 68, W, 2, (140, 132, 116))
    cv.rect(0, 59, W, 1, (238, 240, 244))
    cv.rect(14, 2, 2, 58, (96, 96, 104)); disc(cv, 15, 2, 1.5, (210, 190, 110))
    for i in range(16):
        w = 9 - i // 4
        cv.rect(16, 4 + i, w, 1, (200, 50, 50) if (i // 2) % 2 == 0 else (240, 236, 230))
    cv.rect(16, 4, 4, 7, (50, 60, 120))
    cv.poly([(44, 58), (46, 42), (78, 42), (78, 58)], (150, 120, 80))
    cv.rect(45, 41, 33, 17, (246, 242, 230)); cv.rect(45, 41, 33, 1, (200, 190, 170))
    text(cv, 48, 44, "BACK IN", (60, 60, 90))
    text(cv, 50, 51, "SPRING", (196, 52, 46))
    leaf_on(cv, 26, 60, rot=90, outline=(110, 40, 30))
    snowfall(cv, rnd, 26, 4, 0, 60)
    finish(cv, rnd, tint=(150, 160, 175), tint_a=0.08, desat=0.2, vig=0.38, grain=0.1)
    return cv


def s_arch(rnd):
    """Arch Nemesis: on top of the Washington Square arch the leaf and a puffed-up pigeon face off; Fifth
    Avenue runs away behind them"""
    cv = Canvas()
    sky(cv, COLD, 0, 50)
    vx, vy = 60, 40
    cv.poly([(0, 60), (vx - 6, vy + 6), (vx + 6, vy + 6), (W, 60)], hz((110, 112, 120), 0.4))
    for side in (-1, 1):
        xs = 0 if side < 0 else W
        cv.poly([(xs, -4), (vx + side * 6, vy - 8), (vx + side * 6, vy + 6), (xs, 64)], hz(P["bldB"] if side < 0 else P["bldA"], 0.35))
        for i in range(9):
            f = 0.82 ** i
            x = vx + side * (6 + (abs(xs - vx) - 6) * f)
            top, bot = vy - 8 - (vy + 4) * f, vy + 6 + (58 - vy - 6) * f
            for k in range(1, 6):
                y = top + (bot - top) * k / 6
                cv.rect(x - (1 if f > 0.5 else 0), y, 2 if f > 0.5 else 1, 2 if f > 0.4 else 1, hz(P["win"], 0.35 + 0.3 * (1 - f)))
    for i in range(6):
        disc(cv, vx - 3 + i, vy + 4, 0.8, (255, 220, 160), 0.5)
    S, S2, Hi = (222, 214, 196), (190, 182, 164), (236, 230, 216)
    cv.poly([(0, 62), (W, 62), (W, H), (0, H)], S)
    cv.rect(0, 62, W, 2, Hi)
    for x0 in range(-80, 200, 22):
        cv.line([(vx + (x0 - vx) * 0.35, 62), (x0, H)], S2)
    for y in (70, 80):
        cv.rect(0, y, W, 1, S2)
    for _ in range(40):
        cv.put(rnd.randrange(W), rnd.randrange(64, H), (244, 246, 250))
    cv.rect(0, 61, W, 1, (240, 242, 246))
    leaf_on(cv, 36, 76, outline=(90, 30, 24))
    pigeon(cv, 82, 77, 2, puffed=True)
    snowfall(cv, rnd, 26, 4)
    finish(cv, rnd, vig=0.4, bloom=(58, 60, 40, 0.1), grain=0.1)
    return cv


def s_flatiron(rnd):
    """Pressing Matters: looking down off the very prow of the Flatiron at the leaf pressed flat on it;
    steam rises from the street far below as if off an iron, a cab passes"""
    cv = Canvas()
    t = 0.3
    cv.rect(0, 0, W, H, hz((96, 98, 106), t))
    for (x, y, w, h) in [(-4, -4, 30, 24), (92, -6, 32, 22), (-6, 48, 24, 44), (98, 44, 26, 50)]:
        cv.rect(x, y, w, h, hz((120, 128, 146), t))
        cv.rect(x + 6, y + 6, 4, 5, hz((140, 100, 70), t))
        for _ in range(8):
            cv.put(x + rnd.randrange(max(1, w)), y + rnd.randrange(max(1, h)), hz((236, 238, 244), t))
    for (x, y, w, h) in [(26, -4, 66, 3), (18, 22, 80, 3), (22, 44, 4, 50), (94, 40, 4, 50)]:
        cv.rect(x, y, w, h, hz((150, 146, 140), t))
    for x in range(32, 88, 4):
        cv.rect(x, 26, 2, 6, hz((226, 226, 222), t))
    cab(cv, 34, 16, 1)
    for x, y in [(22, 21), (48, 24), (88, 23), (95, 47), (24, 58)]:
        cv.rect(x, y, 1, 1, hz((40, 40, 50), t)); cv.put(x + 1, y + 1, hz((70, 70, 80), t))
    steam(cv, [(76, 10, 2), (74, 16, 3), (72, 24, 5), (74, 32, 7), (80, 42, 9), (88, 52, 11)], rnd, a0=0.8, a1=0.3)
    steam(cv, [(22, 32, 2), (25, 38, 4), (22, 48, 6), (16, 60, 8)], rnd, a0=0.7, a1=0.25)
    cv.poly([(60, 34), (30, 92), (90, 92)], (112, 104, 90))
    cv.poly([(60, 38), (36, 92), (84, 92)], (200, 188, 164))
    cv.line([(60, 38), (36, 92)], (164, 152, 128), 2); cv.line([(60, 38), (84, 92)], (150, 138, 116), 2)
    cv.line([(60, 36), (34, 92)], (232, 226, 210)); cv.line([(60, 36), (86, 92)], (226, 220, 204))
    cv.rect(54, 78, 12, 10, (170, 160, 140)); cv.rect(54, 78, 12, 2, (226, 220, 206))
    flat = leaf_im(2, 0, outline=(96, 30, 24))
    flat = flat.resize((flat.width + 8, flat.height - 6), Image.NEAREST)  # ironed flat
    stamp(cv, flat, 60, 56)
    finish(cv, rnd, vig=0.42, grain=0.1, bloom=(60, 54, 30, 0.1))
    return cv


def s_steps(rnd):
    """Stair Struck: the leaf on the glowing red steps in Times Square in the billboards' light, phone
    flashes going off in the crowd, a big screen behind reading LEAF"""
    cv = Canvas()
    sky(cv, NIGHT, 0, H)
    cv.rect(0, 0, 14, 44, hz((40, 110, 220), 0.45, (40, 30, 60)))
    cv.rect(106, 0, 14, 40, hz((230, 60, 160), 0.45, (40, 30, 60)))
    cv.rect(16, 2, 88, 32, (238, 116, 36)); cv.rect(16, 2, 88, 2, (255, 170, 80))
    text(cv, 60 - text_w("LEAF", 4) // 2, 8, "LEAF", (255, 244, 214), 4)
    glow(cv, 60, 18, 56, (255, 140, 60), 0.35)
    y, h = 40, 2
    while y < H:
        cv.rect(0, y, W, h, (232, 60, 52)); cv.rect(0, y, W, 1, (255, 150, 120))
        cv.rect(0, y + h, W, max(1, h // 2), (150, 24, 30))
        y += h + max(1, h // 2)
        h += 1
    for i in range(12):
        x = 4 + i * 10 + rnd.randint(-2, 2)
        yb = 40 + rnd.randint(0, 6)
        c = (66, 40, 64)
        disc(cv, x + 3, yb - 6, 3, c, 0.85); cv.rect(x - 1, yb - 4, 9, 7, c)
        if i % 2 == 0:
            cv.rect(x + 7, yb - 12, 2, 4, (110, 110, 140))
        if i in (2, 6, 10):
            glow(cv, x + 8, yb - 12, 9, (255, 255, 255), 0.6); cv.rect(x + 7, yb - 13, 2, 2, (255, 255, 255))
    glow(cv, 60, 70, 18, (255, 180, 120), 0.4)
    leaf_on(cv, 60, 73, outline=(255, 214, 170))
    finish(cv, rnd, tint=(160, 60, 120), tint_a=0.05, vig=0.5, grain=0.12)
    return cv


def s_column(rnd):
    """Leaf Erikson: on top of the Columbus Circle column by the statue's feet, a tiny flag planted; the
    twin glass towers behind"""
    cv = Canvas()
    sky(cv, COLD, 0, H)
    t = 0.45
    for (x0, x1, top0, top1) in [(70, 90, 14, 4), (94, 116, 22, 12)]:
        cv.poly([(x0, top0), (x1, top1), (x1, H), (x0, H)], hz((120, 140, 166), t))
        for x in range(x0 + 2, x1, 3):
            cv.rect(x, max(top0, top1) + 2, 1, H, hz((150, 170, 196), t))
        cv.line([(x0, top0), (x1, top1)], hz((200, 214, 230), t))
    cv.rect(60, 56, 60, 40, hz((130, 140, 156), 0.5))
    for x in range(0, 60, 9):
        tree(cv, x + 4, 72, 26, hz((70, 56, 50), 0.55), rnd, w=1)
    St, Sts, Sth = (186, 182, 172), (150, 146, 136), (214, 210, 200)
    cv.rect(10, 56, 48, 10, (168, 162, 150)); cv.rect(10, 56, 48, 1, Sth)
    cv.poly([(16, -2), (52, -2), (56, 56), (12, 56)], St)
    cv.poly([(40, -2), (52, -2), (56, 56), (44, 56)], Sts)
    for x in (22, 30, 38):
        cv.line([(x, 0), (x - 3, 50)], Sts)
    cv.rect(16, 48, 14, 8, (130, 126, 118)); cv.rect(34, 50, 14, 6, (130, 126, 118))
    cv.rect(16, 48, 14, 1, Sth)
    cv.rect(0, 66, W, 6, (222, 214, 196)); cv.rect(0, 72, W, 18, (188, 180, 160))
    cv.rect(0, 72, W, 1, (160, 152, 134)); cv.rect(0, 78, W, 1, (210, 202, 184))
    cv.rect(0, 65, W, 1, (242, 244, 248))
    disc(cv, 94, 68, 3, (240, 242, 246))
    cv.rect(94, 36, 1, 32, (86, 60, 40))
    cv.poly([(95, 36), (110, 40), (95, 44)], (222, 60, 48))
    leaf_on(cv, 78, 68, outline=(90, 30, 24))
    snowfall(cv, rnd, 24, 4)
    finish(cv, rnd, vig=0.4, bloom=(78, 56, 30, 0.12), grain=0.1)
    return cv


def s_maine(rnd):
    """Main Character: the gilded figure atop the Maine monument raises her arms, and there on her head is
    the leaf, posing; the park's bare trees behind"""
    cv = Canvas()
    sky(cv, COLD, 0, H)
    soft_skyline(cv, 70, rnd, t=0.55, hmin=20, hmax=48)
    for x in range(-4, W, 8):
        tree(cv, x, 92, rnd.randint(30, 44), hz((70, 56, 50), 0.5), rnd, w=2)
    G, Gh, Gs = (222, 176, 66), (255, 228, 140), (150, 104, 36)
    d = 18                                                                 # her, lower in the frame
    cv.poly([(40, 30 + d), (68, 30 + d), (80, 92), (28, 92)], G)
    cv.poly([(58, 30 + d), (68, 30 + d), (80, 92), (64, 92)], Gs)
    cv.poly([(40, 30 + d), (46, 30 + d), (36, 92), (28, 92)], Gh)
    for x in (48, 54, 60):
        cv.line([(x, 40 + d), (x - 2, 90)], Gs)
    cv.line([(42, 34 + d), (30, 20 + d), (24, 6 + d)], G, 5); cv.line([(41, 33 + d), (30, 20 + d)], Gh, 2)
    cv.line([(66, 34 + d), (78, 20 + d), (84, 6 + d)], Gs, 5)
    disc(cv, 24, 5 + d, 3, G); disc(cv, 84, 5 + d, 3, Gs)
    cv.ellipse(46, 16 + d, 62, 33 + d, G); cv.ellipse(46, 16 + d, 54, 31 + d, Gh)
    cv.ellipse(46, 14 + d, 62, 22 + d, Gs)
    for x, y in [(36, 66), (48, 40), (74, 80), (52, 70), (24, 22)]:
        cv.put(x, y, (255, 255, 240)); cv.blend(x - 1, y, (255, 255, 240), 0.5); cv.blend(x + 1, y, (255, 255, 240), 0.5)
    leaf_on(cv, 54, 16 + d, outline=(110, 40, 30))
    snowfall(cv, rnd, 20, 3)
    finish(cv, rnd, tint=(200, 160, 110), tint_a=0.04, vig=0.42, leak=("tr", (255, 190, 120), 0.35), grain=0.1)
    return cv


def s_cat(rnd):
    """Catnap: a ginger cat in the window swats at the leaf on the fire escape (its paw a blur)"""
    cv = Canvas()
    bricks(cv, 0, 0, W, H, hz((138, 74, 58), 0.2), hz((96, 56, 48), 0.2), rnd)
    window(cv, 6, 8, 40, 48, (60, 50, 46), (232, 190, 120))
    glow(cv, 26, 32, 30, (255, 200, 130), 0.35)
    cv.rect(6, 8, 8, 48, (196, 120, 90)); cv.rect(38, 8, 8, 48, (196, 120, 90))
    cv.rect(4, 56, 44, 3, (160, 150, 140))
    C1, C2, C3 = (220, 132, 58), (176, 92, 36), (244, 196, 140)
    cv.ellipse(12, 30, 40, 58, C1)
    for y in (36, 42, 48):
        cv.line([(16, y), (24, y + 2)], C2, 2)
    cv.ellipse(14, 18, 34, 38, C1)
    cv.poly([(15, 22), (17, 12), (23, 20)], C1); cv.poly([(26, 20), (32, 12), (33, 22)], C1)
    cv.poly([(17, 20), (18, 15), (21, 20)], (230, 150, 150))
    cv.rect(18, 26, 4, 2, (90, 160, 80)); cv.rect(26, 26, 4, 2, (90, 160, 80))
    cv.put(19, 26, (20, 20, 20)); cv.put(27, 26, (20, 20, 20))
    cv.ellipse(20, 30, 28, 36, C3); cv.put(24, 31, (200, 110, 110))
    for k, a in ((10, 0.25), (5, 0.45)):                                   # the swipe, blurred
        for x in range(36, 68 - k):
            for y in range(40, 46):
                cv.blend(x, y + (x - 36) * 0.3 - k * 0.2, C1, a)
    cv.line([(36, 44), (68, 52)], C1, 6)
    cv.ellipse(64, 46, 76, 56, C1); cv.ellipse(68, 50, 74, 55, (240, 170, 170))
    for x in (66, 69, 72, 75):
        cv.line([(x, 47), (x + 2, 44)], (250, 250, 250))
    I1, I2 = (44, 42, 48), (70, 68, 74)
    for x in range(52, W, 5):
        cv.rect(x, 34, 1, 26, I1)
    cv.rect(50, 34, 70, 2, I1)
    cv.rect(0, 60, W, 5, I1)
    for x in range(0, W, 3):
        cv.put(x, 61, I2)
    cv.rect(0, 59, W, 1, (236, 238, 244))
    cv.rect(0, 65, W, 25, hz((90, 80, 80), 0.4))
    for _ in range(14):
        cv.put(rnd.randrange(W), rnd.randrange(66, H), hz((230, 230, 236), 0.3))
    leaf_on(cv, 86, 60, outline=(90, 30, 24))
    snowfall(cv, rnd, 20, 3)
    finish(cv, rnd, vig=0.45, bloom=(76, 52, 30, 0.12), grain=0.1)
    return cv


def s_laundry(rnd):
    """Laundry Day: looking up between the tenements, the leaf pegged on the washing line with the socks"""
    cv = Canvas()
    sky(cv, [(0, (186, 194, 206)), (1, (214, 218, 224))], 0, H)
    for side in (-1, 1):
        pts = [(0, 0), (40, 0), (16, H), (0, H)] if side < 0 else [(W, 0), (80, 0), (104, H), (W, H)]
        cv.poly(pts, (126, 72, 58) if side < 0 else (110, 64, 54))
        for k in range(6):
            y = 6 + k * 15
            xe = 40 - 24 * y / H if side < 0 else 80 + 24 * y / H
            for j in range(2):
                x = (xe - 12 - j * 13) if side < 0 else (xe + 4 + j * 13)
                window(cv, x, y, 7, 9, (70, 46, 40), (70, 80, 100))
            cv.rect(xe - 28 if side < 0 else xe, y + 10, 28, 1, (40, 38, 44))
    pts = [(24, 28), (40, 38), (60, 42), (80, 38), (96, 26)]
    cv.line(pts, (220, 220, 220))
    cv.poly([(32, 34), (44, 39), (46, 56), (30, 54)], (90, 130, 190))
    cv.rect(26, 36, 6, 6, (90, 130, 190)); cv.rect(44, 39, 5, 6, (90, 130, 190))
    cv.rect(72, 39, 3, 9, (200, 60, 60)); cv.rect(72, 47, 5, 2, (200, 60, 60))
    cv.rect(78, 37, 3, 9, (240, 240, 236)); cv.rect(78, 45, 5, 2, (240, 240, 236))
    cv.rect(84, 34, 8, 14, (236, 196, 70))
    leaf_on(cv, 60, 66, rot=180, outline=(90, 30, 24))
    cv.rect(59, 38, 3, 8, (204, 168, 116)); cv.rect(59, 38, 1, 8, (232, 204, 156))
    snowfall(cv, rnd, 26, 5)
    finish(cv, rnd, vig=0.45, grain=0.1, bloom=(60, 54, 24, 0.1))
    return cv


def s_gobble(rnd):
    """Gobble Gobble: the giant parade turkey overhead, the leaf bouncing off its belly"""
    cv = Canvas()
    sky(cv, COLD, 0, H)
    cv.poly([(0, 0), (22, 0), (10, H), (0, H)], hz(P["bldB"], 0.3))
    cv.poly([(W, 0), (98, 0), (110, H), (W, H)], hz(P["bldA"], 0.3))
    for y in range(4, H, 7):
        cv.rect(2, y, 4, 3, hz(P["win"], 0.3)); cv.rect(112, y, 4, 3, hz(P["win"], 0.3))
    for i, c in enumerate([(200, 60, 40), (232, 130, 40), (240, 196, 70), (200, 60, 40)]):
        disc(cv, 70, 34, 42 - i * 6, c)
    for a in range(0, 180, 20):
        r = math.radians(a + 190)
        cv.line([(70, 34), (70 + math.cos(r) * 42, 34 + math.sin(r) * 42)], (170, 50, 30))
    cv.ellipse(30, 22, 102, 70, (150, 96, 56)); cv.ellipse(34, 24, 92, 56, (176, 118, 70))
    cv.ellipse(40, 56, 96, 72, (124, 78, 44))
    cv.line([(38, 40), (30, 26), (28, 16)], (150, 96, 56), 8)
    disc(cv, 26, 14, 8, (160, 104, 62))
    disc(cv, 24, 12, 3, (250, 250, 250)); disc(cv, 23, 13, 1.4, (20, 20, 20))
    cv.poly([(17, 16), (10, 18), (17, 20)], (240, 190, 60))
    cv.ellipse(16, 18, 22, 30, (210, 50, 50))
    for x in (44, 66, 88):
        cv.line([(x, 70), (x - 6, H)], (230, 230, 230))
    for i in range(6):
        cv.blend(64 + i * 3, 72 + (i - 3) ** 2 * 0.6, (250, 250, 255), 0.7)
    leaf_on(cv, 86, 86, outline=(90, 30, 24))
    for i in range(14):
        x = i * 9 + rnd.randint(0, 4)
        disc(cv, x, 92, 5, hz(rnd.choice([(60, 50, 60), (150, 50, 50), (60, 80, 120)]), 0.4))
    snowfall(cv, rnd, 20, 3)
    finish(cv, rnd, vig=0.4, grain=0.1, leak=("tl", (255, 210, 160), 0.25))
    return cv


def s_splash(rnd):
    """Making a Splash: a burst water main fountaining out of the street, the leaf caught in the spray"""
    cv = Canvas()
    sky(cv, COLD, 0, 50)
    soft_skyline(cv, 54, rnd, t=0.5, hmin=26, hmax=50)
    cv.rect(0, 54, W, 36, (70, 74, 86))
    for x in range(0, W, 14):
        cv.rect(x, 70, 7, 1, (200, 196, 150))
    for x in (12, 20, 98, 106):
        cv.poly([(x, 88), (x + 3, 74), (x + 6, 88)], (236, 110, 40)); cv.rect(x + 1, 80, 4, 2, (246, 246, 246))
    for y in range(8, 88):
        f = (88 - y) / 80
        w = 4 + f * 24 + math.sin(y * 0.4) * 2
        for x in range(int(60 - w), int(60 + w) + 1):
            a = 0.9 * (1 - (abs(x - 60) / (w + 1)) ** 2) * (0.7 + 0.3 * (1 - f))
            cv.blend(x, y, (220, 236, 246), a)
    for _ in range(140):
        a = rnd.uniform(0, math.pi)
        r = rnd.uniform(4, 40)
        cv.blend(60 + math.cos(a) * r * 1.2, 22 - math.sin(a) * r * 0.4 + r * 0.6, (236, 246, 252), 0.85)
    for x in range(30, 90, 2):
        cv.blend(x, 86 + rnd.randint(0, 3), (200, 220, 236), 0.5)
    leaf_on(cv, 62, 50, outline=(120, 40, 30))
    for _ in range(30):
        cv.blend(rnd.randrange(46, 78), rnd.randrange(30, 60), (240, 248, 252), 0.8)
    finish(cv, rnd, vig=0.4, grain=0.1, bloom=(62, 40, 34, 0.12))
    return cv


def s_kid(rnd):
    """Finders Keepers: a kid in a yellow raincoat in Central Park, mittens cupped round the leaf"""
    cv = Canvas()
    sky(cv, COLD, 0, 60)
    soft_skyline(cv, 52, rnd, t=0.65, hmin=12, hmax=30)
    for x in range(-4, W, 10):
        tree(cv, x, 66, rnd.randint(26, 40), hz((70, 56, 50), 0.5), rnd, w=2)
    cv.rect(0, 62, W, 28, (234, 238, 244))
    for _ in range(30):
        cv.put(rnd.randrange(W), rnd.randrange(62, H), (210, 218, 230))
    Y, Ys = (240, 198, 60), (204, 158, 34)
    cv.poly([(66, 40), (104, 40), (114, 92), (58, 92)], Y)
    cv.poly([(94, 40), (104, 40), (114, 92), (100, 92)], Ys)
    for y in (52, 64, 76):
        disc(cv, 80, y, 1.4, (120, 90, 40))
    disc(cv, 84, 28, 13, P["skin"])
    cv.ellipse(70, 10, 98, 26, (200, 50, 60)); disc(cv, 84, 9, 3, (240, 236, 236))
    cv.rect(72, 22, 26, 3, (170, 40, 50))
    cv.line([(76, 30), (78, 29), (80, 30)], (60, 40, 40)); cv.line([(86, 30), (88, 29), (90, 30)], (60, 40, 40))
    cv.line([(79, 35), (82, 37), (85, 35)], (170, 70, 70))
    disc(cv, 76, 33, 2, (240, 160, 150), 0.6); disc(cv, 90, 33, 2, (240, 160, 150), 0.6)
    cv.line([(68, 48), (54, 62)], Y, 7)
    leaf_on(cv, 46, 58, outline=(90, 30, 24))
    cv.ellipse(34, 56, 50, 68, (200, 50, 60)); cv.ellipse(46, 56, 62, 68, (180, 40, 52))
    steam(cv, [(76, 40, 1.5), (70, 40, 2.5), (63, 38, 3.5)], rnd, a0=0.55, a1=0.2)
    snowfall(cv, rnd, 24, 4)
    finish(cv, rnd, vig=0.4, grain=0.1, bloom=(50, 56, 34, 0.12))
    return cv


def ribbon(cv, pts, c, a=0.85, gap=2):
    for i in range(0, len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        n = max(1, int(math.hypot(x1 - x0, y1 - y0) / gap))
        for k in range(n):
            t = k / n
            cv.blend(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, c, a)


def canyon(cv, rnd, vx=60, vy=38, t=0.35):
    cv.poly([(0, H), (vx - 4, vy + 8), (vx + 4, vy + 8), (W, H)], hz((96, 98, 108), t))
    for side, col in ((-1, P["bldB"]), (1, P["bldA"])):
        xs = 0 if side < 0 else W
        cv.poly([(xs, -4), (vx + side * 4, vy - 10), (vx + side * 4, vy + 8), (xs, H)], hz(col, t))
        for i in range(10):
            f = 0.8 ** i
            x = vx + side * (4 + (abs(xs - vx) - 4) * f)
            for k in range(1, 8):
                top, bot = vy - 10 - (vy + 14) * f, vy + 8 + (H - vy - 8) * f
                y = top + (bot - top) * k / 8
                cv.rect(x, y, 2 if f > 0.45 else 1, 2 if f > 0.45 else 1, hz(P["winLit"] if rnd.random() < 0.15 else P["win"], t + 0.3 * (1 - f)))


def s_currents(rnd):
    """Current Affairs: down a street canyon a hidden current shows itself in a ribbon of snow; the leaf
    rides it"""
    cv = Canvas()
    sky(cv, COLD, 0, 40)
    canyon(cv, rnd)
    for off, a in ((-3, 0.5), (0, 0.85), (3, 0.5)):
        pts = [(x, 74 - 26 * math.sin((x + 10) / 40) - x * 0.2 + off) for x in range(-4, 124, 4)]
        ribbon(cv, pts, (246, 248, 252), a, gap=1.5)
        ribbon(cv, [(x, y + 1) for x, y in pts], (246, 248, 252), a * 0.5, gap=1.5)
    cv.rect(30, 58, 3, 2, (240, 236, 220))
    leaf_on(cv, 70, 56, outline=(90, 30, 24), rot=-15)
    snowfall(cv, rnd, 18, 3)
    finish(cv, rnd, vig=0.42, grain=0.1, bloom=(70, 48, 28, 0.1))
    return cv


def s_allcurrents(rnd):
    """Wind Whisperer: high over the roofs at dusk, every current in the city swirling round the leaf"""
    cv = Canvas()
    sky(cv, DUSK, 0, 64)
    x = -2
    while x < W:
        w, h = rnd.randint(6, 14), rnd.randint(4, 22)
        c = rnd.choice([(54, 58, 90), (64, 66, 100), (46, 50, 80)])
        cv.rect(x, 90 - h - 16, w, h + 30, c)
        for yy in range(90 - h - 14, H, 3):
            for xx in range(x + 1, x + w - 1, 3):
                if rnd.random() < 0.35:
                    cv.put(xx, yy, P["winLit"])
        x += w
    for k in range(6):
        a0 = k * math.pi / 3
        pts = []
        for i in range(60):
            t = i / 59
            r = 70 * (1 - t) + 9
            a = a0 + t * 3.2
            pts.append((60 + math.cos(a) * r * 1.2, 40 + math.sin(a) * r * 0.6))
        ribbon(cv, pts, (240, 236, 250), 0.75, gap=2.5)
    glow(cv, 60, 40, 22, (255, 220, 190), 0.35)
    leaf_on(cv, 60, 46, outline=(255, 214, 180))
    finish(cv, rnd, tint=(90, 80, 150), tint_a=0.05, vig=0.5, grain=0.1)
    return cv


def s_devil(rnd):
    """Spin Doctor: a dust devil whirling up out of a building site, the leaf riding near its top"""
    cv = Canvas()
    sky(cv, COLD, 0, 70)
    cv.line([(86, 6), (86, 62)], hz((230, 180, 60), 0.5), 2); cv.line([(60, 8), (116, 8)], hz((230, 180, 60), 0.5), 2)
    cv.line([(70, 8), (70, 20)], hz((90, 90, 90), 0.5))
    soft_skyline(cv, 62, rnd, t=0.6, hmin=8, hmax=24)
    cv.rect(0, 50, W, 16, (196, 170, 120))
    for x in range(0, W, 12):
        cv.rect(x, 50, 1, 16, (160, 136, 96))
    cv.rect(16, 53, 14, 9, (60, 120, 180)); cv.rect(84, 52, 12, 10, (220, 80, 60))
    cv.rect(0, 66, W, 24, (128, 104, 80))
    for _ in range(40):
        cv.put(rnd.randrange(W), rnd.randrange(66, H), rnd.choice([(150, 124, 96), (236, 238, 244)]))
    D = (200, 178, 140)
    for y in range(8, 88, 2):
        f = (88 - y) / 80
        w = 4 + f * f * 30
        cx = 52 + math.sin(y * 0.15) * 4
        for a in range(0, 360, 10):
            r = math.radians(a + y * 12)
            if math.sin(r) > -0.2:
                cv.blend(cx + math.cos(r) * w, y + math.sin(r) * 1.5, D, 0.65)
                cv.blend(cx + math.cos(r) * w, y + 1 + math.sin(r) * 1.5, (170, 146, 110), 0.35)
    for i in range(30):
        t = i / 30
        r = 6 + t * 26
        a = t * 14
        cv.rect(52 + math.cos(a) * r, 84 - t * 70, 2, 1, rnd.choice([(240, 240, 236), (180, 150, 110), (220, 80, 60)]))
    leaf_on(cv, 72, 24, outline=(90, 30, 24), rot=30)
    finish(cv, rnd, vig=0.42, grain=0.12, tint=(190, 170, 140), tint_a=0.04)
    return cv


def s_vent(rnd):
    """Mind the Gap: a blast of steam out of a subway grate, the leaf shooting up in it"""
    cv = Canvas()
    cv.rect(0, 0, W, 60, hz((110, 90, 80), 0.3))
    for x in (6, 64):
        window(cv, x, 10, 46, 36, hz((60, 50, 46), 0.3), hz((230, 190, 120), 0.3))
    cv.rect(0, 60, W, 30, (150, 146, 140))
    for y in range(60, H, 5):
        cv.rect(0, y, W, 1, (130, 126, 120))
    cv.poly([(34, 72), (86, 72), (96, 90), (24, 90)], (40, 40, 44))
    for x in range(26, 96, 3):
        cv.line([(60 + (x - 60) * 0.72, 72), (x, 90)], (90, 90, 96))
    for y in (76, 80, 85):
        cv.rect(24, y, 72, 1, (90, 90, 96))
    steam(cv, [(60, 84, 6), (58, 74, 8), (60, 62, 10), (62, 48, 12), (60, 34, 14), (58, 18, 16), (60, 2, 18)], rnd, a0=0.75, a1=0.4)
    cv.rect(6, 54, 4, 30, (40, 40, 50)); cv.rect(12, 54, 4, 30, (40, 40, 50)); cv.rect(4, 82, 7, 3, (20, 20, 24)); cv.rect(12, 82, 7, 3, (20, 20, 24))
    cv.rect(104, 50, 5, 34, (120, 70, 60)); cv.rect(110, 50, 5, 34, (120, 70, 60)); cv.rect(103, 82, 7, 4, (30, 24, 24)); cv.rect(110, 82, 7, 4, (30, 24, 24))
    leaf_on(cv, 60, 30, outline=(240, 240, 244), rot=10)
    for y in (32, 38, 44):
        cv.blend(56, y, (255, 255, 255), 0.6); cv.blend(64, y + 2, (255, 255, 255), 0.6)
    finish(cv, rnd, vig=0.42, grain=0.1, bloom=(60, 30, 30, 0.1))
    return cv


def s_cab(rnd):
    """Cab Surfer: a panning shot: the cab sharp, the street streaked behind, the leaf in its slipstream"""
    cv = Canvas()
    for y in range(0, 58):
        cv.rect(0, y, W, 1, hz(rnd.choice([P["bldA"], P["bldB"], P["bldC"], (150, 90, 70), (230, 200, 140)]), 0.35))
    for _ in range(40):
        cv.rect(rnd.randrange(-10, W), rnd.randrange(0, 58), rnd.randint(8, 30), 1, hz(rnd.choice([P["winLit"], (40, 44, 60), (220, 220, 230)]), 0.3))
    cv.rect(0, 58, W, 32, (84, 86, 96))
    for x in range(-10, W, 26):
        cv.rect(x, 80, 18, 1, (210, 206, 170))
    for _ in range(20):
        cv.rect(rnd.randrange(-10, W), rnd.randrange(60, H), rnd.randint(6, 20), 1, (100, 102, 112))
    cv.rect(44, 74, 62, 2, (50, 50, 60))
    cab(cv, 46, 75, 3)
    for y in (50, 54, 58, 62):
        cv.line([(2, y), (28, y)], (236, 238, 244))
    leaf_on(cv, 36, 64, outline=(90, 30, 24), rot=-30)
    finish(cv, rnd, vig=0.4, grain=0.1)
    return cv


def s_mole(rnd):
    """Mole Person: deep in a subway tunnel, a train's headlight coming, the leaf caught in the beam"""
    cv = Canvas()
    cv.rect(0, 0, W, H, (16, 18, 20))
    vx, vy = 64, 40
    for i in range(12):
        f = 0.78 ** i
        w, h = 70 * f + 3, 52 * f + 3
        cv.ellipse(vx - w, vy - h, vx + w, vy + h * 1.6, (40, 42, 40) if i % 2 == 0 else (30, 32, 32))
    cv.poly([(0, H), (vx - 3, vy + 5), (vx + 3, vy + 5), (W, H)], (36, 32, 30))
    for k in range(12):
        f = 0.8 ** k
        y = vy + 5 + (H - vy - 5) * f
        cv.rect(vx - 40 * f - 3, y, 80 * f + 6, 1, (60, 50, 42))
    for side in (-1, 1):
        cv.line([(vx + side * 2, vy + 5), (vx + side * 30, H)], (130, 130, 136))
    glow(cv, vx, vy + 1, 46, (255, 240, 190), 0.55)
    disc(cv, vx, vy + 1, 3.5, (255, 255, 240))
    for a in range(0, 360, 30):
        r = math.radians(a)
        cv.line([(vx, vy + 1), (vx + math.cos(r) * 14, vy + 1 + math.sin(r) * 8)], (255, 240, 200))
    leaf_on(cv, 36, 54, outline=(255, 226, 170))
    for _ in range(30):
        cv.blend(rnd.randrange(W), rnd.randrange(H), (200, 190, 170), 0.4)
    finish(cv, rnd, tint=(40, 80, 70), tint_a=0.08, vig=0.65, grain=0.18)
    return cv


def s_high(rnd):
    """Bird's Eye View: straight down from 150 m: snowy roofs and water towers, a pigeon far below the leaf"""
    cv = Canvas()
    cv.rect(0, 0, W, H, hz((96, 98, 106), 0.4))
    for bx in range(-6, W, 30):
        for by in range(-4, H, 24):
            for i in range(4):
                x, y = bx + 2 + (i % 2) * 13, by + 2 + (i // 2) * 10
                cv.rect(x, y, 12, 9, hz(rnd.choice([(120, 126, 140), (150, 120, 100), (130, 136, 146), (110, 112, 120)]), 0.4))
                if rnd.random() < 0.5:
                    disc(cv, x + rnd.randint(2, 9), y + rnd.randint(2, 6), 1.5, hz((140, 100, 70), 0.4))
                for _ in range(5):
                    cv.put(x + rnd.randrange(12), y + rnd.randrange(9), hz((240, 242, 246), 0.3))
    for _ in range(3):
        y = rnd.randrange(10, 80)
        for x in range(W):
            for k in range(-3, 4):
                cv.blend(x, y + k + math.sin(x / 9) * 2, (236, 238, 244), 0.18 * (1 - abs(k) / 4))
    pigeon(cv, 86, 72, 1, flip=True)
    leaf_on(cv, 38, 48, outline=(90, 30, 24), scale=3)
    finish(cv, rnd, vig=0.45, grain=0.1, bloom=(38, 32, 30, 0.1))
    return cv


def s_fast(rnd):
    """Speed of Leaf: everything a streak, the leaf a red blur over the street"""
    cv = Canvas()
    for y in range(0, 56):
        cv.rect(0, y, W, 1, hz(rnd.choice([P["bldA"], P["bldB"], P["bldC"], (140, 90, 70)]), 0.3))
    for _ in range(30):
        cv.rect(rnd.randrange(-10, W), rnd.randrange(0, 56), rnd.randint(14, 50), 1, hz(rnd.choice([P["winLit"], (40, 44, 60)]), 0.25))
    cv.rect(0, 56, W, 34, (80, 82, 92))
    for _ in range(20):
        cv.rect(rnd.randrange(-20, W), rnd.randrange(60, H), rnd.randint(16, 50), 1, rnd.choice([(242, 192, 44), (220, 220, 226), (120, 122, 132)]))
    for k in range(10):
        cv.rect(k * 7, 40 + (k % 3) - 1, 84 - k * 7, 1, mix((186, 58, 38), (214, 110, 58), k / 10))
    im = leaf_im(2, -90)
    for i, a in ((18, 0.2), (12, 0.35), (6, 0.55)):
        for yy in range(im.height):
            for xx in range(im.width):
                p = im.getpixel((xx, yy))
                if p[3]:
                    cv.blend(88 - im.width // 2 - i + xx, 40 - im.height // 2 + yy, p[:3], a)
    stamp(cv, leaf_im(2, -90, outline=(90, 30, 24)), 88, 40)
    for y in (28, 33, 47, 52):
        cv.rect(10, y, 50, 1, (236, 238, 244))
    finish(cv, rnd, vig=0.42, grain=0.1)
    return cv


def s_spin(rnd):
    """Spin Cycle: a corkscrew trail through the falling snow, the leaf at the end of it"""
    cv = Canvas()
    sky(cv, COLD, 0, H)
    soft_skyline(cv, 92, rnd, t=0.5, hmin=14, hmax=40)
    for i in range(200):
        t = i / 199
        x = 6 + t * 80
        r = 4 + t * 12
        y = 70 - t * 30 + math.sin(t * 6 * math.pi) * r
        front = math.cos(t * 6 * math.pi) > 0
        cv.blend(x, y, (250, 252, 255), 0.95 if front else 0.4)
        if front:
            cv.blend(x, y + 1, (250, 252, 255), 0.5)
    leaf_on(cv, 96, 52, outline=(90, 30, 24), rot=45)
    snowfall(cv, rnd, 30, 4)
    finish(cv, rnd, vig=0.4, grain=0.1, bloom=(90, 40, 26, 0.12))
    return cv


def s_loop(rnd):
    """Loop de Leaf: a loop-the-loop drawn in the air by drifting litter and snow, the leaf coming out of it"""
    cv = Canvas()
    sky(cv, COLD, 0, H)
    canyon(cv, rnd, 60, 50, t=0.45)
    pts = [(-4, 74), (20, 62), (36, 56)]
    for i in range(41):
        a = math.pi / 2 + i / 40 * math.pi * 2
        pts.append((50 - math.cos(a) * 18 + i * 0.4, 38 + math.sin(a) * 20))
    pts += [(80, 54), (98, 44)]
    ribbon(cv, pts, (248, 250, 252), 0.95, gap=1.2)
    ribbon(cv, [(x + 1, y + 1) for x, y in pts], (248, 250, 252), 0.5, gap=1.2)
    for i in range(0, len(pts) - 1, 3):
        x, y = pts[i]
        cv.rect(x + rnd.randint(-2, 2), y + rnd.randint(-2, 2), 2, 1, rnd.choice([(230, 226, 210), (160, 130, 90), (90, 140, 200)]))
    cv.poly([(26, 24), (32, 22), (34, 28), (28, 29)], (236, 236, 240))
    leaf_on(cv, 102, 50, outline=(90, 30, 24), rot=-20)
    finish(cv, rnd, vig=0.42, grain=0.1, bloom=(96, 40, 26, 0.1))
    return cv


def s_drop(rnd):
    """Drop It Like It's Hot: straight down a building's face, the leaf diving for the subway entrance
    and the warm air breathing out of it"""
    cv = Canvas()
    cv.rect(0, 0, W, H, (98, 100, 110))
    cv.poly([(0, 0), (W, 0), (84, 64), (36, 64)], (128, 90, 74))
    for k in range(9):
        f = 0.82 ** k
        y = 64 - 64 * f
        x0, x1 = 36 - 36 * f, 84 + 36 * f
        for j in range(6):
            x = x0 + (x1 - x0) * (j + 0.5) / 6
            cv.rect(x - 2 * f - 1, y + 2, max(1, 4 * f), max(1, 4 * f), (70, 80, 100))
    cv.rect(26, 64, 68, 26, (150, 146, 140))
    cv.rect(46, 72, 28, 14, (24, 20, 20))
    for y in range(74, 86, 3):
        cv.rect(48, y, 24, 1, (60, 52, 50))
    cv.rect(44, 70, 2, 16, (40, 90, 60)); cv.rect(74, 70, 2, 16, (40, 90, 60))
    disc(cv, 45, 68, 2.5, (120, 230, 140)); disc(cv, 75, 68, 2.5, (120, 230, 140))
    glow(cv, 45, 68, 8, (140, 255, 160), 0.4); glow(cv, 75, 68, 8, (140, 255, 160), 0.4)
    steam(cv, [(60, 78, 4), (58, 70, 6), (62, 60, 8)], rnd, a0=0.5, a1=0.15)
    for x in (52, 58, 64, 68):
        cv.line([(x, 8), (x, 26)], (236, 238, 244))
    leaf_on(cv, 60, 48, outline=(90, 30, 24), rot=180)
    finish(cv, rnd, vig=0.5, grain=0.1, bloom=(60, 66, 26, 0.12))
    return cv


def s_plant(rnd):
    """The Last Leaf: in the meadow's soil, the seed and the first tiny sprout; the old leaf beside it"""
    cv = Canvas()
    sky(cv, [(0, (178, 186, 200)), (1, (226, 222, 214))], 0, 50)
    soft_skyline(cv, 46, rnd, t=0.7, hmin=8, hmax=26)
    cv.rect(0, 46, W, 10, hz((200, 206, 214), 0.3))
    cv.rect(0, 56, W, 34, (86, 62, 44))
    cv.ellipse(10, 50, 110, 76, (96, 70, 50))
    for _ in range(90):
        cv.put(rnd.randrange(W), rnd.randrange(56, H), rnd.choice([(70, 50, 36), (110, 82, 58), (236, 238, 244)]))
    for x, y, w in [(4, 70, 18), (92, 74, 22), (30, 84, 14)]:
        cv.ellipse(x, y, x + w, y + 5, (234, 238, 244))
    cv.ellipse(50, 56, 64, 66, (132, 88, 48)); cv.ellipse(52, 57, 58, 61, (176, 128, 76))
    G1, G2 = (110, 180, 80), (150, 210, 110)
    cv.line([(57, 57), (57, 42)], G1, 2)
    cv.ellipse(46, 38, 57, 44, G1); cv.ellipse(57, 36, 68, 42, G2)
    leaf_on(cv, 88, 66, rot=90, outline=(90, 30, 24))
    finish(cv, rnd, vig=0.4, grain=0.1, leak=("tl", (255, 210, 150), 0.4), bloom=(58, 48, 26, 0.14))
    return cv


def s_mint(rnd):
    """Iron Leaf: the leaf, barely a mark on it, laid on a blacksmith's anvil in the snow, the hammer
    beside it and sparks still flying (it came through 8.8 km of city at 90% or better)"""
    cv = Canvas()
    sky(cv, COLD, 0, 50)
    for x in range(-4, W, 12):
        tree(cv, x, 50, rnd.randint(24, 34), hz((70, 56, 50), 0.55), rnd, w=1)
    cv.rect(0, 46, W, 44, (236, 240, 246))
    for _ in range(60):
        cv.put(rnd.randrange(W), rnd.randrange(48, H), (214, 222, 234))
    # the anvil: horn to the left, face, waist, foot
    D, M, L = (46, 48, 56), (78, 82, 92), (130, 136, 150)
    cv.poly([(22, 60), (40, 57), (40, 64), (30, 64)], M)                 # horn
    cv.rect(40, 56, 50, 9, M); cv.rect(40, 56, 50, 2, L)                # face, lit edge
    cv.rect(52, 65, 26, 8, D)                                            # waist
    cv.rect(44, 73, 42, 6, M); cv.rect(44, 73, 42, 1, L)                # foot
    cv.ellipse(38, 78, 92, 84, (204, 214, 228))                          # its shadow in the snow
    # the leaf on the face, crisp and whole
    leaf_on(cv, 64, 52, scale=2, outline=(110, 40, 30))
    # the hammer leaning on the anvil
    cv.line([(98, 80), (88, 58)], (120, 82, 50), 2)
    cv.rect(83, 54, 12, 6, D); cv.rect(83, 54, 12, 1, L)
    # sparks
    for _ in range(14):
        sparkle(cv, 64 + rnd.randint(-22, 22), 44 + rnd.randint(-14, 8), (255, 200, 110), 1)
    snowfall(cv, rnd, 14, 3)
    finish(cv, rnd, vig=0.38, grain=0.08, bloom=(64, 50, 40, 0.18))
    return cv


def s_quick(rnd):
    """Leaf Blower: a stopwatch on a park bench, stopped well inside fifteen minutes, the leaf beside it"""
    cv = Canvas()
    sky(cv, COLD, 0, 50)
    for x in range(-4, W, 12):
        tree(cv, x, 52, rnd.randint(28, 40), hz((70, 56, 50), 0.55), rnd, w=1)
    cv.rect(0, 46, W, 44, hz((220, 226, 234), 0.2))
    W1, W2 = (150, 100, 60), (112, 72, 42)
    for k, y in enumerate((52, 62, 73)):
        cv.rect(0, y, W, 8 + k, W1); cv.rect(0, y + 7 + k, W, 1, W2); cv.rect(0, y, W, 1, (180, 130, 84))
    cv.rect(4, 44, 6, 46, (40, 60, 44))
    cv.rect(0, 51, W, 1, (240, 242, 246))
    disc(cv, 54, 54, 15, (170, 172, 180)); disc(cv, 54, 54, 13, (246, 246, 240))
    cv.rect(52, 36, 5, 4, (170, 172, 180)); cv.rect(51, 34, 7, 2, (200, 202, 210))
    for k in range(12):
        a = k * math.pi / 6
        cv.put(54 + math.cos(a) * 11, 54 + math.sin(a) * 11, (40, 40, 50))
    cv.line([(54, 54), (54, 45)], (200, 40, 40)); cv.line([(54, 54), (60, 58)], (40, 40, 50))
    disc(cv, 54, 54, 1.2, (40, 40, 50))
    leaf_on(cv, 90, 66, outline=(90, 30, 24))
    snowfall(cv, rnd, 18, 3)
    finish(cv, rnd, vig=0.4, grain=0.1, bloom=(60, 52, 34, 0.14))
    return cv


SCENES = {
    "empire": (s_empire, "Don't Leave Me Waiting"), "bull": (s_bull, "Seeing Red"), "cityhall": (s_cityhall, "Leaf of Absence"),
    "arch": (s_arch, "Arch Nemesis"), "flatiron": (s_flatiron, "Pressing Matters"), "steps": (s_steps, "Stair Struck"),
    "column": (s_column, "Leaf Erikson"), "maine": (s_maine, "Main Character"),
    "cat": (s_cat, "Catnap"), "laundry": (s_laundry, "Laundry Day"), "gobble": (s_gobble, "Gobble Gobble"),
    "splash": (s_splash, "Making a Splash"), "kid": (s_kid, "Finders Keepers"),
    "currents": (s_currents, "Current Affairs"), "allcurrents": (s_allcurrents, "Wind Whisperer"), "devil": (s_devil, "Spin Doctor"),
    "vent": (s_vent, "Mind the Gap"), "cab": (s_cab, "Cab Surfer"), "mole": (s_mole, "Mole Person"),
    "high": (s_high, "Bird's Eye View"), "fast": (s_fast, "Speed of Leaf"), "spin": (s_spin, "Spin Cycle"),
    "loop": (s_loop, "Loop de Leaf"), "drop": (s_drop, "Drop It Like It's Hot"),
    "plant": (s_plant, "The Last Leaf"), "mint": (s_mint, "Iron Leaf"), "quick": (s_quick, "Leaf Blower"),
}


def make(name):
    fn, caption = SCENES[name]
    seed = sum(map(ord, name))
    cv = fn(random.Random(seed))
    return save_png(polaroid(cv.img, caption, seed), name)


# ---------------------------------------------------------------------------- the photo album's pixel art
def album_art():
    """public/achievements/album/: the cover, a tile of page paper, a photo corner and a page arrow, all at
    native size (the page scales them up with image-rendering: pixelated)"""
    r = random.Random(99)
    def save(im, name):
        os.makedirs(os.path.join(OUT, "album"), exist_ok=True)
        path = os.path.join(OUT, "album", name + ".png")
        im.save(path, optimize=True)
        return path
    # the cover: worn leather, stitched, an embossed maple leaf, the title in gold and a handwritten label
    cw, ch = 90, 120
    im = Image.new("RGBA", (cw, ch), (104, 62, 42, 255))
    px = im.load()
    for _ in range(900):
        x, y = r.randrange(cw), r.randrange(ch)
        px[x, y] = r.choice([(96, 56, 38, 255), (112, 68, 46, 255), (90, 52, 36, 255)])
    for y in range(ch):                                                   # the spine
        for x in range(0, 8):
            px[x, y] = (76, 42, 28, 255) if x < 7 else (60, 32, 22, 255)
    for y in (12, 14, ch - 15, ch - 13):
        for x in range(0, 7):
            px[x, y] = (122, 80, 54, 255)
    for (cx, cy) in ((cw - 1, 0), (cw - 1, ch - 1)):                      # scuffed corners
        for y in range(ch):
            for x in range(8, cw):
                d = math.hypot(x - cx, y - cy)
                if d < 9 and r.random() < (1 - d / 9) * 0.8:
                    px[x, y] = (150, 104, 70, 255)
    for x in range(13, cw - 5):                                           # the stitching
        if x % 3 != 2:
            px[x, 5] = px[x, ch - 6] = (206, 166, 112, 255)
    for y in range(6, ch - 6):
        if y % 3 != 2:
            px[13, y] = px[cw - 6, y] = (206, 166, 112, 255)
    gold, goldSh = (226, 186, 100, 255), (70, 38, 24, 255)
    cv = Canvas()
    cv.img, cv.px, cv.d = im.convert("RGB"), None, None
    title = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    tc = Canvas(); tc.img = Image.new("RGB", (cw, ch), (0, 0, 0)); tc.px = tc.img.load(); tc.d = ImageDraw.Draw(tc.img)
    for line, y in (("FAR FROM", 16), ("THE TREE", 23)):
        text(tc, 13 + (cw - 13 - text_w(line)) // 2, y, line, (255, 255, 255))
    for y in range(ch):
        for x in range(cw):
            if tc.px[x, y] != (0, 0, 0):
                px[x, y + 1] = goldSh
    for y in range(ch):
        for x in range(cw):
            if tc.px[x, y] != (0, 0, 0):
                px[x, y] = gold
    leaf = leaf_im(3)                                                     # the embossed leaf
    lx, ly = 13 + (cw - 13 - leaf.width) // 2, 36
    for y in range(leaf.height):
        for x in range(leaf.width):
            if leaf.getpixel((x, y))[3]:
                px[lx + x, ly + y] = (84, 46, 30, 255)
    for y in range(leaf.height):
        for x in range(leaf.width):
            if leaf.getpixel((x, y))[3] and not (x + 1 < leaf.width and y + 1 < leaf.height and leaf.getpixel((x + 1, y + 1))[3]):
                px[lx + x + 1, ly + y + 1] = (138, 90, 60, 255)
    lw = hand_width("My Journey") + 8                                     # the label
    x0, y0 = 13 + (cw - 13 - lw) // 2, 88
    for y in range(y0, y0 + 15):
        for x in range(x0, x0 + lw):
            px[x, y] = (240, 232, 212, 255) if r.random() > 0.06 else (226, 216, 194, 255)
    for x in range(x0, x0 + lw):
        px[x, y0 + 15] = (60, 34, 22, 255)
    hand(im, x0 + 4, y0 + 3, "My Journey", (40, 50, 108), 7)
    save(im, "cover")
    # page paper: cream, with fibres and specks (tiles seamlessly enough at this grain)
    pw = 40
    pp = Image.new("RGB", (pw, pw), (238, 229, 206))
    q = pp.load()
    for _ in range(170):
        x, y = r.randrange(pw), r.randrange(pw)
        q[x, y] = r.choice([(232, 223, 200), (242, 234, 213), (235, 226, 203)])
    for _ in range(6):
        x, y = r.randrange(pw), r.randrange(pw)
        for k in range(r.randint(2, 3)):
            q[(x + k) % pw, (y + k // 2) % pw] = (229, 219, 195)
    save(pp, "paper")
    # a photo corner (top left; the page rotates it for the others)
    co = Image.new("RGBA", (8, 8), (0, 0, 0, 0))
    for y in range(8):
        for x in range(8):
            if x + y < 7:
                co.putpixel((x, y), (46, 38, 34, 255))
            elif x + y == 7:
                co.putpixel((x, y), (110, 96, 86, 255))
    save(co, "corner")
    # a page arrow (pointing right; flipped for the other way)
    ar = Image.new("RGBA", (12, 12), (0, 0, 0, 0))
    shape = ["....##......", "....###.....", "....####....", "#########...", "##########..", "###########.",
             "###########.", "##########..", "#########...", "....####....", "....###.....", "....##......"]
    for y, row in enumerate(shape):
        for x, c in enumerate(row):
            if c == "#":
                edge = any(not (0 <= x + a < 12 and 0 <= y + b < 12 and shape[y + b][x + a] == "#") for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)))
                ar.putpixel((x, y), (66, 42, 28, 255) if edge else (242, 232, 206, 255))
    save(ar, "arrow")


if __name__ == "__main__":
    names = sys.argv[1:] or list(SCENES) + ["album"]
    total = 0
    if "album" in names:
        album_art()
        names.remove("album")
    for n in names:
        path = make(n)
        size = os.path.getsize(path)
        total += size
        print(f"{n:12s} {size / 1024:6.1f} KB")
    print(f"total {total / 1024:.1f} KB")
