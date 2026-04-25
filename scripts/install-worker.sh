#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TSX_PATH="$PROJECT_ROOT/node_modules/.bin/tsx"
PLIST_SRC="$PROJECT_ROOT/scripts/com.adai.worker.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.adai.worker.plist"

if [ ! -x "$TSX_PATH" ]; then
  echo "Error: $TSX_PATH not found. Run 'npm install' first." >&2
  exit 1
fi

mkdir -p "$PROJECT_ROOT/logs"
mkdir -p "$HOME/Library/LaunchAgents"

if [ -f "$PLIST_DST" ]; then
  echo "plist already exists at $PLIST_DST; keeping existing file (edit it and re-run to load)."
else
  sed -e "s|__PROJECT_ROOT__|$PROJECT_ROOT|g" \
      -e "s|__TSX_PATH__|$TSX_PATH|g" \
      "$PLIST_SRC" > "$PLIST_DST"
  echo "Generated $PLIST_DST from template."
fi

# Worker reads config.toml from PROJECT_ROOT cwd at runtime — no env injection needed.

launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load "$PLIST_DST"

echo "Worker loaded: $PLIST_DST"
echo "Logs: $PROJECT_ROOT/logs/worker.{log,err}"
