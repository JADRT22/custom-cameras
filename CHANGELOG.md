# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.1] - 2026-09-29

### Added

- `/cameramenu:debug` — a command that reports what the script camera is doing and changes the
  camera in three named steps. It exists because a camera that does nothing logs nothing, so
  there is no other way to tell "worked", "did nothing" and "was refused" apart. It ships
  hidden behind `ENABLE_SCRIPT_PATH`, with the path it debugs.

### Changed

- **The script camera path is hidden rather than deleted.** It was written as a fallback for
  worlds where the custom presets were expected not to load, and it does not render in 26.50:
  aiming the free camera at the player collapses the view to first person or to the ground, and
  passing the player's rotation renders no camera at all. Everything that reached it now sits
  behind `ENABLE_SCRIPT_PATH` in `scripts/main.js` — no menu entry, no
  `/cameramenu:mode|tune|debug`, and no silent fallback that would trade a working camera for a
  broken one. Flipping the flag brings the whole path back; the code is otherwise intact.
- **`play.sh` is documented as unnecessary.** It exists only to turn on
  `experimental_creator_cameras`, which the add-on does not need, so all it does now is cost
  those worlds their achievements. It still refuses to run without `--yes`.

### Fixed

- **The add-on was briefly documented as needing the experiment. It does not.** The presets
  load with the pack on a world that has never had one; the wrong claim came from treating the
  game's documentation as the spec instead of the content log. The log is what settles it — a
  preset that fails to load makes `setCamera` throw `Invalid camera preset`, and the sessions
  showing a working shoulder camera contain no such line, on a world with
  `experiments_ever_used: 0`. Requirements, achievements, installation and troubleshooting are
  back to "no cheats, no experiment", and the chat message for a rejected preset no longer
  blames a missing experiment.
- **The script camera's aim was investigated.** Passing `rotation: player.getRotation()` (the
  documented form, `camera @s set minecraft:free pos ^-0.75 ^ ^-1.5 rot ~ ~`) instead of
  `facingLocation` was tried to unlock free look; in 26.50 it rendered no camera at all — no
  error, just sky. Neither form is reachable now, but the finding is written down because it is
  the first thing an attempt to revive the path needs: the free-camera *options* are the broken
  part, not the offsets.
- **`/cameramenu:mode script` did nothing at all in a fresh session.** With no camera picked
  yet, `activeCam` was empty and the command only flipped the flag: it answered "script
  mode" and left the camera where it was, which reads exactly like a camera stuck in first
  person. It now clears the previous camera (a native preset camera can otherwise stay in  place) and reapplies the current or last-used one.

## [1.1.0] - 2026-09-29

### Added

- **Achievements are preserved.** `manifest.json` now declares
  `"metadata": { "product_type": "addon" }`, the add-on flag that tells the game the pack is
  an add-on and not a cheat world, and the build validator now fails without it. **This
  release also described the native camera as needing `experimental_creator_cameras`. It does
  not** — see Unreleased: the presets load without any experiment, and claiming otherwise sent
  readers to a switch that only costs them a world's achievements.
- **In-game framing adjustments.** The camera menu gained an **Adjust camera (script)** entry
  (`/cameramenu:tune` opens the same board): one button per step for height, side, distance
  and smoothing, saved per player and per world. Adjusting switches the player to the script
  camera, because native presets are files read at world load and cannot be changed at
  runtime.
- **The script camera is a first-class path, not only an emergency fallback.** It can be
  picked by hand (`/cameramenu:mode script`), it is what the in-game sliders tune, and the
  choice is remembered per player/world — so a world without the experiment can run the
  add-on instead of failing to a degraded mode. **This release also claimed that was verified
  in game on 26.50. It was not: the claim rested on reading the chat message the command
  prints, and the camera never actually rendered. See Unreleased.**
- **The camera is suspended in bed, in a vehicle and while gliding**, and restored when the
  context ends. The check runs inside a `try/catch` so the camera is never suspended on a
  guess.
- `/cameramenu:next` to cycle through the persistent cameras, so every preset is reachable
  without opening the menu.
- `/cameramenu:mode <native|script>` to force the shoulder presets through the script camera,
  so the two paths can be compared in-game before deciding whether the add-on should drop
  its dependency on the experimental camera presets.
- `tune.py --radius` (shoulder distance) and `tune.py --far` (far camera distance), so the
  non-shoulder distance presets are tunable too instead of being fixed at build time.

### Changed

- **`play.sh` now refuses to run without `--yes`.** Enabling the experiment disables the
  affected worlds' achievements permanently, so the script prints the warning and exits
  instead of doing it silently, and the README leads with "you do not need this" — the
  script camera covers the normal case.
- The Shift trigger is enabled again: holding Shift while standing still for 2s opens the
  camera menu (moving restarts the timer). It was disabled while the shoulder framing was
  being fixed up.
- The script framing is now read from the per-player tuning when one exists, falling back to
  the built-in offsets otherwise.
- The menu body states how to open it with Shift.

### Fixed

- **Applying the pack could disable a world's achievements.** The manifest had no
  `metadata.product_type`, so the game treated it as a cheat world. That field is now present
  and enforced by the build.
- **The native-preset fallback no longer reads like a failure.** It fires on every normal
  world (no experiment), so it now states that script mode is active and that it needs
  neither the experiment nor cheats, instead of "native preset unavailable".
- **The in-game adjust screen is now a button board instead of sliders.** The sliders opened
  but were unusable: the handles would not move and the form submitted at the slider's
  minimum, which put the camera underground (height `-2`) and silently switched the
  anti-flicker ease off (smoothing `0`). The board is one click per step with the current
  values on screen, plus **Reset this preset** and **Original + native camera**.
- **Adjustments could not be reset.** `/cameramenu:reset` now clears every stored adjustment
  and leaves script mode, so a bad adjustment can never strand the camera; the board also has
  a reset for the camera you are using.
- **The height range could bury the camera.** The floor was `-2` (a block below the player's
  feet); it is now `-1`, and everything is clamped on read as well as on write, so even a
  hand-edited value cannot put the camera under the ground.
- **The adjust form used the 1.x slider signature.** `@minecraft/server-ui` 2.x moved the
  step and starting value into an options object
  (`slider(label, min, max, { valueStep, defaultValue })`); the old positional shape threw
  `Incorrect number of arguments to function. Expected 3-4, received 5` and took the whole
  form down. Sliders were dropped altogether in favour of the button board described above.
- **The script camera flickered.** It is re-positioned once per tick, so the picture stepped a
  whole tick of movement at a time. Calls now pass
  `easeOptions: { easeTime: 0.05, easeType: "linear" }`, which asks the client to interpolate
  to each new target instead of hard-cutting to it. The **Smoothing** slider tunes it (and `0`
  gives back the old hard-cut behaviour); if a build ever rejects the option, the session
  quietly falls back to hard cuts instead of losing the camera.
- **Dying lost the camera.** Only the initial spawn restored it, so a death left you on the
  default camera until you picked one again. Joining and respawning now share one restore
  path.
- The fallback camera trailed the player while moving. A plain lerp leaves a steady-state
  error of `v/0.35` blocks — about 0.62 blocks walking and 1.55 while flying in creative,
  which is why it was worst in creative flight. The loop now feeds the player's velocity
  forward (`1/0.35` ticks of lead) to cancel the error, and snaps when the gap passes 4
  blocks so teleports do not send the camera flying across the map.

## [1.0.0] - 2026-09-28

First release.

### Added

- Seven cameras selectable from an in-game menu or slash commands, with no cheats
  required: `default`, `left`, `center`, `right`, `boom`, `far`, `low`.
- Native camera presets in `cameras/presets/`, one object per file, built on
  `minecraft:follow_orbit` and `minecraft:fixed_boom`.
- Last camera persisted per player and reapplied on world re-entry.
- Automatic fallback camera (free camera repositioned every tick) when a native preset
  fails to apply, with a chat warning instead of a silent failure.
- `build.py` validator enforcing the camera preset schema rules, the manifest/UUIDs,
  the dependencies and the `.lang` files.
- `play.sh` to re-enable the `experimental_creator_cameras` experiment before launch,
  since the game clears the flag whenever it saves a world.
- `build/toggle_experiment.py` and `build/nbt_experiments.py` to edit and inspect the
  `experiments` compound in a world's `level.dat`.
- `tune.py` to calibrate shoulder camera framing from the terminal.
- `ans_toggle.sh` to enable/disable a global resource pack, for A/B testing.

### Fixed

- `level.dat` header fields were written in the wrong order. Bedrock uses
  `[int32 storage version][int32 payload length]`; the writer emitted them swapped.
- `view_offset` and `entity_offset` were declared on a `fixed_boom` preset, which the
  client rejects with
  `Cannot use view_offset on a preset that is not a follow_orbit camera!`.
- Shoulder cameras were framed below shoulder height (`view_offset` Y of `-0.8`); they now
  use `0.0`, the vanilla reference height.
- Process detection in `play.sh` and `ans_toggle.sh` matched the launcher's Flatpak path
  instead of the game, and combined `pipefail` with `grep -q`, which turned an early match
  into a false negative.
- The locale fallback defaulted to Portuguese, so every player with an unrecognised locale
  got Portuguese strings. English is now the default.

[1.1.1]: https://github.com/JADRT22/custom-cameras/releases/tag/v1.1.1
[1.1.0]: https://github.com/JADRT22/custom-cameras/releases/tag/v1.1.0
[1.0.0]: https://github.com/JADRT22/custom-cameras/releases/tag/v1.0.0
