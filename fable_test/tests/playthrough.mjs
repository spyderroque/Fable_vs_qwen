// Headless end-to-end playthroughs of the real Game class with mocked
// rendering deps. A simple policy plays whole missions to completion.
// Run: node tests/playthrough.mjs

import { makeRng, hashSeed } from '../src/rng.js';
import { generateMap } from '../src/mapgen.js';
import { makeSoldier, makeEnemy } from '../src/units.js';
import { Game } from '../src/game.js';
import { key, distTiles, coverFrom, losClear } from '../src/grid.js';
import { GRENADE } from '../src/config.js';

function mockDeps() {
  const logLines = [];
  const vec = (x = 0, y = 0, z = 0) => ({ x, y, z });
  const groupFor = new Map();
  const kit = {
    group(u) {
      if (!groupFor.has(u.id)) groupFor.set(u.id, { position: vec(), rotation: { x: 0, y: 0, z: 0 } });
      return groupFor.get(u.id);
    },
    faceUnit() {}, syncUnit() {}, updateHealth() {}, hideHealthBar() {},
    setUnitVisible() {}, destroyTileProp() {},
    muzzleWorld: (u) => vec(u.x * 2, 1, u.y * 2),
    chestWorld: (u) => vec(u.x * 2, 1, u.y * 2),
    worldAt: (x, y, h = 0) => vec(x * 2, h, y * 2),
  };
  const fx = {
    sounds: new Proxy({}, { get: () => () => {} }),
    async wait() {},
    async tween() {},
    async tracer() {}, async impact() {}, async explosion() {},
    async grenadeArc() {}, async deathFall() {},
    async moveUnit(group, path, unit, onStep) {
      for (let i = 0; i < path.length; i++) {
        unit.x = path[i].x; unit.y = path[i].y;
        if (onStep) {
          const r = await onStep(i);
          if (r === 'stop' || !unit.alive) return i;
        }
      }
      return path.length - 1;
    },
  };
  const noopRing = { visible: false, position: { set() {} } };
  return {
    logLines,
    deps: {
      kit, fx,
      fog: { update() {} },
      rig: { focusOn() {}, addShake() {}, worldToScreen: () => ({ x: 0, y: 0 }) },
      ui: {
        refreshAll() {}, refreshSquad() {}, refreshActions() {}, refreshObjective() {}, refreshTurn() {},
        showTargets() {}, hideTargets() {}, banner() {}, hint() {}, float() {},
        log: (m) => logLines.push(m),
        modal() {},
      },
      highlights: { setTiles() {}, clear() {} },
      marker: { showAt() {}, hide() {} },
      pathDots: { show() {}, hide() {} },
      aoeRing: { showAt() {}, hide() {} },
      selRing: noopRing,
      reticle: { ...noopRing },
    },
  };
}

function buildGame(seed) {
  const rng = makeRng(hashSeed('pt-' + seed));
  const { map, squad, pods: podSpawns } = generateMap(rng);
  const classOrder = ['ranger', 'grenadier', 'sharpshooter', 'specialist'];
  const soldiers = squad.map((s, i) => makeSoldier(classOrder[i], 'S' + i, 'S' + i, s.x, s.y));
  const enemies = [];
  const pods = [];
  podSpawns.forEach((p, pi) => {
    pods.push({ id: pi, activated: false });
    for (const m of p.members) enemies.push(makeEnemy(m.type, m.x, m.y, pi));
  });
  const { deps, logLines } = mockDeps();
  const game = new Game({ map, rng, soldiers, enemies, pods, deps });
  return { game, logLines };
}

function invariants(game, seed, errors) {
  const seen = new Set();
  for (const u of game.allAlive()) {
    const k = key(u.x, u.y);
    if (seen.has(k)) errors.push(`seed ${seed}: two living units share tile ${u.x},${u.y}`);
    seen.add(k);
    if (u.hp <= 0) errors.push(`seed ${seed}: living unit with hp<=0`);
    if (u.hp > u.maxHp) errors.push(`seed ${seed}: hp over max`);
    if (u.ammo < 0) errors.push(`seed ${seed}: negative ammo for ${u.name}`);
  }
}

// Plays like a competent player: take good shots, grenade clusters, otherwise
// advance from cover to cover and overwatch when contact is likely.
async function playerPolicy(game) {
  const safety = (x, y) => {
    let s = 0;
    for (const e of game.aliveEnemies()) {
      if (!losClear(game.map, e.x, e.y, x, y)) { s += 0.5; continue; }
      const c = coverFrom(game.map, x, y, e.x, e.y);
      s += c === 'full' ? 2 : c === 'half' ? 1 : -2.5;
    }
    return s;
  };
  for (let guard = 0; guard < 24; guard++) {
    const u = game.aliveSoldiers().find(s => s.ap > 0);
    if (!u || game.mode === 'over') return;
    game.select(u);
    if (game.mode !== 'idle') return;

    if (u.grenades > 0) {
      const cluster = game.aliveEnemies().find(e => game.enemyVisible(e) &&
        distTiles(u.x, u.y, e.x, e.y) <= GRENADE.range &&
        game.aliveEnemies().filter(o => distTiles(e.x, e.y, o.x, o.y) <= GRENADE.radius).length >= 2);
      if (cluster) {
        game.startGrenade();
        await game.confirmGrenade(cluster.x, cluster.y);
        continue;
      }
    }

    game.startTargeting();
    if (game.mode === 'target') {
      const best = game.targets[0]; // sorted by hit chance
      if (best.shot.hit >= 35 || u.ap === 1) {
        game.setTargetIdx(0);
        await game.confirmFire();
        continue;
      }
      game.cancel();
    }

    if (u.ammo === 0) { game.doReload(); continue; }

    const foes = game.aliveEnemies();
    if (!foes.length) return;
    const anyVisible = foes.some(e => game.enemyVisible(e));
    if (!game.range) { u.ap = 0; continue; }

    let best = null;
    for (const [k, node] of game.range) {
      const x = k % 1000, y = Math.floor(k / 1000);
      if (node.cost > 0 && game.occupiedExcept(u).has(k)) continue;
      const d = Math.min(...foes.map(e => distTiles(x, y, e.x, e.y)));
      const approach = anyVisible ? -Math.abs(d - 8) * 0.15 : -d * 0.3;
      const score = safety(x, y) + approach - (node.cost > u.mob ? 0.6 : 0);
      if (!best || score > best.score) best = { x, y, score, cost: node.cost };
    }
    if (!best || best.cost === 0) {
      // already on the best tile: overwatch (or hunker if that fails)
      game.doOverwatch();
      if (u.ap > 0) game.doHunker();
      if (u.ap > 0) u.ap = 0;
      continue;
    }
    await game.clickTile(best.x, best.y);
  }
}

const errors = [];
let wins = 0, losses = 0;

for (let seed = 1; seed <= 8; seed++) {
  const { game } = buildGame(seed);
  try {
    await game.start();
    let rounds = 0;
    while (game.mode !== 'over' && rounds < 40) {
      await playerPolicy(game);
      invariants(game, seed, errors);
      if (game.mode === 'over') break;
      await game.endTurn();
      invariants(game, seed, errors);
      rounds++;
    }
    if (game.mode !== 'over') {
      errors.push(`seed ${seed}: game did not finish in 40 rounds ` +
        `(soldiers ${game.aliveSoldiers().length}, enemies ${game.aliveEnemies().length})`);
    } else if (game.aliveSoldiers().length) {
      wins++;
      if (game.aliveEnemies().length) errors.push(`seed ${seed}: over but enemies alive`);
    } else losses++;
    if (!game.pods.every(p => p.activated) && game.aliveEnemies().length === 0) {
      errors.push(`seed ${seed}: enemies all dead but pod never activated?`);
    }
    console.log(`seed ${seed}: ${game.aliveSoldiers().length ? 'WIN ' : 'LOSS'} in ${game.round} rounds, ` +
      `squad ${game.aliveSoldiers().length}/4, shots ${game.stats.shots}, hits ${game.stats.hits}`);
  } catch (e) {
    errors.push(`seed ${seed}: threw ${e.stack}`);
    console.error(`seed ${seed}: EXCEPTION`, e.message);
  }
}

console.log(`\n${wins} wins / ${losses} losses`);
if (errors.length) {
  console.error('\nERRORS:');
  for (const e of errors) console.error(' -', e);
  process.exit(1);
}
console.log('playthrough OK');
