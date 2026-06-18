# Fable_vs_qwen
Comparision of Fable to Qwen3.6-35B-A3B

**In all cases the prompt was this:**

You are an expert game developer specializing in Three.js and browser-based 3D games. Your task is to recreate the core gameplay loop of XCOM 2 in Three.js.

Build a fully playable tactical turn-based strategy game with the following systems:

Map & Environment

Procedurally generated tile-based tactical maps using Three.js geometries (buildings, cover objects, destructible terrain)
Isometric or perspective camera with pan, zoom, and rotation controls
Fog of war system using shader materials or render targets
Cover system with half-cover and full-cover tiles rendered visually
Units & Combat

XCOM soldier squad (4–6 units) vs alien enemies (Advent soldiers, Sectoids, Vipers)
Turn-based action point system (2 actions per unit per turn)
Line-of-sight raycast system using Three.js Raycaster
Hit chance calculation based on distance, cover, and flanking angle
Actions: Move, Shoot, Overwatch, Reload, Grenade, Hunker Down
Health bars rendered as 3D sprites above units
UI & HUD

Action panel rendered in HTML/CSS overlaid on the Three.js canvas
Unit roster panel showing HP, ammo, and status effects
Enemy health and status indicators
Turn order display
Mission objective tracker
AI

Enemy AI that uses cover, flanks, and activates in pods when spotted
Basic threat assessment: enemies prioritize exposed soldiers
Tech constraints:

Vanilla Three.js (r160+) only — no game engines
All assets procedural or from simple geometries (BoxGeometry, CylinderGeometry, etc.) — no external model files required to run
Single HTML file deliverable if possible, otherwise clearly structured ES modules
Target 60fps on a mid-range laptop
Start with a working map renderer and unit movement, then layer in combat, AI, and UI iteratively. Show your work step by step and explain key architectural decisions as you go.
