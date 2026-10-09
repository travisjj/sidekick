#!/usr/bin/env bash
# Launches Chrome with the DevTools Protocol enabled for drive-chrome.
#
# A dedicated user data directory is required: Chrome refuses --remote-debugging-port when it
# would join an already-running default-profile instance. The profile is kept out of any
# cloud-synced folder on purpose; sync would fight Chrome for the file locks.
#
# Port defaults to 9333 (not the conventional 9222, which many tools attach to). Override with
# the DRIVE_CHROME_PORT environment variable; cdp.mjs reads the same variable.

set -euo pipefail

PORT="${DRIVE_CHROME_PORT:-9333}"
START_URL="${1:-about:blank}"

case "$(uname -s)" in
  Darwin)
    PROFILE_DIR="$HOME/Library/Application Support/drive-chrome-profile"
    CHROME_CANDIDATES=(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    )
    ;;
  *)
    PROFILE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/drive-chrome-profile"
    CHROME_CANDIDATES=(
      "$(command -v google-chrome || true)"
      "$(command -v google-chrome-stable || true)"
      "$(command -v chromium || true)"
      "$(command -v chromium-browser || true)"
    )
    ;;
esac

mkdir -p "$PROFILE_DIR"

CHROME=""
for candidate in "${CHROME_CANDIDATES[@]}"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    CHROME="$candidate"
    break
  fi
done

if [ -z "$CHROME" ]; then
  echo "Chrome was not found in the usual locations. Install Chrome or edit the candidate list in this script." >&2
  exit 1
fi

"$CHROME" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE_DIR" \
  --no-first-run \
  --no-default-browser-check \
  "$START_URL" >/dev/null 2>&1 &

echo "Chrome launched on port $PORT with profile $PROFILE_DIR"
echo "Verify with: curl -s --max-time 5 http://localhost:$PORT/json/version"
