/**
 * Voitures et améliorations (phase 3). Les chiffres « power », « grip », « brake » multiplient
 * le réglage de conduite choisi dans le panneau A/B : la sensation reste la même, la voiture
 * est simplement plus ou moins performante.
 */
export interface CarModel {
  id: string;
  name: string;
  /** Prix au concessionnaire (¥). 0 = voiture de départ. */
  price: number;
  /** Valeur comptée à la revente pour la voiture de départ (¥). */
  baseValue: number;
  power: number;
  grip: number;
  brake: number;
  /** Couleur de série (linéaire). */
  color: readonly [number, number, number];
  bigWing: boolean;
  blurb: string;
}

export const CAR_MODELS: CarModel[] = [
  {
    id: 'ae86',
    name: 'Toyota Sprinter Trueno AE86',
    price: 0,
    baseValue: 6000,
    power: 1.0,
    grip: 1.0,
    brake: 1.0,
    color: [0.72, 0.035, 0.05],
    bigWing: false,
    blurb: 'Légère et joueuse. Votre première voiture.',
  },
  {
    id: 'r34',
    name: 'Nissan Skyline GT-R R34',
    price: 42000,
    baseValue: 42000,
    power: 1.22,
    grip: 1.06,
    brake: 1.1,
    color: [0.02, 0.1, 0.55],
    bigWing: true,
    blurb: 'Plus puissante, plus d’adhérence, de meilleurs freins.',
  },
];

export type UpgradeId = 'engine' | 'tires' | 'weight';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  what: string;
  /** Prix de chaque niveau (¥). */
  prices: number[];
}

/** Améliorations de performance, par niveaux. */
export const UPGRADES: UpgradeDef[] = [
  { id: 'engine', name: 'Moteur', what: '+7 % de puissance par niveau', prices: [4000, 8000, 14000] },
  { id: 'tires', name: 'Pneus', what: '+4 % d’adhérence par niveau', prices: [3000, 6000, 10000] },
  { id: 'weight', name: 'Carrosserie carbone', what: 'Plus légère : +4 % d’accélération et de freinage par niveau', prices: [5000, 9000] },
];

export const UPGRADE_EFFECT = { engine: 0.07, tires: 0.04, weight: 0.04 } as const;

export const NOS = {
  price: 7000,
  /** Secondes de NOS disponibles par course. */
  seconds: 6,
  /** Surcroît de puissance pendant le NOS. */
  boost: 1.4,
  /** Recharge en balade libre (secondes de NOS par seconde). */
  refill: 0.5,
} as const;

export const NEON_PRICE = 2500;
export const PAINT_PRICE = 500;
export const MAX_CARS = 5;
/** Revente : part du prix d'achat et des améliorations récupérée. */
export const RESALE = 0.5;

export const PAINTS: { name: string; color: readonly [number, number, number] }[] = [
  { name: 'Rouge', color: [0.72, 0.035, 0.05] },
  { name: 'Bleu nuit', color: [0.02, 0.1, 0.55] },
  { name: 'Blanc perle', color: [0.8, 0.8, 0.78] },
  { name: 'Noir', color: [0.02, 0.02, 0.025] },
  { name: 'Jaune', color: [0.9, 0.65, 0.02] },
  { name: 'Vert menthe', color: [0.05, 0.6, 0.35] },
  { name: 'Violet', color: [0.3, 0.05, 0.6] },
  { name: 'Orange', color: [0.95, 0.3, 0.02] },
];

export const NEON_COLORS: { name: string; color: readonly [number, number, number] }[] = [
  { name: 'Cyan', color: [0.05, 0.8, 1.0] },
  { name: 'Magenta', color: [1.0, 0.08, 0.55] },
  { name: 'Violet', color: [0.5, 0.15, 1.0] },
  { name: 'Vert', color: [0.1, 1.0, 0.4] },
];
