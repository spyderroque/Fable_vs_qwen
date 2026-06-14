// Unit factories and per-unit state logic. Pure module.

import { CLASSES, ENEMY_TYPES, WEAPONS, SIGHT, POISON } from './config.js';

let nextId = 1;

export function makeSoldier(cls, name, nickname, x, y) {
  const c = CLASSES[cls];
  return {
    id: nextId++, side: 'player', cls, type: cls,
    label: c.label, name, nickname,
    x, y, hp: c.hp, maxHp: c.hp,
    aim: c.aim, mob: c.mob, defense: c.defense,
    weapon: c.weapon, clip: WEAPONS[c.weapon].clip, ammo: WEAPONS[c.weapon].clip,
    grenades: c.grenades, medkits: c.medkits,
    sight: SIGHT.soldier,
    ap: 2, alive: true,
    overwatch: false, hunkered: false, poisoned: 0,
    tint: c.tint,
    kills: 0, shotsFired: 0, shotsHit: 0,
  };
}

export function makeEnemy(type, x, y, podId) {
  const e = ENEMY_TYPES[type];
  return {
    id: nextId++, side: 'enemy', type, podId,
    label: e.label, name: e.label,
    x, y, hp: e.hp, maxHp: e.hp,
    aim: e.aim, mob: e.mob, defense: e.defense,
    weapon: e.weapon, clip: WEAPONS[e.weapon].clip, ammo: WEAPONS[e.weapon].clip,
    grenades: 0, medkits: 0,
    sight: e.sight,
    ap: 2, alive: true, activated: false,
    overwatch: false, hunkered: false, poisoned: 0,
  };
}

export function resetTurn(u) {
  u.ap = 2;
  u.overwatch = false; // overwatch persists only through the opponent's turn
  u.hunkered = false;
}

// Returns true if the unit died.
export function damageUnit(u, dmg) {
  u.hp = Math.max(0, u.hp - dmg);
  if (u.hp === 0) u.alive = false;
  return !u.alive;
}

export function healUnit(u, amount) {
  const healed = Math.min(amount, u.maxHp - u.hp);
  u.hp += healed;
  return healed;
}

export function applyPoison(u) {
  u.poisoned = POISON.turns;
}

// Tick statuses at the start of the unit's side's turn. Returns events for the log/FX.
export function tickStatuses(u, rng) {
  const events = [];
  if (!u.alive) return events;
  if (u.poisoned > 0) {
    const dmg = rng.int(POISON.dmg[0], POISON.dmg[1]);
    const died = damageUnit(u, dmg);
    u.poisoned--;
    events.push({ type: 'poison', unit: u, dmg, died });
  }
  return events;
}
