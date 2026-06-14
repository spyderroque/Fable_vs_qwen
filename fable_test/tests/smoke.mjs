// Headless logic tests for the pure gameplay modules. Run: node tests/smoke.mjs
import { makeRng, hashSeed } from '../src/rng.js';
import { generateMap } from '../src/mapgen.js';
import {
  makeMap, tileAt, key, dijkstraRange, pathFromRange, losClear,
  coverFrom, visibleSet, isWalkable, shotLineExists,
} from '../src/grid.js';
import { computeShot, rollShot, blastTiles, expectedDamage } from '../src/combat.js';
import { makeSoldier, makeEnemy, damageUnit, tickStatuses, applyPoison } from '../src/units.js';
import { planAction, planScamper } from '../src/ai.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ok', name); }
  else { fail++; console.error('  FAIL', name); }
}

console.log('rng');
{
  const a = makeRng(hashSeed('seed-1')), b = makeRng(hashSeed('seed-1'));
  check('deterministic', a.next() === b.next() && a.int(0, 100) === b.int(0, 100));
  const r = makeRng(7);
  let ok = true;
  for (let i = 0; i < 1000; i++) { const v = r.int(3, 9); if (v < 3 || v > 9) ok = false; }
  check('int bounds', ok);
}

console.log('grid: LOS & cover on a hand-built map');
{
  const m = makeMap(9, 9);
  tileAt(m, 4, 4).type = 'wall';       // wall in the center
  tileAt(m, 2, 6).type = 'half';       // low cover
  check('straight LOS blocked by wall', !losClear(m, 4, 1, 4, 7));
  check('LOS clear beside the wall', losClear(m, 1, 1, 7, 1));
  check('half cover does not block sight', losClear(m, 2, 3, 2, 8));
  check('diagonal LOS around wall blocked', !losClear(m, 3, 3, 5, 5));
  // unit at (2,7) has half cover to its north (2,6); attacker from north
  check('cover applies vs attack from cover side', coverFrom(m, 2, 7, 2, 1) === 'half');
  check('flanked from behind', coverFrom(m, 2, 7, 2, 8) === 'none');
  check('flanked from the side', coverFrom(m, 2, 7, 7, 7) === 'none');
  const vis = visibleSet(m, 4, 1, 8);
  check('tile behind wall not visible', !vis.has(key(4, 6)));
  check('open tile visible', vis.has(key(1, 1)));
}

console.log('grid: pathfinding');
{
  const m = makeMap(9, 9);
  for (let x = 1; x < 8; x++) tileAt(m, x, 4).type = 'wall'; // wall with gap at x=0/8
  const range = dijkstraRange(m, new Set(), 4, 1, 30);
  const path = pathFromRange(range, 4, 7);
  check('path found around wall', !!path && path.length >= 9);
  check('path tiles walkable', path.every(p => isWalkable(m, p.x, p.y)));
  const short = dijkstraRange(m, new Set(), 4, 1, 2);
  check('range respects budget', !short.has(key(4, 7)) && short.has(key(4, 3)));
  const occ = new Set([key(4, 2)]);
  const r2 = dijkstraRange(m, occ, 4, 1, 3);
  check('occupied tile not enterable', !r2.has(key(4, 2)));
  // no corner cutting through diagonal gap between two blockers
  const m2 = makeMap(5, 5);
  tileAt(m2, 2, 1).type = 'wall';
  tileAt(m2, 1, 2).type = 'wall';
  const r3 = dijkstraRange(m2, new Set(), 1, 1, 1.5);
  check('no corner cutting', !r3.has(key(2, 2)));
}

console.log('combat');
{
  const m = makeMap(12, 12);
  tileAt(m, 5, 5).type = 'full';
  const occ = new Set();
  const atk = makeSoldier('sharpshooter', 'A', 'A', 5, 10);
  const def = makeEnemy('trooper', 5, 4, 0); // full cover at (5,5) shields it from the southern attacker
  const shot = computeShot(m, occ, atk, def);
  check('shot has LOS via peek', shot.canSee);
  check('full cover applied', shot.cover === 'full' && !shot.flanked);
  const sideAtk = { ...atk, x: 10, y: 4 };
  const shot2 = computeShot(m, occ, sideAtk, def);
  check('flanked from the east', shot2.flanked && shot2.hit > shot.hit);
  check('hit clamped 1..100', shot.hit >= 1 && shot.hit <= 100);
  const rng = makeRng(3);
  let hits = 0;
  for (let i = 0; i < 4000; i++) if (rollShot(rng, shot2).hit) hits++;
  check('roll rate tracks hit chance', Math.abs(hits / 4000 - shot2.hit / 100) < 0.04);
  check('expectedDamage sane', expectedDamage(shot2) > 0 && expectedDamage(shot2) < 8);
  const blast = blastTiles(m, 6, 6, 2.2);
  check('blast tile count plausible', blast.length >= 12 && blast.length <= 21);
}

console.log('units');
{
  const u = makeEnemy('sectoid', 1, 1, 0);
  check('damage kills at 0', !damageUnit(u, 2) && damageUnit(u, 99) && !u.alive);
  const s = makeSoldier('ranger', 'B', 'B', 0, 0);
  applyPoison(s);
  const ev = tickStatuses(s, makeRng(1));
  check('poison ticks', ev.length === 1 && s.hp < s.maxHp && s.poisoned === 1);
}

console.log('mapgen: 25 seeds');
{
  let allOk = true;
  for (let seed = 1; seed <= 25; seed++) {
    const { map, squad, pods } = generateMap(makeRng(seed));
    if (squad.length !== 4) { allOk = false; console.error('  seed', seed, 'bad squad'); }
    const enemies = pods.flatMap(p => p.members);
    if (enemies.length !== 8) { allOk = false; console.error('  seed', seed, 'bad enemy count', enemies.length); }
    for (const e of enemies) {
      if (!isWalkable(map, e.x, e.y)) { allOk = false; console.error('  seed', seed, 'enemy on blocked tile'); }
    }
    // every enemy reachable from squad start
    const range = dijkstraRange(map, new Set(), squad[0].x, squad[0].y, 9999);
    for (const e of enemies) {
      if (!range.has(key(e.x, e.y))) { allOk = false; console.error('  seed', seed, 'enemy unreachable'); }
    }
    const positions = new Set([...squad, ...enemies].map(u => key(u.x, u.y)));
    if (positions.size !== 12) { allOk = false; console.error('  seed', seed, 'overlapping spawns'); }
  }
  check('all seeds valid', allOk);
}

console.log('ai');
{
  const { map, squad, pods } = generateMap(makeRng(5));
  const soldiers = squad.map((s, i) => makeSoldier('ranger', 'S' + i, 'S' + i, s.x, s.y));
  const enemies = pods.flatMap((p, pi) => p.members.map(mm => makeEnemy(mm.type, mm.x, mm.y, pi)));
  const rng = makeRng(9);
  for (const e of enemies) {
    const occupied = new Set([...soldiers, ...enemies].filter(u => u !== e && u.alive).map(u => key(u.x, u.y)));
    const act = planAction({ map, occupied, soldiers, rng }, e);
    const okTypes = ['moveShoot', 'shoot', 'reloadShoot', 'moveReload', 'move', 'overwatch', 'skip'];
    check(`plan valid for ${e.type}#${e.id} (${act.type})`, okTypes.includes(act.type));
    if (act.path) {
      check('  path walkable+free', act.path.every(p => isWalkable(map, p.x, p.y) && !occupied.has(key(p.x, p.y))));
    }
    if (act.target) check('  target is a soldier', soldiers.includes(act.target));
    const sc = planScamper({ map, occupied, soldiers }, e);
    if (sc) check('  scamper path ok', sc.path.every(p => isWalkable(map, p.x, p.y) && !occupied.has(key(p.x, p.y))));
  }
  // point-blank: enemy adjacent to lone soldier should attack
  const lone = makeSoldier('ranger', 'L', 'L', 10, 28);
  const brute = makeEnemy('trooper', 11, 28, 0);
  const act = planAction({ map, occupied: new Set(), soldiers: [lone], rng }, brute);
  check('adjacent enemy attacks', act.type === 'shoot' || act.type === 'moveShoot');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
