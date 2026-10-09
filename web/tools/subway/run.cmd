@echo off
rem Rebuilds every subway asset (Tesseract textures + Blender models + previews) at idle priority, Blender on 8 threads.
rem Extra args go to build_subway.py, e.g. run.cmd --skip-textures --no-previews
start "" /low /b /wait python "%~dp0build_subway.py" %*
