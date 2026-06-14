// Turn state machine and action resolution. Three.js-free: world positions and
// animations are reached through the injected deps (kit/fx/fog/rig/ui).

import { TILE, GRENADE, MEDKIT, WEAPONS } from './config.js';
import {
  key, tileAt, isWalkable, dijkstraRange, pathFromRange, visibleSet,
  shotLineExists, coverSides, distTiles,
} from './grid.js';
import { computeShot, rollShot, blastTiles } from './combat.js';
import { resetTurn, damageUnit, healUnit, applyPoison, tickStatuses } from './units.js';
import { planAction, planScamper } from './ai.js';

export class Game {
  constructor({ map, rng, soldiers, enemies, pods, deps }) {
    this.map = map;
    this.rng = rng;
    this.soldiers = soldiers;
    this.enemies = enemies;
    this.pods = pods; // [{ activated, memberIds }]
    this.d = deps;    // { kit, fx, fog, rig, ui }

    this.phase = 'player';
    this.round = 1;
    this.mode = 'idle'; // idle | busy | target | grenade | medkit | over
    this.selected = null;
    this.range = null;
    this.visible = new Set();
    this.targets = [];
    this.targetIdx = 0;
    this.stats = { shots: 0, hits: 0, lost: 0 };
  }

  // ----------------------------------------------------------- queries

  aliveSoldiers() { return this.soldiers.filter(u => u.alive); }
  aliveEnemies() { return this.enemies.filter(u => u.alive); }
  allAlive() { return [...this.aliveSoldiers(), ...this.aliveEnemies()]; }

  occupiedExcept(unit) {
    const s = new Set();
    for (const u of this.allAlive()) if (u !== unit) s.add(key(u.x, u.y));
    return s;
  }

  unitAt(x, y) { return this.allAlive().find(u => u.x === x && u.y === y) || null; }

  enemyVisible(e) { return e.alive && this.visible.has(key(e.x, e.y)); }

  // ------------------------------------------------------------ vision

  updateVision() {
    const vis = new Set();
    for (const s of this.aliveSoldiers()) {
      for (const k of visibleSet(this.map, s.x, s.y, s.sight)) vis.add(k);
    }
    this.visible = vis;
    this.d.fog.update(vis);
    for (const e of this.enemies) this.d.kit.setUnitVisible(e, this.enemyVisible(e));
    this.d.ui.refreshObjective();
  }

  podsToActivate() {
    const out = [];
    for (const pod of this.pods) {
      if (pod.activated) continue;
      const members = this.enemies.filter(e => e.podId === pod.id && e.alive);
      if (members.some(e => this.visible.has(key(e.x, e.y)))) out.push(pod);
    }
    return out;
  }

  async activatePods(podsList) {
    for (const pod of podsList) {
      if (pod.activated) continue;
      pod.activated = true;
      const members = this.enemies.filter(e => e.podId === pod.id && e.alive);
      for (const e of members) e.activated = true;
      const near = this.aliveSoldiers()[0];
      if (near) pod.lastKnown = { x: near.x, y: near.y };
      this.d.ui.banner('ALIEN POD REVEALED', 'alert');
      this.d.ui.log(`Pod revealed: ${members.map(m => m.label).join(', ')}`);
      const first = members[0];
      if (first) this.d.rig.focusOn(first.x * TILE, first.y * TILE);
      await this.d.fx.wait(0.5);
      for (const e of members) {
        if (!e.alive) continue;
        const plan = planScamper(
          { map: this.map, occupied: this.occupiedExcept(e), soldiers: this.aliveSoldiers() }, e);
        if (plan) await this.enemyMove(e, plan.path);
      }
    }
  }

  // ----------------------------------------------------- shot pipeline

  async resolveShot(attacker, defender, opts = {}) {
    const shot = computeShot(this.map, this.occupiedExcept(attacker), attacker, defender, opts);
    attacker.ammo--;
    this.d.kit.faceUnit(attacker, defender.x, defender.y);
    if (attacker.side === 'player') { this.stats.shots++; attacker.shotsFired++; }
    const res = rollShot(this.rng, shot);

    const from = this.d.kit.muzzleWorld(attacker);
    const to = this.d.kit.chestWorld(defender);
    if (!res.hit) to.x += (this.rng.next() - 0.5) * 2.2, to.z += (this.rng.next() - 0.5) * 2.2;
    if (attacker.side === 'player') this.d.fx.sounds.shoot(); else this.d.fx.sounds.plasma();
    const color = attacker.side === 'player' ? 0xffe08a : 0x7dff8a;
    await this.d.fx.tracer(from, to, color);
    await this.d.fx.impact(this.d.kit.chestWorld(defender), res.hit);

    const label = opts.overwatch ? ' (reaction)' : '';
    if (res.hit) {
      if (attacker.side === 'player') { this.stats.hits++; attacker.shotsHit++; }
      const died = damageUnit(defender, res.dmg);
      this.d.kit.updateHealth(defender);
      this.d.ui.float(this.d.kit.chestWorld(defender), `${res.dmg}`, res.crit ? 'crit' : 'dmg');
      if (res.crit) this.d.rig.addShake(0.35);
      this.d.ui.log(`${attacker.name} hits ${defender.name} for ${res.dmg}${res.crit ? ' CRIT' : ''}${label} [${shot.hit}%]`);
      const weapon = WEAPONS[attacker.weapon];
      if (!died && weapon.poison && this.rng.chance(weapon.poison)) {
        applyPoison(defender);
        this.d.kit.updateHealth(defender);
        this.d.ui.float(this.d.kit.chestWorld(defender), 'POISONED', 'poison');
        this.d.fx.sounds.poison();
      }
      if (died) {
        if (attacker.side === 'player') attacker.kills++;
        await this.handleDeath(defender);
      }
    } else {
      this.d.ui.float(this.d.kit.chestWorld(defender), 'MISS', 'miss');
      this.d.ui.log(`${attacker.name} misses ${defender.name}${label} [${shot.hit}%]`);
    }
    this.d.ui.refreshSquad();
    return res;
  }

  async handleDeath(u) {
    this.d.kit.hideHealthBar(u);
    if (u.side === 'player') this.stats.lost++;
    this.d.ui.log(`${u.name} is down.`);
    await this.d.fx.deathFall(this.d.kit.group(u));
    if (this.selected === u) this.selected = null;
    this.d.ui.refreshSquad();
    this.d.ui.refreshObjective();
  }

  checkEnd() {
    if (this.mode === 'over') return true;
    if (!this.aliveEnemies().length) {
      this.mode = 'over';
      this.clearOverlays();
      const acc = this.stats.shots ? Math.round(100 * this.stats.hits / this.stats.shots) : 0;
      this.d.ui.modal(true, { rounds: this.round, lost: this.stats.lost, acc });
      return true;
    }
    if (!this.aliveSoldiers().length) {
      this.mode = 'over';
      this.clearOverlays();
      const acc = this.stats.shots ? Math.round(100 * this.stats.hits / this.stats.shots) : 0;
      this.d.ui.modal(false, { rounds: this.round, lost: this.stats.lost, acc });
      return true;
    }
    return false;
  }

  // Reaction fire against a unit that just stepped to a new tile.
  async maybeOverwatch(mover) {
    const watchers = (mover.side === 'player' ? this.enemies : this.soldiers)
      .filter(w => w.alive && w.overwatch && w.ammo > 0);
    for (const w of watchers) {
      if (!mover.alive) break;
      if (distTiles(w.x, w.y, mover.x, mover.y) > w.sight) continue;
      if (!shotLineExists(this.map, this.occupiedExcept(w), w.x, w.y, mover.x, mover.y)) continue;
      w.overwatch = false;
      this.d.kit.updateHealth(w);
      this.d.fx.sounds.overwatch();
      this.d.ui.float(this.d.kit.chestWorld(w), 'REACTION FIRE', 'info');
      await this.resolveShot(w, mover, { overwatch: true });
      this.checkEnd();
    }
    return mover.alive;
  }

  // ------------------------------------------------------ player input

  async start() {
    for (const pod of this.pods) pod.id = this.pods.indexOf(pod);
    this.updateVision();
    this.d.ui.refreshAll();
    this.d.ui.banner(`ROUND 1 — PLAYER TURN`, 'player');
    this.select(this.soldiers[0]);
    await this.activatePods(this.podsToActivate());
    this.d.ui.refreshAll();
  }

  clearOverlays() {
    this.d.highlights.clear();
    this.d.pathDots.hide();
    this.d.marker.hide();
    this.d.aoeRing.hide();
    this.d.reticle.visible = false;
    this.d.ui.hideTargets();
    this.d.ui.hint('');
  }

  select(u) {
    if (this.mode === 'busy' || this.mode === 'over' || !u || !u.alive) return;
    this.cancel();
    this.selected = u;
    this.d.fx.sounds.select();
    this.d.selRing.visible = true;
    this.d.selRing.position.set(u.x * TILE, 0.05, u.y * TILE);
    this.d.rig.focusOn(u.x * TILE, u.y * TILE);
    this.refreshRange();
    this.d.ui.refreshAll();
  }

  cycleSoldier(dir) {
    const list = this.aliveSoldiers();
    if (!list.length) return;
    let i = Math.max(0, list.indexOf(this.selected));
    for (let n = 0; n < list.length; n++) {
      i = (i + dir + list.length) % list.length;
      if (list[i].ap > 0 || n === list.length - 1) break;
    }
    this.select(list[i]);
  }

  refreshRange() {
    const u = this.selected;
    this.d.highlights.clear();
    this.range = null;
    if (!u || u.ap <= 0 || this.phase !== 'player') return;
    const maxCost = u.mob * (u.ap >= 2 ? 2 : 1);
    this.range = dijkstraRange(this.map, this.occupiedExcept(u), u.x, u.y, maxCost);
    const tiles = [];
    for (const [k, node] of this.range) {
      if (node.cost === 0) continue;
      const x = k % 1000, y = Math.floor(k / 1000);
      tiles.push({ x, y, color: node.cost <= u.mob + 1e-9 ? 0x2fb8e8 : 0xd8b93a });
    }
    this.d.highlights.setTiles(tiles);
  }

  hoverTile(x, y) {
    if (this.mode === 'over' || this.mode === 'busy') return;
    if (this.mode === 'grenade') {
      const u = this.selected;
      const ok = u && distTiles(u.x, u.y, x, y) <= GRENADE.range;
      this.d.aoeRing.showAt(x, y, GRENADE.radius);
      const hitUnits = ok ? this.allAlive().filter(t => distTiles(x, y, t.x, t.y) <= GRENADE.radius) : [];
      this.d.ui.hint(ok
        ? `Frag out: ${hitUnits.length} unit(s) in blast — click to throw, Esc to cancel`
        : 'Out of throw range');
      return;
    }
    if (this.mode !== 'idle' || !this.selected) return;
    this.d.marker.showAt(x, y);
    if (this.range && isWalkable(this.map, x, y)) {
      const node = this.range.get(key(x, y));
      if (node && node.cost > 0) {
        const path = pathFromRange(this.range, x, y);
        const u = this.selected;
        let dashIdx = path.length;
        for (let i = 0; i < path.length; i++) {
          const c = this.range.get(key(path[i].x, path[i].y)).cost;
          if (c > u.mob + 1e-9) { dashIdx = i; break; }
        }
        this.d.pathDots.show(path, dashIdx);
        return;
      }
    }
    this.d.pathDots.hide();
  }

  hoverOff() {
    this.d.marker.hide();
    this.d.pathDots.hide();
    if (this.mode === 'grenade') this.d.aoeRing.hide();
  }

  async clickTile(x, y) {
    if (this.mode === 'grenade') return this.confirmGrenade(x, y);
    if (this.mode === 'target') { this.cancel(); return; }
    if (this.mode !== 'idle' || !this.selected) return;
    const node = this.range && this.range.get(key(x, y));
    if (!node || node.cost === 0 || !isWalkable(this.map, x, y)) return;
    if (this.occupiedExcept(this.selected).has(key(x, y))) return;
    await this.executeMove(pathFromRange(this.range, x, y), node.cost);
  }

  async clickUnit(unit) {
    if (this.mode === 'over' || this.mode === 'busy') return;
    if (this.mode === 'medkit') {
      if (unit.side === 'player' && this.medkitTargets().includes(unit)) await this.confirmMedkit(unit);
      return;
    }
    if (unit.side === 'player') { this.select(unit); return; }
    // clicking an enemy: enter/advance targeting
    if (this.mode === 'target') {
      const i = this.targets.findIndex(t => t.enemy === unit);
      if (i >= 0) {
        if (i === this.targetIdx) await this.confirmFire();
        else this.setTargetIdx(i);
      }
      return;
    }
    if (this.mode === 'idle' && this.enemyVisible(unit)) this.startTargeting(unit);
  }

  // ------------------------------------------------------------ actions

  buildTargets() {
    const u = this.selected;
    const occ = this.occupiedExcept(u);
    return this.aliveEnemies()
      .filter(e => this.enemyVisible(e))
      .map(e => ({ enemy: e, shot: computeShot(this.map, occ, u, e) }))
      .filter(t => t.shot.canSee)
      .sort((a, b) => b.shot.hit - a.shot.hit);
  }

  startTargeting(preTarget = null) {
    const u = this.selected;
    if (!u || u.ap <= 0 || u.ammo <= 0 || this.mode === 'busy') return;
    const targets = this.buildTargets();
    if (!targets.length) { this.d.fx.sounds.uiError(); this.d.ui.hint('No targets in sight'); return; }
    this.clearOverlays();
    this.mode = 'target';
    this.targets = targets;
    this.targetIdx = Math.max(0, preTarget ? targets.findIndex(t => t.enemy === preTarget) : 0);
    this.d.ui.showTargets(targets, this.targetIdx);
    this._syncReticle();
    this.d.ui.hint('Click target or press Enter to fire — Tab cycles, Esc cancels');
  }

  setTargetIdx(i) {
    this.targetIdx = (i + this.targets.length) % this.targets.length;
    this.d.ui.showTargets(this.targets, this.targetIdx);
    this._syncReticle();
  }

  _syncReticle() {
    const t = this.targets[this.targetIdx];
    if (!t) return;
    this.d.reticle.visible = true;
    this.d.reticle.position.set(t.enemy.x * TILE, 0.06, t.enemy.y * TILE);
    this.d.rig.focusOn(t.enemy.x * TILE, t.enemy.y * TILE);
  }

  async confirmFire() {
    if (this.mode !== 'target') return;
    const t = this.targets[this.targetIdx];
    if (!t) return;
    const u = this.selected;
    this.mode = 'busy';
    this.clearOverlays();
    await this.resolveShot(u, t.enemy);
    u.ap = 0;
    u.overwatch = false;
    if (this.checkEnd()) return;
    this.mode = 'idle';
    this.updateVision();
    await this.activatePods(this.podsToActivate());
    this.afterAction();
  }

  startGrenade() {
    const u = this.selected;
    if (!u || u.ap <= 0 || u.grenades <= 0 || this.mode === 'busy') return;
    this.clearOverlays();
    this.mode = 'grenade';
    const tiles = [];
    for (let y = 0; y < this.map.h; y++) {
      for (let x = 0; x < this.map.w; x++) {
        if (distTiles(u.x, u.y, x, y) <= GRENADE.range) tiles.push({ x, y, color: 0xe07b39 });
      }
    }
    this.d.highlights.setTiles(tiles);
    this.d.ui.hint('Select blast center — Esc to cancel');
  }

  async confirmGrenade(cx, cy) {
    const u = this.selected;
    if (this.mode !== 'grenade' || distTiles(u.x, u.y, cx, cy) > GRENADE.range) return;
    this.mode = 'busy';
    this.clearOverlays();
    u.grenades--; u.ap = 0;
    this.d.kit.faceUnit(u, cx, cy);

    await this.d.fx.grenadeArc(this.d.kit.muzzleWorld(u), this.d.kit.worldAt(cx, cy, 0.15));
    await this.d.fx.explosion(this.d.kit.worldAt(cx, cy), GRENADE.radius * TILE);

    // damage + destruction
    const victims = this.allAlive().filter(t => distTiles(cx, cy, t.x, t.y) <= GRENADE.radius);
    for (const v of victims) {
      const dmg = this.rng.int(GRENADE.dmg[0], GRENADE.dmg[1]);
      const died = damageUnit(v, dmg);
      this.d.kit.updateHealth(v);
      this.d.ui.float(this.d.kit.chestWorld(v), `${dmg}`, 'dmg');
      this.d.ui.log(`Grenade hits ${v.name} for ${dmg}`);
      if (died) await this.handleDeath(v);
    }
    for (const t of blastTiles(this.map, cx, cy, GRENADE.radius)) {
      const tile = tileAt(this.map, t.x, t.y);
      if (tile.type === 'half' || tile.type === 'full' || tile.type === 'wall') {
        tile.hp -= GRENADE.envDmg;
        if (tile.hp <= 0) {
          tile.type = 'floor'; tile.prop = null;
          this.d.kit.destroyTileProp(t.x, t.y);
          this.d.ui.log('Cover destroyed!');
        }
      }
    }
    if (this.checkEnd()) return;
    this.mode = 'idle';
    this.updateVision();
    await this.activatePods(this.podsToActivate());
    this.afterAction();
  }

  medkitTargets() {
    const u = this.selected;
    if (!u) return [];
    return this.aliveSoldiers().filter(s =>
      (s === u || distTiles(u.x, u.y, s.x, s.y) <= 1.5) && (s.hp < s.maxHp || s.poisoned > 0));
  }

  startMedkit() {
    const u = this.selected;
    if (!u || u.ap <= 0 || u.medkits <= 0 || this.mode === 'busy') return;
    const targets = this.medkitTargets();
    if (!targets.length) { this.d.fx.sounds.uiError(); this.d.ui.hint('No wounded allies in reach'); return; }
    this.clearOverlays();
    this.mode = 'medkit';
    this.d.ui.hint('Click a wounded ally (or yourself) to heal — Esc cancels');
  }

  async confirmMedkit(target) {
    const u = this.selected;
    this.mode = 'busy';
    u.medkits--; u.ap -= 1;
    const healed = healUnit(target, MEDKIT.heal);
    target.poisoned = 0;
    this.d.kit.updateHealth(target);
    this.d.fx.sounds.heal();
    this.d.ui.float(this.d.kit.chestWorld(target), `+${healed}`, 'heal');
    this.d.ui.log(`${u.name} stabilizes ${target.name} (+${healed})`);
    await this.d.fx.wait(0.3);
    this.mode = 'idle';
    this.afterAction();
  }

  doOverwatch() {
    const u = this.selected;
    if (!u || u.ap <= 0 || u.ammo <= 0 || this.mode !== 'idle') return;
    u.overwatch = true; u.ap = 0;
    this.d.kit.updateHealth(u);
    this.d.fx.sounds.overwatch();
    this.d.ui.float(this.d.kit.chestWorld(u), 'OVERWATCH', 'info');
    this.d.ui.log(`${u.name} is on overwatch.`);
    this.afterAction();
  }

  doHunker() {
    const u = this.selected;
    if (!u || u.ap <= 0 || this.mode !== 'idle') return;
    if (!coverSides(this.map, u.x, u.y).length) {
      this.d.fx.sounds.uiError(); this.d.ui.hint('Need cover to hunker down'); return;
    }
    u.hunkered = true; u.ap = 0;
    this.d.kit.updateHealth(u);
    this.d.ui.float(this.d.kit.chestWorld(u), 'HUNKERED', 'info');
    this.d.ui.log(`${u.name} hunkers down.`);
    this.afterAction();
  }

  doReload() {
    const u = this.selected;
    if (!u || u.ap <= 0 || u.ammo >= u.clip || this.mode !== 'idle') return;
    u.ammo = u.clip; u.ap -= 1;
    this.d.fx.sounds.reload();
    this.d.ui.log(`${u.name} reloads.`);
    this.afterAction();
  }

  async executeMove(path, cost) {
    const u = this.selected;
    const apCost = cost > u.mob + 1e-9 ? 2 : 1;
    if (u.ap < apCost) return;
    this.mode = 'busy';
    this.clearOverlays();
    this.d.highlights.clear();
    u.ap -= apCost;
    u.hunkered = false;
    this.d.fx.sounds.move();

    const group = this.d.kit.group(u);
    await this.d.fx.moveUnit(group, path, u, async () => {
      this.updateVision();
      this.d.selRing.position.set(u.x * TILE, 0.05, u.y * TILE);
      const alive = await this.maybeOverwatch(u);
      if (!alive) return 'stop';
    });
    this.d.kit.syncUnit(u);
    if (this.checkEnd()) return;
    if (!u.alive) { this.mode = 'idle'; this.afterAction(); return; }
    this.d.rig.focusOn(u.x * TILE, u.y * TILE);
    this.mode = 'idle';
    this.updateVision();
    await this.activatePods(this.podsToActivate());
    this.afterAction();
  }

  afterAction() {
    if (this.mode === 'over') return;
    const u = this.selected;
    if (u && u.alive && u.ap > 0) {
      this.refreshRange();
    } else {
      const next = this.aliveSoldiers().find(s => s.ap > 0);
      if (next) this.select(next);
      else {
        this.d.highlights.clear();
        this.d.ui.hint('Squad spent — press Enter to end turn');
      }
    }
    this.d.ui.refreshAll();
  }

  cancel() {
    if (this.mode === 'target' || this.mode === 'grenade' || this.mode === 'medkit') {
      this.mode = 'idle';
      this.clearOverlays();
      this.refreshRange();
      this.d.ui.refreshAll();
    }
  }

  // --------------------------------------------------------- enemy turn

  async enemyMove(e, path) {
    if (!path || !path.length) return;
    const group = this.d.kit.group(e);
    let focused = false;
    await this.d.fx.moveUnit(group, path, e, async () => {
      const vis = this.enemyVisible(e);
      this.d.kit.setUnitVisible(e, vis);
      if (vis && !focused) { focused = true; this.d.rig.focusOn(e.x * TILE, e.y * TILE); }
      const alive = await this.maybeOverwatch(e);
      if (!alive) return 'stop';
    });
    if (e.alive) this.d.kit.syncUnit(e);
    this.d.kit.setUnitVisible(e, this.enemyVisible(e));
  }

  async endTurn() {
    if (this.phase !== 'player' || this.mode === 'busy' || this.mode === 'over') return;
    this.cancel();
    this.mode = 'busy';
    this.phase = 'enemy';
    this.clearOverlays();
    this.d.selRing.visible = false;
    this.d.ui.banner('ALIEN ACTIVITY', 'alert');
    this.d.ui.refreshTurn();
    await this.d.fx.wait(0.7);

    for (const e of this.enemies) if (e.alive) resetTurn(e);
    // poison ticks on aliens
    for (const e of this.aliveEnemies()) {
      for (const ev of tickStatuses(e, this.rng)) {
        this.d.kit.updateHealth(e);
        if (this.enemyVisible(e)) this.d.ui.float(this.d.kit.chestWorld(e), `${ev.dmg}`, 'poison');
        if (ev.died) await this.handleDeath(e);
      }
    }
    if (this.checkEnd()) return;

    for (const e of this.enemies) {
      if (!e.alive || !e.activated) continue;
      if (!this.aliveSoldiers().length) break;
      const pod = this.pods.find(p => p.id === e.podId);
      // Pods only engage soldiers they can actually see; otherwise they hunt
      // toward the squad's last known position.
      const podMates = this.enemies.filter(m => m.podId === e.podId && m.alive);
      const sees = this.aliveSoldiers().filter(s =>
        podMates.some(m => distTiles(m.x, m.y, s.x, s.y) <= m.sight &&
          shotLineExists(this.map, this.occupiedExcept(m), m.x, m.y, s.x, s.y)));
      if (sees.length && pod) {
        let nearest = sees[0];
        for (const s of sees) {
          if (distTiles(e.x, e.y, s.x, s.y) < distTiles(e.x, e.y, nearest.x, nearest.y)) nearest = s;
        }
        pod.lastKnown = { x: nearest.x, y: nearest.y };
      }
      const ctx = {
        map: this.map,
        occupied: this.occupiedExcept(e),
        soldiers: sees,
        lastKnown: pod ? pod.lastKnown || null : null,
        rng: this.rng,
      };
      const act = planAction(ctx, e);
      const visBefore = this.enemyVisible(e);
      if (visBefore) this.d.rig.focusOn(e.x * TILE, e.y * TILE);

      if (act.type === 'moveShoot') {
        await this.enemyMove(e, act.path);
        if (e.alive && act.target.alive) {
          await this.d.fx.wait(0.18);
          await this.resolveShot(e, act.target);
        }
      } else if (act.type === 'shoot') {
        await this.resolveShot(e, act.target);
      } else if (act.type === 'reloadShoot') {
        this.d.fx.sounds.reload();
        e.ammo = e.clip;
        await this.d.fx.wait(0.3);
        if (act.target.alive) await this.resolveShot(e, act.target);
      } else if (act.type === 'moveReload') {
        if (act.path) await this.enemyMove(e, act.path);
        e.ammo = e.clip;
        this.d.fx.sounds.reload();
      } else if (act.type === 'move') {
        await this.enemyMove(e, act.path);
        if (e.alive && act.thenOverwatch) {
          e.overwatch = true;
          this.d.kit.updateHealth(e);
          if (this.enemyVisible(e)) {
            this.d.fx.sounds.overwatch();
            this.d.ui.float(this.d.kit.chestWorld(e), 'OVERWATCH', 'info');
          }
        }
      } else if (act.type === 'overwatch') {
        e.overwatch = true;
        this.d.kit.updateHealth(e);
        if (this.enemyVisible(e)) {
          this.d.fx.sounds.overwatch();
          this.d.ui.float(this.d.kit.chestWorld(e), 'OVERWATCH', 'info');
        }
      }
      if (this.checkEnd()) return;
      if (this.enemyVisible(e)) await this.d.fx.wait(0.25);
    }

    // back to player
    this.phase = 'player';
    this.round++;
    for (const s of this.soldiers) if (s.alive) resetTurn(s);
    for (const s of this.aliveSoldiers()) {
      for (const ev of tickStatuses(s, this.rng)) {
        this.d.kit.updateHealth(s);
        this.d.ui.float(this.d.kit.chestWorld(s), `${ev.dmg}`, 'poison');
        this.d.fx.sounds.poison();
        if (ev.died) await this.handleDeath(s);
      }
    }
    if (this.checkEnd()) return;
    this.mode = 'idle';
    this.updateVision();
    this.d.ui.banner(`ROUND ${this.round} — PLAYER TURN`, 'player');
    this.d.ui.refreshTurn();
    const first = this.aliveSoldiers().find(s => s.ap > 0);
    if (first) this.select(first);
    this.d.ui.refreshAll();
  }

  // ------------------------------------------------------- UI helpers

  actionsFor(u) {
    if (!u || this.phase !== 'player') return [];
    const inCover = coverSides(this.map, u.x, u.y).length > 0;
    const acts = [
      { id: 'fire', label: 'Fire', hot: '1', enabled: u.ap > 0 && u.ammo > 0,
        reason: u.ammo <= 0 ? 'No ammo — reload' : u.ap <= 0 ? 'No actions left' : `${u.ammo}/${u.clip} ammo` },
      { id: 'grenade', label: 'Grenade', hot: '2', enabled: u.ap > 0 && u.grenades > 0,
        reason: u.grenades <= 0 ? 'No grenades' : `${u.grenades} left — ends turn` },
      { id: 'overwatch', label: 'Overwatch', hot: '3', enabled: u.ap > 0 && u.ammo > 0,
        reason: 'Reaction shot at moving enemies' },
      { id: 'hunker', label: 'Hunker', hot: '4', enabled: u.ap > 0 && inCover,
        reason: inCover ? 'Bonus defense until next turn' : 'Requires cover' },
      { id: 'reload', label: 'Reload', hot: '5', enabled: u.ap > 0 && u.ammo < u.clip,
        reason: u.ammo >= u.clip ? 'Magazine full' : 'Costs 1 action' },
    ];
    if (u.medkits > 0 || u.cls === 'specialist') {
      acts.push({ id: 'medkit', label: 'Medkit', hot: '6', enabled: u.ap > 0 && u.medkits > 0 && this.medkitTargets().length > 0,
        reason: u.medkits <= 0 ? 'No charges' : 'Heal self or adjacent ally' });
    }
    return acts;
  }

  triggerAction(id) {
    if (this.phase !== 'player' || this.mode === 'busy' || this.mode === 'over') return;
    if (id !== 'fire' && this.mode === 'target') this.cancel();
    switch (id) {
      case 'fire': this.mode === 'target' ? this.confirmFire() : this.startTargeting(); break;
      case 'grenade': this.startGrenade(); break;
      case 'overwatch': this.doOverwatch(); break;
      case 'hunker': this.doHunker(); break;
      case 'reload': this.doReload(); break;
      case 'medkit': this.startMedkit(); break;
    }
  }
}
