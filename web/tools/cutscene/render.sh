#!/usr/bin/env bash
# Far From the Tree - intro cutscene pipeline (run from this folder in Git Bash).
# 1) python audio/make_audio.py          # synthesise wind/lapse/rustle/music stems (stdlib + ffmpeg)
#    (re-imported stems need NEW asset ids: tsrct refuses to overwrite sfx-* ids; update audio/stems.json)
# 2) python build.py --audio             # regenerate .tesseract-work/editable.json from code
# 3) tsrct project commit --project intro.tsrct --file .tesseract-work/editable.json
# 4) tsrct export --project intro.tsrct --format prores --output .tesseract-work/master.mov   (run at low priority)
# 5) encode deliverables from the master (below), then delete master.mov
set -e
T="$LOCALAPPDATA/Tesseract/bin/tsrct.cmd"
FF=$(ls "$LOCALAPPDATA"/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/*/bin/ffmpeg.exe | head -1)
OUT=../../public/video
python build.py --audio
"$T" project commit --project intro.tsrct --file .tesseract-work/editable.json
"$T" export --project intro.tsrct --format prores --output .tesseract-work/master.mov
"$FF" -y -i .tesseract-work/master.mov -c:v libx264 -preset slow -tune animation -crf 18 -pix_fmt yuv420p -threads 8 \
  -movflags +faststart -c:a aac -b:a 160k "$OUT/intro.mp4"
"$FF" -y -i .tesseract-work/master.mov -c:v libvpx-vp9 -crf 32 -b:v 0 -row-mt 1 -threads 8 -cpu-used 2 -pix_fmt yuv420p \
  -c:a libopus -b:a 128k "$OUT/intro.webm"
"$FF" -y -sseof -0.05 -i "$OUT/intro.mp4" -frames:v 1 -q:v 2 -update 1 "$OUT/intro_poster.jpg"
rm -f .tesseract-work/master.mov
