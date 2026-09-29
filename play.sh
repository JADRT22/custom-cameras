#!/usr/bin/env bash
# Enable the camera experiment in the worlds and launch Minecraft (Trinity).
#
# Why this exists: the game DISCARDS the experiment flag when it saves the world,
# so flipping it once in level.dat is not enough. This wrapper flips it before launch.
#
# Usage:
#   ./play.sh                 # enable it in every world and open the game
#   ./play.sh "teste addons"  # only in the world with that name
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORLDS="$HOME/.var/app/com.trench.trinity.launcher/data/mcpelauncher/games/com.mojang/minecraftWorlds"
FILTER="${1:-}"
EXPERIMENT="experimental_creator_cameras"

# Read the real process name (comm, truncated to 15 chars) from /proc.
# This avoids the `pgrep -f` false positive: that pattern also matches the
# ".../com.trench.trinity.launcher/data/..." path sitting in any command line.
# No pipe here: with `pipefail`, a `grep -q` that matches the first item kills
# the producer with SIGPIPE and the status becomes 141 (a false negative).
has_proc() {
    local c n
    for c in /proc/[0-9]*/comm; do
        read -r n < "$c" 2>/dev/null || continue
        [ "$n" = "$1" ] && return 0
    done
    return 1
}

# The game client is `mcpelauncher-client` (comm truncated: mcpelauncher-cl).
# The launcher GUI is `trinity` — it may stay open, the game itself may not.
if has_proc "mcpelauncher-cl"; then
    echo "ERROR: Minecraft is running with a world loaded."
    echo "       Close the world/game (the launcher may stay open) and run again,"
    echo "       otherwise the game overwrites level.dat on save and the flag is lost."
    exit 1
fi

count=0
for w in "$WORLDS"/*/; do
    [ -f "$w/level.dat" ] || continue
    name="$(cat "$w/levelname.txt" 2>/dev/null || basename "$w")"
    if [ -n "$FILTER" ] && [ "$name" != "$FILTER" ]; then
        continue
    fi
    python3 "$HERE/build/toggle_experiment.py" "$w" "$EXPERIMENT" on >/dev/null
    echo "experiment enabled: $name"
    count=$((count + 1))
done

if [ "$count" -eq 0 ]; then
    echo "ERROR: no world found (filter: ${FILTER:-all})."
    exit 1
fi

if has_proc "trinity"; then
    echo "launcher is already open — just open the world \"${FILTER:-...}\" now."
    echo "(not opening a second instance)"
else
    echo "launching Minecraft..."
    exec flatpak run com.trench.trinity.launcher
fi
