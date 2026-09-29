#!/usr/bin/env bash
# Turn the Actions & Stuff resource pack (a GLOBAL pack) on/off, for A/B testing.
#
# Actions & Stuff is applied globally, so it affects EVERY world (including the test
# ones) and touches player animations that depend on camera/perspective. This script
# only edits the global pack list, always with a backup:
#
#   ./ans_toggle.sh off   # turn A&S off (keeping a backup)
#   ./ans_toggle.sh on    # turn it back on
#   ./ans_toggle.sh       # show the current state
#
# Always run it with Minecraft closed.
set -euo pipefail

CFG="$HOME/.var/app/com.trench.trinity.launcher/data/mcpelauncher/games/com.mojang/minecraftpe/global_resource_packs.json"
BAK="$CFG.camera-menu-backup"

# Read the real process name from /proc (comm truncated to 15 chars). `pgrep -f`
# was a false positive: it matches the ".../com.trench.trinity.launcher/..." path
# present in any command line (including an idle launcher).
# No pipe here: with `pipefail`, a `grep -q` that matches the first item kills the
# producer with SIGPIPE and the status becomes 141 (a false negative).
has_proc() {
    local c n
    for c in /proc/[0-9]*/comm; do
        read -r n < "$c" 2>/dev/null || continue
        [ "$n" = "$1" ] && return 0
    done
    return 1
}

# mcpelauncher-client = the game running (comm truncated: mcpelauncher-cl)
if has_proc "mcpelauncher-cl"; then
    echo "ERROR: Minecraft is running with a world loaded. Close the game and run again."
    exit 1
fi
if has_proc "trinity"; then
    echo "WARNING: the launcher is open. If the game already read the global packs,"
    echo "         close and reopen the world for the change to apply."
    echo
fi

usage() {
    echo "usage: $0 [off|on|status]"
    exit 2
}

case "${1:-status}" in
    off)
        if [ ! -f "$BAK" ]; then
            cp -p "$CFG" "$BAK"
            echo "backup created: $BAK"
        fi
        echo "[]" > "$CFG"
        echo "A&S DISABLED (global packs emptied). Run './ans_toggle.sh on' after testing."
        ;;
    on)
        if [ -f "$BAK" ]; then
            cp -p "$BAK" "$CFG"
            echo "A&S re-enabled from the backup."
        else
            echo "No backup found — this script never turned A&S off."
        fi
        ;;
    status)
        echo "current global packs:"
        cat "$CFG"
        echo
        if [ -f "$BAK" ]; then
            echo "(backup exists: $BAK — 'on' restores it)"
        fi
        ;;
    *)
        usage
        ;;
esac
