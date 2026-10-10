"""Far From the Tree - the architecture kit's texture atlas, as editable Tesseract compositions.

Imported by build_buildings.py. One 2048 x 2048 design drawn twice from the same feature list:
    albedo   -> src/KitAtlas/albedo.tsrct
    mask     -> src/KitAtlas/mask.tsrct   (white = solid, black = cut out: chain-link, netting, grating, lattice)
post_kit.mjs packs them into web/public/models/buildings_kit.webp (RGBA) and copies kit_layout.json
next to it for kit_blender.py, which maps every face of the kit onto these named rects.

Two more tileable textures for the lots: lot_asphalt (8 m: parking stalls painted 2.7 m apart) and
site_dirt (8 m: churned clay, tyre ruts, gravel, puddles).

All lettering is the stroke font from facade_design.py and every name is invented.
"""
import math, random
from facade_design import Doc, mul, mix, GLYPH, HANZI

CHANNELS = "am"
AW = AH = 2048

# name -> (x, y, w, h) px, origin top-left. UV: u = x / 2048, v = 1 - y / 2048
R = {
    "staves": (0, 0, 512, 512), "tank_roof": (512, 0, 256, 256), "steel_black": (768, 0, 256, 256), "steel_rust": (1024, 0, 256, 256),
    "galv": (1280, 0, 256, 256), "hvac_top": (1536, 0, 256, 256), "hvac_side": (1792, 0, 256, 256),
    "chimney_brick": (512, 256, 256, 256), "stucco": (768, 256, 256, 256), "door_metal": (1024, 256, 128, 256), "tar_paper": (1152, 256, 256, 256),
    "awning": (1408, 256, 256, 256), "canopy": (1664, 256, 256, 256), "concrete": (1920, 256, 128, 256),
    "chainlink": (0, 512, 256, 256), "netting": (256, 512, 256, 256), "grating": (512, 512, 256, 256), "lattice": (768, 512, 512, 256),
    "plywood": (1280, 512, 256, 256), "plank": (1536, 512, 512, 64), "yellow_steel": (1536, 576, 256, 192), "solar": (1792, 576, 256, 192),
    "shed": (0, 768, 512, 256), "dumpster": (512, 768, 512, 256), "toilet": (1024, 768, 256, 512), "booth": (1280, 768, 256, 256),
    "parking_sign": (1536, 768, 512, 256), "skylight": (1280, 1024, 256, 256), "wood_deck": (1536, 1024, 256, 256), "coop": (1792, 1024, 256, 256),
    "ac_front": (0, 1024, 256, 192), "ac_side": (256, 1024, 256, 192), "cloth": (512, 1024, 512, 192),
}
for i in range(4):
    R["hoarding_%d" % i] = (256 * i, 1280, 256, 384)
for i in range(4):
    R["billboard_%d" % i] = (1024 + 512 * (i % 2), 1280 + 256 * (i // 2), 512, 256)
for i in range(6):
    R["blade_%d" % i] = (128 * i, 1664, 128, 384)
SWATCHES = {"black": (0.06, 0.06, 0.06), "white": (0.9, 0.9, 0.88), "grey": (0.45, 0.45, 0.44), "dark": (0.18, 0.18, 0.18),
            "red": (0.7, 0.12, 0.1), "yellow": (0.9, 0.7, 0.1), "glass": (0.2, 0.26, 0.3), "lamp": (1.0, 0.95, 0.8), "red_lamp": (1.0, 0.2, 0.15),
            "bronze": (0.42, 0.32, 0.18), "terracotta": (0.62, 0.32, 0.2), "cream": (0.88, 0.84, 0.74), "green": (0.16, 0.3, 0.2), "rubber": (0.03, 0.03, 0.03),
            "orange": (0.9, 0.42, 0.08), "blue": (0.15, 0.3, 0.6)}
for i, k in enumerate(SWATCHES):
    R["sw_" + k] = (768 + 64 * (i % 8), 1664 + 64 * (i // 8), 64, 64)


def layout_json():
    return {"size": [AW, AH], "rects": R, "swatches": ["sw_" + k for k in SWATCHES]}


class Atlas:
    """Draws into albedo and mask lists at once."""

    def __init__(self, seed):
        self.d = Doc(seed)
        self.rng = self.d.rng
        self.L = {"a": [], "m": []}

    def rect(self, x, y, w, h, a=None, m=(1, 1, 1), op=100, grad=None, blend="normal", round_=0.0):
        if a is not None or grad is not None:
            self.L["a"].append(self.d.rect(x, y, w, h, a or (1, 1, 1), op=op, grad=grad, blend=blend, round_=round_))
        if m is not None and blend == "normal":
            self.L["m"].append(self.d.rect(x, y, w, h, m, round_=round_))

    def poly(self, pts, a=None, m=(1, 1, 1), op=100, blend="normal"):
        if a is not None:
            self.L["a"].append(self.d.poly(pts, a, op=op, blend=blend))
        if m is not None and blend == "normal":
            self.L["m"].append(self.d.poly(pts, m))

    def line(self, pts, c, w, m=(1, 1, 1), op=100):
        self.L["a"].append(self.d.poly(pts, None, stroke=(c, w), closed=False, op=op))
        if m is not None:
            self.L["m"].append(self.d.poly(pts, None, stroke=(m, w), closed=False))

    def ellipse(self, cx, cy, w, h, a, m=(1, 1, 1), op=100):
        self.L["a"].append(self.d.ellipse(cx, cy, w, h, a, op=op))
        if m is not None:
            self.L["m"].append(self.d.ellipse(cx, cy, w, h, m))

    def noise(self, x, y, w, h, op=20, scale=30, kind="cloudy", seed=0, blend="overlay"):
        self.L["a"].append(self.d.noise(x, y, w, h, op=op, scale=scale, kind=kind, seed=seed, blend=blend))

    def text(self, s, x, y, h, c, width=None, maxw=None, vertical=False):
        """stroke-font lettering, baseline-centre at (x, y), cap height h px (vertical: stacked letters)"""
        unit = h / 6.0
        width = width or h * 0.12
        if vertical:
            for i, ch in enumerate(s):
                self._glyph(ch, x - (3 if ch in HANZI else 2) * unit, y + i * h * 1.25, unit, c, width)
            return
        hanzi = any(c_ in HANZI for c_ in s)
        adv = (7.0 if hanzi else 5.2) * unit
        w = len(s) * adv - (adv - (6 if hanzi else 4) * unit)
        k = min(1.0, maxw / w) if maxw else 1.0
        x0 = x - w * k / 2
        for i, ch in enumerate(s):
            self._glyph(ch, x0 + i * adv * k, y - h, unit, c, width, kx=k)

    def _glyph(self, ch, ox, oy, unit, c, width, kx=1.0):
        for st in HANZI.get(ch) or GLYPH.get(ch.upper()) or []:
            self.line([(ox + px * unit * kx, oy + py * unit) for px, py in st], c, width, m=None)

    def region(self, name):
        return R[name]


def build(A):
    rng = A.rng
    X = lambda n: R[n]
    # ---------------------------------------------------------------- water tank staves: weathered cedar, iron hoops drawn by the model
    x, y, w, h = X("staves")
    A.rect(x, y, w, h, (0.42, 0.33, 0.25))
    for i in range(24):
        sx = x + i * w / 24
        c = mul((0.46, 0.36, 0.27), rng.uniform(0.75, 1.15))
        A.rect(sx + 1, y, w / 24 - 2, h, c)
        A.rect(sx, y, 1.5, h, (0.18, 0.14, 0.11))
    A.noise(x, y, w, h, op=40, scale=8, kind="rocky", seed=3)
    A.noise(x, y, w, h, op=30, scale=40, seed=4)
    for _ in range(40):   # water stains running down from the hoops
        sx = x + rng.uniform(0, w)
        A.rect(sx, y + rng.uniform(0, h * 0.6), rng.uniform(3, 12), rng.uniform(40, 200), (0.2, 0.16, 0.12), op=rng.uniform(15, 35))
    A.rect(x, y + h * 0.85, w, h * 0.15, grad=A.d.lin(x, y + h * 0.85, x, y + h, [(0, (1, 1, 1)), (1, (0.45, 0.4, 0.36))]), blend="multiply")
    # ---------------------------------------------------------------- tank roof: tarred conical boards
    x, y, w, h = X("tank_roof")
    A.rect(x, y, w, h, (0.24, 0.20, 0.17))
    for i in range(16):
        A.rect(x + i * w / 16, y, 1.5, h, (0.12, 0.1, 0.09))
    A.noise(x, y, w, h, op=45, scale=10, kind="rocky", seed=5)
    # ---------------------------------------------------------------- painted steel, rust, galvanised
    for nm, base, rust in (("steel_black", (0.09, 0.09, 0.09), 0.25), ("steel_rust", (0.36, 0.18, 0.09), 1.0)):
        x, y, w, h = X(nm)
        A.rect(x, y, w, h, base)
        A.noise(x, y, w, h, op=35, scale=12, kind="rocky", seed=len(nm))
        for _ in range(int(30 * rust) + 6):
            A.ellipse(x + rng.uniform(0, w), y + rng.uniform(0, h), rng.uniform(4, 22), rng.uniform(3, 14), (0.42, 0.2, 0.08), op=rng.uniform(30, 70))
        for _ in range(10):
            A.rect(x + rng.uniform(0, w), y + rng.uniform(0, h * 0.5), rng.uniform(2, 5), rng.uniform(20, 90), (0.38, 0.18, 0.08), op=40)
    x, y, w, h = X("galv")
    A.rect(x, y, w, h, (0.62, 0.63, 0.62))
    A.noise(x, y, w, h, op=30, scale=6, kind="rocky", seed=8)
    A.noise(x, y, w, h, op=25, scale=40, seed=9)
    for _ in range(8):
        A.ellipse(x + rng.uniform(0, w), y + rng.uniform(0, h), rng.uniform(20, 60), rng.uniform(10, 30), (0.5, 0.5, 0.48), op=40)
    # ---------------------------------------------------------------- HVAC: fan grille top, louvred side
    x, y, w, h = X("hvac_top")
    A.rect(x, y, w, h, (0.66, 0.67, 0.66))
    A.ellipse(x + w / 2, y + h / 2, w * 0.86, h * 0.86, (0.1, 0.1, 0.1))
    for k in range(5):
        a = k / 5 * math.tau
        A.line([(x + w / 2, y + h / 2), (x + w / 2 + math.cos(a) * w * 0.38, y + h / 2 + math.sin(a) * h * 0.38)], (0.35, 0.35, 0.35), 14)
    for r_ in (0.18, 0.28, 0.38):
        pts = [(x + w / 2 + math.cos(t / 24 * math.tau) * w * r_, y + h / 2 + math.sin(t / 24 * math.tau) * h * r_) for t in range(25)]
        A.line(pts, (0.5, 0.5, 0.5), 2)
    A.ellipse(x + w / 2, y + h / 2, 28, 28, (0.3, 0.3, 0.3))
    x, y, w, h = X("hvac_side")
    A.rect(x, y, w, h, (0.68, 0.69, 0.68))
    for k in range(16):
        A.rect(x + 12, y + 14 + k * 14, w - 24, 6, (0.25, 0.25, 0.25))
    A.rect(x, y + h - 24, w, 24, (0.45, 0.45, 0.44))
    A.rect(x + 16, y + h - 60, 60, 26, (0.85, 0.85, 0.8))
    A.noise(x, y, w, h, op=20, scale=20, seed=11)
    # ---------------------------------------------------------------- chimney brick, stucco, door, tar paper
    x, y, w, h = X("chimney_brick")
    A.rect(x, y, w, h, (0.55, 0.53, 0.5))
    for r_ in range(int(h / 10)):
        off = (r_ % 2) * 12
        for c_ in range(-1, int(w / 24) + 1):
            A.rect(x + c_ * 24 + off + 1, y + r_ * 10 + 1, 22, 8, mul((0.55, 0.24, 0.17), rng.uniform(0.8, 1.15)))
    A.rect(x, y, w, h * 0.35, grad=A.d.lin(x, y, x, y + h * 0.35, [(0, (0.25, 0.23, 0.22)), (1, (1, 1, 1))]), blend="multiply")
    x, y, w, h = X("stucco")
    A.rect(x, y, w, h, (0.78, 0.76, 0.72))
    A.noise(x, y, w, h, op=35, scale=5, kind="rocky", seed=12)
    A.noise(x, y, w, h, op=30, scale=40, seed=13)
    for _ in range(6):
        A.rect(x + rng.uniform(0, w), y, rng.uniform(4, 14), rng.uniform(60, 200), (0.5, 0.48, 0.45), op=30)
    x, y, w, h = X("door_metal")
    A.rect(x, y, w, h, (0.36, 0.38, 0.38))
    A.rect(x + 8, y + 8, w - 16, h - 16, (0.42, 0.44, 0.44))
    A.rect(x + w - 26, y + h * 0.5, 12, 26, (0.75, 0.7, 0.55))
    A.rect(x + 20, y + 30, w - 40, 30, (0.85, 0.15, 0.1))
    A.text("EXIT", x + w / 2, y + 54, 18, (1, 1, 1), width=3)
    x, y, w, h = X("tar_paper")
    A.rect(x, y, w, h, (0.2, 0.2, 0.2))
    A.noise(x, y, w, h, op=45, scale=4, kind="rocky", seed=14)
    for k in range(4):
        A.rect(x, y + k * 64, w, 3, (0.1, 0.1, 0.1))
    # ---------------------------------------------------------------- fabric (tinted per instance): canvas weave, lighter valance band
    for nm in ("awning", "canopy"):
        x, y, w, h = X(nm)
        A.rect(x, y, w, h, (0.88, 0.88, 0.86))
        for k in range(0, w, 4):
            A.rect(x + k, y, 1, h, (0.8, 0.8, 0.78), op=50)
        for k in range(0, h, 4):
            A.rect(x, y + k, w, 1, (0.82, 0.82, 0.8), op=40)
        A.rect(x, y + h * 0.78, w, h * 0.22, (0.96, 0.96, 0.95))
        A.rect(x, y, w, h * 0.78, grad=A.d.lin(x, y, x, y + h * 0.78, [(0, (0.78, 0.78, 0.78)), (1, (1, 1, 1))]), blend="multiply")
        A.noise(x, y, w, h, op=20, scale=20, seed=len(nm) * 3)
    x, y, w, h = X("concrete")
    A.rect(x, y, w, h, (0.66, 0.65, 0.62))
    A.noise(x, y, w, h, op=40, scale=4, kind="rocky", seed=15)
    A.noise(x, y, w, h, op=30, scale=30, seed=16)
    # ---------------------------------------------------------------- cut-outs: chain-link, netting, grating, lattice
    x, y, w, h = X("chainlink")
    A.rect(x, y, w, h, (0.6, 0.62, 0.62), m=(0, 0, 0))
    s = 16
    for i in range(-16, 17):
        A.line([(x + i * s, y), (x + i * s + h, y + h)], (0.66, 0.68, 0.68), 2.2)
        A.line([(x + i * s + h, y), (x + i * s, y + h)], (0.58, 0.6, 0.6), 2.2)
    x, y, w, h = X("netting")
    A.rect(x, y, w, h, (0.2, 0.42, 0.62), m=(0, 0, 0))
    for k in range(0, w, 6):
        A.rect(x + k, y, 3, h, (0.2, 0.42, 0.62))
    for k in range(0, h, 6):
        A.rect(x, y + k, w, 3, (0.18, 0.4, 0.6))
    x, y, w, h = X("grating")
    A.rect(x, y, w, h, (0.08, 0.08, 0.08), m=(0, 0, 0))
    for k in range(0, w, 12):
        A.rect(x + k, y, 5, h, (0.1, 0.1, 0.1))
    for k in range(0, h, 40):
        A.rect(x, y + k, w, 5, (0.1, 0.1, 0.1))
    A.rect(x, y, w, 8, (0.1, 0.1, 0.1))
    A.rect(x, y + h - 8, w, 8, (0.1, 0.1, 0.1))
    x, y, w, h = X("lattice")   # crane mast / jib side: two chords and zig-zag bracing
    A.rect(x, y, w, h, (0.85, 0.65, 0.1), m=(0, 0, 0))
    A.rect(x, y, w, 18, (0.86, 0.66, 0.12))
    A.rect(x, y + h - 18, w, 18, (0.82, 0.62, 0.1))
    for k in range(9):
        x0 = x + k * w / 8
        A.line([(x0, y + 9), (x0 + w / 16, y + h - 9), (x0 + w / 8, y + 9)], (0.84, 0.64, 0.11), 9)
    A.noise(x, y, w, h, op=25, scale=10, kind="rocky", seed=17)
    # ---------------------------------------------------------------- plywood, scaffold plank, yellow steel, solar
    x, y, w, h = X("plywood")
    A.rect(x, y, w, h, (0.72, 0.58, 0.4))
    for k in range(30):
        yy = y + rng.uniform(0, h)
        A.line([(x, yy), (x + w * 0.4, yy + rng.uniform(-6, 6)), (x + w, yy + rng.uniform(-8, 8))], (0.62, 0.48, 0.32), rng.uniform(1, 3), op=60)
    A.noise(x, y, w, h, op=25, scale=15, seed=18)
    x, y, w, h = X("plank")
    A.rect(x, y, w, h, (0.6, 0.48, 0.32))
    for k in range(6):
        A.rect(x, y + k * h / 6, w, 1.5, (0.4, 0.3, 0.2), op=60)
    A.rect(x, y, 30, h, (0.65, 0.65, 0.65))
    A.rect(x + w - 30, y, 30, h, (0.65, 0.65, 0.65))
    x, y, w, h = X("yellow_steel")
    A.rect(x, y, w, h, (0.88, 0.66, 0.1))
    A.noise(x, y, w, h, op=30, scale=10, kind="rocky", seed=19)
    A.rect(x, y + h * 0.7, w, h * 0.3, grad=A.d.lin(x, y + h * 0.7, x, y + h, [(0, (1, 1, 1)), (1, (0.6, 0.55, 0.5))]), blend="multiply")
    x, y, w, h = X("solar")
    A.rect(x, y, w, h, (0.75, 0.75, 0.75))
    for i in range(6):
        for j in range(4):
            A.rect(x + 6 + i * (w - 12) / 6, y + 6 + j * (h - 12) / 4, (w - 12) / 6 - 3, (h - 12) / 4 - 3, (0.08, 0.12, 0.24))
    # ---------------------------------------------------------------- sidewalk shed plywood: hunter green, stencils
    x, y, w, h = X("shed")
    A.rect(x, y, w, h, (0.13, 0.27, 0.18))
    for k in range(4):
        A.rect(x + k * w / 4, y, 2, h, (0.08, 0.16, 0.1))
    A.noise(x, y, w, h, op=25, scale=20, seed=20)
    for k in range(2):
        A.text("POST NO BILLS", x + w * (0.25 + k * 0.5), y + h * 0.42, 20, (0.92, 0.92, 0.88), width=3)
    A.rect(x + w * 0.38, y + h * 0.58, w * 0.24, h * 0.3, (0.96, 0.96, 0.92))
    A.text("PERMIT", x + w * 0.5, y + h * 0.72, 12, (0.1, 0.1, 0.1), width=2)
    A.text("B-2214", x + w * 0.5, y + h * 0.84, 10, (0.1, 0.1, 0.1), width=2)
    # ---------------------------------------------------------------- dumpster, portable toilet, booth, parking sign
    x, y, w, h = X("dumpster")
    A.rect(x, y, w, h, (0.16, 0.32, 0.52))
    for k in range(6):
        A.rect(x + 20 + k * (w - 40) / 6, y, 8, h, (0.12, 0.25, 0.42))
    A.noise(x, y, w, h, op=35, scale=12, kind="rocky", seed=21)
    A.text("ACE ROLL-OFF", x + w / 2, y + h * 0.45, 26, (0.95, 0.95, 0.9), width=4)
    A.text("718 555 0199", x + w / 2, y + h * 0.7, 16, (0.95, 0.95, 0.9), width=3)
    for _ in range(14):
        A.ellipse(x + rng.uniform(0, w), y + rng.uniform(0, h), rng.uniform(6, 26), rng.uniform(4, 16), (0.45, 0.22, 0.1), op=55)
    x, y, w, h = X("toilet")
    A.rect(x, y, w, h, (0.15, 0.4, 0.62))
    A.rect(x + 30, y + 70, w - 60, h - 90, (0.18, 0.45, 0.68))
    A.rect(x, y, w, 50, (0.9, 0.9, 0.88))
    A.text("POTTY PALS", x + w / 2, y + 38, 18, (0.15, 0.4, 0.62), width=3)
    A.rect(x + w - 70, y + h * 0.5, 30, 14, (0.85, 0.2, 0.15))
    x, y, w, h = X("booth")
    A.rect(x, y, w, h, (0.9, 0.88, 0.8))
    A.rect(x + 20, y + 40, w - 40, h * 0.45, (0.25, 0.3, 0.34))
    A.rect(x, y, w, 30, (0.9, 0.7, 0.1))
    A.text("CASHIER", x + w / 2, y + 24, 16, (0.1, 0.1, 0.1), width=3)
    x, y, w, h = X("parking_sign")
    A.rect(x, y, w, h, (0.95, 0.95, 0.92))
    A.ellipse(x + 90, y + h / 2, 150, 150, (0.75, 0.1, 0.1))
    A.text("P", x + 90, y + h / 2 + 40, 80, (1, 1, 1), width=14)
    A.text("PARKING", x + 330, y + 95, 46, (0.75, 0.1, 0.1), width=7)
    A.text("$14 1HR  $32 DAY", x + 330, y + 160, 24, (0.1, 0.1, 0.1), width=4)
    A.text("OPEN 24 HRS", x + 330, y + 210, 22, (0.1, 0.1, 0.1), width=4)
    # ---------------------------------------------------------------- skylight, deck boards, coop, AC unit, laundry
    x, y, w, h = X("skylight")
    A.rect(x, y, w, h, (0.3, 0.32, 0.3))
    for i in range(3):
        for j in range(2):
            A.rect(x + 10 + i * (w - 20) / 3, y + 10 + j * (h - 20) / 2, (w - 20) / 3 - 8, (h - 20) / 2 - 8,
                   grad=A.d.lin(x, y, x + w, y + h, [(0, (0.5, 0.58, 0.62)), (1, (0.22, 0.26, 0.3))]))
    A.noise(x, y, w, h, op=30, scale=8, kind="rocky", seed=22)
    x, y, w, h = X("wood_deck")
    for k in range(10):
        A.rect(x, y + k * h / 10, w, h / 10 - 3, mul((0.5, 0.38, 0.26), rng.uniform(0.8, 1.1)))
    A.noise(x, y, w, h, op=25, scale=8, kind="rocky", seed=23)
    x, y, w, h = X("coop")
    for k in range(12):
        A.rect(x + k * w / 12, y, w / 12 - 3, h, mul((0.62, 0.5, 0.36), rng.uniform(0.8, 1.1)))
    A.rect(x + w * 0.3, y + h * 0.3, w * 0.4, h * 0.5, (0.15, 0.15, 0.15), m=(1, 1, 1))
    for k in range(10):
        A.rect(x + w * 0.3 + k * w * 0.04, y + h * 0.3, 2, h * 0.5, (0.7, 0.7, 0.7))
    x, y, w, h = X("ac_front")
    A.rect(x, y, w, h, (0.86, 0.84, 0.78))
    A.rect(x + 14, y + 16, w * 0.62, h - 32, (0.3, 0.3, 0.29))
    for k in range(14):
        A.rect(x + 14, y + 20 + k * (h - 40) / 14, w * 0.62, 3, (0.6, 0.6, 0.58))
    A.rect(x + w * 0.72, y + 20, w * 0.22, 40, (0.75, 0.73, 0.68))
    for k in range(3):
        A.ellipse(x + w * 0.8 + k * 14, y + 40, 8, 8, (0.4, 0.4, 0.4))
    A.text("COOLMAX", x + w * 0.83, y + h - 30, 10, (0.3, 0.3, 0.3), width=2)
    A.rect(x, y + h - 20, w, 20, grad=A.d.lin(x, y + h - 20, x, y + h, [(0, (1, 1, 1)), (1, (0.5, 0.45, 0.4))]), blend="multiply")
    x, y, w, h = X("ac_side")
    A.rect(x, y, w, h, (0.8, 0.78, 0.72))
    for k in range(10):
        A.rect(x + 20, y + 20 + k * (h - 40) / 10, w - 40, 5, (0.5, 0.5, 0.48))
    A.rect(x, y, w, h, grad=A.d.lin(x, y, x, y + h, [(0, (1, 1, 1)), (1, (0.62, 0.56, 0.5))]), blend="multiply")
    x, y, w, h = X("cloth")
    cols = [(0.78, 0.22, 0.16), (0.94, 0.92, 0.88), (0.16, 0.35, 0.6), (0.88, 0.7, 0.14), (0.22, 0.54, 0.29), (0.82, 0.48, 0.64), (0.5, 0.5, 0.5), (0.1, 0.1, 0.1)]
    for i, c in enumerate(cols):
        A.rect(x + i * w / 8, y, w / 8, h, c)
        A.rect(x + i * w / 8, y, w / 8, h, grad=A.d.lin(x, y, x, y + h, [(0, (0.85, 0.85, 0.85)), (1, (1, 1, 1))]), blend="multiply")
    # ---------------------------------------------------------------- construction hoardings: painted plywood with posters (invented)
    paints = [(0.18, 0.36, 0.55), (0.18, 0.4, 0.3), (0.88, 0.86, 0.8), (0.22, 0.24, 0.27)]
    posters = [("LIVE AT 8", (0.95, 0.85, 0.2)), ("NEW ALBUM", (0.95, 0.4, 0.3)), ("COMEDY", (0.3, 0.75, 0.95)), ("SALE", (0.95, 0.95, 0.95)),
               ("JAZZ NITE", (0.75, 0.3, 0.85)), ("LOFTS", (0.4, 0.8, 0.5)), ("FILM FEST", (0.95, 0.6, 0.15)), ("NOW OPEN", (0.95, 0.3, 0.5))]
    for i in range(4):
        x, y, w, h = X("hoarding_%d" % i)
        A.rect(x, y, w, h, paints[i])
        A.rect(x, y, 3, h, mul(paints[i], 0.7))
        A.noise(x, y, w, h, op=25, scale=20, seed=30 + i)
        if i != 2:
            for k in range(rng.randint(2, 4)):
                t, c = rng.choice(posters)
                px, py = x + rng.uniform(10, w - 110), y + rng.uniform(60, h - 200)
                pw, ph = rng.uniform(80, 110), rng.uniform(120, 160)
                A.rect(px, py, pw, ph, c)
                A.rect(px + 6, py + 6, pw - 12, ph * 0.5, mul(c, 0.7))
                A.text(t, px + pw / 2, py + ph * 0.8, 12, (0.08, 0.08, 0.08), width=2.2, maxw=pw - 10)
                if rng.random() < 0.5:   # torn corner
                    A.poly([(px + pw, py + ph), (px + pw - 30, py + ph), (px + pw, py + ph - 40)], paints[i])
        A.text("POST NO BILLS", x + w / 2, y + h - 40, 16, (0.95, 0.95, 0.9) if i != 2 else (0.1, 0.1, 0.1), width=3)
        if rng.random() < 0.8:   # a tag
            pts = [(x + rng.uniform(20, 60), y + rng.uniform(220, 300))]
            for _ in range(7):
                pts.append((pts[-1][0] + rng.uniform(12, 30), pts[-1][1] + rng.uniform(-20, 20)))
            A.line(pts, rng.choice([(0.9, 0.2, 0.2), (0.1, 0.1, 0.1), (0.95, 0.85, 0.2)]), 5)
    # ---------------------------------------------------------------- billboards (invented products)
    ads = [("FRESH MINT GUM", "CHEW THE CITY", (0.1, 0.6, 0.5), (1, 1, 1)), ("BIG APPLE SODA", "ICE COLD", (0.85, 0.12, 0.12), (1, 0.95, 0.8)),
           ("THE PIGEON", "IN THEATRES FRIDAY", (0.08, 0.08, 0.1), (0.95, 0.75, 0.2)), ("LEAF AIR", "FLY LIGHTER", (0.95, 0.6, 0.1), (0.1, 0.1, 0.1))]
    for i, (t1, t2, bg, fg) in enumerate(ads):
        x, y, w, h = X("billboard_%d" % i)
        A.rect(x, y, w, h, bg)
        A.rect(x, y, w, h, grad=A.d.lin(x, y, x + w, y + h, [(0, mix(bg, (1, 1, 1), 0.2)), (1, mul(bg, 0.7))]))
        A.ellipse(x + w * 0.8, y + h * 0.45, h * 0.7, h * 0.7, mix(bg, fg, 0.3))
        A.text(t1, x + w * 0.4, y + h * 0.48, 34, fg, width=6, maxw=w * 0.7)
        A.text(t2, x + w * 0.4, y + h * 0.75, 18, mix(fg, bg, 0.2), width=3.5, maxw=w * 0.7)
        A.rect(x, y, w, 6, (0.9, 0.9, 0.9))
    # ---------------------------------------------------------------- blade signs (vertical, glowing)
    blades = [("HOTEL", (0.08, 0.1, 0.25), (1, 0.85, 0.4)), ("BAR", (0.6, 0.05, 0.08), (1, 0.9, 0.85)), ("PAWN", (0.05, 0.25, 0.12), (0.95, 0.9, 0.3)),
              ("金山", (0.75, 0.08, 0.06), (1, 0.85, 0.2)), ("DINER", (0.1, 0.1, 0.1), (0.3, 0.9, 1.0)), ("大中", (0.85, 0.66, 0.1), (0.7, 0.05, 0.05))]
    for i, (t, bg, fg) in enumerate(blades):
        x, y, w, h = X("blade_%d" % i)
        A.rect(x, y, w, h, bg)
        A.rect(x + 6, y + 6, w - 12, h - 12, None or mix(bg, (1, 1, 1), 0.06))
        n = len(t)
        hh = min(56.0, (h - 40) / (n * 1.25))
        A.text(t, x + w / 2, y + 26 + hh * 0.2, hh, fg, width=hh * 0.16, vertical=True)
        for k in range(10):   # bulbs around the edge
            A.ellipse(x + 10, y + 20 + k * (h - 40) / 9, 8, 8, (1, 0.95, 0.7))
            A.ellipse(x + w - 10, y + 20 + k * (h - 40) / 9, 8, 8, (1, 0.95, 0.7))
    # ---------------------------------------------------------------- swatches
    for k, c in SWATCHES.items():
        x, y, w, h = X("sw_" + k)
        A.rect(x, y, w, h, c)


def doc(ch):
    A = Atlas(77)
    build(A)
    label = {"a": "albedo", "m": "mask"}[ch]
    panel = A.d.group("kit %s" % label, AW, AH, A.L[ch])
    return {"$schema": "https://jerboa.dev/schemas/fx-composition/editable/v1/document.schema.json", "formatVersion": 1,
            "dimensions": {"width": AW, "height": AH}, "duration": 3.0, "backgroundColor": [0.5, 0.5, 0.5, 1.0] if ch == "a" else [1, 1, 1, 1],
            "composition": {"id": "main", "name": "Kit atlas %s" % label, "layers": [panel]}}


# ------------------------------------------------------------------------------------ lot surfaces (tileable 8 m, 512 px)

def lot_doc(kind):
    d = Doc(91 if kind == "asphalt" else 92)
    rng = d.rng
    S = 512
    L = []
    if kind == "asphalt":
        L.append(d.rect(0, 0, S, S, (0.27, 0.27, 0.27)))
        L.append(d.noise(0, 0, S, S, op=45, scale=3, kind="rocky", seed=1))
        L.append(d.noise(0, 0, S, S, op=35, scale=60, seed=2))
        for _ in range(8):   # oil stains in the middle of each stall
            L.append(d.ellipse(rng.uniform(0, S), rng.uniform(80, 430), rng.uniform(30, 70), rng.uniform(40, 90), (0.12, 0.12, 0.12), op=rng.uniform(30, 55)))
        # stall lines every 2.7 m (S / 8 m * 2.7 = 172.8 px: three stalls per tile, 5.5 m deep)
        for k in range(3):
            x = k * S / 3
            L.append(d.rect(x - 4, 60, 8, 352, (0.85, 0.83, 0.75), op=80))
        L.append(d.rect(0, 0, S, 8, (0.85, 0.83, 0.75), op=55))
        L.append(d.noise(0, 0, S, S, op=20, scale=5, kind="rocky", seed=3))
        for _ in range(6):   # cracks
            x, y = rng.uniform(0, S), rng.uniform(0, S)
            pts = [(x, y)]
            for _ in range(8):
                pts.append((pts[-1][0] + rng.uniform(-20, 20), pts[-1][1] + rng.uniform(-20, 20)))
            L.append(d.poly(pts, None, stroke=((0.12, 0.12, 0.12), 1.5), closed=False))
    else:
        L.append(d.rect(0, 0, S, S, (0.42, 0.34, 0.26)))
        L.append(d.noise(0, 0, S, S, op=50, scale=4, kind="rocky", seed=4))
        L.append(d.noise(0, 0, S, S, op=40, scale=70, seed=5))
        for k in range(3):   # tyre ruts
            x = rng.uniform(0, S)
            pts = [(x + math.sin(t / 8 * math.pi) * 40, t * S / 8) for t in range(9)]
            L.append(d.poly(pts, None, stroke=((0.28, 0.22, 0.17), 18), closed=False, op=70))
            L.append(d.poly([(p[0] + 34, p[1]) for p in pts], None, stroke=((0.28, 0.22, 0.17), 18), closed=False, op=70))
        for _ in range(5):   # gravel patches
            L.append(d.ellipse(rng.uniform(0, S), rng.uniform(0, S), rng.uniform(60, 160), rng.uniform(40, 120), (0.55, 0.53, 0.5), op=55))
        for _ in range(4):   # puddles
            L.append(d.ellipse(rng.uniform(0, S), rng.uniform(0, S), rng.uniform(30, 80), rng.uniform(20, 50), (0.2, 0.22, 0.24), op=75))
    panel = d.group("lot %s" % kind, S, S, L)
    return {"$schema": "https://jerboa.dev/schemas/fx-composition/editable/v1/document.schema.json", "formatVersion": 1,
            "dimensions": {"width": S, "height": S}, "duration": 3.0, "backgroundColor": [0.5, 0.5, 0.5, 1.0],
            "composition": {"id": "main", "name": "Lot %s" % kind, "layers": [panel]}}
