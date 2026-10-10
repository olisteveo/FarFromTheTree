"""Export the rendered layers (tools/music/out/*.wav, from compose.py) for the game: web/public/music.

Each file is the loop with its first second appended, so the game can loop it between 0.5 s and
0.5 s + the loop length: whatever silence an encoder puts at the start shifts both loop points
alike, and the music either side of the jump is the same, so the loop is seamless.
    python tools/music/export.py
"""
import json
import os
import subprocess

import numpy as np
from scipy.io import wavfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "..", "public", "music"))
os.makedirs(OUT, exist_ok=True)
meta = {}
for name in ["title", "street", "roof", "subway"]:
    sr, d = wavfile.read(os.path.join(HERE, "out", f"{name}.wav"))
    ext = np.concatenate([d, d[: sr]], axis=0)
    tmp = os.path.join(HERE, "out", f"{name}_ext.wav")
    wavfile.write(tmp, sr, ext)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-threads", "1", "-i", tmp, "-c:a", "libmp3lame", "-q:a", "4", os.path.join(OUT, f"{name}.mp3")],
                   check=True, creationflags=0x00000040 if os.name == "nt" else 0)
    meta[name] = {"loop": len(d) / sr}
json.dump(meta, open(os.path.join(OUT, "music.json"), "w"), indent=1)
print(meta)
