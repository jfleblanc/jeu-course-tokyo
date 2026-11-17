/**
 * Réglages de conduite — tout ce qui se règle dans le panneau A/B (touche F1).
 * Chaque valeur a un curseur. Pour adopter un réglage trouvé en jouant :
 * « Exporter JSON » dans le panneau, puis coller les valeurs dans PRESET_A ou PRESET_B.
 * Historique des réglages retenus : voir handling-history.md.
 */
export interface HandlingConfig {
  // ——— Moteur ———
  /** Multiplicateur du couple moteur (1 = voiture de série). */
  enginePower: number;
  /** Frein moteur quand on relâche l'accélérateur (0 = roue libre). */
  engineBrake: number;

  // ——— Adhérence ———
  /** Adhérence latérale des pneus avant (μ). */
  gripFront: number;
  /** Adhérence latérale des pneus arrière (μ). */
  gripRear: number;
  /** Adhérence en accélération / freinage (μ). */
  gripLong: number;
  /** Angle de dérive (°) où le pneu donne son maximum. Petit = vif, grand = progressif. */
  peakSlipDeg: number;
  /** Part d'adhérence conservée une fois que le pneu glisse (1 = ne décroche jamais vraiment). */
  slideGrip: number;
  /** Antipatinage : 0 = aucun (l'arrière part à l'accélération), 1 = très présent. */
  tractionControl: number;

  // ——— Châssis ———
  /** Transfert de poids : 0 = voiture « plate », 1 = plonge au freinage et s'écrase en virage. */
  weightTransfer: number;
  /** Raideur de suspension (N/m par roue). */
  suspStiffness: number;
  /** Amortissement de suspension (N·s/m par roue). */
  suspDamping: number;
  /** Barre antiroulis (N/m). */
  antiRoll: number;
  /** Appui aérodynamique (N par (m/s)²). */
  downforce: number;

  // ——— Direction ———
  /** Angle de braquage maximal à basse vitesse (°). */
  steerMaxDeg: number;
  /** Angle de braquage maximal à haute vitesse (°). */
  steerMinDeg: number;
  /** Vitesse (km/h) à laquelle le braquage atteint son minimum. */
  steerSpeedRef: number;
  /** Rapidité du volant au clavier / stick (plus grand = plus direct). */
  steerRate: number;

  // ——— Aides à la conduite ———
  /** Amortissement du lacet : calme les tête-à-queue (0 = aucune aide). */
  yawDamping: number;
  /** Aide au contre-braquage : la voiture contre-braque en partie toute seule. */
  counterSteer: number;

  // ——— Drift (espace) ———
  /** Adhérence arrière pendant le drift (fraction de l'adhérence normale). */
  driftRearGrip: number;
  /**
   * Accroche en drift : force qui ramène la trajectoire vers le nez de la voiture pendant la glisse.
   * 0 = plaque de glace (la voiture pivote mais file tout droit), 1 = la voiture « taille » le virage.
   */
  driftCarve: number;
  /** Angle de drift maximal (°) avant que l'aide ne retienne la voiture. */
  driftMaxAngleDeg: number;
  /** Coup de lacet au déclenchement du drift (rad/s). */
  driftKick: number;
  /** Temps (s) pour retrouver l'adhérence en sortie de drift. */
  driftRecovery: number;

  // ——— Freins ———
  /** Force de freinage totale (N). */
  brakeForce: number;
  /** Répartition avant (0.5 = équilibré, 0.7 = surtout l'avant). */
  brakeBias: number;

  // ——— Lissage des commandes (clavier et gâchettes numériques Switch) ———
  /** Temps (s) pour passer de 0 à plein gaz. */
  throttleRise: number;
  /** Temps (s) pour passer de 0 à plein frein. */
  brakeRise: number;
}

/**
 * Préréglage A — base actuelle (choisie par les joueurs le 2026-11-16) :
 * arrière joueur + braquage nerveux. Son drift glisse beaucoup (peu d'accroche).
 */
export const PRESET_A: HandlingConfig = {
  enginePower: 1.0,
  engineBrake: 0.35,

  gripFront: 1.64,
  gripRear: 1.52,
  gripLong: 1.5,
  peakSlipDeg: 7,
  slideGrip: 0.82,
  tractionControl: 0.7,

  weightTransfer: 0.6,
  suspStiffness: 34000,
  suspDamping: 3600,
  antiRoll: 8000,
  downforce: 1.6,

  steerMaxDeg: 32,
  steerMinDeg: 7,
  steerSpeedRef: 170,
  steerRate: 6.5,

  yawDamping: 1.2,
  counterSteer: 0.45,

  driftRearGrip: 0.42,
  driftCarve: 0.3,
  driftMaxAngleDeg: 38,
  driftKick: 0.55,
  driftRecovery: 0.6,

  brakeForce: 21000,
  brakeBias: 0.62,

  throttleRise: 0.22,
  brakeRise: 0.15,
};

/**
 * Préréglage B — « Drift qui accroche ».
 * Identique à A sauf DEUX réglages de drift :
 *   - driftCarve        0.3 → 0.75  (la trajectoire suit le nez : on prend vraiment le virage)
 *   - driftMaxAngleDeg  38  → 32    (angle un peu plus fermé, plus facile à tenir)
 */
export const PRESET_B: HandlingConfig = {
  ...PRESET_A,
  driftCarve: 0.75,
  driftMaxAngleDeg: 32,
};

export interface SliderDef {
  key: keyof HandlingConfig;
  label: string;
  min: number;
  max: number;
  step: number;
  hint: string;
}

export interface SliderGroup {
  title: string;
  sliders: SliderDef[];
}

/** Définition des curseurs du panneau A/B. */
export const HANDLING_SLIDERS: SliderGroup[] = [
  {
    title: 'Adhérence',
    sliders: [
      { key: 'gripFront', label: 'Adhérence avant', min: 0.8, max: 2.6, step: 0.01, hint: 'Plus haut = le nez mord plus en entrée de virage.' },
      { key: 'gripRear', label: 'Adhérence arrière', min: 0.8, max: 2.6, step: 0.01, hint: 'Plus bas = l’arrière glisse plus facilement.' },
      { key: 'gripLong', label: 'Motricité / freinage', min: 0.8, max: 2.6, step: 0.01, hint: 'Adhérence en ligne droite.' },
      { key: 'peakSlipDeg', label: 'Angle de dérive max. (°)', min: 3, max: 16, step: 0.5, hint: 'Petit = réactions vives. Grand = décrochage progressif.' },
      { key: 'slideGrip', label: 'Adhérence en glisse', min: 0.5, max: 1, step: 0.01, hint: 'Ce qu’il reste d’adhérence une fois que ça glisse.' },
      { key: 'tractionControl', label: 'Antipatinage', min: 0, max: 1, step: 0.05, hint: '0 = l’arrière part à l’accélération.' },
    ],
  },
  {
    title: 'Transfert de poids et châssis',
    sliders: [
      { key: 'weightTransfer', label: 'Transfert de poids', min: 0, max: 1, step: 0.01, hint: 'Plus haut = la voiture plonge et s’écrase, plus vivante.' },
      { key: 'suspStiffness', label: 'Raideur suspension', min: 20000, max: 90000, step: 1000, hint: 'Plus haut = plus sec, moins de roulis.' },
      { key: 'suspDamping', label: 'Amortissement', min: 1500, max: 9000, step: 100, hint: 'Plus haut = la caisse bouge moins.' },
      { key: 'antiRoll', label: 'Barre antiroulis', min: 0, max: 40000, step: 500, hint: 'Limite le roulis en virage.' },
      { key: 'downforce', label: 'Appui aéro', min: 0, max: 5, step: 0.1, hint: 'Colle la voiture au sol à haute vitesse.' },
    ],
  },
  {
    title: 'Direction',
    sliders: [
      { key: 'steerMaxDeg', label: 'Braquage basse vitesse (°)', min: 18, max: 45, step: 1, hint: 'Rayon de braquage en ville.' },
      { key: 'steerMinDeg', label: 'Braquage haute vitesse (°)', min: 2, max: 18, step: 0.5, hint: 'Plus bas = plus stable à fond.' },
      { key: 'steerSpeedRef', label: 'Vitesse de référence (km/h)', min: 80, max: 260, step: 5, hint: 'Vitesse où le braquage est au minimum.' },
      { key: 'steerRate', label: 'Rapidité du volant', min: 1.5, max: 10, step: 0.1, hint: 'Clavier/stick : plus haut = plus direct.' },
    ],
  },
  {
    title: 'Aides à la conduite',
    sliders: [
      { key: 'yawDamping', label: 'Stabilité (lacet)', min: 0, max: 6, step: 0.1, hint: 'Calme les tête-à-queue. 0 = aucune aide.' },
      { key: 'counterSteer', label: 'Aide au contre-braquage', min: 0, max: 1, step: 0.05, hint: 'La voiture rattrape en partie la glisse seule.' },
    ],
  },
  {
    title: 'Drift (espace)',
    sliders: [
      { key: 'driftRearGrip', label: 'Adhérence arrière en drift', min: 0.2, max: 0.9, step: 0.01, hint: 'Plus bas = drift plus large et plus long.' },
      { key: 'driftCarve', label: 'Accroche en drift', min: 0, max: 1.2, step: 0.05, hint: '0 = plaque de glace. Plus haut = la voiture suit son nez dans le virage.' },
      { key: 'driftMaxAngleDeg', label: 'Angle de drift max. (°)', min: 15, max: 70, step: 1, hint: 'Au-delà, l’aide retient la voiture.' },
      { key: 'driftKick', label: 'Coup de lacet', min: 0, max: 1.5, step: 0.05, hint: 'Impulsion au déclenchement du drift.' },
      { key: 'driftRecovery', label: 'Sortie de drift (s)', min: 0.1, max: 2, step: 0.05, hint: 'Temps pour retrouver l’adhérence.' },
    ],
  },
  {
    title: 'Moteur et freins',
    sliders: [
      { key: 'enginePower', label: 'Puissance moteur', min: 0.5, max: 2, step: 0.05, hint: '1 = voiture de série.' },
      { key: 'engineBrake', label: 'Frein moteur', min: 0, max: 1, step: 0.05, hint: 'Ralentissement quand on lâche les gaz.' },
      { key: 'brakeForce', label: 'Force de freinage (N)', min: 8000, max: 36000, step: 500, hint: 'Puissance des freins.' },
      { key: 'brakeBias', label: 'Répartition avant', min: 0.4, max: 0.8, step: 0.01, hint: 'Plus bas = l’arrière freine plus (instable).' },
    ],
  },
  {
    title: 'Lissage des commandes',
    sliders: [
      { key: 'throttleRise', label: 'Montée des gaz (s)', min: 0.02, max: 0.8, step: 0.01, hint: 'Gâchettes Switch et clavier sont tout ou rien : on lisse.' },
      { key: 'brakeRise', label: 'Montée du frein (s)', min: 0.02, max: 0.6, step: 0.01, hint: 'Idem pour le frein.' },
    ],
  },
];

/** Caractéristiques fixes de la voiture de départ (pas dans le panneau A/B). */
export const CAR_SPEC = {
  mass: 1350,
  /** Demi-dimensions de la boîte de collision (m). */
  halfExtents: { x: 0.88, y: 0.3, z: 2.12 },
  colliderOffsetY: 0.1,
  /** Centre de masse (repère voiture : x gauche, y haut, z avant). */
  centerOfMass: { x: 0, y: -0.22, z: 0.08 },
  /** Inerties principales (kg·m²) : tangage, lacet, roulis. */
  inertia: { x: 2300, y: 2500, z: 620 },
  wheelRadius: 0.335,
  /** Position des ancrages de roue (repère voiture). */
  axleFrontZ: 1.32,
  axleRearZ: -1.3,
  halfTrack: 0.8,
  mountY: -0.05,
  suspRestLength: 0.3,
  suspMaxTravel: 0.22,
  /** Aérodynamique : 0.5 · ρ · Cx · S. */
  dragCoef: 0.48,
  rollingResistance: 190,
  // Moteur et boîte
  idleRpm: 900,
  redlineRpm: 7400,
  /** Courbe de couple (N·m) par tranche de 1000 tr/min, de 0 à 8000. */
  torqueCurve: [210, 250, 310, 360, 390, 400, 385, 350, 250],
  gearRatios: [3.4, 2.15, 1.55, 1.2, 0.97, 0.8],
  reverseRatio: 3.2,
  finalDrive: 3.7,
  drivetrainEfficiency: 0.9,
  shiftTime: 0.16,
  autoUpshiftRpm: 6700,
  autoDownshiftRpm: 2900,
} as const;

export type CarSpec = typeof CAR_SPEC;
