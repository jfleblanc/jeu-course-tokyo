/** Mobilier de rue qu'on peut renverser. */
export const LAMPS = {
  /** Part de vitesse perdue quand on fauche un lampadaire (0,03 = 3 %). */
  slowdown: 0.03,
  /** En dessous de cette vitesse (m/s), le lampadaire ne bouge pas (et ne gêne pas). */
  minSpeed: 4,
  /** Demi-largeur et demi-longueur de la zone de contact autour de la voiture (m). */
  hitHalfWidth: 1.0,
  hitHalfLength: 2.3,
  /** Vitesse verticale donnée au lampadaire (m/s), et part de la vitesse de la voiture qu'il reçoit. */
  popUp: 6.5,
  carry: 0.75,
  /** Un lampadaire renversé se redresse quand le joueur est à plus de cette distance (m). */
  respawnDistance: 260,
};

/** Arbres : les petits et les palmiers se fauchent ; les gros (sapins de campagne) sont durs, sauf si on arrive assez fort. */
export const TREES = {
  /** Petit arbre ou palmier : part de vitesse perdue, et vitesse minimale (m/s) pour le faucher. */
  slowdown: 0.06,
  minSpeed: 5,
  /** Gros arbre : il casse si vitesse (m/s) × masse (kg) dépasse ce seuil. 27 000 ≈ 1 100 kg à 90 km/h, ou 1 500 kg à 65 km/h. */
  breakMomentum: 27000,
  /** Part de vitesse perdue en cassant un gros arbre. */
  breakSlowdown: 0.22,
  /** Demi-largeur de contact (m) : voiture + tronc. */
  hitHalfWidth: 1.15,
  hitHalfLength: 2.3,
  popUp: 5,
  carry: 0.6,
  /** Un arbre à terre repousse quand le joueur est à plus de cette distance (m). */
  respawnDistance: 260,
  /** Nombre maximal d'arbres à terre en même temps (les plus anciens repoussent). */
  maxDown: 40,
};

/** Objets de rue à renverser : cônes, barrières de chantier, poubelles, panneaux, cartons. */
export const STREET_PROPS = {
  /** Part des rues qui ont un petit chantier (4 cônes et une barrière) le long du trottoir. */
  worksShare: 0.14,
  /** Part des rues avec un panneau avant le carrefour. */
  signShare: 0.3,
  /** Une poubelle tous les … mètres de trottoir, en moyenne. */
  binEvery: 95,
  /** Part des rues avec un tas de cartons : aux docks, ailleurs. */
  boxShareDocks: 0.55,
  boxShare: 0.07,
  /** Vitesse minimale (m/s) pour renverser un objet. */
  minSpeed: 1.5,
  popUp: 3.2,
  carry: 0.75,
  /** Un objet renversé revient à sa place quand le joueur est à plus de cette distance (m). */
  respawnDistance: 220,
  /** Par genre : rayon de contact (m), demi-hauteur (m), part de vitesse perdue. */
  kinds: {
    cone: { radius: 0.25, half: 0.35, slowdown: 0.004 },
    barriere: { radius: 0.7, half: 0.5, slowdown: 0.012 },
    poubelle: { radius: 0.3, half: 0.45, slowdown: 0.015 },
    panneau: { radius: 0.12, half: 1.3, slowdown: 0.01 },
    carton: { radius: 0.32, half: 0.3, slowdown: 0.004 },
  },
};
