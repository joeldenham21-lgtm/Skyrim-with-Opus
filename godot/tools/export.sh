#!/bin/sh
# Build a release: tools/export.sh [linux|windows|android|all]
# Export templates must be installed (~/.local/share/godot/export_templates/4.5.stable/).
# Android additionally needs the Android SDK/NDK and a debug keystore configured in the editor settings;
# without them the Android preset fails with "Android build template not installed" — that is expected here.
set -e
HERE=$(cd "$(dirname "$0")/.." && pwd)
GODOT=${GODOT:-/tmp/claude-0/-home-user-Skyrim-with-Opus/4735b3e9-ed8f-54b0-979d-13b1690a1576/scratchpad/godot/Godot_v4.5-stable_linux.x86_64}
WHAT=${1:-linux}
cd "$HERE"
mkdir -p builds/linux builds/windows builds/android
"$GODOT" --headless --path . --import >/dev/null 2>&1 || true
one() {
  echo "=== exporting $1 -> $2"
  "$GODOT" --headless --path . --export-release "$1" "$2" 2>&1 | grep -vE "ALSA|snd_|^$" || true
  ls -la "$2" 2>/dev/null || echo "!! $1 export produced no file"
}
case "$WHAT" in
  linux)   one "Linux x86_64"   "builds/linux/RADIUS.x86_64" ;;
  windows) one "Windows x86_64" "builds/windows/RADIUS.exe" ;;
  android) one "Android arm64"  "builds/android/RADIUS.apk" ;;
  all)     one "Linux x86_64" "builds/linux/RADIUS.x86_64"; one "Windows x86_64" "builds/windows/RADIUS.exe"; one "Android arm64" "builds/android/RADIUS.apk" ;;
  *) echo "usage: tools/export.sh [linux|windows|android|all]"; exit 2 ;;
esac
