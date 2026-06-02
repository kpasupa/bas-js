@echo off
REM ── bas-js launcher (Windows) ────────────────────────────────────────────────
REM Opens index.html in Chrome/Edge with --allow-file-access-from-files so the
REM page's ES-module imports load over file://. A dedicated --user-data-dir keeps
REM the saved data-folder permission so it reconnects automatically on later runs.

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
start "" "%BROWSER%" --app="file:///%HTML:\=/%" --allow-file-access-from-files --user-data-dir="%PROFILE%" --disable-extensions --no-first-run --disable-infobars
endlocal
