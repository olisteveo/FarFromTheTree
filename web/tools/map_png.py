# Top-down PNG of public/city.json for sanity checks: python tools/map_png.py s0 s1 out.png
import json, sys
from PIL import Image, ImageDraw
c = json.load(open("public/city.json"))
s0, s1 = float(sys.argv[1]), float(sys.argv[2]); out = sys.argv[3]
r = c["route"]; rp = [(r[i], r[i+1]) for i in range(0, len(r), 2) if s0 <= i//2*4 <= s1]
pad = 420
x0 = min(p[0] for p in rp) - pad; x1 = max(p[0] for p in rp) + pad
z0 = min(p[1] for p in rp) - pad; z1 = max(p[1] for p in rp) + pad
H = 1600; k = H / (z1 - z0); W = int((x1 - x0) * k)
im = Image.new("RGB", (W, H), (42, 74, 92)); d = ImageDraw.Draw(im)
T = lambda x, z: ((x - x0) * k, (z1 - z) * k)
def poly(rings, fill):
    for i, ring in enumerate(rings):
        pts = [T(ring[j], ring[j+1]) for j in range(0, len(ring), 2)]
        if len(pts) > 2: d.polygon(pts, fill=fill if i == 0 else (34, 34, 34))
for p in c["land"]: poly(p, (58, 58, 56))
for p in c["roadbed"]: poly(p, (30, 30, 30))
for p in c["sidewalk"]: poly(p, (110, 110, 110))
for p in c["parks"]: poly(p["p"], (79, 107, 51))
col = {"tenement": (160, 82, 61), "castiron": (217, 203, 176), "prewar": (200, 169, 130), "deco": (230, 196, 106), "modern": (125, 148, 168), "glass": (95, 168, 211), "brick": (138, 90, 68)}
for b in c["skyline"]: poly(b["p"], (80, 80, 80))
for b in c["buildings"]: poly(b["p"], col.get(b["st"], (255, 0, 255)))
sw = c["subway"]; d.line([T(sw[i], sw[i+1]) for i in range(0, len(sw), 2)], fill=(77, 255, 138), width=2)
d.line([T(*p) for p in rp], fill=(255, 176, 74), width=4)
for s in c["stations"]:
    x, y = T(s["x"], s["z"]); d.ellipse([x-6, y-6, x+6, y+6], fill=(77, 255, 138)); d.text((x+8, y-6), s["n"], fill=(255, 255, 255))
for e in c["entrances"]:
    x, y = T(e["x"], e["z"]); d.rectangle([x-2, y-2, x+2, y+2], fill=(0, 255, 0))
for dd in c["districts"]:
    i = min(len(r)//2 - 1, round(dd["s0"]/4)); x, y = T(r[i*2], r[i*2+1]); d.text((x+30, y), dd["name"], fill=(255, 211, 138))
im.save(out); print(out, W, H)
