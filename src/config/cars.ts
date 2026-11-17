import type { CarTraits } from './handling';
/**
 * Voitures et améliorations (phase 3). Les chiffres « power », « grip », « brake » multiplient
 * le réglage de conduite choisi dans le panneau A/B : la sensation reste la même, la voiture
 * est simplement plus ou moins performante.
 */
/** Bruit du moteur d'une voiture. */
export interface EngineSound {
  /** Nombre de cylindres : fixe la hauteur du son à un régime donné. */
  cylinders: number;
  /** Multiplie la hauteur (1 = normale ; le rotatif chante très haut, le diesel gronde). */
  pitch: number;
  /** 0 = sourd, 1 = brillant. */
  bright: number;
  /** 0 = lisse, 1 = rauque. */
  rough: number;
  /** 0 = pas de turbo, 1 = sifflement marqué. */
  turbo: number;
}

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
  /** Modèle 3D (fichier `public/models/<glb>.glb`) ; null = voiture procédurale. */
  glb: string | null;
  /** Moteur, en clair (affiché au garage). */
  engine: string;
  /** Caractère du bruit du moteur (voir audio/sfx.ts). */
  sound: EngineSound;
  /** Transmission, en clair (affichée au garage). */
  drive: string;
  /** Masse, roues motrices, empattement, voies, centre de masse. */
  traits: CarTraits;
  /** Faux si la carrosserie porte une livrée fixe (pas de changement de peinture). */
  paintable: boolean;
  blurb: string;
}

export const CAR_MODELS: CarModel[] = [
  { id: 'ae86', name: 'Toyota Sprinter Trueno AE86', price: 0, baseValue: 6000, power: 1.0, grip: 1.0, brake: 1.0, color: [0.75, 0.75, 0.72], bigWing: false, glb: 'ae86', paintable: true, drive: 'Propulsion', traits: { mass: 1260, driveFront: 0, axleFrontZ: 1.194, axleRearZ: -1.194, halfTrackFront: 0.712, halfTrackRear: 0.712, comY: -0.22, comZ: 0.06 }, engine: '4 cylindres', sound: { cylinders: 4, pitch: 1.0, bright: 0.55, rough: 0.35, turbo: 0 }, blurb: 'Légère et joueuse. Votre première voiture.' },
  { id: 'kansai', name: 'Kansai Spirit 3.0 TDI', price: 9000, baseValue: 9000, power: 0.62, grip: 0.93, brake: 0.92, color: [0.8, 0.6, 0.1], bigWing: false, glb: 'kansai-spirit', paintable: false, drive: 'Propulsion', traits: { mass: 3300, driveFront: 0, axleFrontZ: 1.134, axleRearZ: -1.134, halfTrackFront: 0.877, halfTrackRear: 0.877, comY: -0.06, comZ: 0.05 }, engine: 'diesel', sound: { cylinders: 4, pitch: 0.6, bright: 0.22, rough: 0.85, turbo: 0.25 }, blurb: 'Un van de livraison décoré. Lent et lourd : il pousse tout le monde.' },
  { id: 'integra', name: 'Honda Integra Type R (DC2)', price: 14000, baseValue: 14000, power: 1.06, grip: 1.03, brake: 1.04, color: [0.02, 0.19, 0.65], bigWing: false, glb: 'integra-dc2', paintable: true, drive: 'Traction', traits: { mass: 1450, driveFront: 1, axleFrontZ: 1.276, axleRearZ: -1.276, halfTrackFront: 0.716, halfTrackRear: 0.716, comY: -0.22, comZ: 0.22 }, engine: '4 cylindres VTEC', sound: { cylinders: 4, pitch: 1.12, bright: 0.75, rough: 0.3, turbo: 0 }, blurb: 'Vive et précise, facile à placer.' },
  { id: 'fairlady', name: 'Nissan Fairlady Z (S30)', price: 16000, baseValue: 16000, power: 1.07, grip: 1.0, brake: 1.0, color: [0.35, 0.0, 0.0], bigWing: false, glb: 'fairlady-z', paintable: true, drive: 'Propulsion', traits: { mass: 1380, driveFront: 0, axleFrontZ: 1.186, axleRearZ: -1.186, halfTrackFront: 0.753, halfTrackRear: 0.751, comY: -0.23, comZ: 0.02 }, engine: '6 cylindres en ligne', sound: { cylinders: 6, pitch: 0.92, bright: 0.5, rough: 0.4, turbo: 0 }, blurb: 'Le coupé classique des années 70.' },
  { id: 'datsun240k', name: 'Datsun 240K GT (1972)', price: 18000, baseValue: 18000, power: 1.08, grip: 1.0, brake: 1.02, color: [0.2, 0.1, 0.03], bigWing: false, glb: 'datsun-240k', paintable: true, drive: 'Propulsion', traits: { mass: 1520, driveFront: 0, axleFrontZ: 1.323, axleRearZ: -1.323, halfTrackFront: 0.711, halfTrackRear: 0.717, comY: -0.2, comZ: 0.08 }, engine: '6 cylindres en ligne', sound: { cylinders: 6, pitch: 0.9, bright: 0.5, rough: 0.45, turbo: 0 }, blurb: 'Fastback au caractère bien trempé.' },
  { id: 'hakosuka', name: 'Nissan Skyline 2000 GT-R (1971)', price: 24000, baseValue: 24000, power: 1.11, grip: 1.02, brake: 1.03, color: [0.75, 0.4, 0.03], bigWing: false, glb: 'skyline-2000gtr', paintable: true, drive: 'Propulsion', traits: { mass: 1450, driveFront: 0, axleFrontZ: 1.289, axleRearZ: -1.289, halfTrackFront: 0.66, halfTrackRear: 0.66, comY: -0.2, comZ: 0.08 }, engine: '6 cylindres en ligne', sound: { cylinders: 6, pitch: 0.95, bright: 0.6, rough: 0.5, turbo: 0 }, blurb: 'La « Hakosuka », première GT-R.' },
  { id: 'datsun280z', name: 'Datsun 280Z (kit large)', price: 30000, baseValue: 30000, power: 1.14, grip: 1.05, brake: 1.06, color: [0.79, 0.34, 0.012], bigWing: false, glb: 'datsun-280z', paintable: true, drive: 'Propulsion', traits: { mass: 1720, driveFront: 0, axleFrontZ: 1.178, axleRearZ: -1.178, halfTrackFront: 0.763, halfTrackRear: 0.764, comY: -0.24, comZ: 0.02 }, engine: '6 cylindres en ligne', sound: { cylinders: 6, pitch: 0.9, bright: 0.55, rough: 0.55, turbo: 0 }, blurb: 'Ailes élargies et gros pneus : collée à la route.' },
  { id: 'r32', name: 'Nissan Skyline GT-R (R32)', price: 36000, baseValue: 36000, power: 1.18, grip: 1.06, brake: 1.08, color: [0.42, 0.0, 0.0], bigWing: false, glb: 'skyline-r32', paintable: true, drive: 'Intégrale', traits: { mass: 1890, driveFront: 0.3, axleFrontZ: 1.307, axleRearZ: -1.307, halfTrackFront: 0.741, halfTrackRear: 0.741, comY: -0.22, comZ: 0.12 }, engine: '6 cylindres biturbo', sound: { cylinders: 6, pitch: 0.95, bright: 0.6, rough: 0.4, turbo: 0.6 }, blurb: '« Godzilla » : puissante et sûre.' },
  { id: 'r34', name: 'Nissan Skyline GT-R R34', price: 42000, baseValue: 42000, power: 1.22, grip: 1.06, brake: 1.1, color: [0.0, 0.06, 0.56], bigWing: false, glb: 'skyline-r34', paintable: true, drive: 'Intégrale', traits: { mass: 2060, driveFront: 0.3, axleFrontZ: 1.33, axleRearZ: -1.33, halfTrackFront: 0.709, halfTrackRear: 0.709, comY: -0.22, comZ: 0.12 }, engine: '6 cylindres biturbo', sound: { cylinders: 6, pitch: 0.95, bright: 0.62, rough: 0.4, turbo: 0.7 }, blurb: 'Plus puissante, plus d’adhérence, de meilleurs freins.' },
  { id: 'rx7', name: 'Mazda RX-7', price: 48000, baseValue: 48000, power: 1.24, grip: 1.09, brake: 1.1, color: [0.02, 0.02, 0.025], bigWing: false, glb: 'rx7', paintable: true, drive: 'Propulsion', traits: { mass: 1690, driveFront: 0, axleFrontZ: 1.208, axleRearZ: -1.208, halfTrackFront: 0.728, halfTrackRear: 0.778, comY: -0.25, comZ: 0.0 }, engine: 'rotatif biturbo', sound: { cylinders: 2, pitch: 2.6, bright: 0.85, rough: 0.2, turbo: 0.5 }, blurb: 'Moteur rotatif, châssis affûté.' },
  { id: 'grsupra', name: 'Toyota GR Supra', price: 65000, baseValue: 65000, power: 1.3, grip: 1.1, brake: 1.14, color: [0.54, 0.014, 0.014], bigWing: false, glb: 'gr-supra', paintable: true, drive: 'Propulsion', traits: { mass: 1980, driveFront: 0, axleFrontZ: 1.233, axleRearZ: -1.233, halfTrackFront: 0.786, halfTrackRear: 0.799, comY: -0.24, comZ: 0.02 }, engine: '6 cylindres turbo', sound: { cylinders: 6, pitch: 0.9, bright: 0.6, rough: 0.35, turbo: 0.6 }, blurb: 'Moderne et très rapide.' },
  { id: 'caspita', name: 'Jiotto Caspita (1989)', price: 120000, baseValue: 120000, power: 1.42, grip: 1.16, brake: 1.2, color: [0.55, 0.55, 0.55], bigWing: false, glb: 'caspita', paintable: true, drive: 'Propulsion, moteur central', traits: { mass: 1640, driveFront: 0, axleFrontZ: 1.337, axleRearZ: -1.337, halfTrackFront: 0.869, halfTrackRear: 0.808, comY: -0.28, comZ: -0.14 }, engine: '12 cylindres à plat', sound: { cylinders: 12, pitch: 0.8, bright: 0.9, rough: 0.15, turbo: 0 }, blurb: 'Supercar japonaise rarissime à moteur de F1.' },
  { id: 'gt300', name: 'Toyota GR Supra GT300', price: 160000, baseValue: 160000, power: 1.5, grip: 1.22, brake: 1.28, color: [0.8, 0.8, 0.8], bigWing: false, glb: 'supra-gt300', paintable: false, drive: 'Propulsion', traits: { mass: 1650, driveFront: 0, axleFrontZ: 1.351, axleRearZ: -1.351, halfTrackFront: 0.859, halfTrackRear: 0.859, comY: -0.3, comZ: 0.0 }, engine: 'V8 de course', sound: { cylinders: 8, pitch: 0.95, bright: 0.8, rough: 0.6, turbo: 0 }, blurb: 'Voiture de course : le sommet.' },
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
