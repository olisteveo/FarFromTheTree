"""Far From the Tree - rebuild every subway asset from scratch.

    python web/tools/subway/build_subway.py                  # textures + models + previews
    python web/tools/subway/build_subway.py --skip-textures  # models only (reuse the rendered PNGs)
    python web/tools/subway/build_subway.py --only Atlas     # re-render one texture doc, then models
    python web/tools/subway/build_subway.py --no-previews

Steps (heavy work at idle CPU priority, Blender limited to 8 threads):
  1. subway_design.py -> Tesseract compositions atlas/*.tsrct -> rendered PNGs in atlas/
  2. subway_blender.py (headless Blender 5.2): models the trains, track and props, converts the
     textures to JPEG and writes web/public/models/subway.glb, subway_*.jpg and subway.json;
     renders review images into web/tools/subway/previews/.

Needs: Tesseract CLI (tsrct) and Blender 5.2. No Python packages beyond the standard library.
"""
import json, os, shutil, subprocess, sys, glob

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(WEB, "public", "models")
PREV = os.path.join(HERE, "previews")
ATLAS_DIR = os.path.join(HERE, "atlas")
IDLE = 0x00000040 if os.name == "nt" else 0   # IDLE_PRIORITY_CLASS
FONTS = ["arialbd.ttf", "arial.ttf", "impact.ttf", "georgiab.ttf"]


def find_tsrct():
    for c in [os.path.join(os.environ.get("LOCALAPPDATA", ""), "Tesseract", "bin", "tsrct.cmd"),
              os.path.join(os.path.expanduser("~"), "AppData", "Local", "Tesseract", "bin", "tsrct.cmd"),
              os.path.expanduser("~/Library/Application Support/Tesseract/bin/tsrct"),
              os.path.expanduser("~/.local/share/Tesseract/bin/tsrct"), shutil.which("tsrct") or ""]:
        if c and os.path.exists(c):
            return c
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


def run(cmd, quiet=False):
    print(">", " ".join(cmd), flush=True)
    r = subprocess.run(cmd, creationflags=IDLE, stdout=subprocess.DEVNULL if quiet else None)
    if r.returncode:
        sys.exit("failed: %s" % r.returncode)


def font_dir():
    return os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")


def build_textures(only=None):
    sys.path.insert(0, HERE)
    import subway_design
    T = find_tsrct()
    work = os.path.join(ATLAS_DIR, ".tesseract-work")
    os.makedirs(work, exist_ok=True)
    for name, fn in subway_design.DOCS.items():
        if only and name not in only:
            continue
        proj = os.path.join(ATLAS_DIR, name + ".tsrct")
        if not os.path.exists(proj):
            run([T, "project", "create", "--project", proj])
            for f in FONTS:
                p = os.path.join(font_dir(), f)
                if os.path.exists(p):
                    run([T, "project", "import-font", "--project", proj, "--file", p], quiet=True)
        layout = os.path.join(work, name + ".json")
        with open(layout, "w") as f:
            json.dump(fn(), f)
        run([T, "project", "commit", "--project", proj, "--file", layout])
        run([T, "preview", "--project", proj, "--time", "1", "--output", os.path.join(ATLAS_DIR, name + ".png")])
    with open(os.path.join(ATLAS_DIR, "layout.json"), "w") as f:
        json.dump(subway_design.layout_json(), f, indent=1)


def build_models(args):
    B = find_blender()
    os.makedirs(PREV, exist_ok=True)
    run([B, "-b", "-t", "8", "--factory-startup", "--python", os.path.join(HERE, "subway_blender.py"), "--", OUT, ATLAS_DIR, PREV] + args)


if __name__ == "__main__":
    args = sys.argv[1:]
    only = None
    if "--only" in args:
        only = args[args.index("--only") + 1].split(",")
    if "--skip-textures" not in args:
        build_textures(only)
    if "--textures-only" not in args:
        build_models([a for a in args if a in ("--no-previews",)] + (["--prev", args[args.index("--prev") + 1]] if "--prev" in args else []))
    for f in sorted(glob.glob(os.path.join(OUT, "subway*"))):
        print("%-24s %8.1f KB" % (os.path.basename(f), os.path.getsize(f) / 1024))
