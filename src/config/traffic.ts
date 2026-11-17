/**
 * Circulation dans les rues (essai) : des voitures ordinaires qui suivent les rues à gauche,
 * ralentissent aux carrefours et s'arrêtent derrière un obstacle. En balade partout dans la
 * ville ; en course, sur le tracé, comme obstacles à éviter.
 */
export const TRAFFIC = {
  /** Nombre de voitures en circulation autour du joueur. */
  count: 24,
  /** Nombre de voitures pendant une course (elles apparaissent sur le tracé). */
  raceCount: 14,
  /** Elles apparaissent entre ces deux distances du joueur (m), et disparaissent au-delà de la troisième. */
  spawnMin: 70,
  spawnMax: 230,
  despawn: 290,
  /** Vitesse de croisière (m/s) selon la rue. */
  speed: { boulevard: 14, avenue: 12, street: 8.5, alley: 5 },
  /** Vitesse dans les carrefours (m/s). */
  junctionSpeed: 6,
  accel: 2.6,
  brake: 7,
  /** Distance à laquelle elles voient un obstacle devant elles (m). */
  lookAhead: 16,
  /** Masse une fois percutées (kg) : légères, elles se poussent bien. */
  mass: 1100,
  /** Couleurs ordinaires (linéaire) : blanc, gris, noir, beige, bleu nuit, bordeaux, taxi. */
  colors: [
    [0.7, 0.7, 0.68],
    [0.3, 0.31, 0.33],
    [0.03, 0.03, 0.035],
    [0.42, 0.36, 0.26],
    [0.03, 0.06, 0.16],
    [0.2, 0.02, 0.03],
    [0.75, 0.5, 0.03],
    [0.12, 0.2, 0.16],
  ] as [number, number, number][],
} as const;
