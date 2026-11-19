/**
 * Le garage du joueur : un atelier au sous-sol d'un immeuble de la ville, relié à la rue par une
 * rampe. Ce fichier ne contient que la géométrie (dimensions, repère) : la ville s'en sert pour
 * réserver la place et trouer le sol, les collisions et l'affichage pour le construire.
 *
 * Repère local : origine au centre de l'atelier, au niveau de la rue ; +z vers la rue ; l'atelier
 * est sous l'immeuble, la rampe longe son côté +x et débouche dans la rue.
 */
export interface GarageSite {
  x: number;
  z: number;
  /** Angle du repère local (même convention que rotation.y de three.js). */
  yaw: number;
}

export const GARAGE = {
  /** Altitude du sol de l'atelier (m). */
  floor: -4.6,
  /** Atelier : demi-largeur (x) et demi-profondeur (z), hauteur sous plafond. */
  halfW: 13,
  halfD: 8.5,
  height: 4.25,
  /** Épaisseur des murs. */
  wall: 0.3,
  /** Porte de l'atelier, sur le mur +x : de doorZ0 à doorZ1. */
  doorZ0: -2.2,
  doorZ1: 5.2,
  /** Palier en bas de la rampe et rampe : de rampX0 à rampX1 ; le palier va de landingZ0 à rampZ0, la rampe de rampZ0 (en bas) à rampZ1 (dans la rue). */
  rampX0: 13.3,
  rampX1: 19.6,
  landingZ0: -3.4,
  rampZ0: 6,
  rampZ1: 32,
  /** Hauteur de l'immeuble au-dessus. */
  buildingHeight: 15,
  /** Place de la voiture du joueur (au milieu, nez vers la porte) et places le long du mur du fond. */
  mainBay: { x: -5, z: 0, yaw: Math.PI / 2 },
  bays: [-0.2, 3.7, 7.6, 11.3].map((x) => ({ x, z: -5.6, yaw: 0 })),
} as const;

/** Rectangles troués dans le sol (repère local) : l'atelier, puis le palier et la rampe. */
/** Accessoires fixes de l'atelier (étagères, piles de pneus, fûts) : emprise au sol x0, z0, x1, z1 et hauteur. */
export const GARAGE_FIXTURES: readonly (readonly [number, number, number, number, number])[] = [
  [-11.5, -8.5, -7.7, -7.75, 3.2],
  [10.2, 7.0, 12.3, 8.5, 1.1],
  [-12.6, 7.0, -10.5, 8.5, 1.3],
  [3.9, 7.2, 6.7, 8.5, 0.9],
];

export const GARAGE_HOLES = [
  { x0: -GARAGE.halfW - GARAGE.wall, x1: GARAGE.halfW + GARAGE.wall, z0: -GARAGE.halfD - GARAGE.wall, z1: GARAGE.halfD + GARAGE.wall },
  { x0: GARAGE.rampX0, x1: GARAGE.rampX1, z0: GARAGE.landingZ0, z1: GARAGE.rampZ1 },
] as const;

/** Emprise totale (repère local). */
export const GARAGE_BOUNDS = { x0: GARAGE_HOLES[0].x0, x1: GARAGE.rampX1, z0: GARAGE_HOLES[0].z0, z1: GARAGE.rampZ1 } as const;

/** Repère local → monde. */
export function garageToWorld(s: GarageSite, lx: number, lz: number): [number, number] {
  const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
  return [s.x + lx * c + lz * sn, s.z - lx * sn + lz * c];
}

/** Monde → repère local. */
export function garageToLocal(s: GarageSite, x: number, z: number): [number, number] {
  const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
  const dx = x - s.x, dz = z - s.z;
  return [dx * c - dz * sn, dx * sn + dz * c];
}

/** Vrai si ce point (repère local) est au-dessus d'un trou : l'atelier ou la rampe. */
export function inGarageHole(lx: number, lz: number, margin = 0): boolean {
  return GARAGE_HOLES.some((h) => lx > h.x0 - margin && lx < h.x1 + margin && lz > h.z0 - margin && lz < h.z1 + margin);
}

/** Altitude de la chaussée dans le garage en ce point local, ou null si on est dehors. */
export function garageFloorAt(lx: number, lz: number): number | null {
  const h0 = GARAGE_HOLES[0];
  if (lx > h0.x0 && lx < h0.x1 && lz > h0.z0 && lz < h0.z1) return GARAGE.floor;
  if (lx >= GARAGE.rampX0 && lx <= GARAGE.rampX1 && lz >= GARAGE.landingZ0 && lz <= GARAGE.rampZ1) {
    return lz <= GARAGE.rampZ0 ? GARAGE.floor : GARAGE.floor * (1 - (lz - GARAGE.rampZ0) / (GARAGE.rampZ1 - GARAGE.rampZ0));
  }
  return null;
}
