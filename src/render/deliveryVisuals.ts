import * as THREE from 'three/webgpu';
import { GeomBuilder } from './geomBuilder';
import type { Deliveries, Delivery } from '../world/deliveries';

type V3 = readonly [number, number, number];
const AMBER: V3 = [1.0, 0.62, 0.1], GREEN: V3 = [0.25, 1.0, 0.45];

/** Repère lumineux d'un point de livraison : cercle au sol, colonne de lumière, colis qui flotte. */
function marker(color: V3, material: THREE.Material, parcel: boolean): THREE.Group {
  const g = new THREE.Group();
  const gb = new GeomBuilder();
  gb.cylinder(0, 0.05, 0, 5.6, 5.6, 0.3, 28, color, [1, 3, 1, 1.0], false);
  gb.cylinder(0, 0.05, 0, 0.3, 0.3, 40, 8, color, [1, 3, 1, 1.2], false);
  g.add(new THREE.Mesh(gb.build(), material));
  if (parcel) {
    const pb = new GeomBuilder();
    pb.box(0, 0, 0, 1.1, 0.9, 1.1, 0, color, [1, 3, 1, 0.9], true, true);
    pb.box(0, 0, 0, 1.14, 0.94, 0.16, 0, [1, 1, 1], [1, 3, 1, 1.4], true, true);
    pb.box(0, 0, 0, 0.16, 0.94, 1.14, 0, [1, 1, 1], [1, 3, 1, 1.4], true, true);
    const box = new THREE.Mesh(pb.build(), material);
    box.name = 'colis';
    box.position.y = 2.4;
    g.add(box);
  }
  g.traverse((o) => { o.frustumCulled = false; });
  return g;
}

/** Affiche les colis proposés (ambre) et l'arrivée de la livraison en cours (vert). */
export class DeliveryVisuals {
  private readonly pickups: THREE.Group[] = [];
  private readonly goal: THREE.Group;
  private time = 0;

  constructor(scene: THREE.Object3D, private readonly deliveries: Deliveries, count: number, material: THREE.Material) {
    for (let k = 0; k < count; k++) {
      const m = marker(AMBER, material, true);
      m.visible = false;
      this.pickups.push(m);
      scene.add(m);
    }
    this.goal = marker(GREEN, material, false);
    this.goal.visible = false;
    scene.add(this.goal);
  }

  /** `show` faux : rien n'est affiché (en course). */
  update(dt: number, show: boolean): void {
    this.time += dt;
    const d = this.deliveries;
    this.pickups.forEach((g, k) => {
      const m: Delivery | undefined = show && !d.current ? d.bank[d.offered[k] ?? -1] : undefined;
      g.visible = m !== undefined;
      if (!m) return;
      g.position.set(m.from.x, 0, m.from.z);
      const box = g.getObjectByName('colis');
      if (box) { box.rotation.y = this.time * 1.2 + k; box.position.y = 2.4 + Math.sin(this.time * 2 + k) * 0.25; }
    });
    this.goal.visible = show && d.current !== null;
    if (d.current) this.goal.position.set(d.current.to.x, 0, d.current.to.z);
  }
}
