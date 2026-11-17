/** Niveaux, paliers et récompenses (phase 3). */
export const MAX_LEVEL = 40;

export const TIERS = [
  { name: 'Débutant', from: 1, to: 10 },
  { name: 'Intermédiaire', from: 11, to: 20 },
  { name: 'Avancé', from: 21, to: 30 },
  { name: 'Expert', from: 31, to: 40 },
] as const;

export const tierOf = (level: number): (typeof TIERS)[number] => TIERS.find((t) => level >= t.from && level <= t.to) ?? TIERS[TIERS.length - 1]!;

/** XP nécessaire pour passer du niveau `level` au suivant. */
export const xpToNext = (level: number): number => 100 + (level - 1) * 45;

/** Part de la récompense selon la place à l'arrivée (1er, 2e, 3e, 4e). */
const XP_SHARE = [1, 0.7, 0.5, 0.3];
const MONEY_SHARE = [1, 0.6, 0.4, 0.2];

/** Récompense d'une course : elle augmente avec le niveau et avec la place. */
export function raceReward(level: number, place: number, circuit: boolean): { xp: number; money: number } {
  const k = Math.max(0, Math.min(3, place - 1));
  const bonus = circuit ? 1.25 : 1;
  return {
    xp: Math.round((70 + level * 9) * (XP_SHARE[k] as number) * bonus),
    money: Math.round(((1500 + level * 250) * (MONEY_SHARE[k] as number) * bonus) / 10) * 10,
  };
}

/** Les adversaires deviennent meilleurs avec le niveau du joueur. */
export const aiDifficulty = (level: number): number => Math.min(1.28, 0.9 + (level - 1) * 0.012);

/** Épreuve de palier : circuit à plusieurs tours, adversaires renforcés, il faut finir dans les deux premiers. */
export const TIER_TRIAL = { extraDifficulty: 0.07, placeNeeded: 2 } as const;

export const START_MONEY = 2000;
