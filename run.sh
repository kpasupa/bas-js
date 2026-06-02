#!/usr/bin/env bash
# ── bas-js launcher (macOS / Linux) ───────────────────────────────────────────
# Opens index.html in Chrome/Edge/Chromium with --allow-file-access-from-files so the
# page's ES-module imports load over file://. A dedicated --user-data-dir keeps the saved
# data-folder permission so it reconnects automatically on later runs.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
HTML="$DIR/index.html"
PROFILE="${TMPDIR:-/tmp}/bas-js-browser"

# Locate a Chromium-family browser.
BROWSER=""
CANDIDATES=(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
  "$(command -v google-chrome || true)"
  "$(command -v google-chrome-stable || true)"
  "$(command -v chromium || true)"
  "$(command -v microsoft-edge || true)"
)
for c in "${CANDIDATES[@]}"; do
  if [ -n "$c" ] && [ -x "$c" ]; then BROWSER="$c"; break; fi
done

if [ -z "$BROWSER" ]; then
  echo "Could not find Chrome/Edge/Chromium. Install one to run bas-js."
  exit 1
fi

echo "Launching: $BROWSER"
"$BROWSER" --app="file://$HTML" --allow-file-access-from-files --user-data-dir="$PROFILE" --disable-extensions --no-first-run --disable-infobars >/dev/null 2>&1 &
