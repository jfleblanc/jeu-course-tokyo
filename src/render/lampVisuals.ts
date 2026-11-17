import * as THREE from 'three/webgpu';
import { GeomBuilder } from './geomBuilder';
import type { LampField } from '../world/lampField';
import type { Lamp } from '../world/cityGen';

const DARK_METAL = [0.035, 0.037, 0.042] as const;

/**
 * Affichage des lampadaires, par instances : un modèle par famille (hauteur, bras, couleur),
 * une position par lampadaire. Debout, ils ne coûtent rien à mettre à jour ; seuls ceux qui
 * viennent d'être fauchés sont déplacés.
 */
export class LampVisuals {
  private readonly slot: { solid: THREE.InstancedMesh; glow: THREE.InstancedMesh; index: number }[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly offset = new THREE.Matrix4();

  constructor(scene: THREE.Object3D, private readonly field: LampField, mats: { solid: THREE.Material; glow: THREE.Material }) {
    const groups = new Map<string, number[]>();
    field.lamps.forEach((l, i) => {
      const k = `${l.height}|${l.arm}|${l.color.join(',')}`;
      const g = groups.get(k);
      if (g) g.push(i); else groups.set(k, [i]);
    });
    for (const ids of groups.values()) {
      const l = field.lamps[ids[0] as number] as Lamp;
      const solid = new GeomBuilder();
      solid.cylinder(0, 0, 0, 0.1, 0.07, l.height, 5, DARK_METAL, [0, 0, 0, 0], false);
      solid.box(0, l.height, l.arm * 0.5, 0.09, 0.09, l.arm, 0, DARK_METAL, [0, 0, 0, 0], true, true);
      const glow = new GeomBuilder();
      // Tête lumineuse (aData : graine, type 3 = uni, -, intensité)
      glow.box(0, l.height - 0.08, l.arm, 0.32, 0.12, 0.8, 0, l.color, [1, 3, 1, 2.6], true, true);
      const sm = new THREE.InstancedMesh(solid.build(), mats.solid, ids.length);
      const gm = new THREE.InstancedMesh(glow.build(), mats.glow, ids.length);
      for (const mesh of [sm, gm]) { mesh.frustumCulled = false; mesh.name = 'lampadaires'; scene.add(mesh); }
      ids.forEach((id, index) => { this.slot[id] = { solid: sm, glow: gm, index }; this.place(id); });
      sm.instanceMatrix.needsUpdate = true; gm.instanceMatrix.needsUpdate = true;
    }
  }

  private place(id: number): void {
    const f = this.field;
    const l = f.lamps[id] as Lamp;
    const s = this.slot[id];
    if (!s) return;
    if (f.state[id] === 0) {
      this.quat.setFromAxisAngle(this.up, Math.atan2(l.dx, l.dz));
      this.pos.set(l.x, 0, l.z);
      this.m.compose(this.pos, this.quat, this.one);
    } else {
      const p = id * 7, q = f.pose;
      this.pos.set(q[p] as number, q[p + 1] as number, q[p + 2] as number);
      this.quat.set(q[p + 3] as number, q[p + 4] as number, q[p + 5] as number, q[p + 6] as number).normalize();
      this.m.compose(this.pos, this.quat, this.one);
      // le modèle a son origine au pied ; la pose est celle du milieu du mât
      this.m.multiply(this.offset.makeTranslation(0, -l.height / 2, 0));
    }
    s.solid.setMatrixAt(s.index, this.m);
    s.glow.setMatrixAt(s.index, this.m);
    s.solid.instanceMatrix.needsUpdate = true;
    s.glow.instanceMatrix.needsUpdate = true;
  }

  /** À appeler à chaque image. */
  update(): void {
    const d = this.field.dirty;
    for (let i = 0; i < d.length; i++) this.place(d[i] as number);
    d.length = 0;
  }
}
