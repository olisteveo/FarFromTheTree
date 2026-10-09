"""
Sanity check for web/public/models/vehicles.glb (plain Python, no deps).

Checks: the six named objects exist, material names are from the agreed set, triangle counts are
within budget, wheels sit on y=0, and each vehicle faces +Z (headlights forward of tail lights).
Usage: python check_vehicles.py [path/to/vehicles.glb]
"""
import json, os, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
GLB = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "..", "public", "models", "vehicles.glb")
NAMES = ["cab", "sedan", "suv", "bus", "truck", "van"]
MATS = {"paint", "glass", "trim", "tyre", "rim", "light_front", "light_rear", "sign"}
REQUIRED = {"paint", "glass", "trim", "tyre", "rim", "light_front", "light_rear"}
BUDGET = {"cab": 4000, "sedan": 4000, "suv": 4000, "van": 4000, "bus": 6000, "truck": 6000}
DIMS = {"cab": (4.95, 1.9, 1.55), "sedan": (4.6, 1.85, 1.45), "suv": (4.9, 1.95, 1.8),
        "bus": (12, 2.6, 3.2), "truck": (8.5, 2.5, 3.4), "van": (5.5, 2.0, 2.4)}

data = open(GLB, "rb").read()
magic, ver, total = struct.unpack_from("<III", data, 0)
assert magic == 0x46546C67, "not a GLB"
off, doc, binc = 12, None, None
while off < len(data):
    ln, typ = struct.unpack_from("<II", data, off)
    chunk = data[off + 8: off + 8 + ln]
    if typ == 0x4E4F534A:
        doc = json.loads(chunk)
    elif typ == 0x004E4942:
        binc = chunk
    off += 8 + ln

fails = []
nodes = {n.get("name"): n for n in doc["nodes"]}
mats = [m.get("name") for m in doc.get("materials", [])]
print(f"file: {os.path.abspath(GLB)}  {len(data) / 1024:.0f} KB")
print("materials:", mats)
for m in mats:
    if m not in MATS:
        fails.append(f"unexpected material {m}")


def acc_count(i):
    return doc["accessors"][i]["count"]


grand = 0
for name in NAMES:
    n = nodes.get(name)
    if not n or "mesh" not in n:
        fails.append(f"missing object {name}")
        continue
    for k in ("translation", "rotation", "scale"):
        if k in n:
            fails.append(f"{name}: node has a {k} (expected identity)")
    mesh = doc["meshes"][n["mesh"]]
    tris, used, mn, mx, body_top = 0, {}, [1e9] * 3, [-1e9] * 3, 0.0
    for p in mesh["primitives"]:
        mname = mats[p["material"]]
        t = acc_count(p["indices"]) // 3 if "indices" in p else acc_count(p["attributes"]["POSITION"]) // 3
        tris += t
        a = doc["accessors"][p["attributes"]["POSITION"]]
        used[mname] = (a["min"], a["max"], t)
        mn = [min(x, y) for x, y in zip(mn, a["min"])]
        mx = [max(x, y) for x, y in zip(mx, a["max"])]
        if mname in ("paint", "glass"):
            body_top = max(body_top, a["max"][1])
    grand += tris
    size = [mx[i] - mn[i] for i in range(3)]
    missing = REQUIRED - set(used)
    if missing:
        fails.append(f"{name}: missing materials {sorted(missing)}")
    if name in ("cab", "bus") and "sign" not in used:
        fails.append(f"{name}: missing sign material")
    if tris > BUDGET[name]:
        fails.append(f"{name}: {tris} tris over budget {BUDGET[name]}")
    if abs(mn[1]) > 0.01:
        fails.append(f"{name}: lowest point y={mn[1]:.3f}, expected 0")
    fz = (used["light_front"][0][2] + used["light_front"][1][2]) / 2
    rz = (used["light_rear"][0][2] + used["light_rear"][1][2]) / 2
    if not (fz > 0 > rz):
        fails.append(f"{name}: not facing +Z (front lights z={fz:.2f}, rear lights z={rz:.2f})")
    L, W, H = DIMS[name]
    # mirrors widen x a little; length (z) and body height (paint/glass, i.e. without the taxi
    # roof sign) should be close to spec
    if abs(size[2] - L) > 0.05 * L or abs(body_top - H) > 0.06 * H:
        fails.append(f"{name}: size {size} vs spec L{L} W{W} H{H}")
    print(f"{name:6s} {tris:5d} tris  size x{size[0]:.2f} y{size[1]:.2f} z{size[2]:.2f} body-top {body_top:.2f}  "
          f"front lights z={fz:+.2f} rear z={rz:+.2f}  prims: " +
          ", ".join(f"{k}:{v[2]}" for k, v in used.items()))
print(f"total {grand} tris")
imgs = doc.get("images", [])
print(f"embedded images: {len(imgs)}")
if fails:
    print("FAIL:\n  " + "\n  ".join(fails))
    sys.exit(1)
print("OK")
