/** Particules : étincelles, fumée de pneus, poussière, flammes, éclats. Tout se règle ici. */
export const EFFECTS = {
  /** Nombre maximal de particules lumineuses (étincelles, flammes) et de voiles (fumée, poussière, éclats). */
  maxGlow: 500,
  maxSoft: 700,
  /** Étincelles : vitesse minimale de frottement (m/s) et nombre par mètre frotté. */
  sparkMinSpeed: 6,
  sparksPerMeter: 1.6,
  /** Fumée de pneus : à partir de cette adhérence utilisée (1 = limite du pneu), et bouffées par seconde et par roue au maximum. */
  smokeFrom: 1.05,
  smokeRate: 26,
  smokeAlpha: 0.2,
  /** Poussière en campagne : vitesse minimale (m/s), bouffées par seconde et par roue à 100 km/h. */
  dustMinSpeed: 9,
  dustRate: 9,
  dustAlpha: 0.13,
  /** Flammes d'échappement au lever de pied d'un moteur turbo : nombre de flammèches. */
  backfire: 9,
  /** Au-delà de cette distance de la caméra (m), les autres voitures n'émettent rien. */
  range: 90,
};
