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
  /** Mini-fiche affichée avant le départ. */
  car: string;
  /** Modèle 3D de sa voiture (`public/models/<glb>.glb`). */
  glb: string;
  bio: string;
}

/**
 * Pilotes fictifs. Trois sont tirés au sort à chaque course ; tous deviennent meilleurs
 * avec le niveau du joueur (voir aiDifficulty dans progression.ts).
 */
export const AI_DRIVERS: AiLevel[] = [
  { name: 'Kenji Aoki', color: [0.05, 0.25, 0.75], topSpeed: 168, cornerGrip: 10.5, braking: 8.5, lookAhead: 6.5, car: 'Nissan Skyline GT-R R34', glb: 'skyline-r34', bio: 'Régulier et rapide partout. Le pilote à battre.' },
  { name: 'Mika Tanabe', color: [0.85, 0.75, 0.05], topSpeed: 160, cornerGrip: 9.9, braking: 8, lookAhead: 6.5, car: 'Mazda RX-7', glb: 'rx7', bio: 'Très à l’aise dans les ruelles, moins en ligne droite.' },
  { name: 'Ryo Sakamoto', color: [0.1, 0.6, 0.3], topSpeed: 154, cornerGrip: 8.8, braking: 7.5, lookAhead: 7, car: 'Honda Integra Type R', glb: 'integra-dc2', bio: 'Prudent en virage, mais il ne fait jamais d’erreur.' },
  { name: 'Hana Kuroda', color: [0.75, 0.05, 0.4], topSpeed: 172, cornerGrip: 9.2, braking: 8.2, lookAhead: 7, car: 'Nissan Skyline GT-R R32', glb: 'skyline-r32', bio: 'Une fusée sur les avenues. Freine tard, parfois trop.' },
  { name: 'Daichi Mori', color: [0.85, 0.35, 0.03], topSpeed: 158, cornerGrip: 10.2, braking: 8.8, lookAhead: 6, car: 'Toyota GR Supra', glb: 'gr-supra', bio: 'Freinages impeccables, sorties de virage musclées.' },
  { name: 'Yui Hasegawa', color: [0.55, 0.6, 0.65], topSpeed: 164, cornerGrip: 9.6, braking: 8, lookAhead: 6.5, car: 'Nissan Fairlady Z', glb: 'fairlady-z', bio: 'Discrète, toujours dans le bon wagon à l’arrivée.' },
  { name: 'Sora Ishikawa', color: [0.3, 0.08, 0.6], topSpeed: 150, cornerGrip: 9.0, braking: 7.6, lookAhead: 7, car: 'Datsun 280Z', glb: 'datsun-280z', bio: 'Débute sur le circuit. Parfait pour se faire la main.' },
  { name: 'Takumi Endo', color: [0.75, 0.75, 0.72], topSpeed: 170, cornerGrip: 10.8, braking: 8.6, lookAhead: 6, car: 'Toyota AE86', glb: 'ae86', bio: 'Légende des cols de montagne. Redoutable en virage.' },
];

/** Tracés de la banque : mêmes graines = mêmes tracés à chaque partie. */
export const TRACK_BANK: { name: string; seed: number; circuit: boolean }[] = [
  { name: 'Sprint de Shibuya', seed: 1101, circuit: false },
  { name: 'Traversée de Shinjuku', seed: 2203, circuit: false },
  { name: 'Les néons d’Akihabara', seed: 3307, circuit: false },
  { name: 'Ruelles de Golden Gai', seed: 4409, circuit: false },
  { name: 'Grande avenue de Ginza', seed: 5501, circuit: false },
  { name: 'Diagonale de Roppongi', seed: 6607, circuit: false },
  { name: 'Nuit sur Ueno', seed: 7703, circuit: false },
  { name: 'Descente d’Ikebukuro', seed: 8809, circuit: false },
  { name: 'Boucle d’Asakusa', seed: 9101, circuit: true },
  { name: 'Anneau de Harajuku', seed: 9203, circuit: true },
  { name: 'Circuit d’Odaiba', seed: 9307, circuit: true },
  { name: 'Tour de Nakano', seed: 9401, circuit: true },
];

/** Objets à ramasser sur le parcours. */
export const PICKUPS = {
  /** Une mallette d'argent tous les… (m). */
  cashSpacing: 380,
  /** Valeur d'une mallette : base + par niveau (¥). */
  cashBase: 250,
  cashPerLevel: 30,
  /** Chance qu'un téléporteur soit présent sur un tracé (rare). */
  teleporterChance: 0.4,
  /** Le téléporteur place devant la voiture qui précède, au plus à cette distance (m). */
  teleporterMax: 100,
  /** Rayon de ramassage (m). */
  radius: 3.4,
} as const;

/** Effet élastique : les adversaires ralentissent un peu s'ils sont loin devant, accélèrent s'ils sont loin derrière. */
export const RUBBER_BAND = { distance: 160, maxBoost: 0.1, maxSlow: 0.12 } as const;
