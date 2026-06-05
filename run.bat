@echo off
REM ── bas-js launcher (Windows) ────────────────────────────────────────────────
REM Opens index.html in a dedicated Chrome/Edge app window. The separate
REM --user-data-dir keeps the saved folder permission isolated from regular Chrome.

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

echo Launching: "%BROWSER%"
start "" "%BROWSER%" --app="%HTML%" --user-data-dir="%PROFILE%"

endlocal
