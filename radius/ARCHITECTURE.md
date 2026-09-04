# RADIUS — Architecture & Module Contracts

Read DESIGN.md first. This file is the technical contract: how modules plug together and what each owns.

## Stack
- three 0.170 (ESM), bundled with esbuild into ONE self-contained HTML (`node build.mjs` → `dist/radius.html`).
- No assets: all meshes, textures and sounds are generated in code.
- `src/main.js` builds `ctx` (the shared context) in a fixed order and runs the loop. **Do not edit main.js**; if you
  need a wiring change, say so in your report.

## The `ctx` object (everything talks through it)
| key | from | what |
|---|---|---|
| `THREE, canvas, renderer, scene, camera` | main/render | three basics. Camera is parented: `player.rig` (yaw) → `player.head` (pitch+bob) → `camera`. World-space eye = `player.eye`. |
| `events` | core/events | `on(name, fn) → off`, `once`, `emit(name, ...args)`. Event list below. |
| `input` | core/input | `down(action)`, `pressed(action)` (edge), `released`, `dx/dy` mouse delta, `wheel`, `locked`, `enabled`. Actions: forward back left right sprint crouch jump fire aim reload loadMag flashlight probe interact watch inventory pause slot1..slot5 holster map lean. |
| `state` | core/state | `state.data` = persistent JSON (hp, stamina, money, securityLevel, day, hour, tideLevel, tideDay, flashlight, inventory, storage, missions, stats, flags, settings, seed). `save()/load()/reset()`. |
| `time` | core/time | `hour` (0–24), `day`, `night` (0..1), `isNight`, `tideIn()` seconds, `tideInText()`, `clockText()`, `advance(s)`, `sleepToMorning()`. 1 day = 24 real min. |
| `rng` | core/rng | seeded `mulberry32`: `rng()`, `.range(a,b)`, `.int(a,b)`, `.pick(arr)`, `.chance(p)`, `.gauss()`, `.fork(salt)`. Use `rng.fork(n)` for your module so you don't disturb others' sequences. Also exports `noise2, fbm2, ridged2, hash2, scatter`. |
| `elapsed, frame` | main | seconds since boot (always advances), frame count. Use `ctx.elapsed` for animation time. |
| `world` | world/world | see World below. |
| `sky, lighting, post, vfx` | render | see Render below. |
| `player, inventory, hands, weapons, ballistics` | player/weapons | see Player/Weapons. |
| `enemies, director, population` | enemies | see Enemies. |
| `anomalies, artifacts, probes, detector` | anomalies | see Anomalies. |
| `audio, music, ambience` | audio | see Audio. |
| `hud, menus, panels` | ui | see UI. |
| `missions, loot, base, scares, tide, structures, props, flora, debris` | game/world | see below. |
| `interact` | core/interact | `register({ position: Vector3 | () => Vector3, radius=2.2, prompt: 'PICK UP · PM' | () => string, hold: 0 | seconds, onInteract(), enabled?: () => bool }) → unregister fn`. Prompt text: `[E] text` chooses the key label; default E. Use `·` separators, small-caps style, no exclamation marks. |
| `mode` | main | `'title' | 'playing' | 'paused' | 'dead'`. |
| `game` | main | `start(newGame)`, `pause()`, `resume()`, `respawn()`, `toTitle()`. |
| `debug` | main | `{ god, noEnemies }`. |

Every module is created by `createX(ctx)` and returns an object with `update(dt[, t])`. **`dt` is 0 while a base panel
is open** (world frozen) and while not playing. Never keep your own clocks that assume dt > 0.

### Events (emit/listen via `ctx.events`)
`gameStart(newGame)`, `respawn`, `playerDamaged(amount, info)`, `playerDied(info)`, `deathScreen(info)`, `footstep({surface, sprint, crouch})`,
`inventoryChanged({id, delta})`, `earned(n)`, `enemySpawned(e)`, `enemyHit(e, amount, info)`, `enemyKilled(e, info)`,
`directorState(state, prev)`, `directorNotify(kind, data)`, `directorEvent(name)`, `newday(day)`, `tideWarning('hour'|'minutes')`, `tideNow`, `tideRising`, `tide(level)` (the reset: re-roll your content), `enterBase`, `exitBase`, `missionAccepted(m)`, `missionCompleted(m)`, `missionFailed(m)`, `artifactPicked(id)`, `anomalyRevealed(a)`, `weaponFired(w)`, `weaponJammed(w)`, `pointerlock(bool)`, `keydown(code)`, `canvasClick`, `sleep`.

## World (`ctx.world`)
- `map` = `world/map.js` exports: `SIZE=640, HALF, WATER_LEVEL=-0.6, POIS[], poi(id), ROADS[], RAIL, START, BASE, COLUMN, distToPolyline(x,z,pts) → {d,t}, pointOnPolyline(pts,t01)`.
  POIs: vanno(base) checkpoint convoy marsh zarya(village) object12(industrial) rail church forest field_a(electric) field_b(reflector) field_c(gravity) vents(gas) north(ridge). Each `{id, name, kind, x, z, r}`.
- `getHeight(x,z)`, `getNormal(x,z,out)`, `getSurface(x,z) → 'grass'|'mud'|'road'|'rock'|'water'`, `isWater(x,z)`.
- Colliders: `addBox(cx,cy,cz,sx,sy,sz, {surface, tag, passable, blocksBullets, noAvoid, walkable})`, `addCylinder(x,z,r,y0,y1,{...})`, `addCollider(c)`, `removeCollider(c)`, `clearTag(tag)`, `query(x,z,r,fn)`, `pointInSolid(x,y,z)`.
  Boxes are world-axis-aligned. Build rotated walls from several boxes. Use `tag` so Tide resets can `clearTag`.
- `groundHeight(x,z,fromY) → {y, surface}` (terrain or a box top you can stand on), `resolveCapsule(pos, r, h)`, `raycast(origin, dir, maxDist) → {distance, point, normal, surface, collider} | null`, `lineOfSight(a, b)`.
- Registries (push into these; AI/loot/missions read them): `coverPoints: Vector3[]`, `spawnSpots: [{position, poi, kind:'interior'|'exterior'|'hidden'}]`, `lootSpots: [{position, poi, kind:'shelf'|'floor'|'crate'}]`, `hidingSpots: [{position, poi}]`.
- `baseVolume {min,max}`, `isInBase(p)`, `nearestPoi(x,z,kinds?)`, `randomPoint(rnd, cx, cz, r)`.
- Terrain material is a MeshStandardMaterial with a procedural splat; all built-in materials get **global fog** (height + distance + sun tint) automatically via `render/fog.js`. Custom ShaderMaterials that want fog must `Object.assign(uniforms, fogUniforms, UniformsUtils.clone(UniformsLib.fog))`, set `fog: true`, and `#include <fog_pars_vertex>/<fog_vertex>/<fog_pars_fragment>/<fog_fragment>` (see `terrain.js` water for a working example). Materials with `fog: false` are unfogged (use for sky/distant/glow).

## Render
- `sky`: `uniforms` (uSunDir, uNight, uTime, uHorizon, uZenith, uTide...), `columnPosition`. Owns the dome, the Pechorsk Anomaly, orbiting debris, the Column.
- `lighting`: `sun, moon, hemi, ambient, flashlight (SpotLight on camera), sunDir, horizon, zenith, sunColor, storm (0..1 extra fog)`, `setFlashlight(on)`. Fog color/density are driven per frame from a keyframe table by hour.
- `post`: `damageFlash(v)`, `flash(v)` (white), `shock(v)` (fragment ring+inversion), `shake(v)`, `setAnomaly(strength, sx, sy, aberration)`, `setBlur(v)`, `setTide(v)`, `setDeath(v)`, `bloom` (UnrealBloomPass; threshold 0.88 — only emissive > ~1.0 blooms; use `emissiveIntensity` > 1 or additive materials with bright colors for glow).
- `vfx`: `spark(pos, normal, n, [r,g,b])`, `dustPuff(pos, normal, n, [r,g,b], size)`, `impact(pos, normal, surface)`, `tracer(from, to, width)`, `muzzleFlash(pos, dir)`, `light(pos, color, intensity, life, distance)` (pooled point light), `explosion(pos, radius, color)`, `shatter(pos, [r,g,b])`, `ash(pos, n)`. Particle pools: `vfx.sparks.emit(...)`, `vfx.dust.emit(x,y,z, vx,vy,vz, r,g,b, life, size, gravity, kind(0 spark|1 puff), now)` with `now = ctx.elapsed`.
- `render/textures.js`: `radialTexture(key, stops)`, `glowTexture()`, `softDotTexture()`.
- `render/glsl.js`: `GLSL_NOISE` (hash11/21/31, vnoise, vnoise3, fbm, fbm3, fbm3d, worley), `GLSL_ACES`.
- Renderer: no tone mapping (post does ACES). Shadows: PCFSoft, sun shadow box 140 m around the player. Set `castShadow` on meshes that matter (trees, buildings, enemies); `receiveShadow` on big surfaces.

## Player (`ctx.player`)
`position` (feet, Vector3), `velocity`, `rig`, `head`, `eye` (world-space camera position), `forward` (XZ unit), `yaw`, `pitch`, `hp`, `stamina`, `crouched`, `sprinting`, `moving`, `speed`, `noise` (0..1 loudness), `dead`, `inBase`, `inWater`, `eyeHeight`, `radius`.
`damage(amount, {kind:'bullet'|'slash'|'melee'|'blast'|'shock'|'burn'|'fall'|'bleed'|'anomaly', source, bleed:false?})`, `heal(n)`, `stopBleeding()`, `addStamina(n)`, `kick(pitchRad, yawRad)` (recoil), `lockMovement(seconds)`, `teleport(x,z)`, `setLook(yaw,pitch)`, `die(info)`.
Yaw 0 faces north (−z). `forward = (−sin yaw, 0, −cos yaw)`.

## Inventory (`ctx.inventory`) — `player/inventory.js`
Exports `AMMO`, `ITEMS`, `WEAPON_DEFS`, `makeWeapon(id)`, `defaultInventory()`. Data lives in `state.data.inventory = { weapons: [ {uid,id,dirt,jammed,chamber,mags:[rounds...],magIndex} ], slots:[uid|null ×4], items:{id:count}, ammo:{cal:count} }`.
API: `count(id)`, `has(id,n)`, `add(id,n)`, `remove(id,n)`, `addAmmo(cal,n)`, `ammoCount(cal)`, `takeAmmo(cal,n)`, `addWeapon(w)`, `removeWeapon(uid)`, `weaponInSlot(i)`, `weaponByUid`, `artifacts()`, `money()`, `spend(n)`, `earn(n)`, `fillMags(w)`, `dropAll()`, `giveStarterKit()`. Emits `inventoryChanged`.

## Weapons (`ctx.weapons`, `ctx.hands`, `ctx.ballistics`) — weapons agent
- `weapons.current → { def (WEAPON_DEFS entry), id, uid, chamber, mags, magIndex, dirt, jammed, state } | null` (state: idle|firing|reloading|jammed|bolt|breaking). `adsBlend` 0..1, `spreadDeg` (live), `equipSlot(i)`, `holster()`, `fire()`, `reload()`, `onInventoryChanged()`, `update(dt)`.
- Weapons must: read input themselves (fire/aim/reload/loadMag/slot1-4/holster/wheel), call `ballistics.shoot`, `player.kick`, `vfx.muzzleFlash`, `audio.play('shot_<id>', {pos})`, `director.notify('shot', {pos})`, `hud.showAmmo()` + `hud.setAmmo(html)`, `hud.setSpread(px, ads)`, emit `weaponFired`/`weaponJammed`, mutate the inventory weapon object directly (it is the save data), and set `camera.fov` for ADS (base fov = `state.data.settings.fov`).
- `hands.root` is a Group under the camera; `hands.setWeaponMesh(group|null)`, `hands.kick()`, `hands.adsBlend`. Sway/bob/breath live here.
- `ballistics.shoot(origin, dir, { damage, range, spreadDeg, pellets=1, tracer=true, source:'player'|'enemy', kind:'bullet' }) → hits[]`. Tests `enemies.raycast` first then `world.raycast`; applies `enemy.damage`, `vfx.impact(point, normal, surface)`, tracers. Enemies may call it with `source:'enemy'` to shoot the player (it then tests the player capsule instead of enemies).
- Gun meshes: `weapons/gunmesh.js` `buildGun(id) → Group` with named children `mag`, `slide`/`bolt`, `muzzle` (an Object3D at the muzzle for flash/tracer origin). Low-poly but with bevels, dark metal + worn wood/bakelite, procedural grime; never a plain box.

## Enemies (`ctx.enemies`, `enemies/common.js`)
- Manager: `registerType(type, Class)`, `spawn(type, Vector3, opts) → enemy`, `list`, `count(type?)`, `nearest(pos, maxD, filter)`, `engagedCount()`, `raycast(origin, dir, maxDist) → {enemy, distance, point}`, `blast(center, radius, damage, info)`, `removeAll()`.
- `class Enemy` (extend it): fields `type, position, yaw, hp, maxHp, alive, aware (0..1), engaged, state, stateT, radius, height, speed, poi, home, lastSeenPlayer, lastSeenT, root (Group in scene), flying`.
  Helpers: `perceive(dt, {fov, maxDay, hearing, visGain, hearGain, decay})` (integrates awareness; fires director spotted/lost), `playerVisibility()`, `playerAudibility()`, `observedByPlayer(halfAngle)`, `followGround(dt)`, `faceToward(x,z,dt,rate)`, `moveToward(target, speed, dt, {stop, allowWater, face, turnRate}) → remaining`, `hitTest(origin, dir, max)` (capsule; override for odd shapes), `damage(amount, info)`, `kill(info)`, `hurtPlayer(amount, kind)`, `sound(name, opts)`, `loopSound(name, opts)` (auto-stopped on death), `setState(s)`, `distanceToPlayer()`, `eyePos(out)`.
  Overridables: `tick(dt)` (your AI), `onHit(amount, info)`, `onDeath(info)`, `deathTick(dt)`, `deathDuration`, `onSpotted()`, `onStateChange(s)`, `onDispose()`.
- Types & registration: each file exports `registerX(ctx)` calling `ctx.enemies.registerType('x', Class)`. Constructor signature `(ctx, position, opts)`.
- `director`: `state` (CALM/UNEASE/HUNT/COMBAT/AFTERMATH), `tension` 0..1, `threatNear`, `engaged`, `notify(kind, data)`, `recentShotAt(pos, range)`, `rest()`.
- `population` (enemies-core agent): decides who lives where by POI and tide level, spawns out of view (`!e.observedByPlayer()` test on candidate spots, > 35 m away), caps counts, respawns on `tide`, respects `ctx.debug.noEnemies`.

## Anomalies (`ctx.anomalies`, `ctx.artifacts`, `ctx.probes`, `ctx.detector`) — anomalies agent
- `anomalies.list`, `spawn(type, pos)` (types: electric, reflector, gravity, gas), `fieldAt(playerPos) → { strength, sx, sy, aberration }` (post distortion; main does not call post for you — call `ctx.post.setAnomaly(...)` in your update), `nearestDistance(pos)`, `populate()`, `reset()`. Each anomaly: `{ type, position, radius, revealed, reveal(), update(dt), affectPlayer(dt) }`. Artifacts spawn 2–6 m from anomalies via `artifacts.spawn(type, pos)` and register with `ctx.interact` (hold 0.6 s, prompt `PICK UP · PEARL`), add to inventory (`art_pearl` etc.), emit `artifactPicked`.
- `probes`: G throws (consumes `probe` item); simple ballistic arc with terrain/collider stop; passing within `anomaly.radius` calls `reveal()`.
- `detector`: slot 5 equips it (`weapons.holster()` first); ticks (`audio.play('detector_tick')`) at a rate from distance to nearest artifact.

## Audio (`ctx.audio`) — engine is done; `sfx.js` (sfx agent) registers names; `music.js` + `ambience.js` (music agent)
- `audio.register(name, (audio, out, opts) => handle?)` for one-shots; `audio.registerLoop(name, (audio, out, opts) => ({ stop(), set(k,v), update(dt) }))` for loops. Inside generators use `audio.ctx`, `audio.now`, `audio.noise(type)`, `audio.osc(type, f)`, `audio.gain(v)`, `audio.filter(type, f, q)`, `audio.env(param, [[t, v, 'lin'|'exp'], ...], t0)`, `audio.shaper(k)`, `audio.delay(t, fb)`. Connect your chain to `out` (a GainNode already routed to a bus/panner). Start sources with `.start(t)` and stop them at a definite time.
- `audio.play(name, { pos?, gain, rate, hrtf, ref, max, rolloff, reverb, bus:'sfx'|'music'|'amb', ...custom })` → handle; `audio.loop(name, opts)` → `{ setPos(v3), setGain(v, tc), set(k,v), stop(fade) }`; `audio.stopAll()`, `setMuffle(0..1)`, `setVolume`, `setMusicVolume`. Missing names are recorded in `audio.missing` (shown by `__radius.stats()`).
- **Canonical sound names** (sfx agent registers ALL of these; everyone else plays them by name):
  - core: `step_grass step_mud step_road step_rock step_water step_concrete step_metal step_wood land jump hurt hurt_bullet death flashlight click ui_slip tide_warn tide_chord siren`
  - weapons: `shot_pm shot_akm shot_toz shot_mosin dry_click reload_magout reload_magin reload_chamber bolt_open bolt_close break_open break_close shell_insert jam unjam mag_load_round weapon_draw weapon_holster ads_in ads_out bullet_whiz impact_metal impact_concrete impact_dirt impact_wood impact_ash impact_glass impact_water`
  - enemies: `mimic_radio mimic_spot mimic_shot mimic_hit mimic_death mimic_skip mimic_step slider_click slider_screech slider_lunge slider_hit slider_death slider_step fragment_pop fragment_explode fragment_approach spawn_skitter spawn_bite spawn_death seeker_step seeker_shot seeker_hiss seeker_death seeker_spot`
  - enemy loops: `mimic_static fragment_chime seeker_hum`
  - anomalies: `arc_zap reflector_whip gravity_crush gas_cough probe_throw probe_land probe_trigger artifact_pickup detector_tick` · loops: `arc_hum reflector_hum gravity_drone gas_hiss artifact_hum`
  - ambience one-shots: `crow bird distant_shot drip` · loops: `wind radius_hum base_hum drizzle`
  - ui/game: `ui_click ui_open ui_close ui_buy ui_deny ui_stamp door_open door_close sleep mission_complete container_open pickup_item pickup_ammo bandage_use medkit_use stim_use`
  Music is synthesized directly in `music.js` (not registered names). Generators receive `opts` so callers can pass `{ rate, gain, pos, variant }`.
- **Enemy fire contract**: entities shoot with `ctx.ballistics.shoot(origin, dir, { source:'enemy', damage, spreadDeg, tracer:true, kind:'bullet' })`. With `source:'enemy'` ballistics tests the world and the player capsule (feet `player.position`, radius 0.35, height 1.8 or 1.3 crouched), calls `player.damage(damage, { kind:'bullet', source: opts.shooter })` on a hit, plays `bullet_whiz` when the ray passes within 1.5 m of `player.eye` without hitting, spawns impact vfx, and returns the hit list.

## UI (`ctx.hud`, `ctx.menus`, `ctx.panels`)
- `hud`: `prompt(text|null, holdProgress)`, `notify(text, {code, ms})`, `setObjective(code, text, targetVector3|null)`, `showAmmo()`, `setAmmo(html)`, `hint(text, ms)`, `setSpread(px, ads)`, `fadeOut(white?)`, `fadeIn()`, `setGameVisible(bool)`. CSS in `ui/style.css` (core); UI agent adds `ui/ui.css`.
- `menus` (UI agent): `show('title'|'pause'|'death'|'settings', data)`, `hide()`, `current`. Must call `ctx.game.start/resume/respawn/toTitle`.
- `panels` (UI agent): `open('inventory'|'terminal'|'workbench'|'supply'|'storage'|'bed'|'map', data)`, `close()`, `isOpen`. The world freezes while open; `Esc` closes (main handles). Panels unlock the pointer (`ctx.input.unlock()`, `ctx.input.enabled=false`) and re-lock on close.

## Game modules
- `missions` (game agent): `available()`, `active`, `accept(id)`, `complete(id)`, `generate()`, `reset()`, `update(dt)`. Places mission objects via `ctx.interact` + small meshes, tracks kills via `enemyKilled`, uses `hud.setObjective`, pays via `inventory.earn`, raises `state.data.securityLevel` (5,000 / 15,000 ₽ earned). Writing register: DESIGN.md §10.
- `loot` (game agent): fills `world.lootSpots` with containers/items (ammo boxes, meds, batteries, probes, the odd weapon), re-rolls on `tide`.
- `scares` (game agent): timed director events (figure on a ridge that vanishes, distant gunfire, clicks in the grass, radio voice with no source, a fragment cluster crossing ahead), respecting director state (only in CALM/UNEASE) and never inside the base.
- `base` (structures agent): bunker mesh (exterior + interior), colliders, the door (interact → fade → toggle in/out + emit enterBase/exitBase), stations registered with `interact` that call `ctx.panels.open(name)`, base lights (flickering tube), `world.baseVolume` alignment.
- `structures`/`props` (structures agent), `flora`/`debris` (flora agent): build once at init from `world.map`; register colliders (tag by POI), cover points, spawn/loot/hiding spots. Use InstancedMesh for anything repeated. Budget: ≤ 400 draw calls total, ≤ 1.5 M triangles in view.

## Testing
`node tools/smoke.mjs --out .smoke/<name> [--scenario file.mjs] [--seconds N]` builds and runs the game headless (SwiftShader WebGL2), screenshots, and prints console errors + `__radius.stats()`. Scenarios: `export default async (page, api) => { await api.start(); await api.run('window.__radius.teleport(-130, 60)'); await api.screenshot('zarya'); }`. Debug API: `window.__radius.{start, teleport(x,z), look(dx,dy), setLook(yaw,pitch), setTime(h), spawn(type,x,z), spawnAnomaly(type,x,z), god(), give(id,n), giveWeapon(id), press(action), stats(), ctx}`. Use `--out` under `.smoke/` with your own name so parallel runs don't collide. Expect ~15–25 fps under SwiftShader; that's the software renderer, not the game.

## Conventions
- **Never cache `ctx.state.data`** (or anything inside it) across frames: `game.start()` replaces the object. Read `ctx.state.data.x` when you need it.
- ES modules, no TypeScript, no external deps beyond three. Prefer `const`, small pure helpers, early returns.
- Never allocate `new THREE.Vector3()` per frame in hot loops — keep module-level temporaries.
- Everything you add to the scene must be disposable on `tide` reset if it is content (loot, enemies, anomalies, artifacts); static structures stay.
- Colors: DESIGN.md §8 palette. Materials: `MeshStandardMaterial` with `roughness ≥ 0.7`, use `onBeforeCompile` or `vertexColors` for procedural variation; never `MeshNormalMaterial`, never untextured flat single-colour walls.
- Strings: DESIGN.md §10 register. No emoji, no exclamation marks, no placeholder text.
