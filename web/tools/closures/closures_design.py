"""Far From the Tree - the street closures' textures, authored as editable Tesseract compositions.

Imported by build_closures.py. Each entry in DOCS becomes tools/closures/tesseract/<Name>/<Name>.tsrct (the editable
source) and a rendered <Name>.png; closures_blender.py turns them into web/public/textures/closures/*.

  Hoarding  1024x512 RGB    raw MDF / plywood site hoarding, one tile = four 1.22 x 2.44 m sheets (4.88 x 2.44 m):
                            pale tan board, every sheet a slightly different tone, seams, rows of screw heads over the
                            studs, stencilled spray paint (POST NO BILLS, a permit number), an orange survey mark,
                            a couple of torn fly-posters pasted on (invented), grime splashed up from the street.
  Netting   256x256 RGBA    green debris netting over one scaffold bay (2.5 x 2 m): the knit, the tubes showing
                            through, a sun-faded seam; alpha so the scaffold reads behind it.

All branding is invented: no real logos, agencies or companies.
"""
import math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "street"))
from street_design import Doc, mul, mix, grime, scratches, chips, FONT_FILES, FONT_STYLE  # noqa: E402

TAN = (0.80, 0.66, 0.47)


def hoarding_doc(fonts):
    d = Doc(4881, fonts)
    W, H = 1024, 512
    r = d.rng
    L = [d.rect(0, 0, W, H, TAN, name="board")]
    sw = W / 4
    for i in range(4):
        # each sheet its own tone: some fresh and pale, one weathered darker, one with a greyish cast
        tone = mix(TAN, r.choice([(0.86, 0.73, 0.55), (0.72, 0.57, 0.40), (0.78, 0.68, 0.52), (0.83, 0.67, 0.45)]), 0.8)
        L.append(d.rect(i * sw, 0, sw, H, tone, name="sheet"))
        # the board's fibre: faint long streaks
        for _ in range(26):
            x = i * sw + r.random() * sw
            L.append(d.line([(x, 0), (x + (r.random() - 0.5) * 10, H)], mul(tone, 0.9 + r.random() * 0.15), 1 + r.random() * 3, op=30))
        # rain streaks down from the top edge
        for _ in range(5):
            x = i * sw + 10 + r.random() * (sw - 20)
            L.append(d.line([(x, 0), (x + (r.random() - 0.5) * 4, 60 + r.random() * 160)], mul(tone, 0.72), 4 + r.random() * 6, op=28, effects=[d.blur(3)]))
    L.append(d.noise(W, H, op=22, scale=18, seed=2.0))
    L.append(d.noise(W, H, op=14, scale=90, kind="cloudy", seed=7.0, blend="multiply", contrast=40))
    # seams between the sheets and along the top and bottom rails
    for i in range(5):
        x = min(W - 2, i * sw)
        L.append(d.rect(x - 2, 0, 4, H, (0.32, 0.25, 0.17), op=85, name="seam"))
        L.append(d.rect(x + 2, 0, 2, H, mul(TAN, 1.12), op=50))
    for y in (0, H - 6):
        L.append(d.rect(0, y, W, 6, (0.36, 0.28, 0.19), op=70))
    # screw heads: down each edge and over the middle stud, every ~30 px (300 mm)
    for i in range(4):
        for xx in (i * sw + 12, i * sw + sw / 2, i * sw + sw - 12):
            for y in range(16, H - 8, 30):
                L.append(d.ellipse(xx, y + (r.random() - 0.5) * 2, 4.5, 4.5, (0.28, 0.26, 0.24), op=85))
                L.append(d.ellipse(xx - 0.8, y - 0.8, 2, 2, (0.62, 0.6, 0.56), op=70))
    # stencilled spray paint
    L.append(d.text(128, 150, "POST NO BILLS", 32, (0.08, 0.08, 0.08), font="impact", tracking=40, op=88))
    L.append(d.text(640, 150, "POST NO BILLS", 32, (0.08, 0.08, 0.08), font="impact", tracking=40, op=82))
    L.append(d.text(896, 430, "BIN 1093-77 / PERMIT 12-0451", 17, (0.08, 0.08, 0.08), font="bahn", tracking=10, op=75))
    L.append(d.text(384, 470, "NO STANDING · SITE ACCESS", 20, (0.85, 0.15, 0.08), font="impact", tracking=20, op=70))
    # an orange survey mark and an arrow
    L.append(d.line([(600, 440), (650, 440)], (0.98, 0.45, 0.05), 8, op=80))
    L.append(d.line([(640, 425), (654, 440), (640, 455)], (0.98, 0.45, 0.05), 8, op=80))
    L.append(d.text(620, 418, "W/M", 22, (0.98, 0.45, 0.05), font="impact", op=80))
    # torn fly-posters (invented gigs and lost-cat notices), corners ripped
    for (x, y, w, h, c, t1, t2, rot) in [(300, 220, 118, 168, (0.95, 0.88, 0.25), "THE PIGEONS", "LIVE · FRI", -4),
                                          (420, 236, 112, 150, (0.9, 0.3, 0.25), "LOST CAT", "ANSWERS TO MO", 3),
                                          (760, 200, 124, 176, (0.25, 0.45, 0.8), "WINTER", "WAREHOUSE SALE", -2)]:
        pts = [(x, y), (x + w, y + 4), (x + w - 6, y + h * 0.6), (x + w - 22, y + h * 0.55), (x + w - 8, y + h), (x + 4, y + h - 3), (x + 10, y + h * 0.3)]
        L.append(d.poly(pts, mix(c, (0.95, 0.93, 0.88), 0.25), op=92, name="poster"))
        L.append(d.text(x + w / 2, y + 44, t1, 20, (0.1, 0.1, 0.1), font="impact", op=85))
        L.append(d.text(x + w / 2, y + 74, t2, 13, (0.12, 0.12, 0.12), font="arial", op=80))
        for k in range(4):
            L.append(d.rect(x + 14, y + 92 + k * 12, w - 34 - r.random() * 20, 4, (0.25, 0.25, 0.25), op=50))
        L.append(d.poly([(x + w - 22, y + h * 0.55), (x + w - 6, y + h * 0.6), (x + w - 14, y + h * 0.72)], mul(c, 0.7), op=60))  # the torn flap
    L += scratches(d, W, H, 40, (0.4, 0.32, 0.22), op=35)
    L += chips(d, W, H, 18, (0.55, 0.45, 0.32), op=50, s=4)
    L += grime(d, W, H, 38)
    return W, H, TAN + (1,), L, d


def netting_doc(fonts):
    d = Doc(256, fonts)
    W, H = 256, 256
    g = (0.13, 0.40, 0.22)
    L = [d.rect(0, 0, W, H, g, op=72, name="net")]
    for k in range(0, W + 1, 6):
        L.append(d.line([(k, 0), (k, H)], mul(g, 1.5), 1.2, op=55))
    for k in range(0, H + 1, 6):
        L.append(d.line([(0, k), (W, k)], mul(g, 0.7), 1.2, op=45))
    L.append(d.rect(118, 0, 22, H, mix(g, (0.6, 0.75, 0.6), 0.3), op=40, name="faded seam"))
    L.append(d.noise(W, H, op=20, scale=26, seed=3.0))
    # the scaffold showing through: standards at the tile edges, a ledger at mid height and the top, a brace
    L.append(d.rect(0, 0, 9, H, (0.1, 0.16, 0.12), op=80))
    L.append(d.rect(0, 0, W, 8, (0.1, 0.16, 0.12), op=80))
    L.append(d.rect(0, 126, W, 5, (0.1, 0.16, 0.12), op=55))
    L.append(d.line([(6, H), (W, 6)], (0.1, 0.16, 0.12), 4, op=40))
    return W, H, (0, 0, 0, 0), L, d


DOCS = {"Hoarding": hoarding_doc, "Netting": netting_doc}


def build_doc(name):
    W, H, bg, layers, d = DOCS[name](FONT_STYLE)
    layers = list(reversed(layers))   # layers[0] is frontmost
    return {"$schema": "https://jerboa.dev/schemas/fx-composition/editable/v1/document.schema.json", "formatVersion": 1,
            "dimensions": {"width": W, "height": H}, "duration": 3.0, "backgroundColor": list(bg),
            "composition": {"id": "main", "name": "Closures " + name, "layers": layers}}
