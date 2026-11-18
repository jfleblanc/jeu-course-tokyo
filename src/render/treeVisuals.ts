import * as THREE from 'three/webgpu';
import { GeomBuilder } from './geomBuilder';
import { addTree, type TreeSlot } from '../world/cityMesh';
import type { TreeField } from '../world/treeField';
import type { Tree } from '../world/cityGen';

const POOL = 48;

/**
 * Affichage des arbres renversés. Debout, un arbre fait partie du maillage fusionné de son
 * quartier. Quand il tombe, on efface ses sommets de ce maillage (ils sont rangés sous la carte)
 * et on le remplace par un exemplaire mobile pris dans une petite réserve. Quand il repousse,
 * on remet ses sommets en place.
 */
export class TreeVisuals {
  private readonly conifer: THREE.InstancedMesh;
  private readonly palm: THREE.InstancedMesh;
  /** Arbre → (réserve, place) ; et sommets d'origine mis de côté. */
  private readonly inst = new Map<number, { mesh: THREE.InstancedMesh; index: number }>();
  private readonly saved = new Map<number, Float32Array>();
  private readonly free = new Map<THREE.InstancedMesh, number[]>();
  private readonly m = new THREE.Matrix4();
  private readonly off = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(scene: THREE.Object3D, private readonly field: TreeField, private readonly slots: (TreeSlot | undefined)[], material: THREE.Material) {
    const make = (palm: boolean): THREE.InstancedMesh => {
      // Modèle de taille 1 (hauteur 1, rayon 1), mis à l'échelle de chaque arbre.
      const gb = new GeomBuilder();
      addTree(gb, { height: 1, radius: 1, palm, x: 0 }, 0, 0, 0, 1, 1);
      const mesh = new THREE.InstancedMesh(gb.build(), material, POOL);
      mesh.frustumCulled = false;
      mesh.name = 'arbres renversés';
      for (let k = 0; k < POOL; k++) mesh.setMatrixAt(k, this.zero);
      mesh.instanceMatrix.needsUpdate = true;
      this.free.set(mesh, Array.from({ length: POOL }, (_, k) => k));
      scene.add(mesh);
      return mesh;
    };
    this.conifer = make(false);
    this.palm = make(true);
  }

  private hide(id: number): void {
    const slot = this.slots[id];
    if (!slot || this.saved.has(id)) return;
    const attr = slot.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    this.saved.set(id, arr.slice(slot.v0 * 3, slot.v1 * 3));
    for (let v = slot.v0; v < slot.v1; v++) arr[v * 3 + 1] = -3000;
    attr.needsUpdate = true;
  }

  private show(id: number): void {
    const slot = this.slots[id], keep = this.saved.get(id);
    if (!slot || !keep) return;
    const attr = slot.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    (attr.array as Float32Array).set(keep, slot.v0 * 3);
    attr.needsUpdate = true;
    this.saved.delete(id);
  }

  private place(id: number): void {
    const f = this.field;
    const t = f.trees[id] as Tree;
    let it = this.inst.get(id);
    if (f.state[id] === 0) {
      this.show(id);
      if (it) {
        it.mesh.setMatrixAt(it.index, this.zero);
        it.mesh.instanceMatrix.needsUpdate = true;
        (this.free.get(it.mesh) as number[]).push(it.index);
        this.inst.delete(id);
      }
      return;
    }
    if (!it) {
      const mesh = t.palm ? this.palm : this.conifer;
      const index = (this.free.get(mesh) as number[]).pop();
      if (index === undefined) return; // réserve vide : l'arbre reste debout à l'écran
      it = { mesh, index };
      this.inst.set(id, it);
      this.hide(id);
    }
    const p = id * 7, q = f.pose;
    this.pos.set(q[p] as number, q[p + 1] as number, q[p + 2] as number);
    this.quat.set(q[p + 3] as number, q[p + 4] as number, q[p + 5] as number, q[p + 6] as number).normalize();
    this.m.compose(this.pos, this.quat, this.scale.set(1, 1, 1));
    // le modèle a son origine au pied ; la pose est celle du pivot
    this.m.multiply(this.off.makeTranslation(0, -(f.pivot[id] as number), 0));
    this.m.multiply(this.off.makeScale(t.radius, t.height, t.radius));
    it.mesh.setMatrixAt(it.index, this.m);
    it.mesh.instanceMatrix.needsUpdate = true;
  }

  update(): void {
    const d = this.field.dirty;
    for (let i = 0; i < d.length; i++) this.place(d[i] as number);
    d.length = 0;
  }
}
