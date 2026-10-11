"""Far From the Tree - rebuild the street closures' assets.

    python web/tools/closures/build_closures.py                  # textures (Tesseract) + models (Blender)
    python web/tools/closures/build_closures.py --skip-textures  # models only
    python web/tools/closures/build_closures.py --no-previews    # skip the contact-sheet renders

  1. closures_design.py -> Tesseract compositions tesseract/<Name>/<Name>.tsrct (editable sources), rendered with
     `tsrct preview` to tesseract/<Name>/<Name>.png (Hoarding: the MDF site hoarding; Netting: debris netting)
  2. closures_blender.py (headless Blender, 8 threads): the scaffold kit, crane, trucks, barricades ->
     web/public/models/closures.glb, the textures -> web/public/textures/closures/{hoarding.jpg, netting.png}

Everything runs at idle CPU priority. Needs: Tesseract CLI (tsrct), Blender 5.x; standard library only.
The placement is src/render/blockers.ts (the colliders: src/world/blockers.ts).
"""
import json, os, shutil, subprocess, sys, glob

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.abspath(os.path.join(HERE, "..", ".."))
TS = os.path.join(HERE, "tesseract")
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


def build_textures():
    sys.path.insert(0, HERE)
    import closures_design as D
    T = find_tsrct()
    fonts = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")
    for name in D.DOCS:
        root = os.path.join(TS, name)
        work = os.path.join(root, ".tesseract-work")
        os.makedirs(work, exist_ok=True)
        proj = os.path.join(root, name + ".tsrct")
        if not os.path.exists(proj):
            run([T, "project", "create", "--project", proj])
            for f in D.FONT_FILES.values():
                run([T, "project", "import-font", "--project", proj, "--file", os.path.join(fonts, f)], capture=True)
        layout = os.path.join(work, "layout.json")
        with open(layout, "w") as f:
            json.dump(D.build_doc(name), f)
        run([T, "project", "commit", "--project", proj, "--file", layout])
        run([T, "preview", "--project", proj, "--time", "1", "--output", os.path.join(root, name + ".png")])


def build_models(extra):
    B = find_blender()
    run([B, "-b", "-t", "8", "--factory-startup", "--python", os.path.join(HERE, "closures_blender.py"), "--"] + extra)


if __name__ == "__main__":
    a = sys.argv[1:]
    if "--skip-textures" not in a:
        build_textures()
    build_models([x for x in a if x == "--no-previews"])
    for f in [os.path.join(WEB, "public", "models", "closures.glb")] + sorted(glob.glob(os.path.join(WEB, "public", "textures", "closures", "*"))):
        print("%-50s %8.1f KB" % (os.path.relpath(f, WEB), os.path.getsize(f) / 1024))
