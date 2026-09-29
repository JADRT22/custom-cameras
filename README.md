# Custom Cameras (Menu)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Camera presets for **Minecraft Bedrock 26.50** — switched from an in-game menu or slash
commands, on any world, **without enabling cheats**.

Built and maintained entirely from the terminal: no GUI on the desktop, the menu lives
inside the game.

## Cameras

| Preset | Description | Key |
|---|---|---|
| Default | Back to first person | `default` |
| Left Shoulder | Orbit at the shoulder (`radius: 2.5`, `view_offset [-1.2, 0]`) | `left` |
| Center Shoulder | Shoulder orbit, centered and closer | `center` |
| Right Shoulder | Orbit at the shoulder, player pushed to the side | `right` |
| Boom Shoulder | Variant built on `fixed_boom`: no orbit, fixed distance, no offset | `boom` |
| Far | Distant third person (`radius: 7`) | `far` |
| Low Cinematic | Low `minecraft:free` camera behind the player; resets itself | `low` |

## Commands

All of these work **without cheats** (`cheatsRequired: false`):

- `/cameramenu:open` — open the camera menu
- `/cameramenu:set <default|left|center|right|boom|far|low>` — switch directly
- `/cameramenu:reset` — back to default (the escape hatch)

The last camera you pick is reapplied when you re-enter the world. Switching does a quick
fade. The mod does **not** draw a crosshair: when the camera detaches from the player the
vanilla crosshair disappears, and that is expected.

## Requirements

> **This add-on needs the `experimental_creator_cameras` experiment enabled on the world.**
> Shoulder and far cameras inherit from `minecraft:follow_orbit` and `minecraft:fixed_boom`,
> which are experimental camera presets.

Two consequences worth knowing up front:

1. **Installing it as a plain `.mcaddon` is not enough.** If the experiment is off, the
   native presets fail and the add-on silently drops to a script-driven free camera
   (works, but it is smoother to have the native presets).
2. **The game clears the experiment flag when it saves the world.** So this is not a
   one-time toggle — it has to be re-enabled for each session. That is what `./play.sh`
   in this repo automates.

## Installation

### From a release `.mcaddon`

1. Grab `CameraMenu-v1.0.0.mcaddon` from the releases / `dist/`.
2. Double-click it (or open it with Minecraft) to import.
3. Enable it on the world under **Behavior Packs**.
4. Enable **Experimental Creator Camera Features** in the world's experiment settings.

### Development install (what this repo does)

```bash
python3 build.py --install
```

That validates, packages into `dist/`, and copies the pack into
`development_behavior_packs/`, so a world sees it as a development pack and picks up
edits immediately.

## Repository layout

```
src/camera_menu_bp/        the behavior pack itself (this is what ships)
  manifest.json            UUIDs, modules, dependencies
  cameras/presets/*.json   one native camera preset per file
  scripts/main.js          menu, commands, fallback camera, persistence
  texts/*.lang             pack name / description (en_US, pt_BR)
build.py                   validate + package + install
build/toggle_experiment.py enable/disable an experiment in a world's level.dat
build/nbt_experiments.py   read the 'experiments' compound back out of level.dat
build/make_icon.py         generate pack_icon.png with no dependencies
play.sh                    enable the experiment, then launch the game
tune.py                    calibrate shoulder camera framing + reinstall
ans_toggle.sh              A/B testing helper for a global resource pack
```

## Usage

```bash
python3 build.py            # validate + package dist/*.mcaddon
python3 build.py --install  # also install into the game
python3 build.py --icon     # (re)generate pack_icon.png
```

The build refuses to package unless the manifest, UUIDs, modules, dependencies, every
camera preset and both `.lang` files pass validation.

### Getting the experiment to stay on

`play.sh` enables the experiment in the worlds and then launches the game. It refuses to
run while the game has a world loaded, because the game would overwrite `level.dat` on
save and lose the flag:

```bash
./play.sh                  # every world
./play.sh "My World"       # only that world
```

It detects a running game by reading `/proc/<pid>/comm`, so an open launcher does not
block it (in that case it just skips launching a second instance and waits for you).

<details>
<summary>Manual equivalent</summary>

```bash
python3 build/toggle_experiment.py "<world_dir>" experimental_creator_cameras on
```

A backup named `level.dat.camera-menu-backup` is written next to `level.dat` the first
time. Or enable it from the in-game UI: **World Settings → Experiments → Experimental
Creator Camera Features** (when the game itself writes it, it sticks).

</details>

## Tuning the shoulder cameras

Camera height is a matter of taste, so there is a terminal shortcut for it:

```bash
python3 tune.py            # show the current values
python3 tune.py --y 0.4    # raise the shoulder camera
python3 tune.py --y -0.2   # lower it
python3 tune.py --x 1.5    # push the player further to the side
```

`tune.py` rewrites the presets and reinstalls. Re-enter the world for the game to reload
them. You can also edit `cameras/presets/<name>.json` by hand and run
`python3 build.py --install`.

## How it works

The interesting parts are the schema rules that cost real debugging time to pin down.
They are enforced by the build validator so they cannot regress.

- **One object per file.** `minecraft:camera_preset` must be a single object `{...}` — an
  array is rejected with `minecraft:camera_preset: expected an object`.
- **Own namespace only.** Identifiers must stay in `cm:`; using `minecraft:*` makes the
  game discard the file.
- **The distance field is `radius`, and it only exists on `follow_orbit`.** It also
  requires `format_version: 1.21.90`. On `fixed_boom`, `radius` is accepted but
  **silently ignored** (the camera stays at the default 10).
- **`starting_radius` does not exist.** It is not part of the camera preset schema at
  all — the game logs `this member was found in the input, but is not present in the
  Schema` and drops the whole preset (`Failed to load camera presets`). This is the
  single most expensive mistake to make here.
- **`view_offset` and `entity_offset` only work on `follow_orbit`.** The 26.50 binary
  rejects them elsewhere with
  `Cannot use view_offset on a preset that is not a follow_orbit camera!` (same for
  `entity_offset`). `view_offset` is `[x, y]`: `x` pushes the player sideways, `y` is the
  height, where `0.0` is the vanilla default and the reference for "shoulder height".
- **Valid preset names in 26.50**: `first_person`, `third_person`, `third_person_front`,
  `free`, `fixed_boom`, `follow_orbit` (extracted from the vanilla `presets.brarchive` and
  the client binary). There is no `third_person_boom`.
- **Automatic fallback.** If a native preset fails to apply, the script warns in chat and
  switches that player to a free camera repositioned every tick, so the camera never
  simply stops working.
- `scripts/main.js` uses `@minecraft/server 2.10.0` and `@minecraft/server-ui 2.2.0`. The
  menu uses literal strings instead of `RawMessage` because server-ui 2.x does not resolve
  nested messages. There is a safety latch that releases a player if a form never resolves.
- **English is the default locale.** The script only switches to Portuguese for `pt*`
  locales; any unrecognised locale falls back to English.
- Automatic triggers (holding sneak, or using a spyglass) exist but are **disabled** via
  `ENABLE_SHIFT_TRIGGER` / `ENABLE_SPYGLASS_TRIGGER` at the top of the script. The menu and
  the commands are the supported path.
- The Low Cinematic camera is intentionally temporary: it does not persist across sessions.

## Troubleshooting

**The camera falls back to a jittery mode.** The experiment is off for that world. Run
`./play.sh "<world>"` — the game clears the flag every time it saves, so this is per
session, not a one-time fix.

**`Failed to load camera presets` in the content log.** A preset violated the schema.
Check the exact field name in the log; `starting_radius` is the usual suspect.

**Nothing happens on a world.** The pack has to be enabled under Behavior Packs for that
world, and the experiment has to be on.

Always read the **newest** `ContentLog*.txt` rather than screenshots — old sessions mix
into screenshots and it is easy to chase an error that was already fixed. A session with
no `[Camera][error]` lines means the native presets loaded fine.

## Notes

- The world data lives under the launcher's Flatpak directory. `GAME_DIR` in `build.py`
  points at `~/.var/app/com.trench.trinity.launcher/...`; adjust it for other setups.
- `ans_toggle.sh` is only a testing helper for isolating a *global* resource pack
  (Actions & Stuff) when diagnosing animation/camera interference. It is not needed for
  the add-on to work.
- `level.dat` has the header `[int32 storage version][int32 payload length]`. Getting those
  two swapped still lets the file parse, so this is worth remembering if you touch the NBT
  tooling.

## License

[MIT](LICENSE).
