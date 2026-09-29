# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.0]: https://github.com/OWNER/REPO/releases/tag/v1.0.0
