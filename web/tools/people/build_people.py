"""Far From the Tree - rebuild every pedestrian asset from scratch.

    python web/tools/people/build_people.py            # atlas + characters + VAT + previews
    python web/tools/people/build_people.py --only commuter,dog_lab   # quick iteration on a few

Steps (all heavy work runs at idle CPU priority, Blender limited to 8 threads):
  1. atlas_design.py -> Tesseract composition atlas/Atlas.tsrct -> rendered PNG
     -> web/public/models/people_atlas.png
  2. people_blender.py (headless Blender 5.2): builds the characters and dogs, rigs and keys their
     animations, bakes the vertex animation, writes people.glb / people_vat.bin / people.json and
     renders review images into web/tools/people/previews/.

Needs: Tesseract CLI (tsrct) and Blender 5.2. No Python packages beyond the standard library.
"""
import json, os, shutil, subprocess, sys, glob

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(WEB, "public", "models")
PREV = os.path.join(HERE, "previews")
ATLAS_DIR = os.path.join(HERE, "atlas")
IDLE = 0x00000040 if os.name == "nt" else 0   # IDLE_PRIORITY_CLASS


def find_tsrct():
    for c in [os.path.join(os.environ.get("LOCALAPPDATA", ""), "Tesseract", "bin", "tsrct.cmd"),
              os.path.join(os.path.expanduser("~"), "AppData", "Local", "Tesseract", "bin", "tsrct.cmd"),
              os.path.expanduser("~/Library/Application Support/Tesseract/bin/tsrct"),
              os.path.expanduser("~/.local/share/Tesseract/bin/tsrct"), shutil.which("tsrct") or ""]:
        if c and os.path.exists(c):
            return c
    # installed from a packaged (MSIX) app: AppData\Local is virtualised under Packages\<app>\LocalCache
    hits = glob.glob(os.path.join(os.path.expanduser("~"), "AppData", "Local", "Packages", "*", "LocalCache", "Local",
                                  "Tesseract", "bin", "tsrct.cmd"))
    if hits:
        return hits[0]
    sys.exit("tsrct not found")


def find_blender():
    hits = sorted(glob.glob(r"C:\Program Files\Blender Foundation\Blender*\blender.exe"))
    if hits:
        return hits[-1]
    b = shutil.which("blender")
    if b:
        return b
    sys.exit("blender not found")


def run(cmd):
    print(">", " ".join(cmd), flush=True)
    r = subprocess.run(cmd, creationflags=IDLE)
    if r.returncode:
        sys.exit("failed: %s" % r.returncode)


def build_atlas():
    sys.path.insert(0, HERE)
    import atlas_design
    T = find_tsrct()
    os.makedirs(os.path.join(ATLAS_DIR, ".tesseract-work"), exist_ok=True)
    proj = os.path.join(ATLAS_DIR, "Atlas.tsrct")
    if not os.path.exists(proj):
        run([T, "project", "create", "--project", proj])
    layout = os.path.join(ATLAS_DIR, ".tesseract-work", "layout.json")
    with open(layout, "w") as f:
        json.dump(atlas_design.build_doc(), f)
    run([T, "project", "commit", "--project", proj, "--file", layout])
    png = os.path.join(ATLAS_DIR, "Atlas.png")
    run([T, "preview", "--project", proj, "--time", "1", "--output", png])
    os.makedirs(OUT, exist_ok=True)
    shutil.copyfile(png, os.path.join(OUT, "people_atlas.png"))


def build_models(only=""):
    B = find_blender()
    os.makedirs(PREV, exist_ok=True)
    run([B, "-b", "-t", "8", "--factory-startup", "--python", os.path.join(HERE, "people_blender.py"), "--",
         OUT, os.path.join(OUT, "people_atlas.png"), PREV, only])


if __name__ == "__main__":
    args = sys.argv[1:]
    only = ""
    if "--only" in args:
        only = args[args.index("--only") + 1]
    if "--skip-atlas" not in args:
        build_atlas()
    build_models(only)
    for f in ("people.glb", "people_vat.bin", "people.json", "people_atlas.png"):
        p = os.path.join(OUT, f)
        if os.path.exists(p):
            print("%-18s %8.1f KB" % (f, os.path.getsize(p) / 1024))
