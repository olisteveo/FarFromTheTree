# Screenshot the game (street furniture checks) with headless Edge/Chrome (below-normal priority), e.g.
#   powershell -File shot.ps1 "nointro&at=6500,2" times
# Needs the Vite dev server on :5173. Writes previews/web_<name>.png
param([string]$query = "nointro&at=5600,2", [string]$name = "flatiron", [int]$wait = 20000)
$exe = @("C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", "C:\Program Files\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$out = Join-Path $PSScriptRoot "previews\web_$name.png"
$prof = Join-Path $env:TEMP "fftt-street-shot"
$url = "http://localhost:5173/?$query"
$p = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden -ArgumentList @(
  "--headless=new", "--user-data-dir=$prof", "--no-first-run", "--hide-scrollbars", "--enable-gpu", "--use-angle=d3d11",
  "--window-size=1280,720", "--virtual-time-budget=$wait", "--run-all-compositor-stages-before-draw", "--screenshot=$out", $url)
try { $p.PriorityClass = "BelowNormal" } catch {}
if (-not $p.WaitForExit(90000)) {
  Get-CimInstance Win32_Process -Filter "name='msedge.exe' or name='chrome.exe'" | Where-Object { $_.CommandLine -like "*fftt-street-shot*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
if (Test-Path $out) { Write-Output $out } else { Write-Output "no screenshot" }
