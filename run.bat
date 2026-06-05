@echo off
REM ── bas-js launcher (Windows) ────────────────────────────────────────────────
REM Opens index.html in Chrome/Edge with --allow-file-access-from-files so the page's
REM ES-module imports load over file://. A dedicated --user-data-dir keeps the saved
REM data-folder permission so it reconnects automatically on later runs.

setlocal
set "HTML=%~dp0index.html"
set "PROFILE=%LOCALAPPDATA%\bas-js-browser"

set "BROWSER="
for %%P in (
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
) do (
  if exist "%%~P" if not defined BROWSER set "BROWSER=%%~P"
)

if not defined BROWSER (
  echo Could not find Chrome or Edge. Install one to run bas-js.
  pause
  exit /b 1
)

REM ── read app title from index.html ──────────────────────────────────────────
for /f "tokens=2 delims=<>" %%T in ('findstr /i "<title>" "%HTML%"') do set "APPTITLE=%%T"
if not defined APPTITLE set "APPTITLE=bas-js"

echo Launching: "%BROWSER%"
start "" "%BROWSER%" --app="%HTML%" --allow-file-access-from-files --user-data-dir="%PROFILE%"

REM ── set data folder path (relative or absolute); leave blank to pick manually ──
set "DATAPATH=%~dp0cheque"
if not defined DATAPATH goto :done

echo Auto-connect: %DATAPATH%

start /B powershell -NoProfile -Command ^
  "$ws=New-Object -ComObject WScript.Shell; $p='%DATAPATH%'; $rClicked=$false;" ^
  "$t=0; $pick=$null; while($t -lt 15000){" ^
  "  $pick=Get-Process chrome,msedge -EA SilentlyContinue|Where-Object{$_.MainWindowTitle -like '*choose folder*'}; if($pick){break};" ^
  "  if(Get-Process chrome,msedge -EA SilentlyContinue|Where-Object{$_.MainWindowTitle -like '*File granted*'}){exit};" ^
  "  if(-not $rClicked){$rc=Get-Process chrome,msedge -EA SilentlyContinue|Where-Object{$_.MainWindowTitle -like '*Please reconnect*'}; if($rc){$ws.AppActivate($rc.Id); Start-Sleep -Milliseconds 800; $ws.SendKeys('{TAB}'); Start-Sleep -Milliseconds 500; $ws.SendKeys('{ENTER}'); $rClicked=$true}};" ^
  "  if($rClicked){$sel=Get-Process chrome,msedge -EA SilentlyContinue|Where-Object{$_.MainWindowTitle -like '*Selecting*'}; if($sel){$pick=$sel; break}};" ^
  "  Start-Sleep -Milliseconds 200; $t+=200};" ^
  "if(-not $pick){exit};" ^
  "if(-not $rClicked){$ws.AppActivate($pick.Id); Start-Sleep -Milliseconds 800; $ws.SendKeys('{TAB}'); Start-Sleep -Milliseconds 500; $ws.SendKeys('{ENTER}')};" ^
  "$t=0; while($t -lt 5000){if(Get-Process chrome,msedge -EA SilentlyContinue|Where-Object{$_.MainWindowTitle -like '*Selecting*'}){break}; Start-Sleep -Milliseconds 200; $t+=200};" ^
  "Start-Sleep -Milliseconds 1500;" ^
  "$ws.SendKeys('%%d'); Start-Sleep -Milliseconds 700;" ^
  "$ws.SendKeys($p); Start-Sleep -Milliseconds 500;" ^
  "$ws.SendKeys('{ENTER}');" ^
  "$i=0; while($i -lt 3){Start-Sleep -Milliseconds 500; $ws.SendKeys('{ENTER}'); $i++};" ^
  "Start-Sleep -Milliseconds 500; $ws.SendKeys('{TAB}'); $ws.SendKeys('{ENTER}');"

:done

endlocal