# RADIUS — Godot remake

The game moves to **Godot 4.5 (Forward+)**. The design bible, gear spec and reference yardstick stay authoritative:
`../radius/DESIGN.md`, `../radius/GEAR.md`, `../radius/REFERENCE.md`. This file is the engine plan and the
contracts for the Godot project in this folder.

## Why Godot changes the picture
Godot gives us for free what the browser build faked: cascaded directional shadows, SDFGI global illumination,
volumetric fog and fog volumes, SSAO/SSIL, screen-space reflections, glow with proper HDR, ACES tonemapping,
colour correction, depth of field, TAA and FSR 2 upscaling (the 4K/100 fps lever), GPU particles, decals,
navigation meshes for entity pathfinding, a real audio mixer with buses and reverb, and native touch input.
The remake spends its effort on content and behaviour, not on rendering plumbing.

## Assets policy
Real assets are used where they are better than generated ones and obtainable from here:
- Fonts: IBM Plex Mono and Oswald (OFL) from npm `@fontsource/*` → `assets/fonts/`.
- CC0/MIT kits on GitHub are cloneable (e.g. Kenney's Godot FPS kit) but stylised; they do not fit a realistic
  Soviet zone, so they are not used. Texture, model and sound sites (ambientCG, Poly Haven, Kenney, Quaternius,
  freesound) are blocked by this environment's egress policy; if that changes, `tools/fetch_assets.py` is the place.
- Everything else is generated offline into normal Godot assets: PBR texture sets at 2K (`tools/gen_textures.py`,
  numpy: albedo/normal/roughness/AO/height for concrete, plaster, brick, rust, painted metal, gunmetal, wood, logs,
  birch and pine bark, fabric, leather, rubber, mud, gravel, road, roof tile, grass and leaf cards), sound effects
  and music as WAV/OGG (`tools/gen_audio.py`, porting the browser synthesis recipes), and meshes built in GDScript
  at load time (buildings, weapons, characters, trees) with a cache to `.res` so second launches are instant.

## Project layout
```
godot/
  project.godot              Forward+, physics layers, input map (keyboard, mouse, touch), autoloads
  autoload/                  Game.gd (modes, save), Events.gd (signal bus), Data.gd (catalogue from data/*.json),
                             Audio.gd (buses, positional play), Clock.gd (day cycle, Tide), Director.gd (tension)
  data/                      catalogue JSON exported from the browser build's src/data (single source of truth now here)
  scenes/                    main.tscn, player/, world/, entities/, anomalies/, base/, ui/
  scripts/                   one folder per subsystem, GDScript
  shaders/                   terrain splat, water, mimic shiver, phantom, anomalies, sky clouds, post LUT
  assets/                    fonts/, textures/ (generated), audio/ (generated), cache/ (mesh .res)
  tools/                     gen_textures.py, gen_audio.py, port_data.mjs, shot.sh (Xvfb + lavapipe screenshots),
                             scenarios/*.gd (headless drives: teleport, time, spawn, screenshot), export.sh
```

## Engine mapping (contracts for the subsystem agents)
- **World**: `scenes/world/terrain.tscn` — heightfield generated from the same noise/POI rules (script `terrain.gd`),
  MeshInstance3D chunks (32 chunks, LOD by distance) + `HeightMapShape3D` collision; splat shader with the generated
  ground textures; `water.tscn` (marsh/river plane with SSR, depth fade, foam); roads as decals + flattened terrain.
  `world.gd` exposes `get_height(x, z)`, `get_surface(x, z)`, `poi(id)`, registries `cover_points`, `spawn_spots`,
  `loot_spots`, `hiding_spots` (Array[Dictionary]).
- **Sky/weather**: `WorldEnvironment` with a ProceduralSky driven by `Clock` (sun elevation/colour keys from the
  bible), a cloud layer shader on the sky, volumetric fog density by time/weather, `FogVolume`s in hollows, drizzle
  and rain `GPUParticles3D` following the camera, the Pechorsk Anomaly and the Column as far meshes.
- **Lighting**: DirectionalLight3D (4 PSSM cascades), SDFGI on high, SSAO/SSIL, glow, ACES, adjustments; torch,
  headlamp and weapon lights as SpotLight3D with volumetric fog contribution; artifact/fragment OmniLight3D.
- **Player**: CharacterBody3D (`player.gd`): walk/sprint/crouch/jump, stamina, bleeding, weight, head bob and landing
  dip, camera on a Node3D head; `hands.tscn` viewmodel on a SubViewport-free second camera cull layer; input via
  the InputMap (actions in project.godot) — keyboard/mouse and touch (`ui/touch.tscn`: virtual stick + buttons).
- **Inventory/gear**: `scripts/inventory/` ports inventory v2 (instances as Dictionaries; save to `user://save.json`).
- **Weapons**: data from `data/weapons.json` etc.; meshes from `scripts/weapons/gun_builder.gd` (modular, with
  attachments at named mount Node3Ds); logic in `weapons.gd`; ballistics with `PhysicsDirectSpaceState3D.intersect_ray`
  and hit zones; decals for impacts; muzzle flash light + particles; casings as RigidBody3D pooled.
- **Entities**: `scenes/entities/*.tscn` (CharacterBody3D + Skeleton3D rigs built in code with AnimationPlayer
  clips generated by script): mimic (squads via `squad.gd`, NavigationAgent3D pathing on a baked NavigationRegion3D,
  cover, flanking, grenades, loadouts and drops), slider, fragment, spawn, seeker, phantom; perception in
  `perception.gd` (vision cone, light level, hearing, smoke).
- **Anomalies/artifacts**: `scenes/anomalies/*.tscn` with shaders and GPUParticles3D; probes as RigidBody3D.
- **Base/missions/economy/UI**: `scenes/base/vanno.tscn`; UI in Control scenes with a theme (`ui/theme.tres`, Plex
  Mono/Oswald), the paper register; panels: inventory, workbench, loot, supply, terminal, storage, map, bed, death.
- **Audio**: buses Master/SFX/Music/Ambience/UI with reverb per area; `Audio.play(name, pos)` picks from
  `assets/audio/<name>_*.ogg` variants; music layers as looping streams crossfaded by the Director.
- **Perf**: `perf.gd` sets `viewport.scaling_3d_mode = FSR2` and adjusts `scaling_3d_scale` to hold the target fps;
  quality presets low/medium/high/ultra; mobile preset uses the Mobile renderer.
- **Verification**: `tools/shot.sh tools/scenarios/<name>.gd` runs the game under Xvfb with software Vulkan and
  writes PNGs to `.shots/<name>/`; `godot --headless -s tools/tests/<name>.gd` runs logic tests. Every agent must
  look at its screenshots.
