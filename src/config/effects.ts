/** Particules : étincelles, fumée de pneus, poussière, flammes, éclats. Tout se règle ici. */
export const EFFECTS = {
  /** Nombre maximal de particules lumineuses (étincelles, flammes) et de voiles (fumée, poussière, éclats). */
  maxGlow: 400,
  maxSoft: 180,
  /** Étincelles : vitesse minimale de frottement (m/s) et nombre par mètre frotté. */
  sparkMinSpeed: 6,
  sparksPerMeter: 1.6,
  /** Fumée de pneus : à partir de cette adhérence utilisée (1 = limite du pneu), et bouffées par seconde et par roue au maximum. */
  smokeFrom: 1.05,
  smokeRate: 11,
  smokeAlpha: 0.24,
  /** Taille d'un voile de fumée ou de poussière en fin de vie (m). Les grands voiles coûtent cher à dessiner : rester petit. */
  smokeSize: 1.25,
  /** Les voitures adverses fument moins que celle du joueur (part). */
  othersShare: 0.4,
  /** Poussière en campagne : vitesse minimale (m/s), bouffées par seconde et par roue à 100 km/h. */
  dustMinSpeed: 9,
  dustRate: 4,
  dustAlpha: 0.15,
  /** Flammes d'échappement au lever de pied d'un moteur turbo : nombre de flammèches. */
  backfire: 9,
  /** Au-delà de cette distance de la caméra (m), les autres voitures n'émettent rien. */
  range: 60,
  /** Un voile ne dépasse jamais cette part de sa distance à la caméra (0,2 = un cinquième) : aucun ne remplit l'écran. */
  maxScreen: 0.2,
  /** Garde-fou : si l'image met plus de `slowMs` à se dessiner, on émet moins (jusqu'à `minDensity`) ; ça remonte sous `fastMs`. */
  slowMs: 21,
  fastMs: 15,
  minDensity: 0.15,
};
