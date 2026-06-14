// Combat math: hit chance, crits, damage, grenades. Pure module.

import { COVER, POISON, WEAPONS, OVERWATCH_AIM_MULT } from './config.js';
import { coverFrom, shotLineExists, distTiles } from './grid.js';

function rangeMod(weapon, d) {
  switch (weapon.profile) {
    case 'cqc': { // brutal up close, weak at range
      const m = (6 - d) * 5;
      return Math.max(-25, Math.min(30, m));
    }
    case 'long': { // penalized inside 5 tiles, slight bonus far out
      if (d < 5) return Math.max(-30, -(5 - d) * 6);
      return Math.min(10, (d - 5) * 1.5);
    }
    default: { // balanced
      if (d <= 4) return (4 - d) * 2;
      return Math.max(-20, -(d - 4) * 2);
    }
  }
}

// Full to-hit computation with an itemized breakdown for the UI.
export function computeShot(map, occupied, attacker, defender, opts = {}) {
  const d = distTiles(attacker.x, attacker.y, defender.x, defender.y);
  const canSee = shotLineExists(map, occupied, attacker.x, attacker.y, defender.x, defender.y);
  const weapon = WEAPONS[attacker.weapon];
  const breakdown = [];

  let aim = attacker.aim;
  breakdown.push({ label: 'Aim', val: aim });

  if (attacker.poisoned) { breakdown.push({ label: 'Poisoned', val: -POISON.aimPenalty }); aim -= POISON.aimPenalty; }
  if (opts.overwatch) {
    const pen = -Math.round(attacker.aim * (1 - OVERWATCH_AIM_MULT));
    breakdown.push({ label: 'Reaction fire', val: pen });
    aim += pen;
  }

  const rm = Math.round(rangeMod(weapon, d));
  if (rm !== 0) { breakdown.push({ label: 'Range', val: rm }); aim += rm; }

  const cover = coverFrom(map, defender.x, defender.y, attacker.x, attacker.y);
  const flanked = cover === 'none';
  if (cover !== 'none') {
    let def = COVER[cover];
    if (defender.hunkered) def += COVER.hunkerBonus;
    breakdown.push({ label: (defender.hunkered ? 'Hunkered ' : '') + cover + ' cover', val: -def });
    aim -= def;
  } else if (canSee) {
    breakdown.push({ label: 'Flanked!', val: 12 });
    aim += 12;
  }

  if (defender.defense) { breakdown.push({ label: 'Defense', val: -defender.defense }); aim -= defender.defense; }

  const hit = Math.max(1, Math.min(100, Math.round(aim)));
  let crit = weapon.crit + (flanked ? 33 : 0);
  if (defender.hunkered) crit = 0;
  crit = Math.max(0, Math.min(100, crit));

  return { canSee, dist: d, hit, crit, cover, flanked, weapon, breakdown };
}

export function rollShot(rng, shot) {
  const hit = rng.next() * 100 < shot.hit;
  if (!hit) return { hit: false, crit: false, dmg: 0 };
  const crit = rng.next() * 100 < shot.crit;
  let dmg = rng.int(shot.weapon.dmg[0], shot.weapon.dmg[1]);
  if (crit) dmg = Math.round(dmg * 1.5);
  return { hit: true, crit, dmg };
}

export function expectedDamage(shot) {
  const avg = (shot.weapon.dmg[0] + shot.weapon.dmg[1]) / 2;
  const critAvg = avg * 1.5;
  const pHit = shot.hit / 100, pCrit = shot.crit / 100;
  return pHit * ((1 - pCrit) * avg + pCrit * critAvg);
}

// Tiles inside a grenade blast centered on (cx, cy).
export function blastTiles(map, cx, cy, radius) {
  const out = [];
  const r = Math.ceil(radius);
  for (let y = Math.max(0, cy - r); y <= Math.min(map.h - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(map.w - 1, cx + r); x++) {
      if (distTiles(cx, cy, x, y) <= radius) out.push({ x, y });
    }
  }
  return out;
}
