import * as THREE from 'three/webgpu';
import { float, instancedDynamicBufferAttribute, smoothstep, uv, vec2, vec4 } from 'three/tsl';

/**
 * Petites particules en panneaux face caméra (étincelles, fumée, poussière, éclats).
 * Simulation sur le processeur (quelques centaines de points), un seul appel de dessin par nappe.
 * `additive` : lumière qui s'ajoute (étincelles, flammes) ; sinon voile semi-transparent (fumée).
 */
export class Particles {
  private readonly n: number;
  private readonly pos: Float32Array; // x, y, z, taille
  private readonly col: Float32Array; // r, g, b, opacité
  private readonly vel: Float32Array; // vx, vy, vz
  private readonly par: Float32Array; // âge, durée, taille de départ, taille de fin
  private readonly phy: Float32Array; // pesanteur, freinage de l'air, opacité de départ
  private readonly rgb: Float32Array;
  private readonly posAttr: THREE.InstancedBufferAttribute;
  private readonly colAttr: THREE.InstancedBufferAttribute;
  private next = 0;
  alive = 0;

  constructor(scene: THREE.Object3D, max: number, additive: boolean) {
    this.n = max;
    this.pos = new Float32Array(max * 4);
    this.col = new Float32Array(max * 4);
    this.vel = new Float32Array(max * 3);
    this.par = new Float32Array(max * 4);
    this.phy = new Float32Array(max * 3);
    this.rgb = new Float32Array(max * 3);
    this.posAttr = new THREE.InstancedBufferAttribute(this.pos, 4);
    this.colAttr = new THREE.InstancedBufferAttribute(this.col, 4);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    const p = instancedDynamicBufferAttribute(this.posAttr, 'vec4') as unknown as ReturnType<typeof vec4>;
    const c = instancedDynamicBufferAttribute(this.colAttr, 'vec4') as unknown as ReturnType<typeof vec4>;
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    mat.positionNode = p.xyz;
    mat.scaleNode = p.w;
    mat.colorNode = c.xyz;
    // disque aux bords doux
    const d = uv().sub(vec2(0.5, 0.5)).length();
    mat.opacityNode = c.w.mul(smoothstep(float(0.5), float(additive ? 0.05 : 0.18), d));
    mat.fog = !additive;
    const sprite = new THREE.Sprite(mat);
    sprite.count = max;
    sprite.frustumCulled = false;
    sprite.renderOrder = 5;
    sprite.name = additive ? 'étincelles' : 'fumée';
    scene.add(sprite);
  }

  /** Lance une particule. `gravity` en m/s² vers le bas (négatif = elle monte), `drag` en 1/s. */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size0: number, size1: number, r: number, g: number, b: number, alpha: number, gravity: number, drag: number): void {
    const i = this.next;
    this.next = (i + 1) % this.n;
    const p = i * 4, v = i * 3;
    this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z; this.pos[p + 3] = size0;
    this.vel[v] = vx; this.vel[v + 1] = vy; this.vel[v + 2] = vz;
    this.par[p] = 0; this.par[p + 1] = life; this.par[p + 2] = size0; this.par[p + 3] = size1;
    this.phy[v] = gravity; this.phy[v + 1] = drag; this.phy[v + 2] = alpha;
    this.rgb[v] = r; this.rgb[v + 1] = g; this.rgb[v + 2] = b;
  }

  /** `floorAt` : hauteur du sol sous une particule (elles ne passent pas dessous). */
  update(dt: number, floor = -1e9): void {
    const { pos, col, vel, par, phy, rgb } = this;
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      const p = i * 4, v = i * 3;
      const life = par[p + 1] as number;
      if (life <= 0) continue;
      const age = (par[p] as number) + dt;
      if (age >= life) {
        par[p + 1] = 0; pos[p + 3] = 0; col[p + 3] = 0;
        continue;
      }
      alive++;
      par[p] = age;
      const k = Math.exp(-(phy[v + 1] as number) * dt);
      vel[v] = (vel[v] as number) * k; vel[v + 2] = (vel[v + 2] as number) * k;
      vel[v + 1] = (vel[v + 1] as number) * k - (phy[v] as number) * dt;
      pos[p] = (pos[p] as number) + (vel[v] as number) * dt;
      pos[p + 1] = (pos[p + 1] as number) + (vel[v + 1] as number) * dt;
      pos[p + 2] = (pos[p + 2] as number) + (vel[v + 2] as number) * dt;
      if ((pos[p + 1] as number) < floor) { pos[p + 1] = floor; vel[v + 1] = -(vel[v + 1] as number) * 0.3; }
      const u = age / life;
      pos[p + 3] = (par[p + 2] as number) + ((par[p + 3] as number) - (par[p + 2] as number)) * u;
      // l'opacité monte vite puis s'éteint
      const fade = Math.min(1, u * 8) * (1 - u) * (1 - u * 0.3);
      col[p] = rgb[v] as number; col[p + 1] = rgb[v + 1] as number; col[p + 2] = rgb[v + 2] as number;
      col[p + 3] = (phy[v + 2] as number) * fade;
    }
    this.alive = alive;
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }
}
