#!/usr/bin/env python3
"""Camera Menu build: validate, package (.mcaddon) and install into the game.

Usage:
  python3 build.py            # validate + package dist/*.mcaddon
  python3 build.py --install  # also install into development_behavior_packs (Trinity)
  python3 build.py --icon     # (re)generate pack_icon.png
"""
import json, sys, zipfile, shutil, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src" / "camera_menu_bp"
DIST = ROOT / "dist"
ICON = ROOT / "build" / "pack_icon.png"
GAME_DIR = Path.home() / ".var/app/com.trench.trinity.launcher/data/mcpelauncher/games/com.mojang"
DEV_BP = GAME_DIR / "development_behavior_packs" / "camera_menu_bp"

PACK_NAME = "CameraMenu"
VERSION = "1.1.0"

def fail(msg):
    print(f"  [ERROR] {msg}")
    sys.exit(1)

def ok(msg):
    print(f"  [ok] {msg}")

# ---------- validation ----------
def validate():
    print("== Validating ==")
    manifest_path = SRC / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text())
    except json.JSONDecodeError as e:
        fail(f"manifest.json is not valid JSON: {e}")
    ok("manifest.json is valid JSON")

    header = manifest["header"]
    uuid_re = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
    for key in ("uuid",):
        if not uuid_re.match(header[key]):
            fail(f"header.{key} is not a valid UUID: {header[key]}")
    for m in manifest["modules"]:
        if not uuid_re.match(m["uuid"]):
            fail(f"invalid module uuid: {m['uuid']}")
    if not any(m["type"] == "script" for m in manifest["modules"]):
        fail("missing the 'script' module")
    ok("UUIDs and modules present (data + script)")

    deps = manifest.get("dependencies", [])
    mods = {d.get("module_name") for d in deps if "module_name" in d}
    if "@minecraft/server" not in mods:
        fail("missing dependency @minecraft/server")
    if "@minecraft/server-ui" not in mods:
        fail("missing dependency @minecraft/server-ui")
    # we no longer depend on the experimental pack in the manifest: Trinity ignores
    # that trick, so the toggle is written straight into level.dat instead
    # (build/toggle_experiment.py).
    exp_uuids = {d["uuid"] for d in deps if "uuid" in d}
    if exp_uuids:
        fail(f"manifest must not depend on packs (uuid): {sorted(exp_uuids)}")
    ok("dependencies: @minecraft/server 2.10.0, @minecraft/server-ui 2.2.0 (no experimental pack)")

    # The "add-on flag". Since the July 2025 add-on/achievements change, this metadata is
    # what tells the game the pack is an add-on and not a cheat world. Without it, simply
    # applying the pack disables achievements for that world — the exact complaint this
    # guards against, and it is invisible in game, so it must stay in the manifest.
    meta = manifest.get("metadata", {})
    if meta.get("product_type") != "addon":
        fail("manifest.metadata.product_type must be 'addon' "
             "(without it the pack disables achievements for the world)")
    ok("metadata.product_type = 'addon' (achievements preserved)")

    # native JSON presets: ONE OBJECT PER FILE (1.21.80+/26.x format), namespace cm: only
    presets_dir = SRC / "cameras" / "presets"
    preset_files = sorted(presets_dir.glob("*.json"))
    if not preset_files:
        fail("no presets found in cameras/presets/*.json")
    idents = []
    for pf in preset_files:
        try:
            data = json.loads(pf.read_text())
        except json.JSONDecodeError as e:
            fail(f"{pf.name} is not valid JSON: {e}")
        # 1.21.90 is the same format_version as the vanilla 26.50 presets
        # (follow_orbit + radius)
        if data.get("format_version") != "1.21.90":
            fail(f"{pf.name}: format_version must be 1.21.90")
        obj = data["minecraft:camera_preset"]
        if not isinstance(obj, dict):
            fail(f"{pf.name}: minecraft:camera_preset must be ONE OBJECT, not an array")
        ident = obj.get("identifier", "")
        if not ident.startswith("cm:"):
            fail(f"{pf.name}: identifier outside the cm: namespace ({ident})")
        # real preset names registered in the 26.50 binary (extracted from libminecraftpe.so):
        # first_person, third_person, third_person_front, free, fixed_boom, follow_orbit
        valid_bases = {
            "minecraft:first_person", "minecraft:third_person",
            "minecraft:third_person_front", "minecraft:free",
            "minecraft:fixed_boom", "minecraft:follow_orbit",
        }
        base = obj.get("inherit_from")
        if base not in valid_bases:
            fail(f"{pf.name}: inherit_from '{base}' does not exist in 26.50 (valid: {sorted(valid_bases)})")
        # valid fields, from the vanilla 26.50 presets extracted out of the brarchive:
        #   follow_orbit: view_offset, entity_offset, radius
        #   fixed_boom:   view_offset, entity_offset (NO radius — the distance is fixed)
        if "starting_radius" in obj:
            fail(f"{pf.name}: 'starting_radius' does not exist in the schema (the game drops the whole preset)")
        if base == "minecraft:fixed_boom" and "radius" in obj:
            fail(f"{pf.name}: fixed_boom does not accept radius — use follow_orbit to control distance")
        if base == "minecraft:follow_orbit" and "radius" not in obj:
            fail(f"{pf.name}: follow_orbit must declare 'radius' (otherwise it stays at the default 10)")
        # exact messages from the 26.50 binary:
        #   "Cannot use view_offset on a preset that is not a follow_orbit camera!"
        #   "Cannot use entity_offset on a preset that is not a follow_orbit camera!"
        # in other words: fixed_boom does not accept these offsets.
        for campo in ("view_offset", "entity_offset"):
            if campo in obj and base != "minecraft:follow_orbit":
                fail(f"{pf.name}: '{campo}' is only accepted on follow_orbit (the game rejects the preset)")
        if "view_offset" in obj and (not isinstance(obj["view_offset"], list)
                                     or len(obj["view_offset"]) != 2):
            fail(f"{pf.name}: view_offset must be [x, y]")
        if "entity_offset" in obj and (not isinstance(obj["entity_offset"], list)
                                       or len(obj["entity_offset"]) != 3):
            fail(f"{pf.name}: entity_offset must be [x, y, z]")
        idents.append(ident)
    if len(idents) != len(set(idents)):
        fail("duplicate preset identifiers")
    ok(f"{len(idents)} valid presets (one object per file): {', '.join(idents)}")

    # script <-> presets consistency
    script = (SRC / "scripts" / "main.js").read_text()
    missing = [i for i in idents if f'"{i}"' not in script]
    if missing:
        fail(f"presets not referenced in main.js: {missing}")
    # the .lang files only carry the pack name/description: the menu uses literal
    # strings in the script (server-ui 2.x does not resolve nested RawMessage).
    for lang_file in ("pt_BR.lang", "en_US.lang"):
        text = (SRC / "texts" / lang_file).read_text()
        for k in ("pack.name", "pack.description"):
            if not re.search(rf"^{re.escape(k)}=", text, re.M):
                fail(f"{lang_file}: missing key {k}")
        if "camera_menu." in text:
            fail(f"{lang_file}: camera_menu.* keys are no longer used — remove them")
    ok("presets referenced by the script; .lang kept minimal (name/description)")

    if not (SRC / "pack_icon.png").exists():
        fail("pack_icon.png missing (run build.py --icon)")

# ---------- packaging ----------
def package():
    print("== Packaging ==")
    DIST.mkdir(exist_ok=True)
    out = DIST / f"{PACK_NAME}-v{VERSION}.mcaddon"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(SRC.rglob("*")):
            if f.is_file():
                z.write(f, Path("camera_menu_bp") / f.relative_to(SRC))
    ok(f"package created: {out} ({out.stat().st_size} bytes)")
    return out

# ---------- install ----------
def install():
    print("== Installing into Trinity (com.mojang/development_behavior_packs) ==")
    if not GAME_DIR.exists():
        fail(f"game directory not found: {GAME_DIR}")
    if DEV_BP.exists():
        shutil.rmtree(DEV_BP)
    shutil.copytree(SRC, DEV_BP)
    n = sum(1 for f in DEV_BP.rglob("*") if f.is_file())
    ok(f"installed into {DEV_BP} ({n} files)")

if __name__ == "__main__":
    args = sys.argv[1:]
    if "--icon" in args:
        import subprocess
        subprocess.run([sys.executable, str(ROOT / "build" / "make_icon.py"),
                        str(SRC / "pack_icon.png")], check=True)
    validate()
    package()
    if "--install" in args:
        install()
    print("== Build finished ==")
