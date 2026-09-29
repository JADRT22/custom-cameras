# Custom Cameras (Menu)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Camera presets for **Minecraft Bedrock 26.50** — switched from an in-game menu or slash
commands, on any world, **without enabling cheats**.

The menu opens by **holding Shift while standing still** (2s), from `/cameramenu:open`, or
by `/cameramenu:next` to cycle. All seven cameras are first-class: nothing here is
shoulder-only, the shoulder cameras are just the most usable ones.

Built and maintained entirely from the terminal: no GUI on the desktop, the menu lives
inside the game.

## Cameras

| Camera | What it is | `/cameramenu:set` |
|---|---|---|
| Default | Back to first person | `default` |
| Left Shoulder | Shoulder orbit, player pushed to the left (`view_offset [-1.2, 0]`, `radius 2.5`) | `left` |
| Center Shoulder | Same distance as the other shoulders, but centered behind the player (no side offset) | `center` |
| Right Shoulder | Shoulder orbit, player pushed to the right (`view_offset [1.2, 0]`) | `right` |
| Boom Shoulder | Built on `fixed_boom`: no orbit, no side offset, fixed distance | `boom` |
| Far | Distant third person (`radius 7`) | `far` |
| Low Cinematic | Low `minecraft:free` camera behind the player; resets itself after 3s | `low` |

## Commands

All of these work **without cheats** (`cheatsRequired: false`):

- `/cameramenu:open` — open the camera menu
- `/cameramenu:set <default|left|center|right|boom|far|low>` — switch directly
- `/cameramenu:next` — cycle through the persistent cameras
- `/cameramenu:tune` — open the framing adjustment board (same as the menu's **Adjust camera** button)
- `/cameramenu:mode <native|script>` — A/B the two camera paths (see below)
- `/cameramenu:reset` — back to default (the escape hatch)

The menu also opens on its own: hold **Shift while standing still** for 2 seconds, and move
to cancel the timer. (Holding shift is sneak, so Actions & Stuff's sneak animations will
play while you do it — that is the pack doing its job, not this one.)

The last camera you pick is reapplied when you re-enter the world. Switching does a quick
fade. The mod does **not** draw a crosshair: when the camera detaches from the player the
vanilla crosshair disappears, and that is expected.

## Requirements

Nothing to turn on: **no cheats, no experiment.** Applying the pack is enough, and the
world keeps its achievements.

There are two ways the camera can be moved, and the add-on picks one per player.
`/cameramenu:mode native|script` switches by hand, and the choice is remembered per
player/world.

| | What runs | Experiment | Achievements |
|---|---|---|---|
| **native** | The engine drives a native `follow_orbit` / `fixed_boom` preset from `cameras/presets/`. Smoothest, because the engine moves the camera and not the script. | `experimental_creator_cameras` **on** | **lost** — any experiment disables them |
| **script** | The add-on repositions a `minecraft:free` camera itself, every tick, from the preset plus your adjustments. This is the one the adjustment board tunes. | not needed\* | **kept** |

The add-on tries native first and drops to the script camera by itself when a native preset
fails, so a world without the experiment simply works. That is the normal, achievement-safe
case. Forcing script always works; forcing native on a world without the experiment does
nothing.

### Achievements

Achievements are disabled by the **world**, not by this add-on, and by exactly two things:

- **Cheats** (`Allow Cheats: on`). The add-on never needs them: every command is registered
  with `cheatsRequired: false` and `permissionLevel: Any`, so `/cameramenu:*` works on a
  clean world.
- **Any experiment.** Turning one on disables achievements for that world, and it is not
  something you get back. The native camera path needs `experimental_creator_cameras`, so
  **do not enable it — and do not run `./play.sh` — on a world whose achievements you care
  about.** Stay in script mode (what you get by default when the experiment is off) and
  nothing is lost.

On top of that the pack carries the add-on flag, `"metadata": { "product_type": "addon" }`,
in `manifest.json`. Since July 2025 that is what tells the game the pack is an add-on rather
than a cheat world — **without it, merely applying the pack disables achievements**, which is
invisible in game and the usual reason people lose them. The build refuses to package
without it.

> Achievements also require **Survival mode** with cheats off, so a world you play in
> creative has them disabled no matter what any pack does.

The game clears the experiment flag every time it saves a world, so keeping it on is a
per-session toggle — that is what `./play.sh` automates. That script is a convenience for
testing the native path, **not part of a normal install**.

> \* **Verified in 26.50:** with the experiment off, `/cameramenu:mode script` does move the
> shoulder camera, and a world with no cheats accepts every `/cameramenu:*` command. The
> script camera is a little rougher than the native one — it is only re-positioned once per
> tick, so the picture steps 20 times a second — and the **Smoothing** steps on the adjust
> board exist to tame exactly that.

## Installation

### From a release `.mcaddon`

1. Grab `CameraMenu-v1.1.0.mcaddon` from the releases / `dist/`.
2. Double-click it (or open it with Minecraft) to import.
3. Enable it on the world under **Behavior Packs**.
4. That is all — leave cheats off and the experiments untouched; the add-on runs on the
   script camera. Only turn on **Experimental Creator Camera Features** if you want the
   smoother native camera and do not mind losing that world's achievements.

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
build/brx.py               list the entries of a .brarchive (camera preset tables)
build/toggle_experiment.py enable/disable an experiment in a world's level.dat
build/nbt_experiments.py   read the 'experiments' compound back out of level.dat
build/make_icon.py         generate pack_icon.png with no dependencies
play.sh                    enable the experiment (needs --yes), then launch the game
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

### Getting the experiment to stay on (only for worlds that no longer care)

**You do not need this.** It is for a throwaway world where you want the smoother native
camera and achievements are already gone. On any other world, skip it and let the add-on use
the script camera.

`play.sh` enables the experiment in the worlds and then launches the game. Because that
disables their achievements permanently, it refuses to do anything without `--yes`. It also
refuses to run while the game has a world loaded, since the game would overwrite `level.dat`
on save and lose the flag:

```bash
./play.sh                      # prints the warning and does nothing
./play.sh --yes                # every world (irreversible)
./play.sh "My World" --yes     # only that world (irreversible)
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

## Tuning the cameras

### In-game (recommended)

The last entry in the camera menu is **Adjust camera**, and `/cameramenu:tune` opens the same
board. It is a list of buttons, one click per step, with the current values in the header:

| | |
|---|---|
| Height `+` / `-` | 0.10 at a time (`0` = vanilla shoulder height) |
| Distance `+` / `-` | 0.25 at a time |
| Side `+` / `-` | 0.10 at a time |
| Smoothing `+` / `-` | 0.05 at a time (`0` = hard cuts, i.e. shaky) |
| **Reset this preset** | back to the built-in framing for the camera you are using |
| **Original + native camera** | clears every adjustment *and* leaves script mode |

Values are saved per player and per world and applied immediately.

> **Why buttons and not sliders?** They were tried first and they are unusable in this client:
> the handles would not move, and the form submitted at the slider's minimum — height `-2`
> dropped the camera below the player's feet, inside the ground, and smoothing `0` silently
> switched the anti-flicker ease off. On top of that `@minecraft/server-ui` 2.x changed the
> signature to `slider(label, min, max, { valueStep, defaultValue })`, so the 1.x positional
> form throws `Incorrect number of arguments to function. Expected 3-4, received 5` and takes
> the whole form down. Buttons are the widget this client demonstrably handles — the camera
> menu is built from the same one.

Adjusting switches you to the script camera, because these values can only drive it: a native
preset is a file the game read when the world loaded and it cannot be changed while you play.
That is the whole reason the script path exists.

### From the terminal

The terminal shortcut rewrites the *native* preset files instead, so it only changes what you
see when the experiment is on:

```bash
python3 tune.py            # show the current values
python3 tune.py --y 0.4    # raise the shoulder camera
python3 tune.py --y -0.2   # lower it
python3 tune.py --x 1.5    # push the player further to the side
python3 tune.py --radius 1.5  # move the shoulder cameras closer (smaller = tighter)
python3 tune.py --far 12   # distance of the far camera
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
- **The add-on flag is load-bearing.** `manifest.json` declares
  `"metadata": { "product_type": "addon" }`, and the validator fails the build without it.
  Since July 2025 this is what stops the game treating the pack as a cheat world and
  disabling achievements the moment it is applied.
- **Automatic fallback.** If a native preset fails to apply, the script says so in chat and
  switches that player to a free camera repositioned every tick, so the camera never simply
  stops working. On a world without the experiment this is the normal path — and the one
  that keeps that world's achievements.
- `scripts/main.js` uses `@minecraft/server 2.10.0` and `@minecraft/server-ui 2.2.0`. The
  menu uses literal strings instead of `RawMessage` because server-ui 2.x does not resolve
  nested messages. There is a safety latch that releases a player if a form never resolves.
- **The adjustment board uses buttons, not sliders.** Besides the 2.x signature change
  (`slider(label, min, max, options)` — the 1.x positional shape throws
  `Incorrect number of arguments to function. Expected 3-4, received 5`), the sliders
  themselves misbehaved in this client: handles that would not move and values submitted at
  the minimum. Buttons avoid the whole class of problem, and each click re-applies the camera
  so the effect is visible immediately.
- **English is the default locale.** The script only switches to Portuguese for `pt*`
  locales; any unrecognised locale falls back to English.
- Automatic triggers: **Shift is enabled** — hold it while standing still for 2s and the
  menu opens (moving restarts the timer). The spyglass trigger (`ENABLE_SPYGLASS_TRIGGER`)
  is off; `/cameramenu:open` replaces it.
- **The script camera is smoothed through `easeOptions`.** Re-positioning a camera every tick
  makes the picture step a whole tick of movement at a time, which reads as flicker (worst in
  the script path, and worse the faster you move). Passing
  `easeOptions: { easeTime: 0.05, easeType: "linear" }` makes the client interpolate to each
  new target instead of hard-cutting to it. If a build ever rejects that option, the flag is
  cleared for the session and every later call falls back to a plain hard cut, so the camera
  keeps working either way. `Smoothing` of `0` is exactly that hard-cut behaviour, for A/B.
- **The fallback camera has velocity feed-forward.** A plain `c + (t-c)*0.35` lerp trails the
  player by `v/0.35` blocks — about 0.62 blocks walking and 1.55 while flying in creative,
  which is the "drag" people notice. The loop aims `1/0.35` ticks ahead of the player to
  cancel that steady-state error, and snaps instead of lerping when the gap exceeds 4 blocks
  (teleports).
- The Low Cinematic camera is intentionally temporary: it does not persist across sessions.
- **The camera is put on hold in a few contexts** (sleeping, riding a boat/minecart/mob, or
  gliding) and restored when you leave them. The check runs every 0.5s inside a `try/catch`,
  so if a property is ever unavailable the camera is left alone rather than suspended on a
  guess.
- **Dying no longer loses your camera.** Joining and respawning share one restore path, so the
  camera you had before dying is reapplied a few ticks after you are back.
- **Adjustments are per player and per world**, stored in dynamic properties
  (`cm:tune:<preset>`, `cm:script_mode`), next to the `cm:preset` used for the last camera.

## Troubleshooting

**Do I want the native camera or the script one?** `/cameramenu:mode script` forces the
shoulder presets to run through the script loop instead of the native preset, so you can
compare them in the same world without touching the experiment. The native one is smoother
because the engine drives it; the script one needs no experiment at all. Switching back is
`/cameramenu:mode native`.

**The camera is a bit choppier than I expected.** That is the script camera running because
the experiment is off — normal, and nothing is broken. For the engine-driven version, enable
`experimental_creator_cameras` for that world (`./play.sh "<world>"` does it; the game clears
the flag every time it saves, so it is per session) — **but that trades away that world's
achievements, so do it on a throwaway world, not on one you care about.**

**My achievements are disabled and I never turned cheats on.** Two things do that: the world
has an experiment enabled, or the pack is missing the add-on flag. The manifest in this repo
has it (`metadata.product_type = "addon"`) and the build enforces it; if you copied the pack
out and edited its manifest, that is the line that went missing.

To check a world, read its `level.dat`:

```bash
python3 build/nbt_experiments.py "<world>/level.dat"
```

The `experiments` compound is the verdict. `experiments_ever_used: 1` (or
`saved_with_toggled_experiments: 1`) means the world has already been flagged and the game
will not give achievements back on its own, even after `experimental_creator_cameras` is
turned off. A world that never touched an experiment has those two at `0` and only behaves
that way — that is the one to build in if you want achievements.

**`Failed to load camera presets` in the content log.** A preset violated the schema.
Check the exact field name in the log; `starting_radius` is the usual suspect.

**Nothing happens on a world.** The pack has to be enabled under **Behavior Packs** for that
world. The experiment is *not* required — if the camera works but feels choppier than the
descriptions here, the add-on is on the script path, which is normal.

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
