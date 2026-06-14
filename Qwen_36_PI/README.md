# XCOM 2 — Tactical Strategy Game

A fully playable tactical turn-based strategy game built with Three.js, inspired by XCOM 2.

## Features

- **Procedurally Generated Maps** — Buildings, rocks, trees, water, roads, and cover objects
- **4 XCOM Classes** — Soldier, Rifleman, Grenadier, Sniper with unique stats
- **3 Alien Types** — Advent Soldiers, Sectoids (psionic), Vipers (fast)
- **Full Combat System** — Hit chance, cover bonuses, distance modifiers, flanking
- **Action Point System** — 2 AP per unit per turn
- **6 Actions** — Move, Shoot, Overwatch, Hunker Down, Grenade, Reload
- **Fog of War** — Line-of-sight based visibility
- **Enemy AI** — Cover usage, flanking, threat assessment, pod activation
- **Turn Order** — Initiative-based turn system
- **3D HUD** — Health bars, selection rings, move/shoot indicators
- **Message Log** — Combat feedback and mission events

## How to Play

### Opening the Game
Simply open `index.html` in a modern web browser (Chrome, Firefox, Edge). No server required.

### Camera Controls
| Control | Action |
|---------|--------|
| **WASD / Arrow Keys** | Pan camera |
| **Q / E** | Rotate camera |
| **R / F** | Zoom in / out |
| **Scroll Wheel** | Zoom in / out |
| **Right Mouse Drag** | Pan camera |

### Combat
1. **Select a unit** by clicking on it or its roster entry
2. **Choose an action** from the bottom panel:
   - **Move** (1 AP) — Click green tiles to move
   - **Shoot** (1 AP) — Click red/green highlighted enemies
   - **Overwatch** (1 AP) — Auto-shoot when enemies move near
   - **Hunker** (1 AP) — +20% cover for the turn
   - **Grenade** (2 AP) — Click an enemy to throw
   - **Reload** (1 AP) — Restore 2 ammo
3. **End Turn** when all units have acted

### Hit Chance Calculation
- **Base**: Unit's aim stat (65-80%)
- **Distance**: -50% at >50m, -25% at >100m, -10% at >200m
- **Cover**: -20% (half), -40% (full)
- **Hunker**: Target gets +20%
- **Flanking**: +15% if ally is on opposite side
- **Overwatch**: -30% penalty

### Missions
- **Objective**: Eliminate all hostile aliens
- Survive as many turns as possible
- Each turn grants XP for hits and kills

## Architecture

```
index.html (single file)
├── Three.js (r160) via CDN
├── Game State (G)
├── Map Generation
│   ├── Tile types (grass, rock, building, cover, water, road, tree)
│   ├── Procedural placement with noise functions
│   └── 3D mesh construction
├── Unit System
│   ├── Class definitions (stats, weapons, skills)
│   ├── 3D model generation (procedural geometry)
│   ├── Health bars (billboarded sprites)
│   └── State management (AP, cover, status effects)
├── Turn System
│   ├── Initiative-based turn order
│   ├── Player/enemy phase switching
│   └── Action point management
├── Combat
│   ├── Line of sight (raycast through tiles)
│   ├── Hit chance calculation
│   ├── Damage with armor reduction
│   └── Cover system
├── AI
│   ├── Threat assessment
│   ├── Cover usage
│   ├── Movement toward targets
│   └── Sequential pod activation
└── UI (HTML/CSS overlay)
    ├── Top bar (mission, turn, phase)
    ├── Unit roster (left)
    ├── Enemy panel (right)
    ├── Turn order (initiative)
    ├── Action panel (bottom)
    └── Message log
```

## Technical Details

- **Single HTML file** — No build step required
- **Vanilla Three.js** — No game engines or frameworks
- **Procedural assets** — All geometry from primitives
- **Target 60fps** — Optimized rendering with instancing
- **Responsive** — Adapts to window size

## Browser Compatibility
- Chrome 90+
- Firefox 88+
- Edge 90+
- Safari 14+

## Controls Reference

| Key | Action |
|-----|--------|
| W/A/S/D | Pan camera |
| Q/E | Rotate camera |
| R/F | Zoom |
| Space | End current unit's turn |
| Escape | Cancel action mode |
| Click | Select unit / confirm action |
| Right-click drag | Pan camera |
