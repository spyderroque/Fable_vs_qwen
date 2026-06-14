// Procedural tactical map generation. Pure module.
// Produces tile data + spawn locations; meshes.js turns this into geometry.

import { MAP_W, MAP_H } from './config.js';
import { makeMap, tileAt, isWalkable, inBounds, key } from './grid.js';

const FULL_PROPS = ['truck', 'pillar', 'tank', 'dumpster'];
const HALF_PROPS = ['crate', 'barrier', 'hydrant', 'planter', 'sandbags'];

function setTile(map, x, y, type, prop = null, hp = 0) {
  const t = tileAt(map, x, y);
  t.type = type; t.prop = prop; t.hp = hp;
}

function rectOverlaps(a, b, pad) {
  return !(a.x + a.w + pad <= b.x || b.x + b.w + pad <= a.x ||
           a.y + a.h + pad <= b.y || b.y + b.h + pad <= a.y);
}

function placeBuilding(map, rng, rect) {
  const { x, y, w, h } = rect;
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) {
      const edge = i === x || i === x + w - 1 || j === y || j === y + h - 1;
      if (edge) setTile(map, i, j, 'wall', 'wall', 12);
      else { setTile(map, i, j, 'floor'); tileAt(map, i, j).interior = true; }
    }
  }
  // Carve 2-3 doors on distinct sides (never corners).
  const sides = rng.shuffle(['n', 's', 'e', 'w']).slice(0, rng.int(2, 3));
  for (const s of sides) {
    let dx, dy;
    if (s === 'n') { dx = x + rng.int(1, w - 2); dy = y; }
    if (s === 's') { dx = x + rng.int(1, w - 2); dy = y + h - 1; }
    if (s === 'w') { dx = x; dy = y + rng.int(1, h - 2); }
    if (s === 'e') { dx = x + w - 1; dy = y + rng.int(1, h - 2); }
    setTile(map, dx, dy, 'door', 'door');
  }
}

function scatterProps(map, rng, buildings) {
  const tryPlace = (kind, prop, hp, count) => {
    let placed = 0, attempts = 0;
    while (placed < count && attempts++ < 400) {
      const x = rng.int(1, map.w - 2), y = rng.int(1, map.h - 2);
      const t = tileAt(map, x, y);
      if (t.type !== 'floor' || t.interior) continue;
      // keep the squad's spawn pocket at the bottom open
      if (y >= map.h - 4 && Math.abs(x - map.w / 2) < 6) continue;
      // don't wall off doors
      let nearDoor = false;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        if (inBounds(map, x+dx, y+dy) && tileAt(map, x+dx, y+dy).type === 'door') nearDoor = true;
      }
      if (nearDoor) continue;
      setTile(map, x, y, kind, prop, hp);
      placed++;
    }
  };
  tryPlace('full', null, 8, 13);
  tryPlace('half', null, 4, 26);
  // assign visual prop kinds
  for (let i = 0; i < map.tiles.length; i++) {
    const t = map.tiles[i];
    if (t.type === 'full' && !t.prop) t.prop = rng.pick(FULL_PROPS);
    if (t.type === 'half' && !t.prop) t.prop = rng.pick(HALF_PROPS);
  }
}

// Flood fill walkable tiles from a start point.
function reachableFrom(map, sx, sy) {
  const seen = new Set([key(sx, sy)]);
  const stack = [[sx, sy]];
  while (stack.length) {
    const [x, y] = stack.pop();
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy;
      if (isWalkable(map, nx, ny) && !seen.has(key(nx, ny))) {
        seen.add(key(nx, ny));
        stack.push([nx, ny]);
      }
    }
  }
  return seen;
}

function nearestReachableTile(map, reach, x, y) {
  for (let r = 0; r < 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx, ny = y + dy;
        if (inBounds(map, nx, ny) && reach.has(key(nx, ny))) return { x: nx, y: ny };
      }
    }
  }
  return null;
}

function attempt(rng) {
  const map = makeMap(MAP_W, MAP_H);

  // Buildings in the upper 2/3 of the map.
  const buildings = [];
  const nBuildings = rng.int(2, 3);
  let tries = 0;
  while (buildings.length < nBuildings && tries++ < 80) {
    const w = rng.int(5, 9), h = rng.int(4, 7);
    const r = { x: rng.int(2, MAP_W - w - 2), y: rng.int(2, MAP_H - h - 12), w, h };
    if (buildings.some(b => rectOverlaps(r, b, 3))) continue;
    buildings.push(r);
  }
  for (const b of buildings) placeBuilding(map, rng, b);
  scatterProps(map, rng, buildings);

  // Squad spawn: bottom center.
  const squad = [];
  const cx = Math.floor(MAP_W / 2);
  outer:
  for (let y = MAP_H - 2; y >= MAP_H - 5; y--) {
    for (const dx of [0, -1, 1, -2, 2, -3, 3]) {
      const x = cx + dx;
      if (isWalkable(map, x, y) && !squad.some(s => s.x === x && s.y === y)) {
        squad.push({ x, y });
        if (squad.length === 4) break outer;
      }
    }
  }
  if (squad.length < 4) return null;

  const reach = reachableFrom(map, squad[0].x, squad[0].y);
  const walkableCount = map.tiles.filter(t => t.type === 'floor' || t.type === 'door').length;
  if (reach.size / walkableCount < 0.7) return null;
  if (!squad.every(s => reach.has(key(s.x, s.y)))) return null;

  // Pods in the upper half, far from spawn.
  const podDefs = [
    ['trooper', 'trooper', 'sectoid'],
    ['trooper', 'sectoid', 'trooper'],
    ['viper', 'trooper'],
  ];
  const pods = [];
  const podTaken = new Set(squad.map(s => key(s.x, s.y)));
  for (let p = 0; p < podDefs.length; p++) {
    let anchor = null, t2 = 0;
    while (!anchor && t2++ < 200) {
      const x = rng.int(2, MAP_W - 3), y = rng.int(2, Math.floor(MAP_H * 0.55));
      const d = Math.hypot(x - cx, y - (MAP_H - 2));
      if (d < 15) continue;
      const fixed = nearestReachableTile(map, reach, x, y);
      if (!fixed || podTaken.has(key(fixed.x, fixed.y))) continue;
      if (pods.some(pp => Math.hypot(pp.anchor.x - fixed.x, pp.anchor.y - fixed.y) < 8)) continue;
      anchor = fixed;
    }
    if (!anchor) return null;
    const members = [];
    const spots = [anchor];
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]) {
      const nx = anchor.x + dx, ny = anchor.y + dy;
      if (isWalkable(map, nx, ny) && reach.has(key(nx, ny)) && !podTaken.has(key(nx, ny))) {
        spots.push({ x: nx, y: ny });
      }
    }
    if (spots.length < podDefs[p].length) return null;
    for (let m = 0; m < podDefs[p].length; m++) {
      members.push({ type: podDefs[p][m], x: spots[m].x, y: spots[m].y });
      podTaken.add(key(spots[m].x, spots[m].y));
    }
    pods.push({ anchor, members });
  }

  return { map, squad, pods, buildings };
}

export function generateMap(rng) {
  for (let i = 0; i < 40; i++) {
    const result = attempt(rng.fork());
    if (result) return result;
  }
  throw new Error('map generation failed after 40 attempts');
}
