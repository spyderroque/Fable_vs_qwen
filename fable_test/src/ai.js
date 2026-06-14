// Enemy decision making. Pure module — returns action descriptors; game.js executes them.
//
// Action shapes:
//   { type:'moveShoot', path, target }   move (1 AP) then fire
//   { type:'shoot', target }             fire from current tile
//   { type:'reloadShoot', target }       reload then fire (no move)
//   { type:'moveReload', path }          fall back to cover and reload
//   { type:'move', path, thenOverwatch } reposition / advance
//   { type:'overwatch' } | { type:'skip' }

import { dijkstraRange, pathFromRange, losClear, coverFrom, coverSides, distTiles } from './grid.js';
import { computeShot, expectedDamage } from './combat.js';

// How well a tile shelters `unit` from the given soldiers.
function tileCoverScore(map, x, y, soldiers) {
  let score = 0;
  for (const s of soldiers) {
    if (!losClear(map, s.x, s.y, x, y)) { score += 0.5; continue; }
    const c = coverFrom(map, x, y, s.x, s.y);
    if (c === 'full') score += 2;
    else if (c === 'half') score += 1;
    else score -= 2.5; // exposed to this soldier
  }
  return score;
}

function archetypeRangeScore(type, d) {
  switch (type) {
    case 'sectoid': return -(Math.abs(d - 10) * 0.2) - (d < 6 ? 1.5 : 0);
    case 'viper':   return -(Math.abs(d - 5.5) * 0.15);
    default:        return -(Math.abs(d - 7.5) * 0.15);
  }
}

function bestShotFrom(map, occupied, enemy, x, y, soldiers) {
  let best = null;
  const virtual = { ...enemy, x, y };
  for (const s of soldiers) {
    const shot = computeShot(map, occupied, virtual, s, {});
    if (!shot.canSee) continue;
    let score = expectedDamage(shot) + shot.hit * 0.02;
    if (shot.flanked) score += enemy.type === 'viper' ? 2.5 : 1;
    if (s.hp <= expectedDamage(shot) * 1.3) score += 3; // finishing move
    if (!best || score > best.score) best = { target: s, shot, score };
  }
  return best;
}

// ctx: { map, occupied, soldiers, lastKnown, rng }
//   soldiers  — only the soldiers this enemy's pod can actually see
//   lastKnown — where the pod last saw a soldier ({x,y} or null); used to hunt
export function planAction(ctx, enemy) {
  const { map, occupied, soldiers, lastKnown, rng } = ctx;
  const SHOT_THRESHOLD = 28;

  const range = dijkstraRange(map, occupied, enemy.x, enemy.y, enemy.mob * 2);
  const blueTiles = [];
  const dashTiles = [];
  for (const [k, node] of range) {
    const x = k % 1000, y = Math.floor(k / 1000);
    if (node.cost <= enemy.mob + 1e-9) blueTiles.push({ x, y, cost: node.cost });
    else dashTiles.push({ x, y, cost: node.cost });
  }

  // --- Offensive plan: best (move +) shoot combo within 1 move action ---
  let bestPlan = null;
  if (enemy.ammo > 0 && soldiers.length) {
    for (const t of blueTiles) {
      const shot = bestShotFrom(map, occupied, enemy, t.x, t.y, soldiers);
      if (!shot || shot.shot.hit < SHOT_THRESHOLD) continue;
      const cover = tileCoverScore(map, t.x, t.y, soldiers);
      const d = distTiles(t.x, t.y, shot.target.x, shot.target.y);
      const score = shot.score * 2 + cover * 1.2 + archetypeRangeScore(enemy.type, d) - t.cost * 0.05;
      if (!bestPlan || score > bestPlan.score) bestPlan = { ...shot, tile: t, score };
    }
  }
  if (bestPlan) {
    if (bestPlan.tile.cost === 0) return { type: 'shoot', target: bestPlan.target };
    return { type: 'moveShoot', path: pathFromRange(range, bestPlan.tile.x, bestPlan.tile.y), target: bestPlan.target };
  }

  // --- Out of ammo: shoot after reloading if someone is in sight, else fall back ---
  if (enemy.ammo === 0) {
    const here = soldiers.length ? bestShotFrom(map, occupied, enemy, enemy.x, enemy.y, soldiers) : null;
    if (here && here.shot.hit >= SHOT_THRESHOLD) return { type: 'reloadShoot', target: here.target };
    let best = { x: enemy.x, y: enemy.y, s: tileCoverScore(map, enemy.x, enemy.y, soldiers) };
    for (const t of blueTiles) {
      const s = tileCoverScore(map, t.x, t.y, soldiers) - t.cost * 0.05;
      if (s > best.s) best = { x: t.x, y: t.y, s };
    }
    if (best.x === enemy.x && best.y === enemy.y) return { type: 'moveReload', path: null };
    return { type: 'moveReload', path: pathFromRange(range, best.x, best.y) };
  }

  // --- Contact but no good shot: reposition for a better angle, stay covered ---
  if (soldiers.length) {
    let nearest = soldiers[0];
    for (const s of soldiers) {
      if (distTiles(enemy.x, enemy.y, s.x, s.y) < distTiles(enemy.x, enemy.y, nearest.x, nearest.y)) nearest = s;
    }
    const curDist = distTiles(enemy.x, enemy.y, nearest.x, nearest.y);
    let move = null;
    for (const t of blueTiles) {
      const d = distTiles(t.x, t.y, nearest.x, nearest.y);
      if (d < 3) continue; // don't hug soldiers without a shot
      const cover = tileCoverScore(map, t.x, t.y, soldiers);
      const score = cover * 1.0 - d * 0.3;
      if (!move || score > move.score) move = { ...t, score, d };
    }
    if (move && (move.d < curDist - 1 || tileCoverScore(map, move.x, move.y, soldiers) >
                 tileCoverScore(map, enemy.x, enemy.y, soldiers) + 0.5)) {
      return {
        type: 'move',
        path: pathFromRange(range, move.x, move.y),
        thenOverwatch: enemy.ammo > 0 && rng.chance(0.65),
      };
    }
    return { type: 'overwatch' };
  }

  // --- No contact: hunt toward the last known position, else hold ---
  if (lastKnown && distTiles(enemy.x, enemy.y, lastKnown.x, lastKnown.y) > 3) {
    let move = null;
    for (const t of [...blueTiles, ...dashTiles]) {
      const d = distTiles(t.x, t.y, lastKnown.x, lastKnown.y);
      const coverBonus = Math.min(2, coverSides(map, t.x, t.y).length) * 0.3;
      const score = -d * 0.5 + coverBonus - (t.cost > enemy.mob ? 0.4 : 0);
      if (!move || score > move.score) move = { ...t, score };
    }
    if (move && (move.x !== enemy.x || move.y !== enemy.y)) {
      return { type: 'move', path: pathFromRange(range, move.x, move.y), thenOverwatch: rng.chance(0.4) };
    }
  }
  return { type: 'overwatch' };
}

// Free cover-seeking move when a pod is revealed (XCOM "scamper").
export function planScamper(ctx, enemy) {
  const { map, occupied, soldiers } = ctx;
  const range = dijkstraRange(map, occupied, enemy.x, enemy.y, enemy.mob);
  let best = null;
  const curScore = tileCoverScore(map, enemy.x, enemy.y, soldiers);
  for (const [k, node] of range) {
    const x = k % 1000, y = Math.floor(k / 1000);
    const d = soldiers.length ? Math.min(...soldiers.map(s => distTiles(x, y, s.x, s.y))) : 99;
    if (d < 4) continue;
    const score = tileCoverScore(map, x, y, soldiers) * 1.5 - node.cost * 0.05 - Math.abs(d - 9) * 0.1;
    if (!best || score > best.score) best = { x, y, score };
  }
  if (!best || best.score <= curScore * 1.5 + 0.01) return null;
  const path = pathFromRange(range, best.x, best.y);
  return path && path.length ? { path } : null;
}
