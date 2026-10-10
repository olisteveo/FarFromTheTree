# Top-down map of Chinatown + the Manhattan Bridge plaza (dev check): python tools/chinatown/map_ct.py out.png [x0 x1 z0 z1] [extra.json]
import json, sys, math
from PIL import Image, ImageDraw
c = json.load(open("public/city.json"))
out = sys.argv[1]
x0, x1, z0, z1 = [float(v) for v in sys.argv[2:6]] if len(sys.argv) > 5 else (-1350, -350, 1650, 2550)
extra = json.load(open(sys.argv[6])) if len(sys.argv) > 6 else {}
H = 1600; k = H / (z1 - z0); W = int((x1 - x0) * k)
im = Image.new("RGB", (W, H), (42, 74, 92)); d = ImageDraw.Draw(im)
T = lambda x, z: ((x1 - x) * k, (z1 - z) * k)
def poly(rings, fill, outline=None):
    for i, ring in enumerate(rings):
        pts = [T(ring[j], ring[j+1]) for j in range(0, len(ring), 2)]
        if len(pts) > 2: d.polygon(pts, fill=fill if i == 0 else (34, 34, 34), outline=outline)
for p in c["land"]: poly(p, (58, 58, 56))
for p in c["roadbed"]: poly(p, (30, 30, 30))
for p in c["sidewalk"]: poly(p, (110, 110, 110))
for p in c["plaza"]: poly(p, (150, 140, 120))
for p in c.get("open", []): poly(p, (90, 110, 90))
for p in c["parks"]: poly(p["p"], (79, 107, 51))
for p in c["sites"]: poly(p["p"], (140, 120, 60))
for b in c["skyline"]: poly(b["p"], (80, 80, 80))
for b in c["buildings"]: poly(b["p"], (160, 82, 61), outline=(90, 40, 30))
r = c["route"]; d.line([T(r[i], r[i+1]) for i in range(0, len(r), 2)], fill=(255, 176, 74), width=3)
for st in c["streets"]:
    p = st["p"]
    pts = [T(p[i], p[i+1]) for i in range(0, len(p), 2)]
    d.line(pts, fill=(200, 200, 255) if st["n"] != "MANHATTAN BRG" else (255, 60, 255), width=1 if st["n"] != "MANHATTAN BRG" else 3)
    if len(pts) > 1:
        m = pts[len(pts)//2]
        if 0 < m[0] < W and 0 < m[1] < H: d.text(m, st["n"][:14], fill=(255, 255, 200))
for ln in extra.get("lines", []):
    d.line([T(ln[i], ln[i+1]) for i in range(0, len(ln), 2)], fill=tuple(extra.get("lc", [0, 255, 255])), width=3)
for pt in extra.get("pts", []):
    x, y = T(pt[0], pt[1]); d.ellipse([x-4, y-4, x+4, y+4], fill=(0, 255, 255)); 
    if len(pt) > 2: d.text((x+6, y-6), str(pt[2]), fill=(0, 255, 255))
# grid ticks
for gx in range(int(x0 // 100) * 100, int(x1) + 1, 100):
    X, _ = T(gx, z0); d.line([(X, H - 12), (X, H)], fill=(255, 255, 255)); d.text((X + 2, H - 24), str(gx), fill=(255, 255, 255))
for gz in range(int(z0 // 100) * 100, int(z1) + 1, 100):
    _, Y = T(x1, gz); d.line([(0, Y), (12, Y)], fill=(255, 255, 255)); d.text((14, Y - 6), str(gz), fill=(255, 255, 255))
im.save(out)
print(out, W, H)
