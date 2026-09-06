#!/bin/sh
# Headless render of a scenario: tools/shot.sh tools/scenarios/<name>.gd [WxH]
# Runs Godot under Xvfb with Mesa's software Vulkan (lavapipe) and writes PNGs to .shots/<name>/.
set -e
HERE=$(cd "$(dirname "$0")/.." && pwd)
GODOT=${GODOT:-/tmp/claude-0/-home-user-Skyrim-with-Opus/4735b3e9-ed8f-54b0-979d-13b1690a1576/scratchpad/godot/Godot_v4.5-stable_linux.x86_64}
SCEN=$1; RES=${2:-960x540}
NAME=$(basename "$SCEN" .gd)
mkdir -p "$HERE/.shots/$NAME"
export VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json
export RADIUS_SHOTS="$HERE/.shots/$NAME"
cd "$HERE"
# Serialise headless Godot runs (4 CPUs, software Vulkan) and make sure new assets are imported first.
exec 9>/tmp/radius-godot.lock; flock 9
if [ -z "$NO_IMPORT" ]; then "$GODOT" --headless --path . --import >/dev/null 2>&1 || true; fi
xvfb-run -a -s "-screen 0 1280x720x24" timeout ${TIMEOUT:-600} "$GODOT" --path . --rendering-driver vulkan --resolution "$RES" --scenario "$SCEN" 2>&1 | grep -vE "ALSA|snd_|audio_driver_alsa|dummy driver|^$|WARNING: All audio"
ls "$HERE/.shots/$NAME"
