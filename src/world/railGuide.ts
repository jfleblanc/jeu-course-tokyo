import type { Highway, HighwaySample } from './cityGen';

/** Ce que le rail a besoin de connaître d'une voiture (pas de dépendance au moteur physique ici). */
export interface RailCar {
  x: number; y: number; z: number;
  /** Avant de la voiture (unitaire, à plat) et demi-dimensions de la caisse. */
  fx: number; fz: number; halfWidth: number; halfLength: number;
  vx: number; vz: number;
}

/** Réponse : variation de vitesse à appliquer au centre de la voiture, et variation de lacet (rad/s). */
export interface RailPush { dvx: number; dvz: number; dyaw: number; touching: boolean }

const CELL = 14;
export const RAIL = {
  /** La caisse est retenue à cette distance de la glissière (m). */
  margin: 0.04,
  /** Raideur du rappel (1/s²) : 0,1 m d'enfoncement → raideur × 0,1 m/s² vers la route. */
  stiffness: 140,
  /** Part de la vitesse vers le mur annulée à chaque pas (1 = tout : aucun rebond). */
  absorb: 1,
  /** Au-delà de cet enfoncement (m), la voiture est considérée sortie (ouverture, saut) : on ne la rappelle plus. */
  maxDepth: 0.9,
  /** Part du couple de redressement appliquée (la voiture se met parallèle au mur). */
  align: 0.5,
  /** Écart de hauteur toléré entre la voiture et la chaussée (m). */
  heightBand: 2.2,
};

/**
 * Glissières « douces ». Les routes à glissières (autoroutes, ponts, col) sont connues par leur
 * axe : plutôt que de laisser la caisse cogner un obstacle physique — ce qui la fait sauter ou
 * s'accrocher, même contre un mur lisse —, on la retient par le calcul juste avant le contact :
 * la vitesse vers le mur est annulée, la vitesse le long du mur est gardée. Les obstacles
 * physiques restent derrière, en secours.
 */
export class RailGuide {
  private readonly roads: Highway[] = [];
  private readonly grid = new Map<number, number[]>();

  add(hw: Highway): void {
    const r = this.roads.length;
    this.roads.push(hw);
    hw.samples.forEach((s, k) => {
      const key = Math.floor(s.x / CELL) * 100003 + Math.floor(s.z / CELL);
      const cell = this.grid.get(key);
      const id = r * 100000 + k;
      if (cell) cell.push(id); else this.grid.set(key, [id]);
    });
  }

  private static inGap(hw: Highway, side: number, k: number): boolean {
    const n = hw.samples.length;
    for (const g of hw.gaps) {
      if (g.side !== side) continue;
      const rel = (((k - g.from) % n) + n) % n;
      if (rel <= g.to - g.from) return true;
    }
    return false;
  }

  /** Calcule la poussée pour une voiture pendant un pas `dt` ; renvoie `out` (réutilisé). */
  push(c: RailCar, dt: number, out: RailPush): RailPush {
    out.dvx = 0; out.dvz = 0; out.dyaw = 0; out.touching = false;
    // Échantillon de route le plus proche, à la bonne hauteur.
    let best: HighwaySample | null = null, bestRoad: Highway | null = null, bestK = 0, bd = 20 * 20;
    const ci = Math.floor(c.x / CELL), cj = Math.floor(c.z / CELL);
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
      const cell = this.grid.get(i * 100003 + j);
      if (!cell) continue;
      for (const id of cell) {
        const hw = this.roads[Math.floor(id / 100000)] as Highway;
        const s = hw.samples[id % 100000] as HighwaySample;
        if (Math.abs(c.y - 0.58 - s.y) > RAIL.heightBand) continue;
        const d = (s.x - c.x) * (s.x - c.x) + (s.z - c.z) * (s.z - c.z);
        if (d < bd) { bd = d; best = s; bestRoad = hw; bestK = id % 100000; }
      }
    }
    if (!best || !bestRoad) return out;
    const hw = bestRoad;
    // Au-delà du bout d'une route ouverte, plus de glissière.
    const along = (c.x - best.x) * best.tx + (c.z - best.z) * best.tz;
    if (!hw.closed && ((bestK === 0 && along < 0) || (bestK === hw.samples.length - 1 && along > 0))) return out;
    const limit = hw.halfWidth - RAIL.margin;
    const lx = -best.tz, lz = best.tx; // côté +1
    for (const side of [1, -1]) {
      if (RailGuide.inGap(hw, side, bestK)) continue;
      // Coin de la caisse le plus enfoncé de ce côté.
      let depth = 0, rx = 0, rz = 0;
      for (const a of [1, -1]) for (const b of [1, -1]) {
        const ox = c.fx * c.halfLength * a + c.fz * c.halfWidth * b, oz = c.fz * c.halfLength * a - c.fx * c.halfWidth * b;
        const lat = ((c.x + ox - best.x) * lx + (c.z + oz - best.z) * lz) * side;
        if (lat - limit > depth) { depth = lat - limit; rx = ox; rz = oz; }
      }
      if (depth <= 0 || depth > RAIL.maxDepth) continue;
      out.touching = true;
      const nx = -lx * side, nz = -lz * side; // vers la route
      const vOut = -(c.vx * nx + c.vz * nz); // vitesse vers le mur
      const dv = Math.max(0, vOut) * RAIL.absorb + RAIL.stiffness * depth * dt;
      out.dvx += nx * dv; out.dvz += nz * dv;
      // Couple autour de la verticale : le coin touché est repoussé, la voiture se met parallèle.
      out.dyaw += (rz * nx - rx * nz) * dv * RAIL.align / (c.halfLength * c.halfLength);
    }
    return out;
  }
}

let current: RailGuide | null = null;
/** Glissières douces de la ville en cours (posées par buildCityColliders). */
export const setRailGuide = (g: RailGuide | null): void => { current = g; };
export const railGuide = (): RailGuide | null => current;
