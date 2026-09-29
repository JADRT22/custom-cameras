import {
  world,
  system,
  Player,
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
} from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

// ============================================================
// Custom Cameras — native camera presets (inherit_from: follow_orbit)
// The world must have the experimental_creator_cameras experiment enabled
// (build/toggle_experiment.py, or World Settings -> Experiments in-game).
// If a native preset fails to load, the script falls back to a script-driven
// free camera instead — the camera never simply stops working.
// ============================================================

const HOLD_TICKS = 40; // hold shift for 2s
const MOVE_EPS = 0.01;
const CHECK_INTERVAL = 5; // sneak polling (0.25s)
const PROP_LAST = "cm:preset";
const CAMERA_ITEM = "minecraft:spyglass";
const MENU_TIMEOUT_TICKS = 1200; // safety latch: a form that never resolves
const SPAWN_DELAY_TICKS = 10; // wait after spawn before restoring the camera

// Automatic triggers — disabled by design: menu and commands only for now.
// Set to true to re-enable (shift = hold still while sneaking; spyglass = use the item).
const ENABLE_SHIFT_TRIGGER = false;
const ENABLE_SPYGLASS_TRIGGER = false;

// key, presetId (null = default/first person), persist
// fb = fallback offsets [side, back, up] used when the native preset fails
const PRESETS = [
  { key: "default", id: null, persist: true, fb: null, pt: "Padrão (1ª pessoa)", en: "Default (first person)" },
  { key: "left", id: "cm:shoulder_left", persist: true, fb: [-0.9, 2.5, 0.4], pt: "Ombro Esquerdo", en: "Left Shoulder" },
  { key: "center", id: "cm:shoulder_center", persist: true, fb: [0, 2.5, 0.4], pt: "Ombro Central", en: "Center Shoulder" },
  { key: "right", id: "cm:shoulder_right", persist: true, fb: [0.9, 2.5, 0.4], pt: "Ombro Direito", en: "Right Shoulder" },
  { key: "boom", id: "cm:boom_right", persist: true, fb: [0.9, 2.5, 0.4], pt: "Ombro Boom (sem órbita)", en: "Boom Shoulder (no orbit)" },
  { key: "far", id: "cm:far", persist: true, fb: [0, 7, 1.0], pt: "Distante (3ª pessoa longe)", en: "Far (3rd person)" },
  { key: "low", id: "minecraft:free", persist: false, fb: null, pt: "Cinemática Baixa (temporária)", en: "Low Cinematic (temporary)" },
];

/** @type {Map<string, number>} playerId -> sneak start tick */
const sneakStart = new Map();
/** @type {Map<string, number>} playerId -> tick the menu was opened */
const menuOpen = new Map();
/** @type {Map<string, object>} playerId -> active preset */
const activeCam = new Map();
/** @type {Map<string, object>} playerId -> fallback state (smoothed position) */
const fallback = new Map();
/** presets that failed as a native preset (per session) */
const brokenPresets = new Set();

// ==================== Language ====================
// English is the default for every locale we do not explicitly support.
function wantsPortuguese(player) {
  try {
    if (typeof player.locale === "string" && player.locale.length > 0) {
      return player.locale.startsWith("pt");
    }
  } catch { /* ignore */ }
  return false;
}
function label(player, preset) {
  return wantsPortuguese(player) ? preset.pt : preset.en;
}

// ==================== Camera ====================
function fade(player) {
  try {
    player.camera.fade({
      fadeColor: { red: 0, green: 0, blue: 0, alpha: 0.3 },
      fadeTime: { fadeInTime: 0.2, holdTime: 0.05, fadeOutTime: 0.4 },
    });
  } catch { /* cosmético */ }
}

function applyPreset(player, preset, withFade = true) {
  fallback.delete(player.id);
  try {
    if (preset.id === null) {
      player.camera.clear();
    } else if (preset.fb && brokenPresets.has(preset.id)) {
      // native preset unavailable in this world: use the fallback (free camera per tick)
      applyFallback(player, preset);
    } else if (preset.id === "minecraft:free") {
      // one-shot cinematic: 3s of a low free camera behind the player, then it resets itself
      const head = player.getHeadLocation();
      const yaw = (player.getRotation().y * Math.PI) / 180;
      const loc = {
        x: head.x + Math.sin(yaw) * 5,
        y: head.y - 1.2,
        z: head.z - Math.cos(yaw) * 5,
      };
      player.camera.setCamera("minecraft:free", { location: loc, facingLocation: head });
      system.runTimeout(() => {
        try {
          if (activeCam.get(player.id) === preset) {
            player.camera.clear();
            activeCam.delete(player.id);
          }
        } catch { /* ignore */ }
      }, 60);
    } else {
      player.camera.setCamera(preset.id);
    }
    activeCam.set(player.id, preset);
    player.setDynamicProperty(PROP_LAST, preset.persist ? preset.key : "default");
  } catch (e) {
    console.warn(`[CameraMenu] failed to apply camera: ${e}`);
    if (preset.fb) {
      // marca como quebrado e ativa o plano B na hora
      brokenPresets.add(preset.id);
      player.sendMessage(
        wantsPortuguese(player)
          ? "§e[Câmeras] preset nativo indisponível — usando modo alternativo."
          : "§e[Cameras] native preset unavailable — using fallback mode."
      );
      applyFallback(player, preset);
      activeCam.set(player.id, preset);
      if (withFade) fade(player);
    }
    return;
  }
  if (withFade) fade(player);
}

function restoreLast(player) {
  try {
    const key = player.getDynamicProperty(PROP_LAST);
    const preset = typeof key === "string" ? PRESETS.find((p) => p.key === key) : undefined;
    if (preset && preset.persist && preset.id) {
      system.runTimeout(() => {
        try {
          // only restore if the player did not pick another camera meanwhile
          if (!activeCam.has(player.id)) applyPreset(player, preset, false);
        } catch { /* player left */ }
      }, SPAWN_DELAY_TICKS);
    } else if (preset && !preset.persist) {
      player.setDynamicProperty(PROP_LAST, "default");
    }
  } catch { /* ignore */ }
}

// ==================== Fallback: free camera repositioned every tick ====================
function camTarget(player, off) {
  const [side, back, up] = off;
  const head = player.getHeadLocation();
  const yaw = (player.getRotation().y * Math.PI) / 180;
  const fx = -Math.sin(yaw);
  const fz = Math.cos(yaw);
  // right vector = forward rotated by -90 degrees
  const rx = -fz;
  const rz = fx;
  return {
    x: head.x + rx * side - fx * back,
    y: head.y + up,
    z: head.z + rz * side - fz * back,
  };
}

function applyFallback(player, preset) {
  try {
    const target = camTarget(player, preset.fb);
    fallback.set(player.id, { preset, cur: target });
    player.camera.setCamera("minecraft:free", {
      location: target,
      facingLocation: player.getHeadLocation(),
    });
  } catch (e) {
    console.warn(`[CameraMenu] fallback failed: ${e}`);
  }
}

// fallback loop (only runs for players currently in fallback mode)
system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    const state = fallback.get(player.id);
    if (!state) continue;
    try {
      const head = player.getHeadLocation();
      const target = camTarget(player, state.preset.fb);
      const c = state.cur;
      c.x += (target.x - c.x) * 0.35;
      c.y += (target.y - c.y) * 0.35;
      c.z += (target.z - c.z) * 0.35;
      player.camera.setCamera("minecraft:free", {
        location: { x: c.x, y: c.y, z: c.z },
        facingLocation: { x: head.x, y: head.y, z: head.z },
      });
    } catch { /* player unloaded */ }
  }
});

// ==================== Menu ====================
async function openMenu(player) {
  if (menuOpen.has(player.id)) return;
  menuOpen.set(player.id, system.currentTick);
  try {
    const pt = wantsPortuguese(player);
    const active = activeCam.get(player.id) ?? PRESETS[0];

    const form = new ActionFormData()
      .title(pt ? "Câmeras" : "Cameras")
      .body(pt ? `Câmera atual: ${label(player, active)}` : `Current camera: ${label(player, active)}`);
    for (const p of PRESETS) form.button(label(player, p));

    const res = await form.show(player);
    if (res.canceled || res.selection === undefined) return;
    const chosen = PRESETS[res.selection];
    if (!chosen) return;

    applyPreset(player, chosen);
    player.sendMessage(
      pt ? `§aCâmera: ${label(player, chosen)}` : `§aCamera: ${label(player, chosen)}`
    );
  } catch (e) {
    console.warn(`[CameraMenu] erro no menu: ${e}`);
  } finally {
    menuOpen.delete(player.id);
  }
}

// Menu safety latch — independent of the triggers: if a form never resolves, the
// player is released (otherwise a stuck menu would block the command forever).
system.runInterval(() => {
  const now = system.currentTick;
  for (const [playerId, since] of menuOpen) {
    if (now - since > MENU_TIMEOUT_TICKS) menuOpen.delete(playerId);
  }
}, 40);

// ==================== Trigger 1: held sneak (polling) ====================
if (ENABLE_SHIFT_TRIGGER) system.runInterval(() => {
  const now = system.currentTick;
  for (const player of world.getAllPlayers()) {
    try {
      if (menuOpen.has(player.id)) continue;

      let sneaking = false;
      try { sneaking = player.isSneaking === true; } catch { sneaking = false; }
      if (!sneaking) {
        sneakStart.delete(player.id);
        continue;
      }

      const start = sneakStart.get(player.id) ?? now;
      sneakStart.set(player.id, start);

      // moving while sneaking restarts the timer
      const mv = player.inputInfo.getMovementVector();
      if (Math.abs(mv.x) > MOVE_EPS || Math.abs(mv.y) > MOVE_EPS) {
        sneakStart.set(player.id, now);
        continue;
      }

      if (now - start >= HOLD_TICKS) {
        sneakStart.delete(player.id);
        openMenu(player);
      }
    } catch { /* ignore */ }
  }
}, CHECK_INTERVAL);

// ==================== Trigger 2: spyglass ====================
if (ENABLE_SPYGLASS_TRIGGER) world.afterEvents.itemUse.subscribe(({ source, itemStack }) => {
  if (source instanceof Player && itemStack?.typeId === CAMERA_ITEM) {
    system.run(() => openMenu(source));
  }
});

// ==================== Lifecycle ====================
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  restoreLast(player);
  player.sendMessage(
    wantsPortuguese(player)
      ? "§7[Câmeras] §fAtivo! Menu: §e/cameramenu:open§f | Troca direta: §e/cameramenu:set right§f | Destrava: §e/cameramenu:reset"
      : "§7[Cameras] §fRunning! Menu: §e/cameramenu:open§f | Set: §e/cameramenu:set right§f | Unlock: §e/cameramenu:reset"
  );
});

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
  sneakStart.delete(playerId);
  menuOpen.delete(playerId);
  activeCam.delete(playerId);
  fallback.delete(playerId);
});

// ==================== Commands ====================
function asPlayer(origin) {
  const e = origin.sourceEntity;
  return e instanceof Player ? e : undefined;
}

function cmdOpen(origin) {
  const player = asPlayer(origin);
  if (!player) return { status: CustomCommandStatus.Failure, message: "Players only." };
  system.run(() => openMenu(player));
  return { status: CustomCommandStatus.Success };
}

function cmdSet(origin, key) {
  const player = asPlayer(origin);
  if (!player) return { status: CustomCommandStatus.Failure, message: "Players only." };
  const preset = PRESETS.find((p) => p.key === key);
  if (!preset) {
    return { status: CustomCommandStatus.Failure, message: "Presets: default, left, center, right, boom, far, low" };
  }
  system.run(() => applyPreset(player, preset));
  return {
    status: CustomCommandStatus.Success,
    message: wantsPortuguese(player)
      ? `§aCâmera: ${label(player, preset)}`
      : `§aCamera: ${label(player, preset)}`,
  };
}

function cmdReset(origin) {
  const player = asPlayer(origin);
  if (!player) return { status: CustomCommandStatus.Failure, message: "Players only." };
  system.run(() => {
    try {
      player.camera.clear();
      activeCam.delete(player.id);
      fallback.delete(player.id);
      player.setDynamicProperty(PROP_LAST, "default");
      player.sendMessage(
        wantsPortuguese(player)
          ? "§aCâmera resetada para o padrão."
          : "§aCamera reset to default."
      );
    } catch (e) {
      player.sendMessage(
        wantsPortuguese(player) ? `§cFalha ao resetar: ${e}` : `§cReset failed: ${e}`
      );
    }
  });
  return { status: CustomCommandStatus.Success };
}

system.beforeEvents.startup.subscribe((init) => {
  init.customCommandRegistry.registerEnum("cameramenu:preset", PRESETS.map((p) => p.key));

  init.customCommandRegistry.registerCommand(
    {
      name: "cameramenu:open",
      description: "Open the custom cameras menu",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
    },
    cmdOpen
  );

  init.customCommandRegistry.registerCommand(
    {
      name: "cameramenu:set",
      description: "Set a custom camera",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
      mandatoryParameters: [{ type: CustomCommandParamType.Enum, name: "cameramenu:preset" }],
    },
    cmdSet
  );

  init.customCommandRegistry.registerCommand(
    {
      name: "cameramenu:reset",
      description: "Reset camera to default",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
    },
    cmdReset
  );
});
