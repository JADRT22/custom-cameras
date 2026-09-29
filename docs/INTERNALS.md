# Internals

Technical notes for anyone modifying the add-on or writing their own camera presets for
Minecraft Bedrock 26.50. These rules cost real debugging time to pin down, and the build
validator (`build.py`) enforces them so they cannot regress.

## Camera preset schema rules

- **One object per file.** `minecraft:camera_preset` must be a single object `{...}`. An array is rejected with `minecraft:camera_preset: expected an object`.
- **Own namespace only.** Identifiers must stay in `cm:`. Using `minecraft:*` makes the game discard the file.
- **The distance field is `radius`, and it only exists on `follow_orbit`.** It also requires `format_version: 1.21.90`. On `fixed_boom`, `radius` is accepted but **silently ignored** (the camera stays at the default 10).
- **`starting_radius` does not exist.** It is not part of the camera preset schema. The game logs `this member was found in the input, but is not present in the Schema` and drops the whole preset (`Failed to load camera presets`). This is the single most expensive mistake to make here.
- **`view_offset` and `entity_offset` only work on `follow_orbit`.** The 26.50 binary rejects them elsewhere with `Cannot use view_offset on a preset that is not a follow_orbit camera!` (same for `entity_offset`). `view_offset` is `[x, y]`: `x` pushes the player sideways, `y` is the height, where `0.0` is the vanilla default and the reference for "shoulder height".
- **Valid preset names in 26.50:** `first_person`, `third_person`, `third_person_front`, `free`, `fixed_boom`, `follow_orbit` (extracted from the vanilla `presets.brarchive` and the client binary). There is no `third_person_boom`.
- **Presets are read at world load.** They cannot be changed while playing, so tuning means rewriting the files and re-entering the world.

## Manifest and achievements

- **The add-on flag is load-bearing.** `manifest.json` declares `"metadata": { "product_type": "addon" }`, and the validator fails the build without it. Since July 2025 this is what stops the game from treating the pack as a cheat world and disabling achievements the moment it is applied.
- Only two things take a world's achievements: **cheats** and **any experiment**. This add-on needs neither.
- `experiments_ever_used: 1` (or `saved_with_toggled_experiments: 1`) in `level.dat` means the world is flagged for good. The game will not hand achievements back, even after the experiment is turned off. Check with `build/nbt_experiments.py`.
- `level.dat` has the header `[int32 storage version][int32 payload length]`. Swapping those two still lets the file parse, so remember this if you touch the NBT tooling.

## Script side (`scripts/main.js`)

- Uses `@minecraft/server 2.10.0` and `@minecraft/server-ui 2.2.0`.
- The menu uses literal strings instead of `RawMessage`, because server-ui 2.x does not resolve nested messages.
- A safety latch releases a player if a form never resolves.
- **English is the default locale.** The script only switches to Portuguese for `pt*` locales.
- **Triggers:** Shift is enabled (hold while standing still for 2s; moving restarts the timer). The spyglass trigger (`ENABLE_SPYGLASS_TRIGGER`) is off; `/cameramenu:open` replaces it.
- **No automatic fallback.** When a native preset fails to apply, the add-on does not quietly swap in the script camera. It puts the camera back to a defined state and says in chat that the game rejected the preset, which is the actual problem. A silent fallback would only trade a working camera for a broken one.
- **The camera is put on hold** while sleeping, riding a boat/minecart/mob, or gliding, and restored afterwards. The check runs every 0.5s inside a `try/catch`, so if a property is ever unavailable the camera is left alone rather than suspended on a guess.
- **Dying keeps your camera.** Joining and respawning share one restore path, so the previous camera is reapplied a few ticks after you are back.
- **Persistence.** The last camera is stored per player and per world in the `cm:preset` dynamic property. `cm:tune:*` and `cm:script_mode` are only written by the hidden script path, and `/cameramenu:reset` clears them.

## The Low Cinematic camera

Low Cinematic is intentionally temporary (it resets after 3s and does not persist across sessions). It uses the same `setCamera("minecraft:free", {...})` form as the hidden script path, and that form turned out not to render in 26.50, so it may do nothing. It is still offered only because it was never part of the failure report. If it is confirmed dead, it should go the same way as the rest of the script path.

## The hidden script camera

`scripts/main.js` also contains a second way to move the camera: a `minecraft:free` camera repositioned by the script every tick. It was written as a fallback for worlds where the presets were expected not to load, and **it does not render in 26.50**:

- aiming it at the player collapses the view to first person, or to the ground;
- passing the player's rotation instead renders **no camera at all**: no error in the log, just sky.

So it is off, behind the `ENABLE_SCRIPT_PATH` flag: no menu entry, no `/cameramenu:mode|tune|debug`. Flip the flag to `true` to bring the whole path back if a future build starts honouring the free camera.

If you try the path again, these are the starting points:

- **Aiming.** `facingLocation: player.getHeadLocation()` is what puts the player in frame. The documented alternative, `rotation: player.getRotation()`, rendered no camera at all in 26.50.
- **Smoothing.** Re-positioning a camera once per tick makes the picture step a whole tick at a time. `easeOptions` (`{ easeTime: 0.05, easeType: "linear" }`) smoothed it.
- **Velocity feed-forward.** A plain `c + (t-c)*0.35` lerp trails the player by `v/0.35` blocks (about 0.62 walking, 1.55 flying in creative), which is the "drag" people notice. The loop aimed `1/0.35` ticks ahead to cancel that steady-state error, and snapped instead of lerping when the gap passed 4 blocks (teleports).
- **Adjustment board.** `/cameramenu:tune` was a board of buttons rather than sliders. `server-ui` 2.x changed the signature to `slider(label, min, max, options)` (the 1.x positional form throws `Incorrect number of arguments to function. Expected 3-4, received 5`), and the sliders in this client opened but their handles would not move and the form submitted at the minimum. Buttons avoid the whole class of problem, and each click re-applies the camera.
- Why the board could never drive a native preset: a preset is a file the game reads at load and cannot be changed while you play.

## Aim assist (native, no script)

Aim assist left the experimental toggles in 1.21.70. Two ways to turn it on: the `/aimassist`
command ("Requires Cheats Enabled: Yes" in the Microsoft command list — as a typed command it
costs achievements) or an `aim_assist` block inside the camera preset JSON, which needs nothing.
This add-on uses the second:

```json
"aim_assist": { "preset": "cm:aim_preset" }
```

- `aim_assist/presets/*.json` maps items (or the empty hand) to categories. Here it maps only
  weapons to `cm:combat`; `default_item_settings` and `hand_settings` point at `cm:off` — an
  all-zero category. First release mapped everything, and the assist dragged the crosshair off
  the block being mined; weapons-only was the fix.
- `aim_assist/categories/*.json` holds the weights: in `cm:combat` `block_default` is 0 and
  `entity_default` is 70, so the crosshair pulls toward mobs and ignores scenery. Specific
  entries override the defaults.
- The assist exists only while the preset is applied; `camera.clear()` removes it. First person
  is not supported by aim assist at all — which is fine, only the shoulder/boom presets have it.
- Verified in 26.50 on keyboard and mouse: preset loads with zero schema errors in the content
  log and the assist pulls toward mobs. Controller behaviour not verified.
- Schema guard in `build.py`: `cm:` namespaces only, every category referenced by a preset must
  exist, and `default_item_settings`/`hand_settings` must point at defined categories.

## Debugging tips

- Always read the **newest** `ContentLog*.txt` rather than screenshots. Old sessions mix into screenshots and it is easy to chase an error that was already fixed.
- A session with no `[Camera][error]` lines means the native presets loaded fine.
- **The experiment is not needed:** a preset that fails to load makes the game throw `Invalid camera preset`. A session showing a working shoulder camera and no such line proves the presets load on a world that never had an experiment.
- **Cheats are not needed:** every command is registered with `cheatsRequired: false` and `permissionLevel: Any`.

## Build helpers

| File | Purpose |
| --- | --- |
| `build.py` | Validate, package to `dist/`, optionally install into `development_behavior_packs/` |
| `build/brx.py` | List the entries of a `.brarchive` (camera preset tables) |
| `build/toggle_experiment.py` | Enable or disable an experiment in a world's `level.dat` (writes `level.dat.camera-menu-backup` first) |
| `build/nbt_experiments.py` | Read the `experiments` compound back out of `level.dat` |
| `build/make_icon.py` | Generate `pack_icon.png` with no dependencies |
| `tune.py` | Calibrate shoulder camera framing and reinstall |
| `play.sh` | Enable `experimental_creator_cameras` and launch the game. **Not needed**, costs achievements, requires `--yes`, refuses to run while a world is loaded, detects a running game via `/proc/<pid>/comm` |
| `ans_toggle.sh` | A/B testing helper for a global resource pack (Actions & Stuff) when diagnosing animation/camera interference |
