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
