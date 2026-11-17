import * as THREE from 'three/webgpu';

export type Vec3 = readonly [number, number, number];
export type Vec4 = readonly [number, number, number, number];

const ZERO4: Vec4 = [0, 0, 0, 0];
const WHITE: Vec3 = [1, 1, 1];

/**
 * Accumule des quads/boîtes/cylindres dans UNE seule géométrie (un seul draw call).
 * Attributs : position, normal, uv (en mètres), color, aData (vec4 libre pour les shaders).
 */
export class GeomBuilder {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly uvs: number[] = [];
  private readonly col: number[] = [];
  private readonly data: number[] = [];
  private readonly idx: number[] = [];
  private count = 0;

  get vertexCount(): number {
    return this.count;
  }

  /** Quad p0→p1→p2→p3 (sens antihoraire vu de face). UV : (u0,v0) en p0 … (u1,v1) en p2. */
  quad(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, n: Vec3, u0: number, v0: number, u1: number, v1: number, color: Vec3 = WHITE, data: Vec4 = ZERO4): void {
    const base = this.count;
    this.pos.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]);
    this.uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
    for (let k = 0; k < 4; k++) {
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(color[0], color[1], color[2]);
      this.data.push(data[0], data[1], data[2], data[3]);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.count += 4;
  }

  /** Comme quad(), mais avec les UV donnés sommet par sommet. */
  quadUv(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, n: Vec3, uv: readonly [number, number, number, number, number, number, number, number], color: Vec3 = WHITE, data: Vec4 = ZERO4): void {
    const at = this.uvs.length;
    this.quad(p0, p1, p2, p3, n, 0, 0, 1, 1, color, data);
    for (let k = 0; k < 8; k++) this.uvs[at + k] = uv[k] as number;
  }

  /**
   * Boîte centrée en (cx, cy, cz), tournée de `yaw` autour de Y.
   * UV des faces latérales en mètres : u horizontal, v vertical depuis le bas.
   */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, yaw = 0, color: Vec3 = WHITE, data: Vec4 = ZERO4, top = true, bottom = false): void {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    // Axes locaux : X = (c, 0, −s), Z = (s, 0, c)
    const P = (lx: number, ly: number, lz: number): Vec3 => [cx + lx * c + lz * s, cy + ly, cz - lx * s + lz * c];
    const N = (lx: number, lz: number): Vec3 => [lx * c + lz * s, 0, -lx * s + lz * c];
    // +Z
    this.quad(P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz), N(0, 1), 0, 0, sx, sy, color, data);
    // −Z
    this.quad(P(hx, -hy, -hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz), N(0, -1), 0, 0, sx, sy, color, data);
    // +X
    this.quad(P(hx, -hy, hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), N(1, 0), 0, 0, sz, sy, color, data);
    // −X
    this.quad(P(-hx, -hy, -hz), P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz), N(-1, 0), 0, 0, sz, sy, color, data);
    if (top) this.quad(P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz), P(-hx, hy, -hz), [0, 1, 0], 0, 0, sx, sz, color, data);
    if (bottom) this.quad(P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz), [0, -1, 0], 0, 0, sx, sz, color, data);
  }

  /** Cylindre vertical (ou cône si r1 ≠ r0), base en y0. */
  cylinder(cx: number, y0: number, cz: number, r0: number, r1: number, height: number, sides: number, color: Vec3 = WHITE, data: Vec4 = ZERO4, cap = true): void {
    for (let k = 0; k < sides; k++) {
      const a0 = (k / sides) * Math.PI * 2;
      const a1 = ((k + 1) / sides) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      this.quad(
        [cx + c1 * r0, y0, cz + s1 * r0],
        [cx + c0 * r0, y0, cz + s0 * r0],
        [cx + c0 * r1, y0 + height, cz + s0 * r1],
        [cx + c1 * r1, y0 + height, cz + s1 * r1],
        [Math.cos(am), 0, Math.sin(am)],
        0, 0, 1, height, color, data,
      );
      if (cap && r1 > 0.001) {
        this.quad(
          [cx, y0 + height, cz],
          [cx + c1 * r1, y0 + height, cz + s1 * r1],
          [cx + c0 * r1, y0 + height, cz + s0 * r1],
          [cx, y0 + height, cz],
          [0, 1, 0], 0, 0, 1, 1, color, data,
        );
      }
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aData', new THREE.Float32BufferAttribute(this.data, 4));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
