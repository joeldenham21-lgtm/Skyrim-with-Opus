# WYRMHOLD — Crown of the North

An open-world action RPG in the frozen north, built as a spiritual successor to Skyrim.
It runs in a browser, needs no build step, and **ships with zero art assets** — every
mountain, tree, texture, sound and note of music is generated at runtime by code.

## ▶ Play now

**[Play WYRMHOLD](https://claude.ai/code/artifact/cb9e9f58-8dc8-4e6b-bcde-66266962b119)** — a one-file build of
the whole game. Nothing to install; press **BEGIN**.

Or run it locally from source:

```
git clone <this repo> && cd Skyrim-with-Opus
node serve.js
```

Then open **http://localhost:8080** and press **BEGIN**. That's the whole setup.
No `npm install`, no bundler, no downloads — the only dependency (three.js) is
vendored in `vendor/`, so it also works completely offline.

> Prefer a one-liner? `npm start`, `./play.sh`, or any static file server
> (`python3 -m http.server 8080`) works just as well.

---

## Play

| | Desktop | Mobile / Touch |
|---|---|---|
| Move | `W A S D` | left stick |
| Look | mouse | right half of the screen |
| Attack | `LMB` | ⚔ button, or tap the look area |
| Power attack | `F` | hold ⚔ |
| Block | `RMB` | 🛡 |
| Cast | `Q` | ✷ |
| Cycle spell | `X` / mouse wheel | SPELL |
| Sprint / Sneak | `Shift` / `C` | RUN / SNEAK |
| Jump | `Space` | ⤒ |
| Interact | `E` | ✋ |
| Inventory / Map / Journal / Character | `I` `M` `J` `P` | BAG / MAP / ☰ |
| Toggle 1st/3rd person | `V` | — |
| Wait / Photo mode | `T` / `G` | — |
| Menu | `Esc` | ☰ |

Everything is rebindable in **Settings → Controls**. Gamepads work too.

**Settings → Display → Play Mode** switches between Desktop and Mobile at any
moment (it also auto-detects). Mobile mode turns on the on-screen sticks and
buttons, scales the UI up, and biases quality toward frame-rate.

---

## What's in it

**The land.** A 4 × 4 km province: a river running from a northern glacier to a
southern coast, a lake, pine forest, moors, a snow line, and eleven named places
to find — the village of Hearthwatch, a nine-stone circle, a Nord barrow, a
broken watchtower, a bandit camp, a hunter's lodge, a wayshrine, a wreck on the
shingle, a mine, and a dragon's roost.

**The game.** A main quest in five stages and four side quests, with branching
dialogue (including skill checks), three merchants, smithing and smelting,
lockpicking, ten skills with twenty perks, level-up attribute choices, an
inventory with carry weight, loot tables, a bounty system, fast travel, resting,
and saves in four slots with autosave.

**The fight.** Light and power melee with real swing timing, blocking that costs
stamina, archery with charge, gravity and drag, six spells across two schools
(projectile, sustained stream, self-heal, ward), sneak attacks, staggering, and
hit-stop. Enemies see you based on distance, field of view, light level, whether
you're crouched, and how much noise you just made — and they call for help.

**The dragon.** Skarnvald wakes when you complete the ritual at the Wardstone,
then circles, strafes with fire, and lands to fight you on the ground.

---

## How it's built

There are no `.png`, `.gltf`, `.mp3` or `.wav` files anywhere in this repository.

**Materials** — 24 PBR material sets are written as small GLSL "surface recipes"
and baked on the GPU at boot into seamless albedo / ORM / normal textures at a
resolution you choose in settings. All the noise is *periodic*, so every texture
tiles perfectly; foliage recipes also bake an alpha cutout so a conifer is a
silhouette rather than a green rectangle.

**Terrain** — eroded fractal noise, carved by a river, roads and settlement pads
that are baked once into a coarse modifier field. It streams as a distance-driven
quadtree with a per-frame time budget, and the six-way splat blends by height,
slope, biome and live weather (snow actually accumulates during a blizzard).

**Sky** — Rayleigh and Mie single scattering raymarched through a spherical
atmosphere, plus a volumetric cloud slab with Beer–Powder lighting, a star field
with a Milky Way band, two moons with phase and craters, and an aurora. The same
shader is rendered into a small cubemap and run through PMREM every few frames,
so the world's ambient light always matches the sky you can see.

**Rendering** — HDR forward pass into a half-float buffer, then a hand-written
post chain: SSAO, screen-space reflections on wet ground, light shafts,
volumetric height fog with sun in-scattering, TAA (which doubles as a temporal
upscaler), a physically-scaled bloom, auto-exposure, and an AgX film transform
with selectable grades. Shadows are cascaded (via three's CSM addon), chained
onto the custom terrain/water/wind material patches.

**Animation** — no keyframes and no skeletal meshes. Every figure is assembled
from primitives into a joint hierarchy and animated by blending pose generators:
gait, crouch, swim, airborne, block, aim, cast, four attack swings, stagger and
death, with secondary motion on the cloak.

**Audio** — synthesised with the Web Audio API, including an adaptive score that
layers a modal drone, a bowed lead, a frame drum and a choir pad and cross-fades
between exploration, danger, combat, town and night.

### Layout

```
index.html          boot shell, import map
serve.js            zero-dependency static server
vendor/three/       three.js r185 (MIT), vendored so the game works offline
src/core/           math & noise, settings schema, input, save
src/render/         texture bakery, material palette, sky, post pipeline
src/world/          heightfield, terrain LOD, water, scatter, props, world state
src/game/           player, rig & animation, actors, combat, items, stats, quests, audio
src/ui/             menus, settings, HUD, inventory, map, journal, touch controls
tools/              browser test harnesses used to develop and verify the renderer
```

---

## Performance

Quality is driven by six presets from **Potato** to **Cinematic 4K**, and every
individual option is exposed underneath. The renderer separates *render*
resolution from *output* resolution, so you can run a 4K output buffer with a 70%
internal render scale and let the temporal upscaler reconstruct the detail — that
is what makes 4K viable on a laptop and 60fps viable on a phone.

- **Output Resolution** caps the buffer (720p → 4K, or uncapped).
- **Render Scale** sets the internal resolution; below 100% TAA reconstructs.
- **Dynamic Resolution** trims render scale automatically to hold your target FPS.
- **Performance Overlay** (Settings → Gameplay) shows fps, both resolutions,
  draw calls, triangles, streamed chunks and live instance counts.

The starting preset is chosen from your GPU string, device memory and core count,
and is deliberately conservative — it is nicer to start smooth and push quality
up than to open on a slideshow.

Some numbers from the test scenes: the whole village batches from 978 primitives
down to **19 draw calls**, terrain streams ~80 chunks at a time, and vegetation
draws thousands of trees, rocks and grass clumps through a handful of
InstancedMeshes that are only refilled when you cross a cell boundary.

---

## Known limitations

Worth stating plainly:

- **Reflections.** Water uses image-based reflection from the live sky plus
  screen-space refraction. There is no planar reflection pass, so you will not
  see a mountain mirrored in the lake. Screen-space reflections are applied to
  wet ground during rain, not to every surface.
- **Interiors** are one procedural barrow layout and one mine, generated from the
  same room-and-corridor system with different dressing. Houses have interiors
  you can walk into, but they are dressed from a shared kit.
- **NPC schedules** are light: villagers wander their home area and react to
  combat, but they do not sleep, work shifts or walk to the tavern at dusk.
- **The dragon** is the only flying creature, and it is the only encounter with a
  bespoke state machine.
- Shadow-casting is limited to the sun cascades; the dozens of fire and magic
  point lights illuminate but do not cast shadows, which is what keeps the light
  budget affordable.

---

## Development harnesses

`tools/` holds the pages used to build and verify this, and they are genuinely
useful if you want to poke at the renderer:

- `tools/texview.html?map=albedo&alpha=1` — every baked material as an atlas
  (`map=` albedo | orm | normal, `alpha=1` to see the cutouts).
- `tools/rendertest.html?w=960&h=540&preset=high&hour=10` — the world and post
  chain without any gameplay, with per-setting overrides via `&set=key:value`.
- `tools/shadertest.html` — compiles and bakes every recipe, reports timings.

The `.mjs` files next to them drive those pages through Playwright to take
screenshots and run a 40-case functional test over combat, quests, dialogue,
dungeons, saves, weather and the dragon.

---

## Hosting it yourself

The repository is a static site, so any file host works.

**GitHub Pages** — a workflow is included at `.github/workflows/pages.yml`, but
GitHub will not let an Actions token switch Pages on for a repository. Enable it
once by hand — **Settings → Pages → Build and deployment → Source: GitHub
Actions** — and then re-run the workflow. Every later push deploys automatically
to `https://<user>.github.io/Skyrim-with-Opus/`.

**One-file build** — `node tools/build/bundle.mjs` (needs `esbuild`) inlines
every module, the vendored three.js and the stylesheet into a single ~1 MB
`dist/wyrmhold.html` that runs from anywhere, including embedded in another
page. If pointer lock is unavailable there — as it is inside most embeds — the
game detects it and switches mouse-look to hold-and-drag.

## Licence

MIT for the game code. three.js is included under its own MIT licence
(`vendor/three/LICENSE`).

This is an original world with original names, characters and story, built as a
homage to the genre — not a copy of, or affiliated with, any Bethesda property.
