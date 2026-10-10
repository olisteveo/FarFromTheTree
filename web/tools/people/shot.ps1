# Screenshot a page with headless Edge/Chrome (below-normal priority), e.g.
#   powershell -File shot.ps1 "tools/people/test.html?mode=clips&clip=talk" clips_talk
#   powershell -File shot.ps1 "?nointro&at=6500,2" times 25000 5174
# Needs a Vite dev server (default :5173). Writes previews/web_<name>.png
param([string]$path = "tools/people/test.html?mode=lineup", [string]$name = "lineup", [int]$wait = 20000, [int]$port = 5173,
      [string]$size = "1280,720")
$exe = @("C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", "C:\Program Files\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$out = Join-Path $PSScriptRoot "previews\web_$name.png"
$prof = Join-Path $env:TEMP "fftt-people-shot"
$url = "http://localhost:$port/$path"
$p = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden -ArgumentList @(
  "--headless=new", "--user-data-dir=$prof", "--no-first-run", "--hide-scrollbars", "--enable-gpu", "--use-angle=d3d11", "--ignore-gpu-blocklist",
  "--window-size=$size", "--virtual-time-budget=$wait", "--run-all-compositor-stages-before-draw", "--screenshot=$out", $url)
try { $p.PriorityClass = "BelowNormal" } catch {}
if (-not $p.WaitForExit(120000)) {
  Get-CimInstance Win32_Process -Filter "name='msedge.exe' or name='chrome.exe'" | Where-Object { $_.CommandLine -like "*fftt-people-shot*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
if (Test-Path $out) { Write-Output $out } else { Write-Output "no screenshot" }
