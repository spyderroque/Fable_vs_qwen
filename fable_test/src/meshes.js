// All procedural geometry: environment, units, highlights, markers, health bars.
// Everything is built from three.js primitives — no external assets.

import * as THREE from 'three';
import { TILE } from './config.js';
import { key, coverSides } from './grid.js';

export const tileToWorld = (x, y, h = 0) => new THREE.Vector3(x * TILE, h, y * TILE);

function box(w, h, d, color, opts = {}) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    opts.mat || new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05 })
  );
  m.position.set(opts.x || 0, opts.y ?? h / 2, opts.z || 0);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function cyl(r, h, color, opts = {}) {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(opts.rTop ?? r, r, h, opts.seg || 12),
    new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.1 })
  );
  m.position.set(opts.x || 0, opts.y ?? h / 2, opts.z || 0);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function sphere(r, color, opts = {}) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(r, opts.seg || 14, opts.seg || 12),
    new THREE.MeshStandardMaterial({
      color, roughness: 0.7,
      emissive: opts.emissive || 0x000000, emissiveIntensity: opts.emissiveIntensity ?? 1,
    })
  );
  m.position.set(opts.x || 0, opts.y || 0, opts.z || 0);
  if (opts.scale) m.scale.set(...opts.scale);
  m.castShadow = true;
  return m;
}

// ---------------------------------------------------------------- environment

function groundTexture(map) {
  const px = 32;
  const c = document.createElement('canvas');
  c.width = map.w * px; c.height = map.h * px;
  const g = c.getContext('2d');
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const t = map.tiles[y * map.w + x];
      const v = ((x * 7349 + y * 9151) % 13) - 6;
      let base = [42 + v, 46 + v, 52 + v];                 // asphalt
      if (t.interior) base = [58 + v, 56 + v, 64 + v];      // building floor
      if (t.type === 'door') base = [70 + v, 64 + v, 52 + v];
      g.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
      g.fillRect(x * px, y * px, px, px);
    }
  }
  g.strokeStyle = 'rgba(160,200,255,0.07)';
  g.lineWidth = 1;
  for (let i = 0; i <= map.w; i++) {
    g.beginPath(); g.moveTo(i * px, 0); g.lineTo(i * px, map.h * px); g.stroke();
  }
  for (let j = 0; j <= map.h; j++) {
    g.beginPath(); g.moveTo(0, j * px); g.lineTo(map.w * px, j * px); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function propMesh(kind, rng01) {
  const g = new THREE.Group();
  switch (kind) {
    case 'wall': {
      g.add(box(TILE, 2.6, TILE, 0x4d5668));
      const trim = box(TILE * 1.02, 0.14, TILE * 1.02, 0x39404f, { y: 2.55 });
      g.add(trim);
      break;
    }
    case 'truck': {
      const colors = [0x7c3a3a, 0x3a5d7c, 0x4a6b46, 0x8a7140];
      g.add(box(1.84, 2.0, 1.84, colors[Math.floor(rng01 * colors.length)]));
      g.add(box(1.9, 0.12, 1.9, 0x2c2f36, { y: 2.0 }));
      break;
    }
    case 'pillar': g.add(cyl(0.45, 2.3, 0x6b7280, { seg: 10 })); break;
    case 'tank': {
      g.add(cyl(0.68, 2.05, 0x77694a, { seg: 14 }));
      g.add(cyl(0.2, 0.3, 0x4b4337, { y: 2.15 }));
      break;
    }
    case 'dumpster': {
      g.add(box(1.7, 1.9, 1.4, 0x3f5a44));
      g.add(box(1.74, 0.1, 1.44, 0x2f4433, { y: 1.92 }));
      break;
    }
    case 'crate': {
      g.add(box(1.3, 0.92, 1.3, 0x8a6a42));
      g.add(box(1.34, 0.08, 0.16, 0x6e5232, { y: 0.5 }));
      break;
    }
    case 'barrier': {
      const b = box(1.6, 0.88, 0.55, 0x8b8f98);
      if (rng01 > 0.5) b.rotation.y = Math.PI / 2;
      g.add(b);
      break;
    }
    case 'hydrant': {
      g.add(cyl(0.2, 0.75, 0xb33a3a, { seg: 10 }));
      g.add(sphere(0.16, 0xb33a3a, { y: 0.78 }));
      break;
    }
    case 'planter': {
      g.add(box(1.35, 0.55, 1.35, 0x7a7f88));
      g.add(box(1.1, 0.38, 1.1, 0x3e6b35, { y: 0.72 }));
      break;
    }
    case 'sandbags': {
      g.add(box(1.35, 0.42, 0.85, 0x9c8d62));
      g.add(box(1.1, 0.36, 0.7, 0x8d7e55, { y: 0.6 }));
      break;
    }
    default: g.add(box(1.2, 0.9, 1.2, 0x888888));
  }
  return g;
}

// ------------------------------------------------------------------- units

function soldierMesh(tint) {
  const g = new THREE.Group();
  const armor = 0x39414e, dark = 0x252a33;
  g.add(box(0.17, 0.66, 0.24, dark, { x: -0.12, y: 0.33 }));
  g.add(box(0.17, 0.66, 0.24, dark, { x: 0.12, y: 0.33 }));
  g.add(box(0.56, 0.6, 0.34, armor, { y: 0.96 }));
  g.add(box(0.6, 0.1, 0.38, tint, { y: 1.22 }));            // class-tinted shoulder line
  g.add(box(0.14, 0.5, 0.2, armor, { x: -0.36, y: 0.95 }));
  g.add(box(0.14, 0.5, 0.2, armor, { x: 0.36, y: 0.95 }));
  g.add(sphere(0.17, 0xc9a380, { y: 1.46 }));
  g.add(box(0.34, 0.16, 0.36, dark, { y: 1.56 }));           // helmet
  const gun = box(0.09, 0.11, 0.86, 0x14171c, { x: 0.3, y: 1.02, z: 0.18 });
  gun.name = 'muzzle';
  g.add(gun);
  return g;
}

function trooperMesh() {
  const g = new THREE.Group();
  const armor = 0x1d1f24, trim = 0xc03d3d;
  g.add(box(0.18, 0.68, 0.26, armor, { x: -0.13, y: 0.34 }));
  g.add(box(0.18, 0.68, 0.26, armor, { x: 0.13, y: 0.34 }));
  g.add(box(0.6, 0.62, 0.38, armor, { y: 0.99 }));
  g.add(box(0.64, 0.1, 0.42, trim, { y: 1.26 }));
  g.add(box(0.15, 0.52, 0.22, armor, { x: -0.39, y: 0.98 }));
  g.add(box(0.15, 0.52, 0.22, armor, { x: 0.39, y: 0.98 }));
  g.add(box(0.32, 0.36, 0.34, armor, { y: 1.52 }));
  g.add(box(0.26, 0.1, 0.06, trim, { y: 1.52, z: 0.17 }));   // visor
  const gun = box(0.09, 0.11, 0.8, 0x101216, { x: 0.31, y: 1.05, z: 0.18 });
  gun.name = 'muzzle';
  g.add(gun);
  return g;
}

function sectoidMesh() {
  const g = new THREE.Group();
  const skin = 0x9aa3ad;
  g.add(cyl(0.07, 0.6, skin, { x: -0.1, y: 0.3, seg: 8 }));
  g.add(cyl(0.07, 0.6, skin, { x: 0.1, y: 0.3, seg: 8 }));
  g.add(cyl(0.16, 0.55, skin, { y: 0.85, rTop: 0.12, seg: 10 }));
  g.add(cyl(0.05, 0.5, skin, { x: -0.24, y: 0.9, seg: 8 }));
  g.add(cyl(0.05, 0.5, skin, { x: 0.24, y: 0.9, seg: 8 }));
  g.add(sphere(0.27, 0xb6bfc9, { y: 1.38, scale: [1, 1.15, 1.05] }));
  g.add(sphere(0.06, 0x000000, { x: -0.11, y: 1.42, z: 0.22, emissive: 0x9b4fd4, emissiveIntensity: 2 }));
  g.add(sphere(0.06, 0x000000, { x: 0.11, y: 1.42, z: 0.22, emissive: 0x9b4fd4, emissiveIntensity: 2 }));
  const gun = box(0.07, 0.09, 0.5, 0x2c1f38, { x: 0.26, y: 0.95, z: 0.15 });
  gun.name = 'muzzle';
  g.add(gun);
  return g;
}

function viperMesh() {
  const g = new THREE.Group();
  const scale = 0xc9b23e, belly = 0xe0d49a;
  g.add(cyl(0.42, 0.3, scale, { y: 0.15, seg: 12 }));
  g.add(cyl(0.3, 0.35, scale, { y: 0.45, seg: 12 }));
  g.add(cyl(0.19, 0.7, scale, { y: 0.95, rTop: 0.15, seg: 10 }));
  g.add(box(0.3, 0.5, 0.1, belly, { y: 0.95, z: 0.13 }));
  const hood = sphere(0.3, scale, { y: 1.5, scale: [1.25, 1.1, 0.55] });
  g.add(hood);
  g.add(sphere(0.16, 0xb5a138, { y: 1.52, z: 0.18 }));
  g.add(sphere(0.045, 0x000000, { x: -0.08, y: 1.58, z: 0.3, emissive: 0xff5533, emissiveIntensity: 2 }));
  g.add(sphere(0.045, 0x000000, { x: 0.08, y: 1.58, z: 0.3, emissive: 0xff5533, emissiveIntensity: 2 }));
  const muzzle = sphere(0.05, 0x6b5f22, { y: 1.45, z: 0.34 });
  muzzle.name = 'muzzle';
  g.add(muzzle);
  return g;
}

// ------------------------------------------------------------- health bars

function drawHealthBar(ctx, unit) {
  const W = 160, H = 40;
  ctx.clearRect(0, 0, W, H);
  const pipW = Math.min(20, (W - 8) / unit.maxHp - 3);
  const total = unit.maxHp * (pipW + 3) - 3;
  let x = (W - total) / 2;
  const good = unit.side === 'player' ? '#6ee86e' : '#e8524a';
  for (let i = 0; i < unit.maxHp; i++) {
    ctx.fillStyle = i < unit.hp ? good : 'rgba(20,24,28,0.85)';
    ctx.fillRect(x, 14, pipW, 12);
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeRect(x + 0.5, 14.5, pipW - 1, 11);
    x += pipW + 3;
  }
  // status dots
  let sx = W / 2 - 12;
  const dot = (color) => {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(sx, 7, 4.5, 0, Math.PI * 2); ctx.fill();
    sx += 12;
  };
  if (unit.poisoned > 0) dot('#7ad12e');
  if (unit.overwatch) dot('#ffd23e');
  if (unit.hunkered) dot('#3ea8ff');
}

// =================================================================== MeshKit

export class MeshKit {
  constructor(scene, map, fow) {
    this.scene = scene;
    this.map = map;
    this.fow = fow;
    this.tileMeshes = new Map();   // key -> prop group (destructibles)
    this.unitGroups = new Map();   // unit.id -> group
    this.healthBars = new Map();   // unit.id -> { sprite, canvas, ctx, tex }
    this.hitboxes = [];
  }

  patchAll(root) {
    root.traverse(o => { if (o.isMesh) this.fow.patch(o.material); });
  }

  buildEnvironment() {
    const { map } = this;
    const env = new THREE.Group();

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(map.w * TILE, map.h * TILE),
      new THREE.MeshStandardMaterial({ map: groundTexture(map), roughness: 0.95 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((map.w - 1) * TILE / 2, 0, (map.h - 1) * TILE / 2);
    ground.receiveShadow = true;
    ground.name = 'ground';
    env.add(ground);
    this.ground = ground;

    const skirt = new THREE.Mesh(
      new THREE.PlaneGeometry(map.w * TILE * 3, map.h * TILE * 3),
      new THREE.MeshBasicMaterial({ color: 0x07090c })
    );
    skirt.rotation.x = -Math.PI / 2;
    skirt.position.set((map.w - 1) * TILE / 2, -0.06, (map.h - 1) * TILE / 2);
    env.add(skirt);

    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const t = map.tiles[y * map.w + x];
        if (t.type === 'floor' || t.type === 'door') continue;
        const seed01 = ((x * 131 + y * 197) % 100) / 100;
        const p = propMesh(t.prop || t.type, seed01);
        p.position.copy(tileToWorld(x, y));
        env.add(p);
        this.tileMeshes.set(key(x, y), p);
      }
    }
    this.patchAll(env);
    this.scene.add(env);
    this.env = env;
  }

  // Replace a destroyed prop with rubble.
  destroyTileProp(x, y) {
    const k = key(x, y);
    const p = this.tileMeshes.get(k);
    if (!p) return;
    this.env.remove(p);
    this.tileMeshes.delete(k);
    const rubble = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const r = box(0.4 - i * 0.08, 0.18, 0.36 - i * 0.06, 0x4a4f58,
        { x: (i - 1) * 0.4, y: 0.09, z: ((i * 53) % 3 - 1) * 0.3 });
      rubble.add(r);
    }
    rubble.position.copy(tileToWorld(x, y));
    this.patchAll(rubble);
    this.env.add(rubble);
  }

  addUnit(unit) {
    let g;
    if (unit.side === 'player') g = soldierMesh(unit.tint);
    else if (unit.type === 'sectoid') g = sectoidMesh();
    else if (unit.type === 'viper') g = viperMesh();
    else g = trooperMesh();

    const hit = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 1.9, 8),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hit.position.y = 0.95;
    hit.name = 'hitbox';
    hit.userData.unitId = unit.id;
    g.add(hit);
    this.hitboxes.push(hit);

    g.position.copy(tileToWorld(unit.x, unit.y));
    this.patchAll(g);
    this.scene.add(g);
    this.unitGroups.set(unit.id, g);

    // health bar sprite
    const canvas = document.createElement('canvas');
    canvas.width = 160; canvas.height = 40;
    const ctx = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sprite.center.set(0.5, 0);
    sprite.scale.set(1.7, 0.42, 1);
    sprite.position.y = 1.85;
    sprite.renderOrder = 50;
    g.add(sprite);
    this.healthBars.set(unit.id, { sprite, canvas, ctx, tex });
    this.updateHealth(unit);
    return g;
  }

  group(unit) { return this.unitGroups.get(unit.id); }

  muzzleWorld(unit) {
    const g = this.group(unit);
    const m = g.getObjectByName('muzzle');
    const v = new THREE.Vector3();
    (m || g).getWorldPosition(v);
    if (!m) v.y += 1.1;
    return v;
  }

  chestWorld(unit) {
    const g = this.group(unit);
    return g.position.clone().add(new THREE.Vector3(0, 1.0, 0));
  }

  updateHealth(unit) {
    const hb = this.healthBars.get(unit.id);
    if (!hb) return;
    drawHealthBar(hb.ctx, unit);
    hb.tex.needsUpdate = true;
  }

  hideHealthBar(unit) {
    const hb = this.healthBars.get(unit.id);
    if (hb) hb.sprite.visible = false;
  }

  worldAt(x, y, h = 0) { return tileToWorld(x, y, h); }

  setUnitVisible(unit, vis) {
    const g = this.group(unit);
    if (g) g.visible = vis;
  }

  faceUnit(unit, tx, ty) {
    const g = this.group(unit);
    const dx = tx - unit.x, dz = ty - unit.y;
    if (dx || dz) g.rotation.y = Math.atan2(dx, dz);
  }

  syncUnit(unit) {
    const g = this.group(unit);
    g.position.copy(tileToWorld(unit.x, unit.y));
  }
}

// ------------------------------------------------------ interactive markers

export class Highlights {
  constructor(scene, max = 1200) {
    const geo = new THREE.PlaneGeometry(TILE * 0.94, TILE * 0.94);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.32, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._c = new THREE.Color();
  }
  setTiles(list) { // [{x, y, color}]
    const n = Math.min(list.length, 1200);
    for (let i = 0; i < n; i++) {
      this._m.makeTranslation(list[i].x * TILE, 0.04, list[i].y * TILE);
      this.mesh.setMatrixAt(i, this._m);
      this.mesh.setColorAt(i, this._c.set(list[i].color));
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  clear() { this.mesh.count = 0; }
}

export class TileMarker {
  constructor(scene, map) {
    this.map = map;
    this.group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x49e0ff });
    const s = TILE * 0.46, t = 0.07, L = 0.5;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const a = new THREE.Mesh(new THREE.BoxGeometry(L, t, t), mat);
      a.position.set(sx * (s - L / 2 + t), 0.06, sz * s);
      const b = new THREE.Mesh(new THREE.BoxGeometry(t, t, L), mat);
      b.position.set(sx * s, 0.06, sz * (s - L / 2 + t));
      this.group.add(a, b);
    }
    // cover shield bars on tile edges
    this.shields = [];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of dirs) {
      const half = new THREE.Mesh(
        new THREE.BoxGeometry(dx ? 0.12 : 1.1, 0.5, dy ? 0.12 : 1.1),
        new THREE.MeshBasicMaterial({ color: 0xc8cdd6 })
      );
      half.position.set(dx * TILE * 0.45, 0.3, dy * TILE * 0.45);
      const full = new THREE.Mesh(
        new THREE.BoxGeometry(dx ? 0.12 : 1.1, 1.0, dy ? 0.12 : 1.1),
        new THREE.MeshBasicMaterial({ color: 0xffc83e })
      );
      full.position.set(dx * TILE * 0.45, 0.55, dy * TILE * 0.45);
      half.visible = full.visible = false;
      this.group.add(half, full);
      this.shields.push({ dx, dy, half, full });
    }
    this.group.visible = false;
    scene.add(this.group);
  }
  showAt(x, y) {
    this.group.visible = true;
    this.group.position.copy(tileToWorld(x, y));
    const sides = coverSides(this.map, x, y);
    for (const s of this.shields) {
      const found = sides.find(c => c.dx === s.dx && c.dy === s.dy);
      s.half.visible = !!found && found.type === 'half';
      s.full.visible = !!found && found.type === 'full';
    }
  }
  hide() { this.group.visible = false; }
}

export class PathDots {
  constructor(scene) {
    this.pool = [];
    this.geo = new THREE.SphereGeometry(0.1, 8, 6);
    this.matBlue = new THREE.MeshBasicMaterial({ color: 0x49e0ff });
    this.matYellow = new THREE.MeshBasicMaterial({ color: 0xeec43d });
    this.scene = scene;
  }
  show(path, dashFromIdx) {
    while (this.pool.length < path.length) {
      const m = new THREE.Mesh(this.geo, this.matBlue);
      this.scene.add(m);
      this.pool.push(m);
    }
    this.pool.forEach((m, i) => {
      if (i < path.length) {
        m.visible = true;
        m.material = i >= dashFromIdx ? this.matYellow : this.matBlue;
        m.position.copy(tileToWorld(path[i].x, path[i].y, 0.12));
      } else m.visible = false;
    });
  }
  hide() { this.pool.forEach(m => { m.visible = false; }); }
}

export class AoeRing {
  constructor(scene) {
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1.0, 48),
      new THREE.MeshBasicMaterial({ color: 0xff8c3a, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.92, 48),
      new THREE.MeshBasicMaterial({ color: 0xff8c3a, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false })
    );
    this.disc.rotation.x = -Math.PI / 2;
    this.group = new THREE.Group();
    this.group.add(this.ring, this.disc);
    this.group.position.y = 0.07;
    this.group.visible = false;
    scene.add(this.group);
  }
  showAt(x, y, radiusTiles) {
    this.group.visible = true;
    this.group.position.set(x * TILE, 0.07, y * TILE);
    const s = radiusTiles * TILE;
    this.group.scale.set(s, s, s);
  }
  hide() { this.group.visible = false; }
}

export function makeRing(scene, color, r = 0.62) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(r - 0.09, r, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  ring.visible = false;
  scene.add(ring);
  return ring;
}
