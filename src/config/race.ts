/** Réglages des courses (phase 2). */
export const RACE = {
  /** Longueur visée d'un tracé (m) : environ 1 min 30 à 2 min. */
  targetLength: 2700,
  /** Circuit à plusieurs tours (épreuve plus difficile, pensée pour les changements de palier). */
  circuit: { lapLength: 950, laps: 3, difficulty: 1.1 },
  /** Distance entre deux points de passage (m). */
  checkpointSpacing: 170,
  /** Rayon dans lequel on « tient » la trajectoire (m) : au-delà, la progression ne compte plus. */
  trackRadius: 34,
  /** Écart de cap (°) à partir duquel un virage reçoit des flèches. */
  turnAngleDeg: 38,
  countdownSeconds: 3,
  /** Position de la ligne de départ le long du tracé (m) et espacement de la grille. */
  startLine: 34,
  gridRowSpacing: 9,
  gridLaneOffset: 3.4,
} as const;

export interface AiLevel {
  name: string;
  /** Couleur de carrosserie (linéaire). */
  color: readonly [number, number, number];
  /** Vitesse de pointe visée (km/h). */
  topSpeed: number;
  /** Accélération latérale acceptée en virage (m/s²) : plus haut = virages plus rapides. */
  cornerGrip: number;
  /** Décélération prévue au freinage (m/s²). */
  braking: number;
  /** Distance de visée devant la voiture (m), plus une part proportionnelle à la vitesse. */
  lookAhead: number;
}

/** Adversaires du palier Débutant. Ils deviendront meilleurs avec le niveau du joueur. */
export const AI_DRIVERS: AiLevel[] = [
  { name: 'Kenji Aoki', color: [0.05, 0.25, 0.75], topSpeed: 168, cornerGrip: 10.5, braking: 8.5, lookAhead: 6.5 },
  { name: 'Mika Tanabe', color: [0.85, 0.75, 0.05], topSpeed: 160, cornerGrip: 9.6, braking: 8, lookAhead: 6.5 },
  { name: 'Ryo Sakamoto', color: [0.1, 0.6, 0.3], topSpeed: 152, cornerGrip: 8.8, braking: 7.5, lookAhead: 7 },
];

/** Effet élastique : les adversaires ralentissent un peu s'ils sont loin devant, accélèrent s'ils sont loin derrière. */
export const RUBBER_BAND = { distance: 160, maxBoost: 0.1, maxSlow: 0.12 } as const;
