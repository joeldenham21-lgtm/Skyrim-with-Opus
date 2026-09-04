# RADIUS — Design Bible

A first-person survival horror set in the Pechorsk Restricted Zone. Browser, WebGL2, everything procedural
(meshes, textures, sounds). Modeled on *Into the Radius 2*: a quiet, hostile, beautiful zone; an Explorer
who goes in, gets what the Committee wants, and tries to get back to base before the Tide.

Read this before writing any code. Every module decision should trace back to a pillar here.

## 1. Premise

Pechorsk, 1987, somewhere in the north. Two years after "the event" a ring-shaped area, the Radius, stopped
obeying physics. The UN Pechorsk Special Committee (UNPSC) contracts civilians — Explorers — to go inside.
You are Explorer 61. Your base is **Vanno**, a concrete bunker at the ring's edge. Beyond its door:
marsh, dead birch forest, the collective farm "Zarya", the substation "Object 12", a rail cutting, the church
on the hill, and at the end of everything, **the Column**: a pillar of pale light a kilometre high, where the
Radius is thickest. The sky is a closed grey lid. The sun is a coin behind gauze. Above the horizon hangs the
Pechorsk Anomaly: an inverted mountain the size of a city, silent, with slow debris orbiting it.

Every few days the **Tide** comes: the zone whites out, rearranges itself, and everything inside that isn't
in a bunker is gone. Explorers watch the clock.

## 2. Pillars (in priority order)

1. **Quiet dread, sudden violence.** Most of the time nothing happens. That is the horror. Fights are rare,
   short and decisive. Never fill silence with filler enemies.
2. **The zone notices you first.** You hear things before you see them. Enemies are silhouettes that are
   hard to separate from dead trees until they move. Sound is the primary threat channel.
3. **Everything costs.** Rounds are counted one at a time. Guns foul and jam. Health does not regenerate.
   The Tide clock runs. The flashlight has a battery. Nothing is free; every choice is a small bet.
4. **Tactile.** Reloads are staged (mag out, mag in, chamber). Probes are thrown. Artifacts are picked with a
   reach. The gun sways; you breathe. You feel the world through hands, not menus.
5. **Ebb and flow.** Tension is a curve, not a constant: calm → unease → hunt → combat → aftermath → calm. The
   Director (see §7) enforces rest windows. Day is survivable; night is not.

## 3. Anti-slop rules (hard constraints)

- No default-looking materials. Every surface has procedural variation (noise in the shader, vertex colour
  jitter, weathering gradients). No flat single-colour boxes with no detail.
- No placeholder copy. Every string the player reads is written in-world in the UNPSC register (§10).
  Never "Game Over", "You died", "Press any key", "Lorem ipsum", "TODO", "Enemy", "Item".
- No emoji, no exclamation marks in UI, no gradient-purple buttons, no rounded-pill neon UI. UI is paper,
  ink, stamp and a single amber accent (§8).
- No floating world-space text, no health bars over enemies, no minimap radar. The HUD is minimal and
  fades when not needed.
- No jump-scares by loud noise alone. Scares come from anticipation, misdirection and consequence.
- No symmetric, gridded layouts of props. Placement is jittered, clustered, motivated (a wreck by the
  road, barrels behind a shed).
- Nothing spawns in the player's view. Enemies enter from out-of-sight or from behind cover.
- Everything animates: grass in wind, debris drifting, sky scrolling, fragments pulsing, mimic edges
  shivering. Static scenes read as dead in the wrong way.

## 4. The player

- 100 HP, no regeneration. Bleeding: after taking gunshot/slash damage, lose 1 HP per 3 s until bandaged.
- Stamina 100: sprint drains 20/s, regen 12/s when not sprinting; below 20 → heavy breathing, wider spread.
- Movement: walk 3.6 m/s, sprint 6.2 m/s, crouch 1.8 m/s. Head bob scales with speed. Eye height 1.7 m
  (crouch 1.05 m). Player collider: capsule r 0.35.
- Flashlight (F): warm spot, cone 28°, drains battery 100 → 0 over ~7 in-game hours of use. Battery
  items refill it.
- Probe (G): throws a small metal probe. Passing through an anomaly triggers its reveal effect.
- Detector: held in the off-hand when equipped (slot 5); ticks faster near artifacts (< 30 m).
- Interact (E): pick up items/artifacts, open containers, use base stations. Hold-to-interact 0.6 s for
  artifacts (reach animation), instant for others.
- Meds: bandage (stops bleed, +10 HP, 3 s), medkit (+45 HP over 8 s, 5 s use), stim (stamina +100, +5 HP).
- Death: screen holds the last frame, desaturates, static rises; UNPSC status card: "EXPLORER 61 — STATUS:
  MISSING. Body not recovered. Contract void." Then "Return to Vanno" restarts from last save (sleep).
  Death costs: everything carried in the Radius. Base storage is safe.

## 5. Weapons

All hitscan with spread + recoil. Damage in HP. "Dirt" 0..1 accumulates per shot; jam chance per shot =
0.18 × dirt³. A jam needs R (clear, 1.2 s). Cleaning at base (workbench) or field kit resets dirt.

| Weapon | Ammo | Mag | Dmg | Rate | Spread | Notes |
|---|---|---|---|---|---|---|
| PM (Makarov) | 9×18 | 8 | 22 | semi, 0.14 s | 1.6° | starter, quiet-ish |
| AKM | 7.62×39 | 30 | 38 | auto 600 rpm | 2.4°, climbs | 2nd security level |
| TOZ-34 | 12 ga | 2 | 9×8 pellets | break-open | 7° | brutal to 12 m |
| Mosin | 7.62×54R | 5 | 95 | bolt 1.1 s | 0.4° | 3rd level, one-shot mimics |

Reload (R, staged): mag out 0.45 s → mag in 0.7 s → chamber 0.5 s if the chamber was empty. Held rounds
must be loaded into magazines: at base instantly, in the field with T (0.6 s per round, standing still).
ADS (RMB) narrows FOV 75 → 58, halves spread, slows movement. Recoil kicks pitch and yaw with recovery.
Muzzle flash (point light 60 ms + sprite), tracer streak, impact: sparks on metal, dust puff on ground,
concrete chips. Empty click sound on dry fire.

## 6. Entities (enemies)

Every entity has: silhouette-first design, a signature sound, a tell before it attacks, a death that is
satisfying without gore (mimics fold and dissolve into ash; fragments shatter; spawn curl up and crumble).

**Mimic** — a human-shaped absence. Matte black, no features, edges shiver (vertex jitter in the shader),
and a smeared white blot of a face that always turns toward you. Carries a rifle it shouldn't be able to
hold. Patrols POIs in pairs, stands very still watching. On contact: fires 3–5-round bursts (8 dmg each,
70 % base accuracy falling with distance), moves between cover points, flanks. When unobserved for > 2 s
it may "skip": teleport 4–8 m closer along its path. Hearing range: 40 m for gunshots, 12 m for footsteps.
Sound: radio chatter — bandpassed noise with clipped syllable bursts, garbled Russian cadence, occasional
squelch. A low tone drops when it spots you. HP 90. Ash dissolve on death.

**Slider** — a mimic that runs on all fours, too fast, joints wrong. Ambusher: lies flat in grass or under
wrecks, indistinguishable until it moves. When you're within 15 m and facing away it sprints in zigzags
and lunges (25 dmg). After a hit or when hit, it retreats out of view and circles to come again. Sound:
dry clicking (like a tongue), then a rising screech on charge. HP 60. Fast (8 m/s).

**Fragment** — a glass sphere the size of a head with a slow pink-white pulse inside. Orbits a lazy path
near anomalies; drifts toward you within 25 m, accelerating; explodes on contact (40 dmg, shock, screen
shock effect). One shot pops it (HP 1). Clusters of 2–4. Sound: pure sine chime + detuned shimmer, pulsing
faster as it approaches — the most beautiful thing in the zone, and it wants to touch you.

**Spawn** — dog-sized many-legged crawler, translucent black. Packs of 3–6, low HP (25), bite 7 dmg, fast
but erratic. Sound: granular skittering. Found in buildings and the rail cutting.

**Seeker** — a mimic three metres tall in an armoured suit, slow, sweeping a searchlight. Heavy MG (12 dmg,
long bursts). Only after Tide level 2, only at Object 12 and the church. The searchlight finding you is the
scare: light floods your screen, the hum rises. HP 600. Sound: hydraulic hiss, heavy footfalls, light hum.

## 7. The Director (ebb and flow)

`tension` 0..1 and a state: CALM → UNEASE → HUNT → COMBAT → AFTERMATH → CALM.
- CALM: wind, occasional crow, drone floor. Enemies patrol, don't seek. Guaranteed ≥ 90 s after AFTERMATH.
- UNEASE: triggered by proximity to a populated POI or by the Director on a timer (2–5 min). Birds stop.
  Static rises. Subtle: a figure on a ridge that is gone when you look again (a mimic skip).
- HUNT: an enemy is aware of you but hasn't attacked. Music pulse layer. Sliders circle; mimics reposition.
- COMBAT: shots fired. Percussion layer, low drones drop out, everything is sharp.
- AFTERMATH: 20 s after the last hostile is dead/lost. A resolving pad. Heart slows. Then CALM.
Night (§9) raises the floor: CALM at night is UNEASE. Tide < 1 h: a siren pulse from the base direction.
The Director also owns *events*: distant gunfire between mimics, a fragment cluster drifting across the
road ahead, a slider's click from the grass with no attack, radio chatter with no source.

## 8. Visual style

- Palette: overcast grey `#8a9098`, marsh olive `#4b5540`, dead birch `#c9c6bd`, rust `#7a4a2a`, concrete
  `#6e6b66`, artifact pink `#ff6fa8`, arc cyan `#7fe8ff`, ember orange `#ff8a3c`, amber UI accent `#e0a458`,
  paper `#d9d3c4`, ink `#1a1917`.
- Light: single overcast sun (soft shadows, low intensity, cool), hemisphere fill grey-blue/olive. Height
  fog + distance fog tinted by time of day (blue-grey day, amber dusk, near-black night with a pale moon).
- Post chain (in this order): bloom (soft, threshold high; only artifacts, arcs, fragments, muzzle flashes,
  the Column glow), colour grade (lifted blacks, desaturate 25 %, cool shadows, warm highlights), anomaly
  refraction/distortion, chromatic aberration (baseline tiny, grows with damage/anomaly proximity),
  vignette (grows with low HP), animated film grain, hurt flash (red-brown, not pure red), Tide white-out.
- Sky: gradient dome (overcast), sun disc with gauze halo, slow drifting cloud noise layer, the Pechorsk
  Anomaly silhouette (inverted mountain) at the horizon with orbiting debris, the Column (a vertical glow
  with slow rising particles) at the far end of the map.
- Motion: head bob, weapon sway with lag, breathing when stamina is low, camera kick on shots, subtle
  screen shake on explosions and near-miss arcs, grass in wind, debris drifting.
- Enemies: matte black material with edge shiver; fragments: refractive glass with inner pulse; anomalies
  are screen-space distortions and light, not particle vomit.

## 9. Time and the Tide

Real-time: one in-game day = 24 minutes. Dawn 05:30, dusk 19:30. Start: day 1, 07:00.
The Tide comes at 05:00 on day 4 (then every 3 days). The base wall clock and the wrist watch (hold Tab)
show "TIDE IN 2d 14h". At Tide − 60 min a siren pulses from the base. At Tide − 10 min the sky begins to
whiten. At Tide: 6 s of rising white and a chord; if the player is outside base → death (§4). If inside:
the zone resets (anomalies relocate, loot respawns, entities respawn, Tide level +1 up to 3). Sleeping at
base (bed) advances to 07:00 next day and saves.

## 10. Writing register (UNPSC)

Terse bureaucratic. Codes, sections, no warmth, occasional dry menace. Examples:

- Mission: `PSC-0417 / RETRIEVAL / OBJECT 12 — Recover the data recorder from the substation control room.
  Anomalous activity index 3. Entities reported: 2 (class Mimic). Do not engage unless necessary.
  Payment 1,800 ₽ on delivery.`
- Prompt: `PICK UP  ·  PM (Makarov)  ·  8/8` — small caps, dot separators.
- Death: `EXPLORER 61 — STATUS: MISSING. Body not recovered. Contract void.`
- Tide: `TIDE IMMINENT. RETURN TO VANNO.`
- Base terminal greeting: `VANNO OUTPOST · UNPSC TERMINAL 3 · EXPLORER 61 · SECURITY LEVEL 1`.
- Tips are rare and diegetic ("Committee advisory: probes reveal anomalies. Throw before you walk.").

## 11. Base (Vanno)

A concrete room 9 × 6 m, fluorescent hum, one flickering tube, a drip. Stations (E to use): **Terminal**
(missions, security level, sell artifacts), **Workbench** (clean weapons, load magazines from ammo boxes),
**Supply crate** (buy ammo, meds, batteries, probes, weapons per security level), **Bed** (sleep → next
07:00, saves), **Storage** (safe stash). A steel door with a wheel leads to the Radius; using it fades out
with the Radius hum swelling and fades in outside at the gate.

## 12. Missions

Generated from templates with real POIs, named items and specific counts (never "kill some enemies"):
RETRIEVAL (a named object at a POI, guarded), SURVEY (plant 3 beacons at listed coordinates), CLEARANCE
(destroy N entities of a class at a POI), ARTIFACT (deliver one artifact of a named type), and one
scripted chain per security level that pushes toward the Column. Payment scales with distance and Tide
level. Security level 1→2 at 5,000 ₽ earned, 2→3 at 15,000 ₽.

## 13. Sound (all synthesized in WebAudio; no files)

- Beds: wind (filtered noise + gust LFO), Radius hum (42 Hz + detuned partials, swells near anomalies),
  rain drizzle sometimes, crows/birds only in CALM daytime (their silence is a cue), base: fluorescent hum,
  generator, drips.
- Foley: footsteps by surface (mud squelch, grass hush, concrete tap, metal clank, wood knock), cloth
  rustle on turns, breathing, heartbeat < 30 HP.
- Weapons: transient click + noise burst + low thump + reverb tail (synthesized impulse response).
  Mechanical reload stages, jam clunk, dry click. Distant shots are low-passed with delay.
- Entities: as in §6. All positional (PannerNode HRTF), with occlusion approximated by distance fog.
- Music: drone engine; layers keyed to Director state. Tide: rising cluster + siren.

## 14. Controls

WASD move · Shift sprint · C crouch · Mouse look · LMB fire · RMB aim · R reload/clear jam · T load mag ·
F flashlight · G throw probe · E interact (hold for artifacts) · 1–4 weapons · 5 detector · Tab hold: watch
(HP, tide, time, ammo) · I inventory · Esc pause. Sensitivity/FOV/volume in settings.
