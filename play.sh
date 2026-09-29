#!/usr/bin/env bash
# Enable the camera experiment in the worlds and launch Minecraft (Trinity).
#
# !!! READ THIS FIRST !!!
# Turning an experiment on disables achievements for that world PERMANENTLY — the game
# flags it with experiments_ever_used and never takes that back, even if the experiment
# is later switched off. The native camera path needs this experiment; the script camera
# path does not. So on a world whose achievements matter, do NOT run this: just play, and
# the add-on falls back to the script camera by itself.
#
# Why this exists at all: for a world where achievements are already gone (or never
# mattered), the native camera is smoother than the script one, and the game DISCARDS the
# experiment flag when it saves the world — so flipping it once in level.dat is not
# enough. This wrapper flips it before every launch.
#
# Usage:
#   ./play.sh                     # refuses: enabling the experiment is irreversible
#   ./play.sh --yes                # enable it in every world and open the game
#   ./play.sh "teste addons" --yes # only in the world with that name
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORLDS="$HOME/.var/app/com.trench.trinity.launcher/data/mcpelauncher/games/com.mojang/minecraftWorlds"
EXPERIMENT="experimental_creator_cameras"

# --yes (or CAMERA_MENU_I_KNOW=1) is required: see the warning above.
YES=0
ARGS=()
for arg in "$@"; do
    case "$arg" in
        --yes) YES=1 ;;
        *) ARGS+=("$arg") ;;
    esac
done
FILTER="${ARGS[0]:-}"

if [ "$YES" -ne 1 ] && [ "${CAMERA_MENU_I_KNOW:-0}" != "1" ]; then
    echo "WARNING: this enables the '$EXPERIMENT' experiment, which disables"
    echo "         achievements for the affected worlds PERMANENTLY."
    echo
    echo "         You do not need it. The add-on works without it by using the"
    echo "         script camera (no experiment, no cheats, achievements kept)."
    echo "         Only enable it on a world whose achievements are already lost."
    echo
    echo "         Re-run with --yes to confirm, or just play normally."
    exit 1
fi

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
