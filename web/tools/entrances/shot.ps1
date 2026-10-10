# Screenshot any game URL with headless Edge/Chrome at below-normal priority, e.g.
#   powershell -File tools/entrances/shot.ps1 "?nointro&at=180,4" bowling
# Needs a Vite dev server on -port (default 5181: npx vite --port 5181). Writes tools/shots/<name>.png
param([string]$query = "?nointro", [string]$name = "shot", [int]$wait = 15000, [int]$port = 5181)
$exe = @("C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", "C:\Program Files\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$dir = Join-Path $PSScriptRoot "../shots"; New-Item -ItemType Directory -Force $dir | Out-Null
$out = Join-Path $dir "$name.png"
$prof = Join-Path $env:TEMP "fftt-entr-shot"
$p = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden -ArgumentList @(
  "--headless=new", "--user-data-dir=$prof", "--no-first-run", "--hide-scrollbars", "--enable-gpu", "--use-angle=d3d11", "--autoplay-policy=no-user-gesture-required",
  "--window-size=1280,720", "--virtual-time-budget=$wait", "--run-all-compositor-stages-before-draw", "--screenshot=$out", "http://localhost:$port/$query")
try { $p.PriorityClass = "BelowNormal" } catch {}
if (-not $p.WaitForExit(90000)) {
  Get-CimInstance Win32_Process -Filter "name='msedge.exe' or name='chrome.exe'" | Where-Object { $_.CommandLine -like "*fftt-entr-shot*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
if (Test-Path $out) { Write-Output $out } else { Write-Output "no screenshot" }
