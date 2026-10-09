@echo off
rem Builds vehicles.glb (+ previews) at low priority with 8 threads. Extra args go to the script, e.g. run.cmd --no-previews
start "" /low /b /wait "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b -t 8 --factory-startup --python "%~dp0build_vehicles.py" -- %*
