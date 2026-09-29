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
// Custom Cameras — native camera presets.
//
// The engine drives a cameras/presets/*.json preset (follow_orbit / fixed_boom). Those files
// load with the pack: no cheats and no experiment are needed. Verified on 26.50 in a world
// whose level.dat had never had an experiment (`experiments_ever_used: 0`) — and the proof is
// that a preset that fails to load makes `setCamera` throw `Invalid camera preset`, which the
// logging sessions did not show. The manifest still carries the add-on flag
// (metadata.product_type = "addon"); without it, applying the pack alone costs the world its
// achievements.
//
// The script-driven free camera is still in this file, but hidden behind
// ENABLE_SCRIPT_PATH below. See that flag for why it is off.
// ============================================================

const HOLD_TICKS = 40; // hold shift for 2s
const MOVE_EPS = 0.01;
const CHECK_INTERVAL = 5; // sneak polling (0.25s)
const PROP_LAST = "cm:preset";
const CAMERA_ITEM = "minecraft:spyglass";
const MENU_TIMEOUT_TICKS = 1200; // safety latch: a form that never resolves
const SPAWN_DELAY_TICKS = 10; // wait after spawn before restoring the camera

// Automatic triggers. Shift is the main way in: hold shift standing still and the menu
// opens; moving cancels the timer. Spyglass stays off (it is the /cameramenu:open path).
const ENABLE_SHIFT_TRIGGER = true;
const ENABLE_SPYGLASS_TRIGGER = false;

// ---- The script camera: kept, but hidden ----
//
// A minecraft:free camera repositioned by the script every tick, written as a fallback for
// worlds where the custom presets were believed not to load. Worlds like that turned out not
// to exist — the presets load with the pack, no experiment involved — and the path does not
// render in 26.50 anyway: aiming the free camera at the player collapses the view to first
// person or to the ground, and passing the player's rotation renders no camera at all.
//
// Everything that reaches it is gated on this flag — no menu entry, no
// `/cameramenu:mode|tune|debug`, and no silent fallback that would trade a working camera for
// a broken one — instead of deleting ~350 lines that a future build might honour. Flip it to
// true to bring all of that back and re-test; the code below is otherwise intact.
const ENABLE_SCRIPT_PATH = false;

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
/** players forcing the script-driven camera instead of the native preset */
const forceScript = new Set();
/** players whose camera is on hold because of the context they are in */
const suspended = new Set();

// ============================================================
// In-game tuning (script camera)
//
// Native presets live in files and are read when the world loads, so they cannot be
// changed while playing. Anything adjustable from the menu therefore drives the script
// camera: tuning a preset also switches that player to script mode, which is exactly what
// makes the add-on work without the experimental camera presets enabled.
// ============================================================
const PROP_SCRIPT = "cm:script_mode";
const PROP_TUNE_PREFIX = "cm:tune:";

/** default script framing per preset key: [side, back, up] */
const TUNE_DEFAULTS = {
  left: { side: -1.2, back: 2.5, up: 0.4 },
  center: { side: 0.0, back: 2.5, up: 0.4 },
  right: { side: 1.2, back: 2.5, up: 0.4 },
  far: { side: 0.0, back: 7.0, up: 1.0 },
  boom: { side: 0.9, back: 2.5, up: 0.4 },
};
/**
 * What each value may be set to, and how far one click moves it: [min, max, step].
 *
 * `up` starts at -1 on purpose. It used to go to -2, which puts the camera a block below
 * the player's feet — inside the ground — and a slider stuck at its minimum is exactly how
 * that happened. `up: 0` is the vanilla shoulder reference height (eye level).
 */
const TUNE_LIMITS = {
  up: [-1, 3, 0.1],
  side: [-3, 3, 0.1],
  back: [1, 16, 0.25],
  ease: [0, 0.3, 0.05],
};
// The script camera only gets one update per tick (20 Hz), so without an ease the picture
// jumps a whole tick of movement at a time — that is the flicker. `easeOptions` makes the
// client interpolate to each new target, so the camera glides between the tick updates.
// 0.05s is exactly one tick; 0 turns it off (hard cuts, for comparing).
const DEFAULT_EASE = 0.05;
/** set to false for the rest of the session if this build rejects the ease option */
let easeSupported = true;

function finite(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** keep a value inside [min, max] of a TUNE_LIMITS entry */
function clampToLimits(value, limits) {
  return Math.min(limits[1], Math.max(limits[0], value));
}

// Clearing a tuning = storing an empty string. readTune only accepts strings that parse as
// JSON, so "" reads back as "no tuning" and the preset returns to its built-in framing.
// (Deleting the property outright would mean relying on setDynamicProperty(key, undefined).)
function clearTune(player, presetKey) {
  try {
    player.setDynamicProperty(PROP_TUNE_PREFIX + presetKey, "");
  } catch (e) {
    console.warn(`[CameraMenu] could not clear the tuning: ${e}`);
  }
}

function clearAllTune(player) {
  for (const key of Object.keys(TUNE_DEFAULTS)) clearTune(player, key);
}

function readTune(player, presetKey) {
  const defaults = TUNE_DEFAULTS[presetKey];
  if (!defaults) return null;
  try {
    const raw = player.getDynamicProperty(PROP_TUNE_PREFIX + presetKey);
    if (typeof raw === "string") {
      const parsed = JSON.parse(raw);
      return {
        side: clampToLimits(finite(parsed.side, defaults.side), TUNE_LIMITS.side),
        back: clampToLimits(finite(parsed.back, defaults.back), TUNE_LIMITS.back),
        up: clampToLimits(finite(parsed.up, defaults.up), TUNE_LIMITS.up),
        ease: clampToLimits(finite(parsed.ease, DEFAULT_EASE), TUNE_LIMITS.ease),
      };
    }
  } catch { /* fall back to the built-in framing */ }
  return { ...defaults, ease: DEFAULT_EASE };
}

function writeTune(player, presetKey, values) {
  try {
    player.setDynamicProperty(PROP_TUNE_PREFIX + presetKey, JSON.stringify(values));
  } catch (e) {
    console.warn(`[CameraMenu] could not save the tuning: ${e}`);
  }
}

/**
 * Move the script camera.
 *
 * `facingLocation` = the player's head. This IS the version that renders: aiming at the
 * player puts them in frame, and the offset (camTarget) is what decides the shoulder
 * framing. `rotation: player.getRotation()` looks like the tidier form and is documented
 * (`camera @s set minecraft:free pos ^-0.75 ^ ^-1.5 rot ~ ~`), but in 26.50 it produced a
 * camera that never showed up — no error, no camera, just the sky — so it is not used here.
 * `/cameramenu:debug` step 2 re-tests it in game; if that step ever starts rendering, this
 * can be switched over and the "looking around is locked to the player" limitation goes away.
 *
 * `easeOptions` is what keeps it from flickering: a preset camera is only re-positioned once
 * per tick, so the client is asked to interpolate to each new target instead of hard-cutting
 * to it. If this build rejects the option (wrong name/shape), the flag is cleared for the
 * session and every later call goes back to a plain hard cut — the camera keeps working, it
 * just flickers like it used to.
 */
function setScriptCamera(player, location, facingLocation, easeTime) {
  const camera = player.camera;
  if (easeSupported && easeTime > 0) {
    try {
      camera.setCamera("minecraft:free", {
        location,
        facingLocation,
        easeOptions: { easeTime, easeType: "linear" },
      });
      return;
    } catch (e) {
      easeSupported = false;
      console.warn(`[CameraMenu] camera ease unavailable, using hard cuts: ${e}`);
    }
  }
  camera.setCamera("minecraft:free", { location, facingLocation });
}

function setScriptMode(player, on) {
  if (on) forceScript.add(player.id);
  else forceScript.delete(player.id);
  try {
    player.setDynamicProperty(PROP_SCRIPT, on === true);
  } catch { /* ignore */ }
}

function loadScriptMode(player) {
  // With the script path hidden, a `cm:script_mode` left behind by an earlier version must
  // not be able to switch a player onto it — otherwise the hidden path comes back on its own.
  if (!ENABLE_SCRIPT_PATH) {
    forceScript.delete(player.id);
    return;
  }
  try {
    if (player.getDynamicProperty(PROP_SCRIPT) === true) forceScript.add(player.id);
    else forceScript.delete(player.id);
  } catch { /* ignore */ }
}

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
    } else if (ENABLE_SCRIPT_PATH && preset.fb &&
               (brokenPresets.has(preset.id) || forceScript.has(player.id))) {
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
      // `facingLocation` is deliberate HERE, unlike in the script camera: this one is a
      // one-shot look-at-the-player shot from 5 blocks away, where aiming at the head is
      // the intent and cannot collapse into the player.
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
      brokenPresets.add(preset.id);
      if (ENABLE_SCRIPT_PATH) {
        // This is the expected path on a world without the experimental camera presets —
        // and the one that keeps that world's achievements. Inform, do not alarm.
        player.sendMessage(
          wantsPortuguese(player)
            ? "§7[Câmeras] modo script ativo — não precisa do experimento nem de cheats (conquistas preservadas)."
            : "§7[Cameras] script mode active — no experiment and no cheats needed (achievements stay on)."
        );
        applyFallback(player, preset);
        activeCam.set(player.id, preset);
        if (withFade) fade(player);
      } else {
        // A native preset would not apply, which in practice means this world has no
        // experimental camera presets. Put the camera back to a defined state and say what
        // is actually wrong, rather than leaving the camera wherever it happened to be and
        // letting the player guess.
        try { player.camera.clear(); } catch { /* ignore */ }
        activeCam.delete(player.id);
        // Do not blame the experiment here: the presets load with the pack on a world that has
        // never had one. A rejection means the preset itself is wrong, and the content log has
        // the schema error.
        player.sendMessage(
          wantsPortuguese(player)
            ? "§c[Câmeras] o jogo recusou este preset (\"Invalid camera preset\") — veja o erro de schema no content log."
            : "§c[Cameras] the game rejected this camera preset (\"Invalid camera preset\") — check the content log for the schema error."
        );
      }
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
    const tuned = readTune(player, preset.key);
    const off = tuned ? [tuned.side, tuned.back, tuned.up] : preset.fb;
    const ease = tuned ? tuned.ease : DEFAULT_EASE;
    const target = camTarget(player, off);
    const head = player.getHeadLocation();
    fallback.set(player.id, { preset, off, ease, cur: target, head });
    setScriptCamera(player, target, head, ease);
  } catch (e) {
    console.warn(`[CameraMenu] fallback failed: ${e}`);
  }
}

// Fallback loop (only runs for players currently in fallback mode).
//
// A plain lerp trails the player by v/LERP blocks: ~0.62 while walking (0.216 blocks per
// tick / 0.35) and ~1.55 while flying in creative — the faster you move, the worse it
// looks. Feeding the player's velocity forward by 1/LERP ticks cancels that steady-state
// error, and a snap threshold keeps teleports from flying the camera across the map.
const LERP = 0.35;
const LEAD_TICKS = 1 / LERP;
const SNAP_DISTANCE = 4;

if (ENABLE_SCRIPT_PATH) system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    const state = fallback.get(player.id);
    if (!state) continue;
    try {
      const head = player.getHeadLocation();
      const prev = state.head;
      const target = camTarget(player, state.off);
      const vx = prev ? head.x - prev.x : 0;
      const vy = prev ? head.y - prev.y : 0;
      const vz = prev ? head.z - prev.z : 0;
      state.head = head;
      const aim = {
        x: target.x + vx * LEAD_TICKS,
        y: target.y + vy * LEAD_TICKS,
        z: target.z + vz * LEAD_TICKS,
      };
      const c = state.cur;
      const k =
        Math.hypot(aim.x - c.x, aim.y - c.y, aim.z - c.z) > SNAP_DISTANCE ? 1 : LERP;
      c.x += (aim.x - c.x) * k;
      c.y += (aim.y - c.y) * k;
      c.z += (aim.z - c.z) * k;
      setScriptCamera(
        player,
        { x: c.x, y: c.y, z: c.z },
        { x: head.x, y: head.y, z: head.z },
        state.ease
      );
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

    // Say when the camera is on hold, because a held camera is cleared, and a cleared
    // camera is first person: without this line there is nothing in the UI to explain it.
    const held = suspendReason(player);
    const form = new ActionFormData()
      .title(pt ? "Câmeras" : "Cameras")
      .body(
        (pt ? `Câmera atual: ${label(player, active)}` : `Current camera: ${label(player, active)}`) +
          (held
            ? pt
              ? `\n§eEm espera (${held}) — a câmera volta quando sair.`
              : `\n§eOn hold (${held}) — the camera comes back when you leave.`
            : "") +
          (pt
            ? "\n\nSegure Shift parado para abrir este menu."
            : "\n\nHold Shift while standing still to open this menu.")
      );
    for (const p of PRESETS) form.button(label(player, p));
    // the adjust board only drives the script camera, so it goes with it
    if (ENABLE_SCRIPT_PATH) form.button(pt ? "Ajustar camera (script)" : "Adjust camera (script)");

    const res = await form.show(player);
    if (res.canceled || res.selection === undefined) return;
    if (ENABLE_SCRIPT_PATH && res.selection === PRESETS.length) {
      // this menu holds the latch: release it before opening the next form
      menuOpen.delete(player.id);
      await openTune(player);
      return;
    }
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

// ==================== Adjust board (A1) — hidden with the script path ====================
//
// Unreachable while ENABLE_SCRIPT_PATH is false: it can only write tunings for the script
// camera, which is the path that does not render.
//
// No sliders here on purpose. The modal sliders in this build opened, but their handles
// would not move and they submitted at their minimum — height -2 dropped the camera into the
// ground and smoothing 0 switched the anti-flicker ease off, which is exactly the "stuck on
// negative numbers" report. Buttons on an ActionFormData are the widget this client proves
// it can handle (the camera menu is built from the same one), so adjusting is one click per
// step, with the current values always on screen and a real reset.
async function openTune(player) {
  if (menuOpen.has(player.id)) return;
  menuOpen.set(player.id, system.currentTick);
  try {
    const pt = wantsPortuguese(player);
    const active = activeCam.get(player.id);
    const key = active && TUNE_DEFAULTS[active.key] ? active.key : "right";
    const preset = PRESETS.find((p) => p.key === key);

    const actions = [
      { field: "up", delta: 1, pt: "Altura +" , en: "Height +" },
      { field: "up", delta: -1, pt: "Altura -", en: "Height -" },
      { field: "back", delta: 1, pt: "Distancia +", en: "Distance +" },
      { field: "back", delta: -1, pt: "Distancia -", en: "Distance -" },
      { field: "side", delta: 1, pt: "Lateral +", en: "Side +" },
      { field: "side", delta: -1, pt: "Lateral -", en: "Side -" },
      { field: "ease", delta: 1, pt: "Suavidade +", en: "Smoothing +" },
      { field: "ease", delta: -1, pt: "Suavidade -", en: "Smoothing -" },
      { field: "reset", delta: 0, pt: "Resetar este preset", en: "Reset this preset" },
      { field: "original", delta: 0, pt: "Original + camera nativa", en: "Original + native camera" },
      { field: "menu", delta: 0, pt: "Outras cameras", en: "Other cameras" },
      { field: "close", delta: 0, pt: "Pronto", en: "Done" },
    ];

    for (;;) {
      const values = readTune(player, key);
      const form = new ActionFormData()
        .title(pt ? `Ajustar: ${label(player, preset)}` : `Adjust: ${label(player, preset)}`)
        .body(
          pt
            ? `Altura ${values.up}   Lateral ${values.side}\nDistancia ${values.back}   Suavidade ${values.ease}\n\nCada toque muda um passo. Suavidade 0 = cortes secos (tremido).`
            : `Height ${values.up}   Side ${values.side}\nDistance ${values.back}   Smoothing ${values.ease}\n\nEach click moves one step. Smoothing 0 = hard cuts (shaky).`
        );
      for (const action of actions) form.button(pt ? action.pt : action.en);

      const res = await form.show(player);
      if (res.canceled || res.selection === undefined) break;
      const action = actions[res.selection];
      if (!action || action.field === "close") break;

      if (action.field === "menu") {
        menuOpen.delete(player.id);
        await openMenu(player);
        return;
      }
      if (action.field === "reset") {
        clearTune(player, key);
      } else if (action.field === "original") {
        clearAllTune(player);
        setScriptMode(player, false);
      } else {
        const step = TUNE_LIMITS[action.field][2];
        // any framing change is only visible on the script camera
        setScriptMode(player, true);
        writeTune(player, key, {
          side:
            action.field === "side"
              ? clampToLimits(values.side + action.delta * step, TUNE_LIMITS.side)
              : values.side,
          back:
            action.field === "back"
              ? clampToLimits(values.back + action.delta * step, TUNE_LIMITS.back)
              : values.back,
          up:
            action.field === "up"
              ? clampToLimits(values.up + action.delta * step, TUNE_LIMITS.up)
              : values.up,
          ease:
            action.field === "ease"
              ? clampToLimits(values.ease + action.delta * step, TUNE_LIMITS.ease)
              : values.ease,
        });
      }

      // every branch ends with the camera re-applied, so the change is visible immediately
      applyPreset(player, preset, false);
    }
  } catch (e) {
    console.warn(`[CameraMenu] adjust board failed: ${e}`);
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

// ==================== Context suspend (A4) ====================
// In a bed, riding a boat/minecart/mob or gliding, a preset camera is either pointless or
// in the way, so it is put on hold and restored when the context ends. The check is wrapped
// in try/catch on purpose: if a property is ever unavailable the camera is left alone
// rather than suspended on a guess.
const SUSPEND_POLL = 10; // 0.5s

function suspendReason(player) {
  try {
    if (player.isSleeping) return "sleeping";
    const riding = player.getComponent("minecraft:riding");
    if (riding && riding.entityRidingOn) return "riding";
    if (player.isGliding) return "gliding";
  } catch { /* never suspend on a guess */ }
  return null;
}

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    try {
      const reason = suspendReason(player);
      const preset = activeCam.get(player.id);
      if (reason) {
        if (!suspended.has(player.id)) {
          suspended.add(player.id);
          fallback.delete(player.id);
          player.camera.clear();
          // One line per hold. This is the only code path that clears the camera behind the
          // player's back, so it is the first thing the content log should be asked about
          // when the camera looks "stuck in first person".
          console.warn(`[CameraMenu] camera on hold: ${reason}`);
        }
      } else if (suspended.has(player.id)) {
        suspended.delete(player.id);
        if (preset) applyPreset(player, preset, false);
      }
    } catch { /* ignore */ }
  }
}, SUSPEND_POLL);

// ==================== Lifecycle ====================
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  // Joining and respawning take the same path: dying takes the camera away with it, so the
  // preset is reapplied on the way back instead of being silently lost.
  activeCam.delete(player.id);
  fallback.delete(player.id);
  suspended.delete(player.id);
  loadScriptMode(player);
  restoreLast(player);
  if (!initialSpawn) return;
  player.sendMessage(
    wantsPortuguese(player)
      ? "§7[Câmeras] §fAtivo! §eSegure Shift parado§f abre o menu (ou §e/cameramenu:open§f) | §e/cameramenu:next§f cicla | §e/cameramenu:reset§f destrava"
      : "§7[Cameras] §fRunning! §eHold Shift standing still§f opens the menu (or §e/cameramenu:open§f) | §e/cameramenu:next§f cycles | §e/cameramenu:reset§f unlocks"
  );
});

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
  sneakStart.delete(playerId);
  menuOpen.delete(playerId);
  activeCam.delete(playerId);
  fallback.delete(playerId);
  suspended.delete(playerId);
  forceScript.delete(playerId);
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
      // the escape hatch. It also clears any tuning and script-mode flag an earlier version
      // left on this player, so a stale property can never strand the camera.
      clearAllTune(player);
      setScriptMode(player, false);
      player.sendMessage(
        wantsPortuguese(player) ? "§aCâmera resetada." : "§aCamera reset."
      );
    } catch (e) {
      player.sendMessage(
        wantsPortuguese(player) ? `§cFalha ao resetar: ${e}` : `§cReset failed: ${e}`
      );
    }
  });
  return { status: CustomCommandStatus.Success };
}

function cmdTune(origin) {
  const player = asPlayer(origin);
  if (!player) return { status: CustomCommandStatus.Failure, message: "Players only." };
  system.run(() => openTune(player));
  return { status: CustomCommandStatus.Success };
}

function cmdMode(origin, mode) {
  const player = asPlayer(origin);
  if (!player) return { status: CustomCommandStatus.Failure, message: "Players only." };
  setScriptMode(player, mode === "script");
  system.run(() => {
    // Clear first, and do not skip the apply when nothing is selected yet.
    //
    // Two things went wrong here. Going straight from a native preset camera to the script
    // free camera can leave the preset in place, so the switch looks like it did nothing;
    // clearing first makes it a clean transition. And when no camera had been picked in
    // this session, `activeCam` was empty, so the command flipped the flag, said "script
    // mode", and visibly did nothing at all — the camera stayed wherever it was (usually
    // first person), which reads exactly like "script mode is broken".
    try { player.camera.clear(); } catch { /* ignore */ }
    const current = activeCam.get(player.id);
    if (current) applyPreset(player, current, false);
    else restoreLast(player);
  });
  const pt = wantsPortuguese(player);
  return {
    status: CustomCommandStatus.Success,
    message:
      mode === "script"
        ? pt
          ? "§aCâmera por script (não precisa do experimento)."
          : "§aScript-driven camera (no experiment needed)."
        : pt
          ? "§aCâmera nativa (precisa do experimento)."
          : "§aNative camera (needs the experiment).",
  };
}

function cmdNext(origin) {
  const player = asPlayer(origin);
  if (!player) return { status: CustomCommandStatus.Failure, message: "Players only." };
  // cycle the persistent cameras only, so the one-shot cinematic is never in the way
  const cycle = PRESETS.filter((p) => p.persist);
  const current = activeCam.get(player.id) ?? PRESETS[0];
  const index = cycle.findIndex((p) => p.key === current.key);
  const preset = cycle[(index + 1) % cycle.length] ?? cycle[0];
  system.run(() => applyPreset(player, preset));
  return {
    status: CustomCommandStatus.Success,
    message: wantsPortuguese(player)
      ? `§aCâmera: ${label(player, preset)}`
      : `§aCamera: ${label(player, preset)}`,
  };
}

// ==================== Debug (temporary) ====================
//
// Hidden with the rest of the script path (ENABLE_SCRIPT_PATH). The script camera produces no
// error in the content log whether it works, does nothing or is refused, so the only way to
// tell those three apart is to ask the game for the numbers and to change the camera in named
// steps while the player watches.
function cmdDebug(origin) {
  const player = asPlayer(origin);
  if (!player) return { status: CustomCommandStatus.Failure, message: "Players only." };
  system.run(() => {
    const say = (m) => player.sendMessage(`§7[dbg] §f${m}`);
    const f3 = (v) => `${v.x.toFixed(1)},${v.y.toFixed(1)},${v.z.toFixed(1)}`;

    try {
      say(`camera.isValid = ${player.camera.isValid}`);
    } catch (e) {
      say(`camera.isValid THREW: ${e}`);
    }

    const active = activeCam.get(player.id);
    let off = [0.9, 2.5, 0.4];
    if (active && TUNE_DEFAULTS[active.key]) {
      const t = readTune(player, active.key);
      if (t) off = [t.side, t.back, t.up];
    }
    const head = player.getHeadLocation();
    const rot = player.getRotation();
    const target = camTarget(player, off);

    say(`dim=${player.dimension.id} loc=${f3(player.location)}`);
    say(`preset=${active ? active.key : "(none)"} forceScript=${forceScript.has(player.id)} easeSupported=${easeSupported}`);
    say(`head=${f3(head)} rot.x=${rot.x.toFixed(1)} rot.y=${rot.y.toFixed(1)}`);
    say(`off=${JSON.stringify(off)} target=${f3(target)}`);

    // Step 1: a plain vanilla preset. If the view does not even change here, the camera API
    // itself is not doing anything in this world, and no amount of tweaking our own call will.
    try {
      player.camera.setCamera("minecraft:third_person");
      say("passo 1: setCamera('minecraft:third_person') nao lancou — virou 3a pessoa?");
    } catch (e) {
      say(`passo 1 LANCOU: ${e}`);
    }

    system.runTimeout(() => {
      try {
        player.camera.setCamera("minecraft:free", { location: target, rotation: player.getRotation() });
        say("passo 2: free + rotation nao lancou — a camera mudou?");
      } catch (e) {
        say(`passo 2 LANCOU: ${e}`);
      }
      system.runTimeout(() => {
        try {
          player.camera.setCamera("minecraft:free", { location: target, facingLocation: head });
          say("passo 3: free + facingLocation nao lancou — a camera mudou?");
        } catch (e) {
          say(`passo 3 LANCOU: ${e}`);
        }
        say("fim. Me manda o texto do chat.");
      }, 40);
    }, 40);
  });
  return { status: CustomCommandStatus.Success };
}

system.beforeEvents.startup.subscribe((init) => {
  init.customCommandRegistry.registerEnum("cameramenu:preset", PRESETS.map((p) => p.key));
  if (ENABLE_SCRIPT_PATH) {
    init.customCommandRegistry.registerEnum("cameramenu:mode", ["native", "script"]);
  }

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

  if (ENABLE_SCRIPT_PATH) init.customCommandRegistry.registerCommand(
    {
      name: "cameramenu:tune",
      description: "Adjust the script camera framing",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
    },
    cmdTune
  );

  if (ENABLE_SCRIPT_PATH) init.customCommandRegistry.registerCommand(
    {
      name: "cameramenu:mode",
      description: "Use the native camera preset or the script-driven one",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
      mandatoryParameters: [{ type: CustomCommandParamType.Enum, name: "cameramenu:mode" }],
    },
    cmdMode
  );

  init.customCommandRegistry.registerCommand(
    {
      name: "cameramenu:next",
      description: "Cycle to the next custom camera",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
    },
    cmdNext
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

  // for pinning down why the script camera does nothing, should the path ever come back
  if (ENABLE_SCRIPT_PATH) init.customCommandRegistry.registerCommand(
    {
      name: "cameramenu:debug",
      description: "Report what the script camera is doing (temporary)",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
    },
    cmdDebug
  );
});
