"""Far From the Tree - build the street surface textures.

    py build_ground.py [name ...]      (default: all)

1. ground_design.py lays out each texture as an editable Tesseract composition
   (tools/ground/src/<Name>/<channel>.tsrct - open it in Tesseract to tweak, or edit the script).
2. tsrct renders the panels to PNG (idle CPU priority).
3. post.mjs (node + sharp, idle priority) makes them seamless, derives normals and writes
   web/public/textures/ground/<name>_c.webp / _n.webp.
"""
import json, os, shutil, subprocess, sys, glob

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.abspath(os.path.join(HERE, "..", ".."))
SRC = os.path.join(HERE, "src")
WORK = os.path.join(HERE, ".tesseract-work")
OUT = os.path.join(WEB, "public", "textures", "ground")
IDLE = 0x00000040 if os.name == "nt" else 0   # IDLE_PRIORITY_CLASS


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


def run(cmd, cwd=None):
    print(">", " ".join(cmd), flush=True)
    r = subprocess.run(cmd, creationflags=IDLE, cwd=cwd, shell=(os.name == "nt" and cmd[0] == "node"))
    if r.returncode:
        sys.exit("failed: %s" % r.returncode)


def main(only):
    sys.path.insert(0, HERE)
    import ground_design
    T = find_tsrct()
    os.makedirs(SRC, exist_ok=True)
    os.makedirs(WORK, exist_ok=True)
    done = []
    for t in ground_design.all_textures():
        if only and t.name not in only:
            continue
        folder = os.path.join(SRC, t.name.title().replace("_", ""))
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(WORK, t.name + ".meta.json"), "w") as f:
            json.dump(t.meta(), f)
        for ch in t.channels:
            label = {"a": "albedo", "h": "height", "r": "rough", "m": "alpha"}[ch]
            proj = os.path.join(folder, label + ".tsrct")
            if not os.path.exists(proj):
                run([T, "project", "create", "--project", proj])
            layout = os.path.join(WORK, "%s_%s.json" % (t.name, ch))
            with open(layout, "w") as f:
                json.dump(t.doc(ch), f)
            run([T, "project", "commit", "--project", proj, "--file", layout])
            run([T, "preview", "--project", proj, "--time", "1", "--output", os.path.join(WORK, "%s_%s.png" % (t.name, ch))])
        done.append(t.name)
    if done:
        run(["node", os.path.join(HERE, "post.mjs"), WORK, OUT] + done, cwd=WEB)


if __name__ == "__main__":
    main(sys.argv[1:])
