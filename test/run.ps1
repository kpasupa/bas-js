# Runs the bas-js test harness in headless Chrome and prints the results block.
$chrome  = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$page    = 'file:///' + (($here -replace '\\','/')) + '/harness.html'
$tmp     = Join-Path $env:TEMP ('basjs-cdp-' + [guid]::NewGuid().ToString('N'))
$outfile = Join-Path $env:TEMP ('basjs-dom-' + [guid]::NewGuid().ToString('N') + '.html')

$cmd = '"' + $chrome + '" --headless --disable-gpu --no-sandbox --no-first-run ' +
       '--disable-crash-reporter --disable-breakpad --virtual-time-budget=15000 ' +
       '--user-data-dir="' + $tmp + '" --dump-dom "' + $page + '" > "' + $outfile + '" 2>nul'
cmd /c $cmd | Out-Null

$dom = Get-Content $outfile -Raw -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $tmp     -ErrorAction SilentlyContinue
Remove-Item -Force        $outfile   -ErrorAction SilentlyContinue

if (-not $dom) { Write-Output 'NO RESULTS CAPTURED'; exit 1 }
$m = [regex]::Match($dom, '(?s)<pre id="out">(.*?)</pre>')
if (-not $m.Success) { Write-Output 'NO <pre> FOUND'; Write-Output $dom; exit 1 }
$txt = $m.Groups[1].Value
$txt = $txt -replace '&lt;','<' -replace '&gt;','>' -replace '&quot;','"' -replace '&#39;',"'" -replace '&amp;','&'
Write-Output $txt
