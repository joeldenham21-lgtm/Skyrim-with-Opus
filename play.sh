#!/usr/bin/env sh
# WYRMHOLD — start the game. Uses node if available, otherwise python3.
set -e
PORT="${PORT:-8080}"
if command -v node >/dev/null 2>&1; then
  PORT="$PORT" exec node "$(dirname "$0")/serve.js"
elif command -v python3 >/dev/null 2>&1; then
  echo ""
  echo "  ⚔  WYRMHOLD — Crown of the North"
  echo ""
  echo "  Play at:  http://localhost:$PORT/"
  echo "  Stop with Ctrl+C"
  echo ""
  cd "$(dirname "$0")"
  exec python3 -m http.server "$PORT"
else
  echo "Need node or python3 to serve the game (ES modules can't load from file://)." >&2
  exit 1
fi
