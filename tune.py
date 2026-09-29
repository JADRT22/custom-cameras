#!/usr/bin/env python3
"""Tune the framing of the shoulder cameras and reinstall into the game.

Camera height is a matter of taste, so instead of guessing this script lets you
calibrate it straight from the terminal:

  python3 tune.py                  # show the current values
  python3 tune.py --y 0.4          # raise the camera (view_offset Y axis)
  python3 tune.py --y -0.2         # lower the camera
  python3 tune.py --x 1.5          # push the player further to the side
  python3 tune.py --y 0.4 --x 1.0  # both at once

Only presets inheriting from follow_orbit accept view_offset/entity_offset — that
is what the 26.50 binary requires (`Cannot use view_offset on a preset that is not
a follow_orbit camera!`). That is why this only touches the shoulder cameras.

Re-enter the world after running it so the game reloads the presets.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PRESETS = ROOT / "src" / "camera_menu_bp" / "cameras" / "presets"
# filename -> whether the X axis is meaningful (False = keep it centered at 0)
SHOULDER = {
    "shoulder_left.json": True,
    "shoulder_center.json": False,  # centered camera: X stays 0
    "shoulder_right.json": True,
}


def load(path):
    return json.loads(path.read_text())


def dump(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def show():
    print("== current view_offset (x, y) ==")
    for name in SHOULDER:
        obj = load(PRESETS / name)["minecraft:camera_preset"]
        print(f"  {name:22} {obj.get('view_offset')}")


def main():
    args = sys.argv[1:]
    if not args:
        show()
        print("\nusage: python3 tune.py --y <height> [--x <side>]")
        return

    y = x = None
    if "--y" in args:
        y = float(args[args.index("--y") + 1])
    if "--x" in args:
        x = float(args[args.index("--x") + 1])
    if y is None and x is None:
        print("nothing to do: pass --y and/or --x")
        sys.exit(2)

    for name, has_x in SHOULDER.items():
        path = PRESETS / name
        data = load(path)
        obj = data["minecraft:camera_preset"]
        if obj.get("inherit_from") != "minecraft:follow_orbit":
            print(f"  [skipped] {name}: does not inherit from follow_orbit")
            continue
        cur = list(obj.get("view_offset", [0.0, 0.0]))
        new_y = y if y is not None else cur[1]
        new_x = x if (x is not None and has_x) else cur[0]
        obj["view_offset"] = [float(new_x), float(new_y)]
        dump(path, data)
        print(f"  [ok] {name}: view_offset = {obj['view_offset']}")

    print("\n== reinstalling ==")
    subprocess.run([sys.executable, str(ROOT / "build.py"), "--install"], check=True)
    print("Done — re-enter the world for it to apply.")


if __name__ == "__main__":
    main()
