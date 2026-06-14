// Central balance data and constants. Pure data — no three.js, no DOM.

export const TILE = 2;            // world units per grid tile
export const MAP_W = 32;
export const MAP_H = 32;

export const SIGHT = { soldier: 14, enemy: 12 };

export const COVER = { half: 20, full: 40, hunkerBonus: 30 };

export const OVERWATCH_AIM_MULT = 0.7;

export const GRENADE = { range: 8, radius: 2.2, dmg: [3, 4], envDmg: 10 };

export const MEDKIT = { heal: 5 };

export const POISON = { turns: 2, dmg: [1, 2], aimPenalty: 15 };

// profile: 'cqc' (close-quarters), 'balanced', 'long'
export const WEAPONS = {
  shotgun:  { name: 'Shard Gun',      dmg: [4, 6], crit: 20, clip: 4, profile: 'cqc' },
  rifle:    { name: 'Assault Rifle',  dmg: [3, 5], crit: 10, clip: 4, profile: 'balanced' },
  cannon:   { name: 'Cannon',         dmg: [4, 6], crit: 5,  clip: 3, profile: 'balanced' },
  sniper:   { name: 'Long Rifle',     dmg: [4, 6], crit: 25, clip: 3, profile: 'long' },
  advRifle: { name: 'Mag Rifle',      dmg: [2, 4], crit: 10, clip: 4, profile: 'balanced' },
  plasma:   { name: 'Wrist Blaster',  dmg: [2, 4], crit: 10, clip: 4, profile: 'balanced' },
  venom:    { name: 'Venom Spit',     dmg: [2, 4], crit: 10, clip: 4, profile: 'balanced', poison: 0.5 },
};

export const CLASSES = {
  ranger:       { label: 'Ranger',       hp: 6, aim: 75, mob: 8, defense: 0, weapon: 'shotgun', grenades: 1, medkits: 0, tint: 0x67e8f9 },
  grenadier:    { label: 'Grenadier',    hp: 7, aim: 65, mob: 6, defense: 0, weapon: 'cannon',  grenades: 2, medkits: 0, tint: 0xfca5a5 },
  sharpshooter: { label: 'Sharpshooter', hp: 5, aim: 78, mob: 6, defense: 0, weapon: 'sniper',  grenades: 1, medkits: 0, tint: 0xd8b4fe },
  specialist:   { label: 'Specialist',   hp: 6, aim: 72, mob: 7, defense: 0, weapon: 'rifle',   grenades: 1, medkits: 1, tint: 0x86efac },
};

export const ENEMY_TYPES = {
  trooper: { label: 'ADVENT Trooper', hp: 4, aim: 62, mob: 7, defense: 0,  weapon: 'advRifle', sight: SIGHT.enemy },
  sectoid: { label: 'Sectoid',        hp: 6, aim: 58, mob: 7, defense: 5,  weapon: 'plasma',   sight: SIGHT.enemy },
  viper:   { label: 'Viper',          hp: 6, aim: 66, mob: 9, defense: 10, weapon: 'venom',    sight: SIGHT.enemy },
};

export const SOLDIER_NAMES = [
  ['Ana', 'Reyes', 'Hawk'], ['Marcus', 'Webb', 'Anvil'], ['Yuki', 'Tanaka', 'Ghost'],
  ['Pavel', 'Sokolov', 'Bear'], ['Lena', 'Fischer', 'Static'], ['Dele', 'Okafor', 'Tempo'],
  ['Saoirse', 'Quinn', 'Banshee'], ['Mateo', 'Vidal', 'Comet'],
];

export const OP_ADJ = ['Burning', 'Silent', 'Crimson', 'Hollow', 'Iron', 'Forgotten', 'Driving', 'Patient'];
export const OP_NOUN = ['Serpent', 'Future', 'Crown', 'Whisper', 'Rain', 'Lance', 'Vigil', 'Anthem'];
