import * as THREE from 'three/webgpu';
import { GeomBuilder } from './geomBuilder';
import { STREET_PROPS } from '../config/props';
import { PROP_KINDS, type PropField, type PropKind, type StreetProp } from '../world/streetProps';

type V3 = readonly [number, number, number];
const NONE = [0, 0, 0, 0] as const;
const ORANGE: V3 = [0.9, 0.3, 0.04], WHITE: V3 = [0.75, 0.75, 0.72], STEEL: V3 = [0.12, 0.13, 0.15];

/** Couleur dominante de chaque genre (pour les éclats quand il est renversé). */
export const PROP_COLOR: Record<PropKind, V3> = {
  cone: ORANGE, barriere: ORANGE, poubelle: [0.05, 0.2, 0.12], panneau: [0.1, 0.25, 0.7], carton: [0.42, 0.31, 0.19],
};

/** Modèle d'un genre d'objet, centré sur son milieu (c'est autour de lui qu'il culbute). */
function model(kind: PropKind): THREE.BufferGeometry {
  const gb = new GeomBuilder();
  const h = STREET_PROPS.kinds[kind].half;
  if (kind === 'cone') {
    gb.box(0, -h + 0.03, 0, 0.46, 0.06, 0.46, 0, [0.06, 0.06, 0.07], NONE, true, true);
    gb.cylinder(0, -h + 0.06, 0, 0.17, 0.11, 0.26, 8, ORANGE, NONE, false);
    gb.cylinder(0, -h + 0.32, 0, 0.11, 0.075, 0.14, 8, WHITE, NONE, false);
    gb.cylinder(0, -h + 0.46, 0, 0.075, 0.03, 0.24, 8, ORANGE, NONE, true);
  } else if (kind === 'barriere') {
    for (const x of [-0.6, 0.6]) {
      gb.box(x, -h + 0.03, 0, 0.08, 0.06, 0.5, 0, STEEL, NONE, true, true);
      gb.box(x, 0, 0, 0.06, 0.95, 0.06, 0, STEEL, NONE, true, true);
    }
    for (let k = 0; k < 6; k++) gb.box(-0.625 + k * 0.25, 0.3, 0, 0.25, 0.22, 0.05, 0, k % 2 ? WHITE : ORANGE, NONE, true, true);
    gb.box(0, -0.05, 0, 1.3, 0.1, 0.04, 0, WHITE, NONE, true, true);
  } else if (kind === 'poubelle') {
    gb.box(0, -0.04, 0, 0.46, 0.82, 0.46, 0, PROP_COLOR.poubelle, NONE, true, true);
    gb.box(0, h - 0.04, 0, 0.52, 0.08, 0.52, 0, [0.03, 0.12, 0.08], NONE, true, true);
    gb.box(0, 0.1, 0.235, 0.3, 0.1, 0.02, 0, [0.02, 0.02, 0.025], NONE, true, true);
  } else if (kind === 'panneau') {
    gb.cylinder(0, -h, 0, 0.035, 0.035, 2.2, 5, STEEL, NONE, false);
    gb.box(0, h - 0.3, 0.02, 0.56, 0.56, 0.03, 0, PROP_COLOR.panneau, NONE, true, true);
    gb.box(0, h - 0.3, 0.04, 0.36, 0.1, 0.02, 0, WHITE, NONE, true, true);
  } else {
    gb.box(0, 0, 0, 0.58, 0.58, 0.58, 0, PROP_COLOR.carton, NONE, true, true);
    gb.box(0, h - 0.005, 0, 0.6, 0.012, 0.09, 0, [0.6, 0.5, 0.34], NONE, true, true);
  }
  return gb.build();
}

/** Affichage des objets de rue, par instances : un appel de dessin par genre. */
export class PropVisuals {
  private readonly slot: { mesh: THREE.InstancedMesh; index: number }[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  triangles = 0;

  constructor(scene: THREE.Object3D, private readonly field: PropField, material: THREE.Material) {
    for (const kind of PROP_KINDS) {
      const ids: number[] = [];
      field.props.forEach((q, i) => { if (q.kind === kind) ids.push(i); });
      if (ids.length === 0) continue;
      const geo = model(kind);
      const mesh = new THREE.InstancedMesh(geo, material, ids.length);
      mesh.frustumCulled = false;
      mesh.name = `objets de rue (${kind})`;
      scene.add(mesh);
      this.triangles += ((geo.getIndex()?.count ?? 0) / 3) * ids.length;
      ids.forEach((id, index) => { this.slot[id] = { mesh, index }; this.place(id); });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private place(id: number): void {
    const f = this.field, slot = this.slot[id];
    if (!slot) return;
    const q = f.props[id] as StreetProp;
    if (f.state[id] === 0) {
      this.pos.set(q.x, q.y + STREET_PROPS.kinds[q.kind].half, q.z);
      this.quat.setFromAxisAngle(this.up, q.yaw);
    } else {
      const p = id * 7, a = f.pose;
      this.pos.set(a[p] as number, a[p + 1] as number, a[p + 2] as number);
      this.quat.set(a[p + 3] as number, a[p + 4] as number, a[p + 5] as number, a[p + 6] as number).normalize();
    }
    this.m.compose(this.pos, this.quat, this.one);
    slot.mesh.setMatrixAt(slot.index, this.m);
    slot.mesh.instanceMatrix.needsUpdate = true;
  }

  update(): void {
    const d = this.field.dirty;
    for (let i = 0; i < d.length; i++) this.place(d[i] as number);
    d.length = 0;
  }
}
