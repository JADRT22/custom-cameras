# Custom Cameras (Menu)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Minecraft Bedrock](https://img.shields.io/badge/Minecraft%20Bedrock-26.50-62b47a)](#compatibility)
[![Release](https://img.shields.io/github/v/release/JADRT22/custom-cameras)](https://github.com/JADRT22/custom-cameras/releases)

**English** · [Português](README.pt-BR.md)

Camera presets for **Minecraft Bedrock** — shoulder, far and cinematic cameras, switched from an
in-game menu or slash commands. Works on any world with **no cheats and no experiment**, and
your world keeps its achievements.

<!-- TODO: add a GIF of the menu opening (hold Shift for 2s) here -->

| Over the right shoulder (`right`) | Over the left shoulder (`left`) |
| --- | --- |
| ![Right Shoulder](docs/right-shoulder.png) | ![Left Shoulder](docs/left-shoulder.png) |

The two shoulder cameras are the same framing mirrored. Over the **right** shoulder puts the
camera to your right, so you appear on the left of the frame (and vice versa).

## Features

- 7 cameras, all usable from the menu or from commands
- Opens the menu by **holding Shift while standing still for 2 seconds**
- Remembers your last camera, per player and per world
- Restores your camera after you die or respawn
- Pauses automatically while sleeping, riding or gliding, then restores
- Smooth, engine-driven movement (native presets, same feel as vanilla third person)
- English and Portuguese (pt_BR) text

## Installation

1. Download `CameraMenu-v1.1.1.mcaddon` from the [Releases](https://github.com/JADRT22/custom-cameras/releases) page.
2. Open it with Minecraft to import.
3. On your world, go to **Behavior Packs** and enable **Camera Menu**.

That's it. Leave cheats **off** and don't enable any experiment — neither is needed, and
turning either on costs that world its achievements for nothing.

## Cameras

| Camera | Description | `/cameramenu:set` |
| --- | --- | --- |
| Default | Back to first person | `default` |
| Left Shoulder | Camera over your left shoulder; you appear on the right of the frame | `left` |
| Center Shoulder | Same distance as the shoulders, directly behind you | `center` |
| Right Shoulder | Camera over your right shoulder; you appear on the left of the frame | `right` |
| Boom Shoulder | Fixed distance, no orbit, no side offset | `boom` |
| Far | Distant third person | `far` |
| Low Cinematic | Low free camera behind the player, resets itself after 3s. **Experimental**, see [Known issues](#known-issues) | `low` |

## Commands

All commands work **without cheats**.

| Command | What it does |
| --- | --- |
| `/cameramenu:open` | Open the camera menu |
| `/cameramenu:set <default\|left\|center\|right\|boom\|far\|low>` | Switch directly to a camera |
| `/cameramenu:next` | Cycle through the persistent cameras |
| `/cameramenu:reset` | Back to default (the escape hatch) |

The menu also opens on its own when you hold **Shift while standing still** for 2 seconds.
Move to cancel the timer.

## Notes

- **No crosshair.** When the camera detaches from the player, the vanilla crosshair disappears. This is expected.
- **Sneak animations.** Holding Shift is sneaking, so any animation pack you use (for example Actions & Stuff) will play its sneak animation while the timer runs.
- **Achievements** also require Survival mode, no matter what any pack does.

## Compatibility

| Component | Version |
| --- | --- |
| Minecraft Bedrock | 26.50 |
| `@minecraft/server` | 2.10.0 |
| `@minecraft/server-ui` | 2.2.0 |
| Add-on | 1.1.1 |

Script API versions change often. Other game versions are untested and may need edits to `scripts/main.js` and the manifest.

## Known issues

- **Low Cinematic is unverified.** It uses the `minecraft:free` camera through the script API, the same form that turned out not to render in 26.50. It may do nothing. If it is dead, it will be removed.
- Camera presets are read when the world loads, so changing their values requires re-entering the world (see [Tuning](#tuning-the-cameras)).

## Troubleshooting

**Nothing happens, no message.** The pack must be enabled under **Behavior Packs** on that world. That is the only requirement.

**Chat says the game rejected a camera preset.** A preset failed the schema check. Check the newest `ContentLog*.txt` for `Invalid camera preset` or `Failed to load camera presets`, which names the offending field. See [docs/INTERNALS.md](docs/INTERNALS.md) for the schema rules.

**My achievements are disabled and I never used cheats.** Either the world has had an experiment enabled, or the pack manifest is missing `"metadata": { "product_type": "addon" }` (this repo has it). To check a world:

```
python3 build/nbt_experiments.py "<world>/level.dat"
```

If `experiments_ever_used` is `1`, the world is already flagged and the game will not give achievements back.

## Development

### Build and install

```
python3 build.py            # validate + package dist/*.mcaddon
python3 build.py --install  # also install into development_behavior_packs/
python3 build.py --icon     # (re)generate pack_icon.png
```

The build refuses to package unless the manifest, UUIDs, modules, dependencies, every camera
preset and both `.lang` files pass validation.

`build.py` reads the game directory from `GAME_DIR`, which currently points at the Flatpak
launcher path (`~/.var/app/com.trench.trinity.launcher/...`). Adjust it for other setups.

### Tuning the cameras

```
python3 tune.py               # show current values
python3 tune.py --y 0.4       # raise the shoulder camera
python3 tune.py --x 1.5       # push the player further to the side
python3 tune.py --radius 1.5  # shoulder cameras closer (smaller = tighter)
python3 tune.py --far 12      # distance of the far camera
```

`tune.py` rewrites the presets and reinstalls. Re-enter the world to reload them. You can also
edit `cameras/presets/<name>.json` by hand and run `python3 build.py --install`.

### Repository layout

```
src/camera_menu_bp/        the behavior pack itself (this is what ships)
  manifest.json            UUIDs, modules, dependencies
  cameras/presets/*.json   one native camera preset per file
  scripts/main.js          menu, commands, persistence
  texts/*.lang             pack name / description (en_US, pt_BR)
build.py                   validate + package + install
build/                     helper scripts (brarchive lister, level.dat NBT tools, icon generator)
tune.py                    calibrate shoulder camera framing + reinstall
play.sh                    enables an experiment in worlds (do not use, see below)
ans_toggle.sh              testing helper for isolating a global resource pack
docs/                      screenshots and internals
```

> **About `play.sh`:** it turns on `experimental_creator_cameras`, which this add-on does **not** need,
> and doing so permanently disables that world's achievements. It refuses to run without `--yes`.
> Leave it alone unless you know why you want it.

## More documentation

- [docs/INTERNALS.md](docs/INTERNALS.md): schema rules, engineering notes and the hidden script camera
- [CHANGELOG.md](CHANGELOG.md)

## License

[MIT](LICENSE)
