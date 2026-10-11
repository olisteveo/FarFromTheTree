#!/usr/bin/env bash
# Far From the Tree - ending film pipeline (run from this folder in Git Bash).
# Everything heavy runs at IDLE priority (cmd start /LOW; children inherit it) and ffmpeg is capped at
# 8 threads: heavy jobs at normal priority once crashed the dev PC.
# 1) python ending.py                 -> .tesseract-work/ending.json (all authored in code)
# 2) tsrct project commit             -> ending.tsrct (gitignored)
# 3) tsrct export --format prores     -> .tesseract-work/ending_master.mov (~20 min)
# 4) soundtrack: "Next Spring" (public/music/planted.mp3) from 1:54 to its end (2:46), entering with a
#    fade as the seed lands (film 6 s), swelling through the growing years; the track's own quiet
#    resolution lands on the title card, with a short fade at the very end
# 5) encode the web files (each must stay under Cloudflare Pages' 25 MB), the poster; delete the master
# Previews while iterating: tsrct filmstrip --project ending.tsrct --timestamps-ms ...
set -e
cd "$(dirname "$0")"
TX="$(cygpath -w "$LOCALAPPDATA/Tesseract/public-cli/0.3.1-x86_64/bin/tsrct.exe")"
FF=$(cygpath -w "$(ls "$LOCALAPPDATA"/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/*/bin/ffmpeg.exe | head -1)")
OUT=../../public/video
M=.tesseract-work/ending_master.mov
A=.tesseract-work/ending_audio.wav
low() { cmd //c start "" //LOW //WAIT //B "$@"; }
python ending.py
[ -f ending.tsrct ] || low "$TX" project create --project ending.tsrct
low "$TX" project commit --project ending.tsrct --file .tesseract-work/ending.json
[ -f "$M" ] || low "$TX" export --project ending.tsrct --format prores --output "$M"
low "$FF" -y -i ../../public/music/planted.mp3 -t 58 -af \
  "atrim=114:166,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=2.5,afade=t=out:st=48.5:d=3.5,adelay=6000:all=1,apad=whole_dur=58,aresample=48000" \
  -ac 2 "$A"
# write to temp names, then move into place (a half-written file is never left as the real one)
low "$FF" -y -i "$M" -i "$A" -map 0:v -map 1:a -c:v libx264 -preset slow -tune animation -crf 22 -pix_fmt yuv420p -threads 8 \
  -c:a aac -b:a 160k -movflags +faststart -shortest "$OUT/ending.tmp.mp4"
low "$FF" -y -i "$M" -i "$A" -map 0:v -map 1:a -c:v libvpx-vp9 -crf 34 -b:v 0 -row-mt 1 -threads 8 -cpu-used 2 -pix_fmt yuv420p \
  -c:a libopus -b:a 128k -shortest "$OUT/ending.tmp.webm"
mv -f "$OUT/ending.tmp.mp4" "$OUT/ending.mp4"
mv -f "$OUT/ending.tmp.webm" "$OUT/ending.webm"
# poster: an early frame (the leaf over the sky) - it shows while the film loads
low "$FF" -y -ss 1.0 -i "$OUT/ending.mp4" -frames:v 1 -q:v 2 -update 1 "$OUT/ending_poster.jpg"
rm -f "$M"
ls -la "$OUT"/ending*
