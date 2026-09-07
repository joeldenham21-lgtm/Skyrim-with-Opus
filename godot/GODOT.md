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

## Contracts v1 (fixed; every agent codes against these)
- **World root** is the `World` node of `scenes/main.tscn` with `scripts/world/world.gd` (`Game.world`). In `_ready` it
  instantiates, in order and only if the scene file exists: `scenes/world/terrain.tscn` → child `Terrain`,
  `water.tscn` → `Water`, `sky.tscn` → `Sky`, `structures.tscn` → `Structures`, `flora.tscn` → `Flora`,
  `anomalies.tscn` → `Anomalies`; then emits `Events.world_ready`. Each of those scenes is owned by one agent and must
  work standalone (missing siblings are normal during development).
  API on `Game.world`: `get_height(x,z)`, `get_normal(x,z)`, `get_surface(x,z)` → one of
  `grass dirt mud gravel rock road concrete wood metal sand water snow`, `in_water(x,z)`, `water_height(x,z)`,
  `poi(id)`, `pois()`, `nearest_poi(x,z)`, `poi_at(x,z)`, `weather()`, `register(kind, dict)` with kind in
  `cover|spawn|loot|hiding|footprint` (dicts carry at least `x`,`z` and for footprint `r`), `in_footprint(x,z,margin)`.
  Terrain implements `get_height/get_normal/get_surface`; Water implements `in_water/water_height`; Sky exposes
  `weather: String` (`clear|overcast|drizzle|rain|fog|storm`), `set_weather(name, seconds)` and emits
  `Events.weather_changed`. When `Sky` exists, `main.gd` builds no environment or sun: Sky owns the
  WorldEnvironment, the DirectionalLight3D (name it `Sun`), moon, clouds, fog volumes and precipitation.
- **Map data** is `data/map.json` (`Data.map`): `SIZE` (metres, square, centred on 0,0), `WATER_LEVEL`, `POIS`
  (`id,name,kind,x,z,r`, optional `anomaly`), `ROADS` (`id,width,pts`), `RAIL`, `START`, `BASE`, `COLUMN`.
  The terrain agent may enlarge the map and add POIs; existing ids stay and `poi_tier.json`/`containers_by_poi.json`
  get entries for new ids (mirror the closest existing kind).
- **Terrain source data** is generated offline by `tools/gen_terrain.py` (numpy) into `assets/terrain/`:
  `height.f32` (little-endian float32, `(N+1)×(N+1)` row-major, z-major then x, metres; N = SIZE at 1 m per sample),
  `splat.png` (RGBA8: R grass, G dirt/mud, B rock, A gravel/road), `splat2.png` (R sand, G moss, B wet, A snow),
  `flora.png` (RGBA8: R tree density, G bush density, B grass density, A clutter density), `water.png` (R water mask,
  G flow-x, B flow-y, A depth), `terrain.json` (metadata: size, min/max height, sea level, generator seed/version).
  `terrain.gd` loads these (never regenerates at runtime) and caches chunk meshes to `assets/cache/`.
- **Textures**: `assets/textures/<kind>/<kind>_albedo.webp`, `<kind>_normal.webp` (OpenGL Y+), `<kind>_orm.webp`
  (R ambient occlusion, G roughness, B metallic), `<kind>_height.webp` (grey). 2048² tileable. Kinds (minimum):
  concrete, plaster, brick, rust, painted_metal, gunmetal, wood, logs, birch_bark, pine_bark, fabric, leather,
  rubber, mud, gravel, road, asphalt, roof_tile, roof_metal, grass, dirt, rock, sand, moss, tarp, paper, glass;
  plus card atlases with alpha in `assets/textures/cards/` (grass blades, pine branch, birch branch, dead branch,
  bush, fern, reeds, leaves) and decals in `assets/textures/decals/` (bullet holes per surface, blood, cracks, moss,
  puddle, oil, scorch, rust streak, posters). Access through `Mats.pbr(kind, uv, tint, opts)` (`scripts/util/mats.gd`)
  which falls back to flat colours until the generator has run. Commit the generated files; keep the whole texture
  payload under ~150 MB (WebP q88–92 for albedo/orm/height, lossless WebP for normals or q95).
- **Audio**: `assets/audio/<name>.ogg` or `<name>_1.ogg … _4.ogg` variants (44.1 kHz, Vorbis q≈0.5),
  `Audio.play(name, pos)` / `Audio.loop(name, pos)` choose variants; bus layout `default_bus_layout.tres` with
  Master, SFX, Music, Ambience, UI, Voice; reverb is a per-area send set by `Audio.set_area(kind)`.
- **Verification**: `tools/shot.sh tools/scenarios/<name>.gd [WxH]` — imports new assets, takes the render lock
  (only one headless Godot at a time on this machine), writes `.shots/<name>/`. Always look at the PNGs.
  Fast syntax check: `godot --headless --path . --check-only --script <file.gd>` (autoload names report as
  "not found" there; that is a false positive, everything else is real). Runtime errors print as `SCRIPT ERROR`.
- **Performance budget (4K, 100 fps target on a laptop RTX 4060/4070 class GPU, FSR2 at 0.67–0.77)**: whole frame
  ≤ 1 200 draw calls and ≤ 4 M primitives at any position; terrain ≤ 40 draw calls (chunk LOD); flora is
  MultiMeshInstance3D per chunk with distance rings (grass ≤ 60 m, bushes ≤ 180 m, tree LOD0 ≤ 60 m, LOD1 ≤ 220 m,
  impostor beyond), grass and clutter cast no shadows, trees LOD0/LOD1 cast; structures merge static geometry
  per building into one ArrayMesh per material; particles ≤ 64 systems alive. `stats()` in the scenario driver
  prints draw calls and primitives — report them in your scenario and stay under budget.

## Contracts v2 (gameplay wave; fixed)
- **Player** (`scripts/player/player.gd`, `Game.player`): `head`, `cam`, `hands` (Node3D under the camera where the
  viewmodel attaches), `torch`, `weapons` (set by the weapons node), `yaw/pitch`, `crouched`, `sprinting`, `in_base`,
  `in_water`, `alive`, `hp`, `stamina`, `noise` (0..1 recent movement/shot loudness; `make_noise(l)`), `light_level`
  (0..1 how lit the player is), `eye_pos()`, `look_dir()`, `damage(amount, info)`, `heal(v)`, `stop_bleeding()`,
  `add_stamina(v)`, `lock_movement(s)`, `die(info)`, `revive()`, `teleport(x,z,y)`, `set_look(yaw,pitch)`.
  Interaction: every frame the player raycasts 2.6 m from the camera on layers 1|4|5 (areas included) and walks up
  the tree to a node in group `interactable`; `focus`/`focus_prompt` are exposed for the HUD. Interactables implement
  `prompt() -> String` (register style: "[E] SEARCH · CRATE") and `interact(player)`; optional `hold_time: float`.
  Physics layers: 1 world, 2 player, 3 entities, 4 props, 5 triggers.
- **Inventory** (`scripts/inventory/inventory.gd`, `class_name Inventory`; `Game.inventory` and `Game.storage` are
  instances over `Game.state["inventory"]` / `["storage"]`, the exact JSON shape of the browser inventory v2 so saves
  and GEAR.md stay valid: `weapons[]`, `mags[]`, `gear[]`, `items{id:count}`, `equipment{primary,secondary,sidearm,
  melee,vest,helmet,backpack,rig,headgear,mask}`, `readyMags[]`, `quick[4]`). Methods are the browser API in
  snake_case: `count/has/add/remove`, `add_ammo/ammo_count/take_ammo/ammo_types_of/preferred_ammo/set_preferred_ammo`,
  `add_weapon/remove_weapon/weapon_by_uid/weapon_in_slot/equip_weapon`, `add_mag/remove_mag/mag_by_uid/
  mags_for_weapon/is_ready/set_ready/best_mag/load_mag/unload_mag/fill_mags`, `add_gear/remove_gear/gear_by_uid/
  equip_gear/unequip/equipped/equipped_def/armor_pieces`, `weight/capacity/overweight`, `money/spend/earn/artifacts`,
  `set_quick`, `drop_all/give_starter_kit`, `list()`; static `make_weapon(id, opts)`, `make_mag(mag_id, ammo, rounds)`,
  `make_gear(id, opts)`, `attach(w, att_id)`, `detach(w, att_id)`, `weapon_effects(w)`, `weapon_weight(w)`,
  `mag_weight(m)`. Emits `Events.inventory_changed(id, delta)` ("equip"/"quick"/"*" for structural changes).
  Player damage model port lives in `scripts/player/damage.gd` (node `Damage` added under the player at start,
  `Game.player.dmg`): `bullet(ammo_id, h01, lateral01, info)`, `other(amount, info)`, `use(item_id) -> bool`, buffs.
- **Entities**: root `CharacterBody3D` in group `entities`, layer 3, mask 1|3|4; properties `kind` (mimic, slider,
  fragment, spawn, seeker, phantom), `alive: bool`, `aware: float` (0..1), `hp`, `squad`; methods `hit(info)` with
  `info = {damage, ammo_id, zone, pos, dir, from ("player"|"entity"|"blast"|"anomaly"), pen}`, `blast(pos, radius,
  damage)`, `flash(pos)`, `hear(pos, loudness)`, `stun(seconds)`. Hit zones: `Area3D` children on layer 3 named
  `head chest stomach arm_l arm_r leg_l leg_r` with `meta "zone"` and `meta "entity"` (the root). Weapon rays use mask
  1|3|4 and read `meta "entity"`/`"zone"` from the collider (falling back to `Data.zone_from_hit`).
  Entities call `Game.player.damage(amount, info)` for melee/blast and `Game.player.dmg.bullet(...)` for shots.
- **Rigs** (`scripts/entities/rig_builder.gd`, `class_name RigBuilder`): `static build(kind, variant := {}) ->
  Node3D` returns a rig (script `rig.gd`) with `play(name, blend := 0.2, speed := 1.0)` over clips `idle idle_alert
  walk run crouch_idle crouch_walk aim fire reload hit_front hit_back death_front death_back melee throw peek_l peek_r
  search flinch` (each kind implements the subset it needs), `set_aim(pitch, yaw)`, `attach(node, socket)` with
  sockets `hand_r hand_l back hip head chest`, `bone_pos(name)`, `eye_pos()`, `zones()` (the zone Area3Ds above),
  `set_ragdoll(on)`, `set_shiver(amount)` (mimic distortion shader), `set_loadout(dict)` (vest/helmet/mask/backpack
  meshes), signal `footstep(foot)`. Skins use `Mats`.
- **Weapons** (`scripts/weapons/weapons.gd`, node `Weapons` created under `Game.player.hands` at game start, sets
  `Game.player.weapons = self`): `equip_slot(i)`, `holster()`, `current() -> Dictionary` (inventory instance),
  `fire_pressed()/fire_released()`, `reload()`, `load_rounds()`, `cycle_fire_mode()`, `toggle_light()`, `melee()`,
  `throw_grenade(item_id)`, `set_ads(on)`, `ads: float`, `ammo_text()`. Ballistics: `scripts/weapons/ballistics.gd`
  static `trace(from, dir, ammo_def, effects) -> Array[Dictionary]`. Fire noise goes to `Director.notify("shot",
  {pos, loud})` and to every entity within range via `hear`. `scripts/weapons/gun_builder.gd`, `class_name
  GunBuilder`: `static build(weapon_def, instance) -> Node3D` with mount Node3Ds `muzzle top_rail side_rail
  bottom_rail mag_well ejection sight_rear sight_front grip stock`, `static refresh(node, instance)`; used for the
  viewmodel, for mimic loadouts (attached to rig socket `hand_r`) and for dropped weapons.
- **Anomalies** (`scenes/world/anomalies.tscn` → World child `Anomalies`, script `scripts/anomalies/anomalies.gd`):
  places fields from `Data.map` POIs of kind `anomaly` plus scattered singles; each anomaly node is in group
  `anomalies` with `kind`, `center`, `radius`, `revealed`, `reveal()`; API `throw_probe(from, velocity)`,
  `nearest(pos, max_dist) -> Dictionary`, `detector_query(pos, range) -> Array`, `spawn_artifact(pos, id)`.
  Artifacts are interactables. Damage via `Game.player.damage(amount, {"kind": "anomaly", "type": kind})`.
- **Loot** (`scripts/loot/loot.gd`, node `Loot` created by the inventory system, `Game.loot`): `roll_container(kind,
  tier) -> Array`, `spawn_pile(pos, items) -> Node`, `open_container(node)`; structures mark containers as
  interactables with `meta "container"` = kind (`crate locker safe desk cabinet bag corpse`) and `meta "poi"`; on
  first interaction Loot fills them and opens the loot panel via `Events.open_panel("loot", data)`.
- **Panels/HUD** (front-end wave): `Events.open_panel(name, data)` / `Events.close_panel()`; HUD reads
  `Game.player.focus_prompt`, `weapons.ammo_text()`, `Game.state`.

## Performance and shipping (owned by the orchestrator)
- `scripts/render/perf.gd` is autoloaded as **Perf**. It picks a quality preset at boot (`mobile low medium high
  ultra`, auto-detected from the GPU name / mobile feature, overridable via `Game.state.settings.quality`), applies
  it (render scale + FSR2, MSAA, TAA, shadow atlas and split count, soft-shadow quality, mesh LOD threshold,
  anisotropy) and then holds the target frame rate (`settings.targetFps`, default 100) by moving
  `Viewport.scaling_3d_scale` between the preset's min and max with hysteresis and a cooldown, emitting
  `Events.render_scale`. FSR2 replaces TAA (the engine refuses both).
  **Every other system must read Perf instead of hard-coding budgets**: `Perf.flora_density`,
  `Perf.clutter_density`, `Perf.particle_scale`, `Perf.shadow_distance`, `Perf.view_distance`, `Perf.decal_budget`,
  `Perf.light_budget`, `Perf.entity_budget`, `Perf.lod_threshold`, and the permissions `Perf.allow_sdfgi`,
  `allow_ssao`, `allow_ssil`, `allow_ssr`, `allow_glow`, `allow_volumetric_fog`, `volumetric_fog_length`.
  Perf only switches features off and clamps distances; densities, colours and energies stay with their owner
  (the Sky module owns fog values, the flora module owns its instancing). `Perf.stats()` returns fps, frame time,
  render scale, preset, draw calls, primitives and VRAM for the F3 overlay and the scenarios.
- `export_presets.cfg` + `tools/export.sh [linux|windows|android|all]` build releases into `builds/` (gitignored).
  Export templates for 4.5.stable are installed in this container. Android also needs the SDK/NDK and a keystore,
  which this container does not have; the preset is committed so it builds on a machine that does.
