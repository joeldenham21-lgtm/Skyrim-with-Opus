# RADIUS

A first-person survival horror set in the Pechorsk Restricted Zone, in the spirit of *Into the Radius 2*.
Runs in the browser. Everything — terrain, buildings, weapons, entities, sounds, music — is generated in code.
There are no assets to download.

**Play:** open `dist/radius.html` in Chrome, Edge or Firefox. Click to begin. Headphones.

## Controls

WASD move · Shift sprint · C crouch · Space jump · Mouse look · LMB fire · RMB aim · R reload / clear jam ·
T load rounds into a magazine · F torch · G throw probe · E interact (hold for artifacts) · 1–4 weapons ·
5 detector · H holster · Tab (hold) watch · I inventory · M map · Esc pause

## What you are doing

You are Explorer 61 under contract to the UN Pechorsk Special Committee. Vanno outpost is home: a bunker with a
terminal (missions, selling artifacts), a workbench (clean weapons, load magazines), a supply crate, a locker and a
cot. Beyond the door is the Radius. Take a contract, go in, get what the Committee wants, get back before the Tide.

Probes reveal anomalies. Throw before you walk. Rounds are counted one at a time. Guns foul and jam. Health does
not regenerate. Night is not survivable without a plan. The Tide comes every three days at 05:00: be inside.

## Build

```
cd radius
npm install
node build.mjs            # -> dist/radius.html (single self-contained file)
node build.mjs --serve    # dev server on http://localhost:8080, rebuilds on every request
node tools/smoke.mjs      # headless playtest: builds, runs in Chromium, screenshots, reports errors and stats
```

Design bible: `DESIGN.md`. Module contracts: `ARCHITECTURE.md`.
