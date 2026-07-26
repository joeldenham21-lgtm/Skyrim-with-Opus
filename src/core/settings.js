/**
 * WYRMHOLD — schema-driven settings.
 *
 * Every option is declared once here; the settings UI is generated from the
 * schema and the renderer reads values through `settings.get(key)`. Changing a
 * value fires listeners so subsystems can rebuild only what they must.
 */

import { clamp } from './math.js';

const STORE_KEY = 'wyrmhold.settings.v1';

// ---------------------------------------------------------------------------
// Quality presets — these only touch graphics/post keys.
// ---------------------------------------------------------------------------

export const PRESETS = {
  potato: {
    label: 'Potato', blurb: 'Anything with a screen. 30fps on old phones.',
    values: {
      renderScale: 0.6, maxRenderPixels: 921600, shadows: 'off', shadowDistance: 60,
      viewDistance: 0.45, terrainDetail: 0.6, grassDensity: 0, grassDistance: 0,
      foliageDistance: 0.4, textureQuality: 0, anisotropy: 1, waterQuality: 'low',
      volumetrics: 'off', particleQuality: 0.35, antialiasing: 'off', ssao: 'off',
      ssr: false, bloom: true, bloomIntensity: 0.5, godrays: false, dof: 'off',
      motionBlur: 0, filmGrain: 0, chromatic: 0, vignette: 0.16, sharpen: 0.45,
      lensFlare: false, cloudQuality: 'off', maxLights: 4, decals: false, wetness: false,
    }
  },
  low: {
    label: 'Low', blurb: 'Smooth on mid-range phones and laptops.',
    values: {
      renderScale: 0.72, maxRenderPixels: 1382400, shadows: 'low', shadowDistance: 90,
      viewDistance: 0.6, terrainDetail: 0.75, grassDensity: 0.4, grassDistance: 0.5,
      foliageDistance: 0.55, textureQuality: 1, anisotropy: 2, waterQuality: 'low',
      volumetrics: 'off', particleQuality: 0.5, antialiasing: 'fxaa', ssao: 'off',
      ssr: false, bloom: true, bloomIntensity: 0.6, godrays: true, dof: 'off',
      motionBlur: 0, filmGrain: 0, chromatic: 0, vignette: 0.18, sharpen: 0.55,
      lensFlare: true, cloudQuality: 'low', maxLights: 6, decals: true, wetness: false,
    }
  },
  medium: {
    label: 'Medium', blurb: 'The balanced default. 60fps on most hardware.',
    values: {
      renderScale: 0.9, maxRenderPixels: 2073600, shadows: 'medium', shadowDistance: 140,
      viewDistance: 0.78, terrainDetail: 0.9, grassDensity: 0.7, grassDistance: 0.7,
      foliageDistance: 0.75, textureQuality: 2, anisotropy: 4, waterQuality: 'medium',
      volumetrics: 'low', particleQuality: 0.75, antialiasing: 'taa', ssao: 'low',
      ssr: false, bloom: true, bloomIntensity: 0.7, godrays: true, dof: 'off',
      motionBlur: 0.2, filmGrain: 0, chromatic: 0, vignette: 0.2, sharpen: 0.6,
      lensFlare: true, cloudQuality: 'medium', maxLights: 10, decals: true, wetness: true,
    }
  },
  high: {
    label: 'High', blurb: 'Full effect stack at 1440p. Modern GPU recommended.',
    values: {
      renderScale: 1.0, maxRenderPixels: 3686400, shadows: 'high', shadowDistance: 220,
      viewDistance: 1.0, terrainDetail: 1.0, grassDensity: 1.0, grassDistance: 0.9,
      foliageDistance: 1.0, textureQuality: 3, anisotropy: 8, waterQuality: 'high',
      volumetrics: 'medium', particleQuality: 1.0, antialiasing: 'taa', ssao: 'high',
      ssr: true, bloom: true, bloomIntensity: 0.75, godrays: true, dof: 'off',
      motionBlur: 0.25, filmGrain: 0.03, chromatic: 0.05, vignette: 0.22, sharpen: 0.6,
      lensFlare: true, cloudQuality: 'high', maxLights: 16, decals: true, wetness: true,
    }
  },
  ultra: {
    label: 'Ultra', blurb: 'Everything on, 4K-ready. Enthusiast GPUs.',
    values: {
      renderScale: 1.0, maxRenderPixels: 8294400, shadows: 'ultra', shadowDistance: 320,
      viewDistance: 1.3, terrainDetail: 1.15, grassDensity: 1.0, grassDistance: 1.0,
      foliageDistance: 1.25, textureQuality: 4, anisotropy: 16, waterQuality: 'ultra',
      volumetrics: 'high', particleQuality: 1.25, antialiasing: 'taa', ssao: 'high',
      ssr: true, bloom: true, bloomIntensity: 0.8, godrays: true, dof: 'cinematic',
      motionBlur: 0.3, filmGrain: 0.04, chromatic: 0.06, vignette: 0.24, sharpen: 0.55,
      lensFlare: true, cloudQuality: 'ultra', maxLights: 24, decals: true, wetness: true,
    }
  },
  cinematic: {
    label: 'Cinematic 4K', blurb: 'Supersampled, film grade. Photo mode & screenshots.',
    values: {
      renderScale: 1.25, maxRenderPixels: 16588800, shadows: 'ultra', shadowDistance: 420,
      viewDistance: 1.6, terrainDetail: 1.3, grassDensity: 1.3, grassDistance: 1.3,
      foliageDistance: 1.5, textureQuality: 4, anisotropy: 16, waterQuality: 'ultra',
      volumetrics: 'high', particleQuality: 1.5, antialiasing: 'taa', ssao: 'high',
      ssr: true, bloom: true, bloomIntensity: 0.85, godrays: true, dof: 'cinematic',
      motionBlur: 0.35, filmGrain: 0.05, chromatic: 0.08, vignette: 0.26, sharpen: 0.5,
      lensFlare: true, cloudQuality: 'ultra', maxLights: 32, decals: true, wetness: true,
    }
  },
};

export const PRESET_ORDER = ['potato', 'low', 'medium', 'high', 'ultra', 'cinematic'];

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const T = {
  toggle: 'toggle', slider: 'slider', select: 'select', keybind: 'keybind',
  action: 'action', preset: 'preset', info: 'info',
};

/** @type {Array<{tab:string,title:string,items:Array<object>}>} */
export const SCHEMA = [
  // ------------------------------------------------------------ DISPLAY
  {
    tab: 'Display', title: 'Platform',
    items: [
      {
        key: 'platform', type: T.select, label: 'Play Mode',
        tip: 'Desktop uses mouse + keyboard and pointer lock. Mobile enables on-screen sticks, larger UI and touch-tuned quality.',
        options: [['auto', 'Auto-Detect'], ['desktop', 'Desktop'], ['mobile', 'Mobile / Touch']],
        default: 'auto', reload: 'platform',
      },
      {
        key: 'uiScale', type: T.slider, label: 'Interface Scale',
        min: 0.75, max: 1.6, step: 0.05, default: 1, fmt: v => `${Math.round(v * 100)}%`,
      },
      {
        key: 'touchScale', type: T.slider, label: 'Touch Control Size',
        min: 0.7, max: 1.5, step: 0.05, default: 1, fmt: v => `${Math.round(v * 100)}%`,
        showIf: s => s.effectivePlatform === 'mobile',
      },
      {
        key: 'leftHanded', type: T.toggle, label: 'Left-Handed Layout', default: false,
        showIf: s => s.effectivePlatform === 'mobile',
      },
    ]
  },
  {
    tab: 'Display', title: 'Resolution & Frame Rate',
    items: [
      {
        key: 'resolutionMode', type: T.select, label: 'Output Resolution',
        tip: 'Caps the internal buffer. 4K renders at up to 3840×2160 before post.',
        options: [['native', 'Native / Auto'], ['720', '720p'], ['1080', '1080p (FHD)'], ['1440', '1440p (QHD)'], ['2160', '2160p (4K UHD)'], ['unlimited', 'Uncapped']],
        default: 'native',
      },
      {
        key: 'renderScale', type: T.slider, label: 'Render Scale',
        tip: 'Below 100% the temporal upscaler reconstructs detail (like DLSS). Above 100% is supersampling.',
        min: 0.4, max: 2.0, step: 0.05, default: 1, fmt: v => `${Math.round(v * 100)}%`,
      },
      {
        key: 'dynamicResolution', type: T.toggle, label: 'Dynamic Resolution', default: true,
        tip: 'Automatically trims render scale to hold your frame-rate target.',
      },
      {
        key: 'targetFps', type: T.slider, label: 'Frame Rate Target',
        min: 30, max: 240, step: 5, default: 60, fmt: v => `${v} fps`,
      },
      { key: 'fpsCap', type: T.toggle, label: 'Cap Frame Rate To Target', default: false },
      { key: 'fullscreen', type: T.action, label: 'Fullscreen', action: 'fullscreen', btn: 'Toggle' },
    ]
  },
  {
    tab: 'Display', title: 'Camera',
    items: [
      { key: 'fov', type: T.slider, label: 'Field of View', min: 55, max: 110, step: 1, default: 75, fmt: v => `${v}°` },
      { key: 'thirdPerson', type: T.toggle, label: 'Start in Third Person', default: true },
      { key: 'headBob', type: T.slider, label: 'Head Bob', min: 0, max: 1.5, step: 0.05, default: 0.7, fmt: v => `${Math.round(v * 100)}%` },
      { key: 'cameraShake', type: T.slider, label: 'Camera Shake', min: 0, max: 1.5, step: 0.05, default: 1, fmt: v => `${Math.round(v * 100)}%` },
      { key: 'brightness', type: T.slider, label: 'Brightness', min: 0.5, max: 2.0, step: 0.02, default: 1, fmt: v => v.toFixed(2) },
    ]
  },

  // ------------------------------------------------------------ GRAPHICS
  {
    tab: 'Graphics', title: 'Quality Preset', items: [{ key: 'preset', type: T.preset }]
  },
  {
    tab: 'Graphics', title: 'Lighting & Shadows',
    items: [
      {
        key: 'shadows', type: T.select, label: 'Shadow Quality',
        options: [['off', 'Off'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra (4 cascades)']],
        default: 'high', dirty: 'shadows',
      },
      { key: 'shadowDistance', type: T.slider, label: 'Shadow Distance', min: 40, max: 500, step: 10, default: 220, fmt: v => `${v} m`, dirty: 'shadows' },
      { key: 'softShadows', type: T.toggle, label: 'Soft Shadow Filtering', default: true, dirty: 'shadows' },
      { key: 'maxLights', type: T.slider, label: 'Dynamic Light Budget', min: 2, max: 48, step: 1, default: 16 },
      { key: 'contactShadows', type: T.toggle, label: 'Contact Shadows', default: true, tip: 'Short-range screen-space shadows that ground objects on the terrain.' },
    ]
  },
  {
    tab: 'Graphics', title: 'World Detail',
    items: [
      { key: 'viewDistance', type: T.slider, label: 'View Distance', min: 0.35, max: 2.0, step: 0.05, default: 1, fmt: v => `${Math.round(v * 100)}%`, dirty: 'terrain' },
      { key: 'terrainDetail', type: T.slider, label: 'Terrain Tessellation', min: 0.5, max: 1.5, step: 0.05, default: 1, fmt: v => `${Math.round(v * 100)}%`, dirty: 'terrain' },
      { key: 'grassDensity', type: T.slider, label: 'Grass Density', min: 0, max: 1.5, step: 0.05, default: 0.85, fmt: v => v === 0 ? 'Off' : `${Math.round(v * 100)}%`, dirty: 'scatter' },
      { key: 'grassDistance', type: T.slider, label: 'Grass Distance', min: 0, max: 1.5, step: 0.05, default: 0.85, fmt: v => `${Math.round(v * 100)}%`, dirty: 'scatter' },
      { key: 'foliageDistance', type: T.slider, label: 'Tree & Rock Distance', min: 0.3, max: 1.75, step: 0.05, default: 1, fmt: v => `${Math.round(v * 100)}%`, dirty: 'scatter' },
      { key: 'particleQuality', type: T.slider, label: 'Particle Budget', min: 0.2, max: 1.75, step: 0.05, default: 1, fmt: v => `${Math.round(v * 100)}%` },
      { key: 'decals', type: T.toggle, label: 'Decals (blood, scorch, footprints)', default: true },
    ]
  },
  {
    tab: 'Graphics', title: 'Materials & Water',
    items: [
      {
        key: 'textureQuality', type: T.select, label: 'Procedural Texture Detail',
        tip: 'Resolution of the runtime-generated PBR material set. Higher costs a moment at load and more VRAM.',
        options: [[0, 'Low (256²)'], [1, 'Medium (512²)'], [2, 'High (1024²)'], [3, 'Very High (2048²)'], [4, 'Ultra (4096²)']],
        default: 3, dirty: 'textures',
      },
      { key: 'anisotropy', type: T.select, label: 'Anisotropic Filtering', options: [[1, 'Off'], [2, '2×'], [4, '4×'], [8, '8×'], [16, '16×']], default: 8, dirty: 'textures' },
      {
        key: 'waterQuality', type: T.select, label: 'Water Quality',
        options: [['low', 'Low (flat)'], ['medium', 'Medium (waves)'], ['high', 'High (+reflections)'], ['ultra', 'Ultra (+caustics, foam)']],
        default: 'high', dirty: 'water',
      },
      { key: 'wetness', type: T.toggle, label: 'Surface Wetness & Snow Build-Up', default: true },
      {
        key: 'cloudQuality', type: T.select, label: 'Volumetric Clouds',
        options: [['off', 'Off (painted sky)'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']],
        default: 'high', dirty: 'sky',
      },
      {
        key: 'volumetrics', type: T.select, label: 'Volumetric Fog & Light Shafts',
        options: [['off', 'Off'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']],
        default: 'medium',
      },
    ]
  },

  // ------------------------------------------------------------ POST
  {
    tab: 'Post FX', title: 'Anti-Aliasing & Reconstruction',
    items: [
      {
        key: 'antialiasing', type: T.select, label: 'Anti-Aliasing',
        tip: 'TAA also drives the temporal upscaler — pair it with a render scale below 100% for a big speedup.',
        options: [['off', 'Off'], ['fxaa', 'FXAA (cheap)'], ['taa', 'TAA (best)']],
        default: 'taa',
      },
      { key: 'taaStrength', type: T.slider, label: 'Temporal Blend', min: 0.5, max: 0.98, step: 0.01, default: 0.9, fmt: v => v.toFixed(2), showIf: s => s.get('antialiasing') === 'taa' },
      { key: 'sharpen', type: T.slider, label: 'Contrast-Adaptive Sharpen', min: 0, max: 1, step: 0.05, default: 0.6, fmt: v => v === 0 ? 'Off' : `${Math.round(v * 100)}%` },
    ]
  },
  {
    tab: 'Post FX', title: 'Screen-Space Effects',
    items: [
      { key: 'ssao', type: T.select, label: 'Ambient Occlusion', options: [['off', 'Off'], ['low', 'Low (8 taps)'], ['high', 'High (16 taps, GTAO)']], default: 'high' },
      { key: 'ssaoIntensity', type: T.slider, label: 'AO Intensity', min: 0, max: 2, step: 0.05, default: 1, fmt: v => `${Math.round(v * 100)}%`, showIf: s => s.get('ssao') !== 'off' },
      { key: 'ssr', type: T.toggle, label: 'Screen-Space Reflections', default: true },
      { key: 'godrays', type: T.toggle, label: 'Light Shafts / God Rays', default: true },
      { key: 'motionBlur', type: T.slider, label: 'Motion Blur', min: 0, max: 1, step: 0.05, default: 0.25, fmt: v => v === 0 ? 'Off' : `${Math.round(v * 100)}%` },
      { key: 'dof', type: T.select, label: 'Depth of Field', options: [['off', 'Off'], ['dialogue', 'Dialogue Only'], ['cinematic', 'Cinematic (always)']], default: 'dialogue' },
    ]
  },
  {
    tab: 'Post FX', title: 'Grade & Film',
    items: [
      {
        key: 'tonemap', type: T.select, label: 'Tone Mapping',
        options: [['agx', 'AgX (filmic, default)'], ['aces', 'ACES Filmic'], ['neutral', 'Khronos Neutral'], ['reinhard', 'Reinhard']],
        default: 'agx',
      },
      { key: 'exposure', type: T.slider, label: 'Exposure', min: -2, max: 2, step: 0.05, default: 0, fmt: v => `${v > 0 ? '+' : ''}${v.toFixed(2)} EV` },
      { key: 'autoExposure', type: T.toggle, label: 'Auto Exposure (eye adaptation)', default: true },
      {
        key: 'grade', type: T.select, label: 'Colour Grade',
        options: [['nordic', 'Nordic (cool teal)'], ['neutral', 'Neutral'], ['ember', 'Ember (warm)'], ['bleak', 'Bleak (desaturated)'], ['saga', 'Saga (high contrast)']],
        default: 'nordic',
      },
      { key: 'bloom', type: T.toggle, label: 'Bloom', default: true },
      { key: 'bloomIntensity', type: T.slider, label: 'Bloom Intensity', min: 0, max: 1.5, step: 0.05, default: 0.75, fmt: v => `${Math.round(v * 100)}%`, showIf: s => s.get('bloom') },
      { key: 'lensFlare', type: T.toggle, label: 'Lens Flare & Dirt', default: true },
      { key: 'chromatic', type: T.slider, label: 'Chromatic Aberration', min: 0, max: 1, step: 0.05, default: 0.05, fmt: v => v === 0 ? 'Off' : `${Math.round(v * 100)}%` },
      { key: 'vignette', type: T.slider, label: 'Vignette', min: 0, max: 1, step: 0.05, default: 0.22, fmt: v => v === 0 ? 'Off' : `${Math.round(v * 100)}%` },
      { key: 'filmGrain', type: T.slider, label: 'Film Grain', min: 0, max: 0.6, step: 0.02, default: 0.03, fmt: v => v === 0 ? 'Off' : v.toFixed(2) },
    ]
  },

  // ------------------------------------------------------------ AUDIO
  {
    tab: 'Audio', title: 'Levels',
    items: [
      { key: 'volMaster', type: T.slider, label: 'Master', min: 0, max: 1, step: 0.02, default: 0.8, fmt: v => `${Math.round(v * 100)}%` },
      { key: 'volMusic', type: T.slider, label: 'Music', min: 0, max: 1, step: 0.02, default: 0.55, fmt: v => `${Math.round(v * 100)}%` },
      { key: 'volSfx', type: T.slider, label: 'Effects', min: 0, max: 1, step: 0.02, default: 0.9, fmt: v => `${Math.round(v * 100)}%` },
      { key: 'volAmbient', type: T.slider, label: 'Ambience & Weather', min: 0, max: 1, step: 0.02, default: 0.7, fmt: v => `${Math.round(v * 100)}%` },
      { key: 'volUi', type: T.slider, label: 'Interface', min: 0, max: 1, step: 0.02, default: 0.5, fmt: v => `${Math.round(v * 100)}%` },
      { key: 'muteUnfocused', type: T.toggle, label: 'Mute When Tab Loses Focus', default: true },
    ]
  },

  // ------------------------------------------------------------ CONTROLS
  {
    tab: 'Controls', title: 'Aiming',
    items: [
      { key: 'sensitivity', type: T.slider, label: 'Look Sensitivity', min: 0.1, max: 3, step: 0.05, default: 1, fmt: v => v.toFixed(2) },
      { key: 'sensitivityAds', type: T.slider, label: 'Sensitivity While Aiming', min: 0.1, max: 2, step: 0.05, default: 0.65, fmt: v => v.toFixed(2) },
      { key: 'touchSensitivity', type: T.slider, label: 'Touch Look Speed', min: 0.5, max: 6, step: 0.1, default: 2.6, fmt: v => v.toFixed(1), tip: 'How far the camera swings per centimetre of drag. Only affects the touch look area.' },
      { key: 'invertY', type: T.toggle, label: 'Invert Vertical Look', default: false },
      { key: 'invertTouchY', type: T.toggle, label: 'Invert Vertical Touch Look', default: false },
      { key: 'smoothing', type: T.slider, label: 'Look Smoothing', min: 0, max: 1, step: 0.05, default: 0.15, fmt: v => v === 0 ? 'Raw' : `${Math.round(v * 100)}%` },
      { key: 'gamepadDeadzone', type: T.slider, label: 'Gamepad Dead Zone', min: 0, max: 0.5, step: 0.01, default: 0.16, fmt: v => v.toFixed(2) },
      { key: 'aimAssist', type: T.slider, label: 'Aim Assist', min: 0, max: 1, step: 0.05, default: 0.35, fmt: v => v === 0 ? 'Off' : `${Math.round(v * 100)}%`, tip: 'Softly biases projectiles toward a target you are already looking at. Defaults higher on touch.' },
      { key: 'autoRun', type: T.toggle, label: 'Always Run', default: true },
      { key: 'toggleCrouch', type: T.toggle, label: 'Toggle Crouch (vs hold)', default: true },
      { key: 'toggleBlock', type: T.toggle, label: 'Toggle Block (vs hold)', default: false },
    ]
  },
  { tab: 'Controls', title: 'Key Bindings', items: [{ key: '__keybinds', type: T.info }] },

  // ------------------------------------------------------------ GAMEPLAY
  {
    tab: 'Gameplay', title: 'Difficulty & Flow',
    items: [
      {
        key: 'difficulty', type: T.select, label: 'Difficulty',
        options: [['novice', 'Novice'], ['adept', 'Adept'], ['expert', 'Expert'], ['master', 'Master'], ['legend', 'Legend']],
        default: 'adept',
      },
      { key: 'autoSave', type: T.toggle, label: 'Auto-Save', default: true },
      { key: 'autoSaveMinutes', type: T.slider, label: 'Auto-Save Interval', min: 1, max: 15, step: 1, default: 4, fmt: v => `${v} min`, showIf: s => s.get('autoSave') },
      { key: 'tutorials', type: T.toggle, label: 'Show Tutorial Prompts', default: true },
      { key: 'timeScale', type: T.slider, label: 'Day Length', min: 4, max: 120, step: 2, default: 24, fmt: v => `${v} min / day` },
    ]
  },
  {
    tab: 'Gameplay', title: 'Interface',
    items: [
      { key: 'hudOpacity', type: T.slider, label: 'HUD Opacity', min: 0.15, max: 1, step: 0.05, default: 1, fmt: v => `${Math.round(v * 100)}%` },
      { key: 'hudAutoHide', type: T.toggle, label: 'Fade HUD When Idle', default: true },
      { key: 'compass', type: T.toggle, label: 'Show Compass', default: true },
      { key: 'crosshair', type: T.toggle, label: 'Show Crosshair', default: true },
      { key: 'damageNumbers', type: T.toggle, label: 'Floating Damage Numbers', default: true },
      { key: 'subtitles', type: T.toggle, label: 'Subtitles', default: true },
      { key: 'showFps', type: T.toggle, label: 'Performance Overlay', default: false },
      { key: 'questMarkers', type: T.toggle, label: 'Quest Markers', default: true },
    ]
  },
];

export const DEFAULT_BINDS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', sprint: 'ShiftLeft', crouch: 'KeyC', walk: 'AltLeft',
  attack: 'Mouse0', block: 'Mouse2', power: 'KeyF', cast: 'KeyQ',
  use: 'KeyE', sheathe: 'KeyR', swapSpell: 'KeyX',
  inventory: 'KeyI', map: 'KeyM', journal: 'KeyJ', stats: 'KeyP',
  camera: 'KeyV', wait: 'KeyT', photo: 'KeyG', menu: 'Escape',
  quick1: 'Digit1', quick2: 'Digit2', quick3: 'Digit3', quick4: 'Digit4',
};

export const BIND_LABELS = {
  forward: 'Move Forward', back: 'Move Back', left: 'Strafe Left', right: 'Strafe Right',
  jump: 'Jump', sprint: 'Sprint', crouch: 'Sneak', walk: 'Walk',
  attack: 'Attack', block: 'Block / Ward', power: 'Power Attack', cast: 'Cast Spell',
  use: 'Interact', sheathe: 'Draw / Sheathe', swapSpell: 'Cycle Spell',
  inventory: 'Inventory', map: 'World Map', journal: 'Journal', stats: 'Character',
  camera: 'Toggle View', wait: 'Wait / Rest', photo: 'Photo Mode', menu: 'Menu',
  quick1: 'Quick Slot 1', quick2: 'Quick Slot 2', quick3: 'Quick Slot 3', quick4: 'Quick Slot 4',
};

// ---------------------------------------------------------------------------

const ALL_ITEMS = (() => {
  const m = new Map();
  for (const g of SCHEMA) for (const it of g.items) if (it.key && !it.key.startsWith('__')) m.set(it.key, it);
  return m;
})();

export class Settings {
  constructor() {
    /** @type {Record<string, any>} */
    this.values = {};
    for (const [k, it] of ALL_ITEMS) if ('default' in it) this.values[k] = it.default;
    this.values.preset = 'high';
    this.binds = { ...DEFAULT_BINDS };
    this.listeners = new Set();
    /** Set of coarse invalidation tags raised since last consumed. */
    this.dirty = new Set();
    this.effectivePlatform = 'desktop';
    this.deviceTier = 'high';
  }

  // -- access ---------------------------------------------------------------
  get(key) { return this.values[key]; }
  has(key) { return key in this.values; }
  item(key) { return ALL_ITEMS.get(key); }

  set(key, value, { silent = false, fromPreset = false } = {}) {
    const it = ALL_ITEMS.get(key);
    if (it && it.type === T.slider) value = clamp(Number(value), it.min, it.max);
    if (this.values[key] === value) return false;
    const old = this.values[key];
    this.values[key] = value;
    if (it && it.dirty) this.dirty.add(it.dirty);
    if (it && it.reload) this.dirty.add(it.reload);
    // Manual graphics tweaks push the preset to "custom".
    if (!fromPreset && PRESET_ORDER.some(p => key in PRESETS[p].values)) this.values.preset = 'custom';
    if (!silent) this.emit(key, value, old);
    this.saveDeferred();
    return true;
  }

  applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    for (const [k, v] of Object.entries(p.values)) this.set(k, v, { silent: true, fromPreset: true });
    this.values.preset = name;
    this.dirty.add('shadows'); this.dirty.add('terrain'); this.dirty.add('scatter');
    this.dirty.add('textures'); this.dirty.add('water'); this.dirty.add('sky');
    this.emit('preset', name);
    this.saveDeferred();
  }

  /** Pixel cap implied by the resolution mode. */
  maxPixels() {
    switch (this.get('resolutionMode')) {
      case '720': return 1280 * 720;
      case '1080': return 1920 * 1080;
      case '1440': return 2560 * 1440;
      case '2160': return 3840 * 2160;
      case 'unlimited': return Infinity;
      default: return this.get('maxRenderPixels') ?? 3686400;
    }
  }

  // -- events ---------------------------------------------------------------
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(key, value, old) { for (const fn of this.listeners) { try { fn(key, value, old, this); } catch (e) { console.warn('[settings]', e); } } }
  consumeDirty(tag) { if (this.dirty.has(tag)) { this.dirty.delete(tag); return true; } return false; }

  // -- persistence ----------------------------------------------------------
  /** True if this page is allowed to persist anything at all. */
  get canPersist() {
    if (this._canPersist === undefined) {
      try { localStorage.setItem('wyrmhold.probe', '1'); localStorage.removeItem('wyrmhold.probe'); this._canPersist = true; }
      catch (e) { this._canPersist = false; }
    }
    return this._canPersist;
  }
  hasStoredSettings() {
    try { return !!localStorage.getItem(STORE_KEY); } catch (e) { return false; }
  }

  saveDeferred() {
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => this.save(), 350);
  }
  save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, values: this.values, binds: this.binds }));
    } catch (e) { /* private mode — settings just won't persist */ }
  }
  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (data && data.values) {
        for (const [k, v] of Object.entries(data.values)) if (k in this.values || ALL_ITEMS.has(k) || k === 'preset') this.values[k] = v;
      }
      if (data && data.binds) this.binds = { ...DEFAULT_BINDS, ...data.binds };
      return true;
    } catch (e) { return false; }
  }
  resetAll() {
    for (const [k, it] of ALL_ITEMS) if ('default' in it) this.values[k] = it.default;
    this.binds = { ...DEFAULT_BINDS };
    this.applyPreset(this.deviceTier);
    this.emit('*');
  }

  /**
   * Choose a starting preset from what we can cheaply learn about the device.
   * Deliberately conservative: it is nicer to start smooth and let the player
   * push quality up than to open on a slideshow.
   */
  autoDetect(gl) {
    const ua = navigator.userAgent || '';
    const coarse = matchMedia('(pointer: coarse)').matches;
    const touch = (navigator.maxTouchPoints || 0) > 0;
    const mobileUA = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua) ||
      (/Mac/.test(ua) && touch && !/Macintosh.*Safari.*Version\/1[0-4]/.test(ua) && coarse);
    const isMobile = mobileUA || (coarse && touch && Math.min(screen.width, screen.height) < 900);

    let tier = 'medium';
    const mem = navigator.deviceMemory || (isMobile ? 4 : 8);
    const cores = navigator.hardwareConcurrency || 4;
    let renderer = '';
    try {
      const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
      else if (gl) renderer = String(gl.getParameter(gl.RENDERER) || '');
    } catch (e) { /* blocked by privacy settings — fall through to heuristics */ }
    const r = renderer.toLowerCase();

    if (isMobile) {
      tier = 'low';
      if (/apple a1[4-9]|apple m[1-9]|adreno \(tm\) 7[3-9]|adreno \(tm\) 8|immortalis|xclipse/.test(r)) tier = 'medium';
      if (mem <= 3 || cores <= 4) tier = 'potato';
    } else {
      tier = 'medium';
      if (/rtx (30|40|50)|rx 6[6-9]|rx 7[0-9]|rx 9[0-9]|apple m[1-4] (pro|max|ultra)|arc a7/.test(r)) tier = 'ultra';
      else if (/rtx (20)|gtx 16|rx 5[5-9]|apple m[1-4]|radeon pro|quadro/.test(r)) tier = 'high';
      else if (/intel|uhd graphics|hd graphics|llvmpipe|swiftshader|software/.test(r)) tier = 'low';
      if (/llvmpipe|swiftshader|software/.test(r)) tier = 'potato';
      if (mem >= 16 && cores >= 12 && tier === 'medium') tier = 'high';
    }

    this.deviceTier = tier;
    this.detectedPlatform = isMobile ? 'mobile' : 'desktop';
    this.gpuName = renderer || 'Unknown GPU';
    return { tier, isMobile, renderer };
  }

  /** Resolves 'auto' against detection. */
  resolvePlatform() {
    const p = this.get('platform');
    this.effectivePlatform = p === 'auto' ? (this.detectedPlatform || 'desktop') : p;
    return this.effectivePlatform;
  }
}

export const settings = new Settings();
