# TACTICAL — an XCOM 2-style squad game in Three.js

A fully playable, browser-based recreation of XCOM 2's core tactical loop,
built with vanilla Three.js (r170). Every asset is procedural — boxes,
cylinders, spheres, canvas textures and synthesized WebAudio. No build step,
no external models, no game engine.

![genre](https://img.shields.io/badge/genre-turn--based%20tactics-49e0ff)

## Run it

Any static file server works (ES modules need http, not `file://`):

```bash
python3 -m http.server 8000     # or: npx serve
# open http://localhost:8000
```

Three.js is vendored in `vendor/`, so it runs fully offline.
Add `?seed=12345` to the URL to replay a specific map.

## How to play

You command a 4-soldier XCOM squad (Ranger, Grenadier, Sharpshooter,
Specialist) against 8 aliens in 3 patrol pods (ADVENT Troopers, Sectoids, a
Viper). Kill them all before they kill you.

| Input | Action |
|---|---|
| Left click | Select soldier / move / pick & confirm target |
| Right click / Esc | Cancel |
| 1–6 | Fire · Grenade · Overwatch · Hunker · Reload · Medkit |
| Tab / Enter | Cycle soldiers (or targets) / confirm shot, end turn |
| WASD · Q/E · wheel · middle-drag | Pan · rotate 90° · zoom · drag-pan |
| F / H / M | Center on soldier / help / mute |

Blue tiles are 1-action moves, yellow are dashes (both actions). Hovering a
tile shows shield icons: gold = full cover, grey = half cover. Firing,
overwatch, hunkering and grenades end a unit's turn; moving and reloading
cost one of its two actions.

### The rules under the hood

- **Cover is directional.** Adjacent cover objects protect only against
  attacks from that hemisphere (full −40 aim, half −20). No applicable cover
  means you're **flanked**: +12 aim and +33% crit for the attacker.
- **Both sides peek.** Line of sight and firing lines are traced from a
  unit's tile *and* its step-out positions beside cover, XCOM style.
- **Weapons have range profiles.** Shotguns dominate up close, sniper rifles
  punish close quarters and reward distance, rifles/cannons are balanced.
- **Overwatch** fires a reaction shot (at 0.7× aim) at the first enemy that
  moves through your line of sight — and aliens use it too.
- **Pods patrol dormant** until they see you, then scamper to cover. Pods
  only engage soldiers they can see; lose them and they hunt your last known
  position.
- **Grenades never miss**, destroy half/full cover (two will breach building
  walls), and are very happy to hit your own squad.
- **Vipers poison** (damage over time, −15 aim); the Specialist's medkit
  heals 5 and cures it.

## Architecture

```
index.html        HUD layout + CSS, import map (vendored three.js)
src/
  config.js       all balance data (stats, weapons, costs)
  rng.js          seeded mulberry32 — every mission is reproducible
  grid.js         pathfinding, LOS, cover, visibility   ← pure logic
  mapgen.js       procedural buildings/props/spawns     ← pure logic
  combat.js       hit/crit/damage math, blast areas     ← pure logic
  units.js        unit factories, statuses              ← pure logic
  ai.js           enemy & scamper decision-making       ← pure logic
  game.js         turn state machine, actions, overwatch, pods, win/lose
  meshes.js       every model & marker, built from primitives
  fog.js          fog of war (shader-injected DataTexture)
  cameraRig.js    XCOM-style camera (pan / 90° rotate / zoom / shake)
  fx.js           tween engine, tracers, explosions, WebAudio synth sounds
  ui.js           DOM HUD: roster, action bar, target cards, log, banners
  main.js         bootstrap, picking, input wiring, render loop
tests/
  smoke.mjs       56 logic assertions (LOS, cover, pathing, combat, mapgen, AI)
  playthrough.mjs full headless missions with the real Game + mocked renderer
```

Key decisions:

- **Gameplay logic is grid-based and renderer-free.** Everything above the
  line in `src/` runs in plain Node, which is how the game is tested: the
  playthrough suite plays entire missions headlessly with a cover-seeking
  policy and asserts invariants (no shared tiles, no negative HP, games
  terminate, smart play wins more often than not).
- **LOS uses Amanatides–Woo voxel traversal** for determinism and speed
  (fog-of-war recomputes ~800 tiles per soldier per step); the Three.js
  `Raycaster` handles what it's best at — mouse picking against unit
  hitboxes and the ground plane.
- **Fog of war is a 32×32 `DataTexture`** sampled by every material via an
  `onBeforeCompile` injection that multiplies the fragment color by the
  tile's visibility (unexplored / explored / visible). One texture update
  dims floors, walls, props and corpses consistently, with soft linear
  filtering at the edges.
- **Actions are promises.** Movement, tracers, scampers and reaction fire
  are awaited tweens, so interleavings like "overwatch interrupts a dash and
  kills the runner mid-path" fall out of ordinary `await` sequencing.

## Tests

```bash
node tests/smoke.mjs        # logic units
node tests/playthrough.mjs  # 8 full headless missions
```
