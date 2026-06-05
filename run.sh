#!/usr/bin/env bash
# ── bas-js launcher (macOS / Linux) ───────────────────────────────────────────
# Opens index.html in a dedicated Chrome/Edge/Chromium app window.
# The separate --user-data-dir keeps the saved folder permission isolated
# from your regular browser profile.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
HTML="$DIR/index.html"
PROFILE="${HOME}/.config/bas-js-browser"

# Locate a Chromium-family browser
BROWSER=""
for c in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium" \
  "$(command -v google-chrome-stable 2>/dev/null || true)" \
  "$(command -v google-chrome 2>/dev/null || true)" \
  "$(command -v chromium 2>/dev/null || true)" \
  "$(command -v microsoft-edge 2>/dev/null || true)"
do
  if [ -n "$c" ] && [ -x "$c" ]; then BROWSER="$c"; break; fi
done

if [ -z "$BROWSER" ]; then
  echo "Could not find Chrome, Edge, or Chromium. Install one to run bas-js."
  exit 1
fi

echo "Launching: $BROWSER"
"$BROWSER" --app="file://$HTML" --user-data-dir="$PROFILE" >/dev/null 2>&1 &
