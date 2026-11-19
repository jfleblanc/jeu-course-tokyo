/** Réglages des courses (phase 2). */
export const RACE = {
  /** Masse des adversaires par rapport à leur modèle (moins de 1 = plus faciles à pousser). */
  aiMassFactor: 0.75,
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
/**
 * `district` : secteur du tracé (absent = ville principale ; 0 = baie, 1 = docks, 2 = collines).
 * `col` : la route du col de montagne, dans un sens (1) ou dans l'autre (−1).
 */
/** `via` : grande course qui enchaîne des liaisons entre quartiers (noms dans `WORLD.links`), dans cet ordre. */
export const TRACK_BANK: { name: string; seed: number; circuit: boolean; district?: number; col?: 1 | -1; via?: string[] }[] = [
  { name: 'Tour de la région : des Docks à la Baie', seed: 9101, circuit: false, via: ['Pont du port', 'Tunnel de la baie'] },
  { name: 'Tour de la région : de la Baie aux Docks', seed: 9203, circuit: false, via: ['Tunnel de la baie', 'Pont du port'] },
  // (« < » devant un nom : la route est prise à l'envers)
  { name: 'Grand tour de Hakone : pont, col, tunnel', seed: 9311, circuit: false, via: ['Pont du port', 'Col de Hakone', 'Tunnel de la baie'] },
  { name: 'Grand tour de Hakone : tunnel, col, pont', seed: 9413, circuit: false, via: ['Tunnel de la baie', '<Col de Hakone', 'Pont du port'] },
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
  // Baie de Yokohama
  { name: 'Front de mer de Yokohama', seed: 11003, circuit: false, district: 0 },
  { name: 'Promenade des palmiers', seed: 11107, circuit: false, district: 0 },
  { name: 'Tour de la grande roue', seed: 11201, circuit: true, district: 0 },
  // Docks de Kawasaki
  { name: 'Sprint des conteneurs', seed: 21001, circuit: false, district: 1 },
  { name: 'Quai numéro 9', seed: 21107, circuit: false, district: 1 },
  { name: 'Boucle des entrepôts', seed: 21203, circuit: true, district: 1 },
  // Collines de Hakone
  { name: 'Route des cèdres', seed: 31001, circuit: false, district: 2 },
  { name: 'Tour du village', seed: 31103, circuit: true, district: 2 },
  { name: 'Col de Hakone', seed: 31201, circuit: false, district: 2, col: 1 },
  { name: 'Col de Hakone, versant est', seed: 31207, circuit: false, district: 2, col: -1 },
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

/**
 * Adversaires à la hauteur de la voiture du joueur : avec une voiture plus puissante ou qui tient
 * mieux la route que la voiture de départ, ils reçoivent une part de cet avantage. 1 = ils
 * suivent entièrement, 0 = ils restent des débutants quoi qu'on conduise.
 */
export const CAR_MATCH = { power: 0.9, grip: 0.85, topSpeed: 0.3 } as const;

/**
 * Départ : pendant le décompte on peut faire monter le moteur. Au « GO », si le régime est dans
 * la bonne plage (part du régime maxi), départ canon ; au-dessus, les roues patinent.
 */
export const LAUNCH = {
  low: 0.58,
  high: 0.86,
  /** Départ canon : puissance multipliée pendant `seconds`, plus un élan immédiat (m/s). */
  boost: 1.35,
  seconds: 1.8,
  kick: 3,
  /** Trop de régime : puissance réduite pendant `spinSeconds`. */
  spin: 0.55,
  spinSeconds: 0.9,
} as const;

/** Effet élastique : les adversaires ralentissent un peu s'ils sont loin devant, accélèrent s'ils sont loin derrière. */
export const RUBBER_BAND = { distance: 160, maxBoost: 0.1, maxSlow: 0.12 } as const;

/**
 * Pilotes agressifs (course du col) : ils roulent plus fort, ne lâchent pas le joueur quand ils
 * sont derrière, et lui ferment la porte quand ils sont devant.
 */
export const AGGRESSIVE = {
  /** Rythme en plus, tout le temps (0,1 = 10 %). */
  pace: 0.1,
  /** Rythme en plus quand ils sont loin derrière le joueur. */
  chase: 0.38,
  /** Puissance moteur en plus : de base, et en plus quand ils sont derrière. */
  power: 0.25,
  chasePower: 0.9,
  /** Adhérence et freinage en plus quand ils sont derrière (0,4 = 40 %) : ils passent les virages plus fort que le joueur ne les voit faire devant lui. */
  chaseGrip: 0.55,
  /** Distance derrière le joueur (m) à laquelle ils donnent tout pour revenir. */
  chaseDistance: 28,
  /** Ils barrent la route au joueur quand il est à moins de cette distance derrière eux (m). */
  blockRange: 32,
  /** Vitesse à laquelle ils se décalent pour barrer (m/s). */
  blockRate: 4.5,
} as const;

/**
 * Épreuves (touche Y) : contre-la-montre, drift noté, poursuite. Seul sur le tracé, sauf la
 * poursuite où il faut rattraper un fuyard. Le résultat est une médaille (or = 1re place).
 */
export const EVENTS = {
  chrono: {
    /** Temps des médailles, par rapport au temps estimé d'un bon pilote adverse sur ce tracé. */
    gold: 1.0, silver: 1.08, bronze: 1.18,
    /** Accélération moyenne prise pour estimer ce temps (m/s²). */
    accel: 4.2,
    /** Correction de l'estimation (mesurée contre de vraies courses simulées). */
    fudge: 0.96,
  },
  drift: {
    /** Points par kilomètre de tracé pour chaque médaille. */
    gold: 1500, silver: 950, bronze: 500,
    /** Glisse minimale (rad) et vitesse minimale (m/s) pour marquer. */
    minSlip: 0.2, minSpeed: 9,
    /** Points par seconde = angle (°, plafonné) × vitesse (m/s) × `rate` × combo. */
    maxAngle: 50, rate: 0.1,
    /** Le combo monte de `comboRate` par seconde de glisse continue, jusqu'à `comboMax`. */
    comboRate: 0.25, comboMax: 3,
    /** Glisse interrompue plus longtemps que ça (s) : le combo retombe à 1. */
    grace: 0.9,
    /** Choc (vitesse perdue d'un coup, m/s) : le combo retombe à 1. */
    crash: 4.5,
  },
  pursuit: {
    /** Avance du fuyard au départ (m) et son niveau par rapport aux adversaires habituels. */
headStart: 60, difficulty: 1.04,
    /** Quand le joueur est à moins de `fleeRange` m derrière, le fuyard gagne de l'adhérence (`flee`, part de AGGRESSIVE.chaseGrip) et de la puissance. */
    fleeRange: 50, flee: 0.65, fleePower: 0.45,
    /** Rattrapé : rester à moins de `distance` m pendant `hold` secondes. */
    distance: 9, hold: 2,
    /** Échappé de peu (écart à l'arrivée en m) : médaille de bronze. */
    close: 40,
  },
} as const;
