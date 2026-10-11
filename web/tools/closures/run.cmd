@echo off
rem Builds closures.glb (+ a contact-sheet preview) at idle priority with 8 threads. Extra args go to the script, e.g. run.cmd --no-previews
start "" /low /b /wait "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b -t 8 --factory-startup --python "%~dp0closures_blender.py" -- %*
