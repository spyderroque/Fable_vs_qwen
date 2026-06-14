// Bootstrap: three.js scene, input, and wiring between map/units/game/UI.

import * as THREE from 'three';
import { TILE, MAP_W, MAP_H, SOLDIER_NAMES, OP_ADJ, OP_NOUN } from './config.js';
import { makeRng, hashSeed } from './rng.js';
import { generateMap } from './mapgen.js';
import { makeSoldier, makeEnemy } from './units.js';
import { MeshKit, Highlights, TileMarker, PathDots, AoeRing, makeRing } from './meshes.js';
import { FogOfWar } from './fog.js';
import { CameraRig } from './cameraRig.js';
import { FX } from './fx.js';
import { Game } from './game.js';
import { UI } from './ui.js';

// ------------------------------------------------------------------ seed

const params = new URLSearchParams(location.search);
const seedStr = params.get('seed') || String(Math.floor(Math.random() * 1e9));
const rng = makeRng(hashSeed(seedStr));

function restart(sameMap) {
  const next = sameMap ? seedStr : String(Math.floor(Math.random() * 1e9));
  location.search = '?seed=' + encodeURIComponent(next);
}

// ----------------------------------------------------------------- scene

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0c10);

const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.5, 300);

const hemi = new THREE.HemisphereLight(0x8093b8, 0x1c2026, 0.95);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2dd, 1.7);
const center = new THREE.Vector3((MAP_W - 1) * TILE / 2, 0, (MAP_H - 1) * TILE / 2);
sun.position.copy(center).add(new THREE.Vector3(26, 42, 18));
sun.target.position.copy(center);
scene.add(sun, sun.target);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const ext = MAP_W * TILE * 0.62;
sun.shadow.camera.left = -ext; sun.shadow.camera.right = ext;
sun.shadow.camera.top = ext; sun.shadow.camera.bottom = -ext;
sun.shadow.camera.near = 4; sun.shadow.camera.far = 130;
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0004;

// ------------------------------------------------------------ world build

const { map, squad, pods: podSpawns } = generateMap(rng);
const fog = new FogOfWar(MAP_W, MAP_H);
const kit = new MeshKit(scene, map, fog);
kit.buildEnvironment();

const classOrder = ['ranger', 'grenadier', 'sharpshooter', 'specialist'];
const names = rng.shuffle(SOLDIER_NAMES);
const soldiers = squad.map((s, i) =>
  makeSoldier(classOrder[i], `${names[i][0]} ${names[i][1]}`, names[i][2], s.x, s.y));

const enemies = [];
const pods = [];
podSpawns.forEach((p, pi) => {
  pods.push({ id: pi, activated: false });
  for (const m of p.members) enemies.push(makeEnemy(m.type, m.x, m.y, pi));
});

for (const u of soldiers) { kit.addUnit(u); kit.group(u).rotation.y = Math.PI; }
for (const e of enemies) kit.addUnit(e);

// ------------------------------------------------------------- helpers

const rig = new CameraRig(camera, {
  minX: -2, maxX: (MAP_W - 1) * TILE + 2,
  minZ: -2, maxZ: (MAP_H - 1) * TILE + 2,
});
rig.focusOn(soldiers[0].x * TILE, soldiers[0].y * TILE, true);

const fx = new FX(scene, rig);
const ui = new UI();
const highlights = new Highlights(scene);
const marker = new TileMarker(scene, map);
const pathDots = new PathDots(scene);
const aoeRing = new AoeRing(scene);
const selRing = makeRing(scene, 0x49e0ff);
const reticle = makeRing(scene, 0xff5340, 0.72);

const game = new Game({
  map, rng, soldiers, enemies, pods,
  deps: { kit, fx, fog, rig, ui, highlights, marker, pathDots, aoeRing, selRing, reticle },
});
ui.bind(game, rig, fx, { onRestart: restart });
ui.setMission(`${rng.pick(OP_ADJ)} ${rng.pick(OP_NOUN)}`, seedStr);

// --------------------------------------------------------------- picking

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hoverKey = -1;

function pickAt(clientX, clientY) {
  pointer.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hitUnits = raycaster.intersectObjects(kit.hitboxes, false)
    .filter(h => h.object.parent.visible);
  if (hitUnits.length) {
    const id = hitUnits[0].object.userData.unitId;
    const unit = [...soldiers, ...enemies].find(u => u.id === id && u.alive);
    if (unit) return { unit };
  }
  const g = raycaster.intersectObject(kit.ground, false);
  if (g.length) {
    const x = Math.round(g[0].point.x / TILE), y = Math.round(g[0].point.z / TILE);
    if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) return { tile: { x, y } };
  }
  return {};
}

let downPos = null, panning = false;

renderer.domElement.addEventListener('pointerdown', (e) => {
  fx.sounds.unlock();
  if (e.button === 1) { panning = true; e.preventDefault(); }
  if (e.button === 0) downPos = { x: e.clientX, y: e.clientY };
});

window.addEventListener('pointerup', (e) => {
  if (e.button === 1) panning = false;
  if (e.button === 0 && downPos) {
    const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
    downPos = null;
    if (moved < 6) {
      const hit = pickAt(e.clientX, e.clientY);
      if (hit.unit) game.clickUnit(hit.unit);
      else if (hit.tile) game.clickTile(hit.tile.x, hit.tile.y);
    }
  }
});

renderer.domElement.addEventListener('pointermove', (e) => {
  if (panning) { rig.panDrag(e.movementX, e.movementY); return; }
  const hit = pickAt(e.clientX, e.clientY);
  const k = hit.tile ? hit.tile.y * 1000 + hit.tile.x : (hit.unit ? hit.unit.y * 1000 + hit.unit.x : -1);
  if (k === hoverKey) return;
  hoverKey = k;
  if (hit.tile) game.hoverTile(hit.tile.x, hit.tile.y);
  else if (hit.unit) game.hoverTile(hit.unit.x, hit.unit.y);
  else game.hoverOff();
});

renderer.domElement.addEventListener('contextmenu', (e) => { e.preventDefault(); game.cancel(); });
renderer.domElement.addEventListener('wheel', (e) => rig.zoom(e.deltaY * 0.012), { passive: true });

// ---------------------------------------------------------------- keyboard

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  fx.sounds.unlock();
  rig.setKey(e.code, true);
  switch (e.code) {
    case 'KeyQ': rig.rotate(1); break;
    case 'KeyE': rig.rotate(-1); break;
    case 'Tab':
      e.preventDefault();
      if (game.mode === 'target') game.setTargetIdx(game.targetIdx + (e.shiftKey ? -1 : 1));
      else game.cycleSoldier(e.shiftKey ? -1 : 1);
      break;
    case 'Enter':
      e.preventDefault();
      if (game.mode === 'target') game.confirmFire();
      else game.endTurn();
      break;
    case 'Escape': game.cancel(); ui.el.help.classList.remove('open'); break;
    case 'KeyF':
      if (game.selected) rig.focusOn(game.selected.x * TILE, game.selected.y * TILE);
      break;
    case 'KeyM': ui.el.btnMute.click(); break;
    case 'KeyH': ui.toggleHelp(); break;
    case 'Digit1': game.triggerAction('fire'); break;
    case 'Digit2': game.triggerAction('grenade'); break;
    case 'Digit3': game.triggerAction('overwatch'); break;
    case 'Digit4': game.triggerAction('hunker'); break;
    case 'Digit5': game.triggerAction('reload'); break;
    case 'Digit6': game.triggerAction('medkit'); break;
  }
});
window.addEventListener('keyup', (e) => rig.setKey(e.code, false));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ------------------------------------------------------------------- loop

const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());
  rig.update(dt);
  fx.update(dt);
  ui.tick(dt);
  renderer.render(scene, camera);
}

game.start();
loop();
