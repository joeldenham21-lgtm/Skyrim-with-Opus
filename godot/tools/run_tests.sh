#!/bin/sh
# Run every headless logic test: tools/run_tests.sh [pattern]
# Tests are SceneTree scripts in tools/tests/*.gd. A test passes when it exits 0 and prints no "FAIL".
set -e
HERE=$(cd "$(dirname "$0")/.." && pwd)
GODOT=${GODOT:-/tmp/claude-0/-home-user-Skyrim-with-Opus/4735b3e9-ed8f-54b0-979d-13b1690a1576/scratchpad/godot/Godot_v4.5-stable_linux.x86_64}
PAT=${1:-}
cd "$HERE"
exec 7>/tmp/radius-godot-import.lock; flock 7
"$GODOT" --headless --path . --import >/dev/null 2>&1 || true
flock -u 7
pass=0; fail=0; failed=""
for t in tools/tests/*.gd; do
  [ -e "$t" ] || continue
  case "$t" in *_driver.gd|*/_*.gd) continue;; esac
  if [ -n "$PAT" ]; then case "$t" in *"$PAT"*) ;; *) continue;; esac; fi
  if timeout "${TEST_TIMEOUT:-300}" "$GODOT" --headless --path . -s "$t" >/tmp/radius-test.out 2>&1; then code=0; else code=$?; fi
  out=$(grep -vE "ALSA|snd_|audio_driver_alsa|dummy driver|WARNING: All audio" /tmp/radius-test.out || true)
  echo "$out" | sed "s|^|  |"
  if [ $code -eq 0 ] && ! echo "$out" | grep -q "FAIL\|SCRIPT ERROR"; then
    echo "PASS $t"; pass=$((pass+1))
  else
    echo "FAIL $t"; fail=$((fail+1)); failed="$failed $t"
  fi
done
echo "--- tests: $pass passed, $fail failed$([ -n "$failed" ] && echo " ($failed )")"
[ $fail -eq 0 ]
