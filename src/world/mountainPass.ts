import { Rng } from '../core/rng';
import { WORLD } from '../config/world';
import type { HighwaySample } from './cityGen';

/** Relief de la montagne : une grille régulière de hauteurs (m). */
export interface Terrain {
  x0: number;
  z0: number;
  /** Axes de la grille (unitaires) : i avance le long de (ux, uz), j le long de (vx, vz). */
  ux: number; uz: number; vx: number; vz: number;
  cell: number;
  ni: number;
  nj: number;
  /** Hauteurs, rangées par j puis i : heights[j * ni + i]. */
  heights: Float32Array;
}

export interface MountainPass {
  samples: HighwaySample[];
  terrain: Terrain;
  /** Indice de l'échantillon le plus haut (le col). */
  summit: number;
  /** Terre-plein à côté du col, pour le temple. */
  pad: { x: number; y: number; z: number };
}

/** Hauteur du relief en un point (interpolation dans la grille) ; 0 hors de la grille. */
export function terrainHeight(t: Terrain, x: number, z: number): number {
  const dx = x - t.x0, dz = z - t.z0;
  const fi = (dx * t.ux + dz * t.uz) / t.cell, fj = (dx * t.vx + dz * t.vz) / t.cell;
  if (fi < 0 || fj < 0 || fi >= t.ni - 1 || fj >= t.nj - 1) return 0;
  const i = Math.floor(fi), j = Math.floor(fj);
  const a = fi - i, b = fj - j;
  const h = t.heights;
  const h00 = h[j * t.ni + i] as number, h10 = h[j * t.ni + i + 1] as number;
  const h01 = h[(j + 1) * t.ni + i] as number, h11 = h[(j + 1) * t.ni + i + 1] as number;
  // même découpage en deux triangles que le maillage (diagonale 00–11)
  return a > b ? h00 + (h10 - h00) * a + (h11 - h10) * b : h00 + (h11 - h01) * a + (h01 - h00) * b;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Tracé de la route de col, dans le repère de la montagne : u = en travers, v = vers le large
 * (0 = bord extérieur du quartier). Elle monte en lacets côté A, passe le col, redescend côté B.
 * Les points sont ensuite décalés pour partir de A et arriver à B, puis légèrement bousculés.
 */
const LAYOUT: [number, number][] = [
  [-300, 70], [-345, 160], [-385, 265], [-305, 345], [-165, 335], [-85, 405], [-165, 480], [-290, 505],
  [-345, 595], [-255, 668], [-125, 645], [-35, 705],
  [5, 790], // le col
  [75, 850], [185, 812], [235, 705], [155, 632], [62, 566], [108, 474], [228, 452], [332, 384], [352, 272], [272, 192], [300, 110],
];
const SUMMIT_POINT = 12;

/**
 * Construit la route de col et le relief autour.
 * (ax, az) et (bx, bz) : pieds de la route, au bord de deux carrefours du quartier ;
 * (ox, oz) : origine du repère (bord extérieur du quartier), (nx, nz) : direction du large.
 * `outside(x, z)` : distance au quartier (0 dedans) — le relief ne mord pas sur le village.
 */
export function buildMountainPass(seed: number, ax: number, az: number, bx: number, bz: number, ox: number, oz: number, nx: number, nz: number, outside: (x: number, z: number) => number): MountainPass {
  const M = WORLD.mountain;
  const rng = new Rng(seed ^ 0x6d2b79f5);
  const ex = nz, ez = -nx; // axe en travers
  const toUV = (x: number, z: number): [number, number] => [(x - ox) * ex + (z - oz) * ez, (x - ox) * nx + (z - oz) * nz];
  const [ua, va] = toUV(ax, az), [ub, vb] = toUV(bx, bz);
  // Points de passage : A, sortie droite du village, lacets, col, lacets, B.
  const pts: [number, number][] = [[ua, va], [ua, Math.max(va + 30, 18)]];
  LAYOUT.forEach(([u, v], k) => {
    const half = k < SUMMIT_POINT ? k / SUMMIT_POINT : (LAYOUT.length - 1 - k) / (LAYOUT.length - 1 - SUMMIT_POINT);
    // décalage pour partir de A / arriver à B, qui s'efface en montant vers le col
    const shift = k < SUMMIT_POINT ? (ua + 300) * (1 - half) : k > SUMMIT_POINT ? (ub - 300) * (1 - half) : 0;
    const j = k === SUMMIT_POINT ? 0 : 16;
    pts.push([u + shift + rng.range(-j, j), v + rng.range(-j, j)]);
  });
  pts.push([ub, Math.max(vb + 30, 18)], [ub, vb]);
  const summitPt = 2 + SUMMIT_POINT;
  // Courbe de Catmull-Rom centripète (pas de boucles dans les épingles), échantillonnée finement.
  const dense: [number, number][] = [];
  let summitDense = 0;
  const P = (k: number): [number, number] => pts[Math.max(0, Math.min(pts.length - 1, k))] as [number, number];
  for (let k = 0; k < pts.length - 1; k++) {
    const p0 = P(k - 1), p1 = P(k), p2 = P(k + 1), p3 = P(k + 2);
    const d = (a: [number, number], b: [number, number]): number => Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])) || 1e-3;
    const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    if (k === summitPt) summitDense = dense.length;
    const steps = 40;
    for (let q = 0; q < steps; q++) {
      const t = t1 + ((t2 - t1) * q) / steps;
      const out: [number, number] = [0, 0];
      for (const c of [0, 1] as const) {
        const A1 = (p0[c] * (t1 - t)) / (t1 - t0) + (p1[c] * (t - t0)) / (t1 - t0);
        const A2 = (p1[c] * (t2 - t)) / (t2 - t1) + (p2[c] * (t - t1)) / (t2 - t1);
        const A3 = (p2[c] * (t3 - t)) / (t3 - t2) + (p3[c] * (t - t2)) / (t3 - t2);
        const B1 = (A1 * (t2 - t)) / (t2 - t0) + (A2 * (t - t0)) / (t2 - t0);
        const B2 = (A2 * (t3 - t)) / (t3 - t1) + (A3 * (t - t1)) / (t3 - t1);
        out[c] = (B1 * (t2 - t)) / (t2 - t1) + (B2 * (t - t1)) / (t2 - t1);
      }
      dense.push(out);
    }
  }
  dense.push(P(pts.length - 1));
  // Abscisses curvilignes, puis profil en long : plat au départ, montée régulière, col arrondi.
  const acc: number[] = [0];
  for (let q = 1; q < dense.length; q++) acc.push((acc[q - 1] as number) + Math.hypot((dense[q] as [number, number])[0] - (dense[q - 1] as [number, number])[0], (dense[q] as [number, number])[1] - (dense[q - 1] as [number, number])[1]));
  const total = acc[acc.length - 1] as number, sTop = acc[summitDense] as number;
  const flat = M.approach;
  const ease = (f: number): number => 0.55 * f + 0.45 * f * f * (3 - 2 * f);
  const heightAt = (s: number): number => {
    const f = s <= sTop ? (s - flat) / (sTop - flat) : (total - flat - s) / (total - flat - sTop);
    return M.height * ease(Math.max(0, Math.min(1, f)));
  };
  // Rééchantillonnage tous les 3 m, en coordonnées du monde.
  const samples: HighwaySample[] = [];
  let next = 0, summit = 0, top = -1;
  for (let q = 1; q < dense.length; q++) {
    const a = dense[q - 1] as [number, number], b = dense[q] as [number, number];
    const len = (acc[q] as number) - (acc[q - 1] as number);
    while (next <= (acc[q] as number)) {
      const f = len > 0 ? (next - (acc[q - 1] as number)) / len : 0;
      const u = a[0] + (b[0] - a[0]) * f, v = a[1] + (b[1] - a[1]) * f;
      const tu = (b[0] - a[0]) / (len || 1), tv = (b[1] - a[1]) / (len || 1);
      const y = heightAt(next);
      if (y > top) { top = y; summit = samples.length; }
      samples.push({ x: ox + ex * u + nx * v, y, z: oz + ez * u + nz * v, tx: ex * tu + nx * tv, tz: ez * tu + nz * tv, s: next });
      next += 3;
    }
  }
  // Tangentes lissées (les changements de tronçon de la courbe font de petits à-coups).
  for (let q = 1; q < samples.length - 1; q++) {
    const a = samples[q - 1] as HighwaySample, b = samples[q + 1] as HighwaySample, c = samples[q] as HighwaySample;
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    c.tx = (b.x - a.x) / l; c.tz = (b.z - a.z) / l;
  }

  // ——— Relief ———
  const sp = samples[summit] as HighwaySample;
  // Terre-plein du temple : à côté du col, du côté du large.
  const sideSign = -sp.tz * nx + sp.tx * nz > 0 ? 1 : -1;
  const pad = { x: sp.x - sp.tz * sideSign * (M.halfWidth + 24), y: sp.y - 0.3, z: sp.z + sp.tx * sideSign * (M.halfWidth + 24) };
  const hash = (i: number, j: number): number => {
    let h = (i * 374761393 + j * 668265263 + seed * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const vnoise = (x: number, z: number): number => {
    const i = Math.floor(x), j = Math.floor(z), a = x - i, b = z - j;
    const sa = a * a * (3 - 2 * a), sb = b * b * (3 - 2 * b);
    return (hash(i, j) * (1 - sa) + hash(i + 1, j) * sa) * (1 - sb) + (hash(i, j + 1) * (1 - sa) + hash(i + 1, j + 1) * sa) * sb;
  };
  const natural = (u: number, v: number): number => {
    // Le massif monte avec v à peu près comme la route, et culmine de part et d'autre du col.
    const slope = M.height * 1.02 * smooth(-30, 800, v) + 110 * smooth(760, 1180, v);
    const peaks = 1 + 0.42 * (1 - Math.exp(-((u - 20) * (u - 20)) / (230 * 230))) * smooth(420, 900, v);
    const sides = 1 - smooth(560, 850, Math.abs(u));
    const n = (vnoise(u / 150, v / 150) - 0.5) * 46 + (vnoise(u / 48 + 9, v / 48 + 3) - 0.5) * 13;
    return Math.max(0, slope * peaks * sides + n * smooth(0, 220, v) * sides);
  };
  const cell = M.cell;
  const u0 = -870, u1 = 870, v0 = -70, v1 = 1270;
  const ni = Math.round((u1 - u0) / cell) + 1, nj = Math.round((v1 - v0) / cell) + 1;
  const heights = new Float32Array(ni * nj);
  const flatR = M.halfWidth + 7.5, blend = M.blend;
  // Grille de recherche du point de route le plus proche.
  const BUCKET = 60;
  const buckets = new Map<number, number[]>();
  samples.forEach((s, k) => {
    const key = Math.floor(s.x / BUCKET) * 100003 + Math.floor(s.z / BUCKET);
    const b = buckets.get(key);
    if (b) b.push(k); else buckets.set(key, [k]);
  });
  const reach = Math.ceil((flatR + blend) / BUCKET);
  for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
    const u = u0 + i * cell, v = v0 + j * cell;
    const x = ox + ex * u + nx * v, z = oz + ez * u + nz * v;
    let h = natural(u, v) * smooth(15, 190, outside(x, z));
    // Terre-plein du temple
    const dp = Math.hypot(x - pad.x, z - pad.z);
    h = pad.y + (h - pad.y) * smooth(20, 52, dp);
    // La route : plate sur son emprise, raccordée au relief en talus.
    let best = Infinity, by = 0;
    const bi = Math.floor(x / BUCKET), bj = Math.floor(z / BUCKET);
    for (let p = bi - reach; p <= bi + reach; p++) for (let q = bj - reach; q <= bj + reach; q++) {
      const b = buckets.get(p * 100003 + q);
      if (!b) continue;
      for (const k of b) {
        const s = samples[k] as HighwaySample;
        const d = Math.hypot(s.x - x, s.z - z);
        if (d < best) { best = d; by = s.y; }
      }
    }
    if (best < flatR + blend) h = by - 0.6 + (h - (by - 0.6)) * smooth(flatR, flatR + blend, best);
    heights[j * ni + i] = Math.max(-0.6, h);
  }
  // Bords de la grille au niveau du sol sur les côtés et côté village.
  for (let j = 0; j < nj; j++) { heights[j * ni] = Math.min(heights[j * ni] as number, 0); heights[j * ni + ni - 1] = Math.min(heights[j * ni + ni - 1] as number, 0); }
  for (let i = 0; i < ni; i++) heights[i] = Math.min(heights[i] as number, 0);
  const terrain: Terrain = { x0: ox + ex * u0 + nx * v0, z0: oz + ez * u0 + nz * v0, ux: ex, uz: ez, vx: nx, vz: nz, cell, ni, nj, heights };
  return { samples, terrain, summit, pad };
}
