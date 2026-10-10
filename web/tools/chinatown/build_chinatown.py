"""Far From the Tree - rebuild the Chinatown assets (paifang gates, paper lanterns, festival dressing,
neon signs and the Manhattan Bridge with its arch and colonnade).

    python web/tools/chinatown/build_chinatown.py                  # textures (Tesseract) + models (Blender) + previews
    python web/tools/chinatown/build_chinatown.py --skip-textures  # models only (reuse the rendered PNGs)
    python web/tools/chinatown/build_chinatown.py --only BridgeTruss
    python web/tools/chinatown/build_chinatown.py --no-previews
    python web/tools/chinatown/build_chinatown.py --skip-district  # don't redo the district's footprints and ground

  0. district.ts (far.dat -> the bridge district's footprints, models/ct_district.json) and district_ground.py
     (the painted street plan, textures/chinatown/district_ground*.webp, and the street furniture positions)
  1. chinatown_design.py (+ district_design.py) -> Tesseract compositions tesseract/<Name>/<Name>.tsrct (editable sources),
     rendered with `tsrct preview` to tesseract/<Name>/<Name>.png; the atlas layout to tesseract/layout.json
  2. chinatown_blender.py (headless Blender 5.2, 8 threads): models the gate kit, lanterns, stalls and the
     bridge, writes web/public/models/chinatown.glb + chinatown_bridge.glb, converts the atlases to WebP
     (web/public/textures/chinatown/, full size and a 512 copy for phones), review renders in previews/.

Everything runs at idle CPU priority. Needs: Tesseract CLI (tsrct), Blender 5.2; standard library only.
"""
import json, os, re, sys, glob

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.abspath(os.path.join(HERE, "..", ".."))
MODELS = os.path.join(WEB, "public", "models")
TEXOUT = os.path.join(WEB, "public", "textures", "chinatown")
TS = os.path.join(HERE, "tesseract")
PREV = os.path.join(HERE, "previews")
sys.path.insert(0, os.path.join(HERE, "..", "park"))
from build_park import find_tsrct, find_blender, run, IDLE  # noqa: E402  (idle priority runner)
import subprocess  # noqa: E402


def build_textures(only=None):
    sys.path.insert(0, HERE)
    import chinatown_design as cd
    T = find_tsrct()
    os.makedirs(TS, exist_ok=True)
    with open(os.path.join(TS, "layout.json"), "w") as f:
        json.dump(cd.layout_json(), f, indent=1)
    for name in cd.DOCS:
        if only and name not in only:
            continue
        root = os.path.join(TS, name)
        work = os.path.join(root, ".tesseract-work")
        os.makedirs(work, exist_ok=True)
        proj = os.path.join(root, name + ".tsrct")
        if not os.path.exists(proj):
            run([T, "project", "create", "--project", proj])
            for f in (cd.FONTS if name in cd.NEEDS_FONT else []):
                if os.path.exists(f):
                    run([T, "project", "import-font", "--project", proj, "--file", f], capture=True)
        layout = os.path.join(work, "layout.json")
        with open(layout, "w") as f:
            json.dump(cd.build_doc(name), f)
        run([T, "project", "commit", "--project", proj, "--file", layout])
        run([T, "preview", "--project", proj, "--time", "1", "--output", os.path.join(root, name + ".png")])


def build_models(args):
    B = find_blender()
    os.makedirs(TEXOUT, exist_ok=True)
    os.makedirs(PREV, exist_ok=True)
    run([B, "-b", "-t", "8", "--factory-startup", "--python", os.path.join(HERE, "chinatown_blender.py"), "--",
         MODELS, TEXOUT, TS, PREV] + args)


def build_district():
    """the bridge district: its footprints out of far.dat (district.ts), then the painted ground (district_ground.py)"""
    npx = "npx.cmd" if os.name == "nt" else "npx"
    subprocess.run([npx, "tsx", "tools/chinatown/district.ts"], cwd=WEB, creationflags=IDLE, check=True)
    subprocess.run([sys.executable, os.path.join(HERE, "district_ground.py")], cwd=WEB, creationflags=IDLE, check=True)


if __name__ == "__main__":
    a = sys.argv[1:]
    only = set(a[a.index("--only") + 1].split(",")) if "--only" in a else None
    if not only and "--skip-district" not in a:
        build_district()
    if "--skip-textures" not in a:
        build_textures(only)
    if not only and "--skip-models" not in a:
        build_models([x for x in a if x.startswith("--no-") or x.startswith("--prev=")])
    for f in sorted(glob.glob(os.path.join(MODELS, "chinatown*")) + glob.glob(os.path.join(MODELS, "ct_district*")) + glob.glob(os.path.join(TEXOUT, "*"))):
        print("%-44s %8.1f KB" % (os.path.relpath(f, WEB), os.path.getsize(f) / 1024))
