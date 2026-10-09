"""Far From the Tree - rebuild the Central Park assets.

    python web/tools/park/build_park.py                 # textures (Tesseract) + models (Blender)
    python web/tools/park/build_park.py --skip-textures # models only
    python web/tools/park/build_park.py --only Schist,Ice   # just some textures, no models

  1. park_design.py -> Tesseract compositions tesseract/<Name>/<Name>.tsrct (editable sources),
     rendered with `tsrct preview` to tesseract/<Name>/<Name>.png
  2. park_blender.py (headless Blender 5.2, 8 threads): builds the trees (3 species x 3 LODs),
     rocks, Gapstow Bridge, the Maine monument, lamps, benches, baskets, carts, skaters and ducks,
     writes web/public/models/park_trees.glb + park_props.glb, converts the opaque textures to JPEG
     in web/public/textures/park/. (Review renders: tools/park/test.html.)

Everything runs at idle CPU priority. Needs: Tesseract CLI (tsrct), Blender 5.2; standard library only.
"""
import json, os, re, shutil, subprocess, sys, glob

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.abspath(os.path.join(HERE, "..", ".."))
MODELS = os.path.join(WEB, "public", "models")
TEXOUT = os.path.join(WEB, "public", "textures", "park")
TS = os.path.join(HERE, "tesseract")
PREV = os.path.join(HERE, "previews")
IDLE = 0x00000040 if os.name == "nt" else 0   # IDLE_PRIORITY_CLASS


def find_tsrct():
    for c in [os.path.join(os.environ.get("LOCALAPPDATA", ""), "Tesseract", "bin", "tsrct.cmd"),
              os.path.expanduser("~/Library/Application Support/Tesseract/bin/tsrct"),
              os.path.expanduser("~/.local/share/Tesseract/bin/tsrct"), shutil.which("tsrct") or ""]:
        if c and os.path.exists(c):
            return c
    hits = glob.glob(os.path.join(os.path.expanduser("~"), "AppData", "Local", "Packages", "*", "LocalCache", "Local", "Tesseract", "bin", "tsrct.cmd"))
    if hits:
        return hits[0]
    sys.exit("tsrct not found")


def find_blender():
    hits = sorted(glob.glob(r"C:\Program Files\Blender Foundation\Blender*\blender.exe"))
    if hits:
        return hits[-1]
    return shutil.which("blender") or sys.exit("blender not found")


def run(cmd, capture=False):
    print(">", " ".join(cmd), flush=True)
    r = subprocess.run(cmd, creationflags=IDLE, capture_output=capture, text=capture)
    if r.returncode:
        if capture:
            print(r.stdout, r.stderr)
        sys.exit("failed: %s" % r.returncode)
    return r.stdout if capture else ""


def build_textures(only=None):
    sys.path.insert(0, HERE)
    import park_design
    T = find_tsrct()
    for name in park_design.DOCS:
        if only and name not in only:
            continue
        root = os.path.join(TS, name)
        work = os.path.join(root, ".tesseract-work")
        os.makedirs(work, exist_ok=True)
        proj = os.path.join(root, name + ".tsrct")
        if not os.path.exists(proj):
            run([T, "project", "create", "--project", proj])
        font = None
        if name in park_design.NEEDS_FONT:
            out = run([T, "project", "import-font", "--project", proj, "--file", park_design.FONT], capture=True)
            fam = re.search(r'"fontFamily"\s*:\s*"([^"]+)"', out)
            sty = re.search(r'"fontStyle"\s*:\s*"([^"]+)"', out)
            font = (fam.group(1) if fam else "Arial", sty.group(1) if sty else "Bold")
        layout = os.path.join(work, "layout.json")
        with open(layout, "w") as f:
            json.dump(park_design.build_doc(name, font), f)
        run([T, "project", "commit", "--project", proj, "--file", layout])
        run([T, "preview", "--project", proj, "--time", "1", "--output", os.path.join(root, name + ".png")])


def build_models(args):
    B = find_blender()
    os.makedirs(TEXOUT, exist_ok=True)
    run([B, "-b", "-t", "8", "--factory-startup", "--python", os.path.join(HERE, "park_blender.py"), "--",
         MODELS, TEXOUT, TS, PREV] + args)


if __name__ == "__main__":
    a = sys.argv[1:]
    only = set(a[a.index("--only") + 1].split(",")) if "--only" in a else None
    if "--skip-textures" not in a:
        build_textures(only)
    if not only and "--skip-models" not in a:
        build_models([x for x in a if x.startswith("--no-")])
    for f in sorted(glob.glob(os.path.join(MODELS, "park_*.glb")) + glob.glob(os.path.join(TEXOUT, "*"))):
        print("%-40s %8.1f KB" % (os.path.relpath(f, WEB), os.path.getsize(f) / 1024))
