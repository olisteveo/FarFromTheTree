"""Far From the Tree - rebuild the subway entrance / stairwell / air-vent assets from scratch.

    python web/tools/entrances/build_entrances.py                  # textures + models + previews
    python web/tools/entrances/build_entrances.py --skip-textures  # models only (reuse the rendered PNGs)
    python web/tools/entrances/build_entrances.py --only StairWall # re-render one texture doc, then models
    python web/tools/entrances/build_entrances.py --no-previews

Steps (heavy work at idle CPU priority, Blender limited to 8 threads):
  1. entrances_design.py -> Tesseract compositions atlas/*.tsrct -> rendered PNGs in atlas/
  2. entrances_blender.py (headless Blender 5.2): models the kiosk, canopy and stone entrances, the vent
     fans and grates; converts the textures (web/public/textures/entrances/*.webp, the grate keyed to
     alpha) and writes web/public/models/entrances.glb + entrances.json; review renders in previews/.

Needs: Tesseract CLI (tsrct) and Blender 5.2. No Python packages beyond the standard library.
"""
import json, os, subprocess, sys, glob

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(WEB, "public", "models")
TEX = os.path.join(WEB, "public", "textures", "entrances")
PREV = os.path.join(HERE, "previews")
ATLAS_DIR = os.path.join(HERE, "atlas")
sys.path.insert(0, os.path.join(HERE, "..", "subway"))
import build_subway as bs  # noqa: E402  (find_tsrct, find_blender, run, font_dir, FONTS)


def build_textures(only=None):
    sys.path.insert(0, HERE)
    import entrances_design
    T = bs.find_tsrct()
    work = os.path.join(ATLAS_DIR, ".tesseract-work")
    os.makedirs(work, exist_ok=True)
    for name, fn in entrances_design.DOCS.items():
        if only and name not in only:
            continue
        proj = os.path.join(ATLAS_DIR, name + ".tsrct")
        if not os.path.exists(proj):
            bs.run([T, "project", "create", "--project", proj])
            for f in bs.FONTS:
                p = os.path.join(bs.font_dir(), f)
                if os.path.exists(p):
                    bs.run([T, "project", "import-font", "--project", proj, "--file", p], quiet=True)
        layout = os.path.join(work, name + ".json")
        with open(layout, "w") as f:
            json.dump(fn(), f)
        bs.run([T, "project", "commit", "--project", proj, "--file", layout])
        bs.run([T, "preview", "--project", proj, "--time", "1", "--output", os.path.join(ATLAS_DIR, name + ".png")])
    with open(os.path.join(ATLAS_DIR, "layout.json"), "w") as f:
        json.dump(entrances_design.layout_json(), f, indent=1)


def build_models(args):
    B = bs.find_blender()
    os.makedirs(PREV, exist_ok=True)
    os.makedirs(TEX, exist_ok=True)
    bs.run([B, "-b", "-t", "8", "--factory-startup", "--python", os.path.join(HERE, "entrances_blender.py"), "--", OUT, TEX, ATLAS_DIR, PREV] + args)


if __name__ == "__main__":
    args = sys.argv[1:]
    only = None
    if "--only" in args:
        only = args[args.index("--only") + 1].split(",")
    os.makedirs(ATLAS_DIR, exist_ok=True)
    if "--skip-textures" not in args:
        build_textures(only)
    if "--textures-only" not in args:
        build_models([a for a in args if a in ("--no-previews",)] + (["--prev", args[args.index("--prev") + 1]] if "--prev" in args else []))
    for f in sorted(glob.glob(os.path.join(OUT, "entrances*")) + glob.glob(os.path.join(TEX, "*"))):
        print("%-28s %8.1f KB" % (os.path.basename(f), os.path.getsize(f) / 1024))
