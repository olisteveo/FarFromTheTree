# Timed frames with and without the people in a busy spot, headless (GPU on), e.g.
#   powershell -File bench.ps1 "nointro&at=6500,2" times 60 5174 1920,1080
# Needs a dev server with the /__rec endpoint (the main one, or vite.solo.config.ts on :5174).
# Writes web/recordings/bench/<name>.json and .jpg, prints the json.
param([string]$game = "nointro&at=6500,2", [string]$name = "times", [int]$n = 60, [int]$port = 5174, [string]$size = "1920,1080", [string]$extra = "")
$exe = @("C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", "C:\Program Files\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$out = Join-Path $PSScriptRoot "..\..\recordings\bench\$name.json"
if (Test-Path $out) { Remove-Item $out }
$prof = Join-Path $env:TEMP "fftt-people-bench"
$url = "http://localhost:$port/tools/people/bench.html?g=$([uri]::EscapeDataString($game))&n=$n&name=$name$extra"
$p = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden -ArgumentList @(
  "--headless=new", "--user-data-dir=$prof", "--no-first-run", "--hide-scrollbars", "--enable-gpu", "--use-angle=d3d11", "--ignore-gpu-blocklist",
  "--disable-gpu-vsync", "--disable-frame-rate-limit", "--window-size=$size", $url)
$t = 0
while (-not (Test-Path $out) -and $t -lt 400) { Start-Sleep 2; $t += 2 }
Start-Sleep 1
Get-CimInstance Win32_Process -Filter "name='msedge.exe' or name='chrome.exe'" | Where-Object { $_.CommandLine -like "*fftt-people-bench*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
if (Test-Path $out) { Get-Content $out } else { "no result" }
