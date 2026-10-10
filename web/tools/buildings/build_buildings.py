"""Far From the Tree - rebuild the architecture assets.

    python web/tools/buildings/build_buildings.py                    # facade textures + kit models
    python web/tools/buildings/build_buildings.py --textures [name..]  # facade texture layers only
    python web/tools/buildings/build_buildings.py --kit               # kit atlas + Blender models only
    python web/tools/buildings/build_buildings.py --kit-models        # Blender models only (reuse the atlas)

Steps (heavy work at idle CPU priority, Blender limited to 8 threads, at most 3 tsrct at once):
  1. facade_design.py -> one Tesseract composition per channel per texture-array layer
     (src/<Layer>/<albedo|height|rough|mask>.tsrct) -> PNG panels in .tesseract-work/
  2. post.mjs (node + sharp) lays the procedural brick / ashlar, packs the mask, derives normals:
     web/public/textures/buildings/<layer>_c.webp, <layer>_n.webp, layers.json
  3. kit_design.py -> src/KitAtlas/*.tsrct -> the kit atlas;  kit_blender.py (headless Blender 5.2)
     models the kit (fire escapes, water towers, cornice brackets, awnings, scaffolding...) into
     web/public/models/buildings_kit.glb and renders previews/.

Needs: Tesseract CLI (tsrct), node (sharp is in web/node_modules) and Blender 5.2.
"""
import json, os, shutil, subprocess, sys, glob, time

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.abspath(os.path.join(HERE, "..", ".."))
SRC = os.path.join(HERE, "src")
WORK = os.path.join(HERE, ".tesseract-work")
TEX_OUT = os.path.join(WEB, "public", "textures", "buildings")
MODELS = os.path.join(WEB, "public", "models")
PREV = os.path.join(HERE, "previews")
IDLE = 0x00000040 if os.name == "nt" else 0   # IDLE_PRIORITY_CLASS
CH = {"a": "albedo", "h": "height", "r": "rough", "m": "mask"}


def find_tsrct():
    for c in [os.path.join(os.environ.get("LOCALAPPDATA", ""), "Tesseract", "bin", "tsrct.cmd"),
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


def run(cmd, cwd=None, quiet=False):
    print(">", " ".join(cmd), flush=True)
    r = subprocess.run(cmd, creationflags=IDLE, cwd=cwd, shell=(os.name == "nt" and cmd[0] == "node"),
                       stdout=subprocess.DEVNULL if quiet else None)
    if r.returncode:
        sys.exit("failed: %s" % r.returncode)


def render_jobs(jobs, T, parallel=3):
    """jobs: [(project, layout json path, png)] -> create/commit/preview, a few at a time."""
    pending = list(jobs)
    running = []
    while pending or running:
        while pending and len(running) < parallel:
            proj, layout, png = pending.pop(0)
            if not os.path.exists(proj):
                subprocess.run([T, "project", "create", "--project", proj], creationflags=IDLE, stdout=subprocess.DEVNULL)
            r = subprocess.run([T, "project", "commit", "--project", proj, "--file", layout], creationflags=IDLE, stdout=subprocess.DEVNULL)
            if r.returncode:
                sys.exit("commit failed: " + proj)
            p = subprocess.Popen([T, "preview", "--project", proj, "--time", "1", "--output", png], creationflags=IDLE,
                                 stdout=subprocess.DEVNULL)
            running.append((p, png))
        time.sleep(0.2)
        for p, png in list(running):
            if p.poll() is not None:
                if p.returncode:
                    sys.exit("preview failed: " + png)
                running.remove((p, png))
                print("  rendered", os.path.basename(png), flush=True)


def build_textures(only):
    sys.path.insert(0, HERE)
    import facade_design
    T = find_tsrct()
    os.makedirs(WORK, exist_ok=True)
    layers = facade_design.all_layers()
    jobs, names = [], []
    for l in layers:
        if only and l.name not in only:
            continue
        folder = os.path.join(SRC, "".join(p.title() for p in l.name.split("_")))
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(WORK, l.name + ".meta.json"), "w") as f:
            json.dump(l.meta(), f)
        for ch, label in CH.items():
            layout = os.path.join(WORK, "%s_%s.json" % (l.name, ch))
            with open(layout, "w") as f:
                json.dump(l.doc(ch), f)
            jobs.append((os.path.join(folder, label + ".tsrct"), layout, os.path.join(WORK, "%s_%s.png" % (l.name, ch))))
        names.append(l.name)
    render_jobs(jobs, T)
    if names:
        run(["node", os.path.join(HERE, "post.mjs"), WORK, TEX_OUT] + names, cwd=WEB)
    with open(os.path.join(TEX_OUT, "layers.json"), "w") as f:
        json.dump({"layers": [l.meta() for l in layers]}, f, indent=1)


def build_kit(models_only=False):
    sys.path.insert(0, HERE)
    if not models_only:
        import kit_design
        T = find_tsrct()
        os.makedirs(WORK, exist_ok=True)
        jobs = []
        folder = os.path.join(SRC, "KitAtlas")
        os.makedirs(folder, exist_ok=True)
        for ch, label in CH.items():
            if ch not in kit_design.CHANNELS:
                continue
            layout = os.path.join(WORK, "kit_%s.json" % ch)
            with open(layout, "w") as f:
                json.dump(kit_design.doc(ch), f)
            jobs.append((os.path.join(folder, label + ".tsrct"), layout, os.path.join(WORK, "kit_%s.png" % ch)))
        for kind, nm in (("asphalt", "lot_asphalt"), ("dirt", "site_dirt")):
            layout = os.path.join(WORK, nm + ".json")
            with open(layout, "w") as f:
                json.dump(kit_design.lot_doc(kind), f)
            d = os.path.join(SRC, "".join(p.title() for p in nm.split("_")))
            os.makedirs(d, exist_ok=True)
            jobs.append((os.path.join(d, "albedo.tsrct"), layout, os.path.join(WORK, nm + ".png")))
        render_jobs(jobs, T)
        with open(os.path.join(WORK, "kit_layout.json"), "w") as f:
            json.dump(kit_design.layout_json(), f, indent=1)
        run(["node", os.path.join(HERE, "post_kit.mjs"), WORK, os.path.join(MODELS)], cwd=WEB)
    B = find_blender()
    os.makedirs(PREV, exist_ok=True)
    run([B, "-b", "-t", "8", "--factory-startup", "--python", os.path.join(HERE, "kit_blender.py"), "--", MODELS, WORK, PREV])


if __name__ == "__main__":
    args = sys.argv[1:]
    if "--textures" in args:
        build_textures([a for a in args if not a.startswith("--")])
    elif "--kit" in args:
        build_kit()
    elif "--kit-models" in args:
        build_kit(models_only=True)
    else:
        build_textures([])
        build_kit()
    for f in sorted(glob.glob(os.path.join(TEX_OUT, "*")) + glob.glob(os.path.join(MODELS, "buildings*"))):
        print("%-36s %8.1f KB" % (os.path.basename(f), os.path.getsize(f) / 1024))
