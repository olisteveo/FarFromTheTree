"""Far From the Tree - rebuild the street furniture assets.

    python web/tools/street/build_street.py                  # textures (Tesseract) + models (Blender)
    python web/tools/street/build_street.py --skip-textures  # models only
    python web/tools/street/build_street.py --only Names     # just one texture doc, no models

  1. street_design.py -> Tesseract compositions tesseract/<Name>/<Name>.tsrct (editable sources),
     rendered with `tsrct preview` to tesseract/<Name>/<Name>.png
       Atlas: every surface, sign and poster the props use;  Names: the street-name blades
  2. street_blender.py (headless Blender, 8 threads): the props -> web/public/models/street_props.glb,
     the renders -> web/public/textures/street/{atlas.jpg, names.jpg, wire.png}
  3. web/public/models/street.json: the atlas and name-blade rects for the runtime

Everything runs at idle CPU priority. Needs: Tesseract CLI (tsrct), Blender 5.x; standard library only.
The placement itself is src/render/streetLayout.ts (check it with: npx tsx tools/street/layout-check.ts).
"""
import json, os, re, shutil, subprocess, sys, glob

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.abspath(os.path.join(HERE, "..", ".."))
MODELS = os.path.join(WEB, "public", "models")
TEXOUT = os.path.join(WEB, "public", "textures", "street")
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


def build_textures(only=None):
    sys.path.insert(0, HERE)
    import street_design
    T = find_tsrct()
    fonts = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")
    for name in street_design.DOCS:
        if only and name not in only:
            continue
        root = os.path.join(TS, name)
        work = os.path.join(root, ".tesseract-work")
        os.makedirs(work, exist_ok=True)
        proj = os.path.join(root, name + ".tsrct")
        if not os.path.exists(proj):
            run([T, "project", "create", "--project", proj])
            for f in street_design.FONT_FILES.values():
                run([T, "project", "import-font", "--project", proj, "--file", os.path.join(fonts, f)], capture=True)
        layout = os.path.join(work, "layout.json")
        with open(layout, "w") as f:
            json.dump(street_design.build_doc(name), f)
        run([T, "project", "commit", "--project", proj, "--file", layout])
        run([T, "preview", "--project", proj, "--time", "1", "--output", os.path.join(root, name + ".png")])
    with open(os.path.join(MODELS, "street.json"), "w") as f:
        json.dump(street_design.layout_json(), f, separators=(",", ":"))


def build_models():
    B = find_blender()
    os.makedirs(TEXOUT, exist_ok=True)
    run([B, "-b", "-t", "8", "--factory-startup", "--python", os.path.join(HERE, "street_blender.py"), "--", MODELS, TEXOUT, TS])


if __name__ == "__main__":
    a = sys.argv[1:]
    only = set(a[a.index("--only") + 1].split(",")) if "--only" in a else None
    if "--skip-textures" not in a:
        build_textures(only)
    if not only and "--skip-models" not in a:
        build_models()
    for f in sorted(glob.glob(os.path.join(MODELS, "street*")) + glob.glob(os.path.join(TEXOUT, "*"))):
        print("%-40s %8.1f KB" % (os.path.relpath(f, WEB), os.path.getsize(f) / 1024))
