import * as THREE from 'three/webgpu';
import { attribute, color, float, mix, positionLocal, step, vec3 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { CarSpec } from '../config/handling';
import type { CarVisual } from './carModel';
import { REST_HEIGHT } from './vehicle';

/**
 * Voitures en vrai modèle 3D (GLB produit par `tools/convert-car.mjs`).
 *
 * Le fichier contient `body` et `wheel` (détail complet, voiture du joueur) ainsi que
 * `body_lod1` et `wheel_lod1` (allégés, adversaires). Origine : au sol, au milieu des essieux,
 * +Z vers l'avant. Les matériaux du fichier portent le nom d'une famille, remplacée ici par
 * un matériau du jeu : `paint` (peinture réglable), `glass`, `lens`, `matte` / `metal` /
 * `chrome` (couleur par sommet), `emit`, `tail` (feux de frein), `head` (phares) ;
 * les matériaux `tex:…` gardent leur texture.
 */
export interface CarAsset {
  id: string;
  credit: string;
  /** Côté de la roue modèle : −1 = droite (x négatif). */
  wheelSide: number;
  wheelRadius: number;
  axleFrontZ: number;
  axleRearZ: number;
  halfTrackFront: number;
  halfTrackRear: number;
  radiusFront: number;
  radiusRear: number;
  /** Couleur de série (linéaire), si le modèle a une peinture réglable. */
  paint: [number, number, number] | null;
  max: [number, number, number];
  parts: Record<'body' | 'body_lod1' | 'wheel' | 'wheel_lod1', THREE.Mesh[]>;
}

const cache = new Map<string, Promise<CarAsset>>();

export function loadCarAsset(id: string): Promise<CarAsset> {
  let p = cache.get(id);
  if (!p) {
    const url = new URL(`models/${id}.glb`, document.baseURI).href;
    // (types du chargeur réduits au strict nécessaire)
    const loader = new GLTFLoader() as unknown as { loadAsync(u: string): Promise<{ scene: THREE.Group }> };
    const loading: Promise<CarAsset> = loader.loadAsync(url).then((gltf) => {
      const e = gltf.scene.userData as Partial<CarAsset>;
      const parts: CarAsset['parts'] = { body: [], body_lod1: [], wheel: [], wheel_lod1: [] };
      for (const name of Object.keys(parts) as (keyof CarAsset['parts'])[]) {
        gltf.scene.getObjectByName(name)?.traverse((o: THREE.Object3D) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) parts[name].push(m);
        });
      }
      if (!parts.body.length || !parts.wheel.length) throw new Error(`modèle ${id} incomplet`);
      return {
        id,
        credit: e.credit ?? '',
        wheelSide: e.wheelSide ?? -1,
        wheelRadius: e.wheelRadius ?? 0.33,
        axleFrontZ: e.axleFrontZ ?? 1.3,
        axleRearZ: e.axleRearZ ?? -1.3,
        halfTrackFront: e.halfTrackFront ?? 0.78,
        halfTrackRear: e.halfTrackRear ?? 0.78,
        radiusFront: e.radiusFront ?? 0.33,
        radiusRear: e.radiusRear ?? 0.33,
        paint: e.paint ?? null,
        max: e.max ?? [0.9, 1.3, 2.2],
        parts,
      };
    });
    cache.set(id, loading);
    p = loading;
  }
  return p;
}

type Look = () => THREE.Material;

/** Matériaux du jeu pour chaque famille du fichier. */
function looks(visual: CarVisual, glossy: boolean): Record<string, Look> {
  const vcol = attribute('color', 'vec4');
  const solid = (metal: number, rough: number): Look => () => {
    const m = new THREE.MeshStandardNodeMaterial();
    m.colorNode = vcol.rgb;
    m.metalnessNode = float(metal);
    m.roughnessNode = float(rough);
    return m;
  };
  const brake = float(visual.brakeLevel as unknown as number);
  const reverse = float(visual.reverseLevel as unknown as number);
  return {
    paint: () => visual.paint,
    matte: solid(0.0, 0.62),
    metal: solid(0.9, 0.42),
    // Adversaires : chromes moins brillants (nos phares y font des taches blanches).
    chrome: solid(1.0, glossy ? 0.14 : 0.3),
    glass: () => {
      const m = new THREE.MeshPhysicalNodeMaterial();
      m.colorNode = color(0.02, 0.03, 0.04);
      m.roughnessNode = float(0.06);
      m.metalnessNode = float(0.6);
      m.transparent = true;
      m.opacity = 0.55;
      m.depthWrite = false;
      return m;
    },
    lens: () => {
      const m = new THREE.MeshStandardNodeMaterial();
      m.colorNode = vcol.rgb;
      m.opacityNode = vcol.a.max(0.25);
      m.roughnessNode = float(0.1);
      m.metalnessNode = float(0.2);
      m.transparent = true;
      m.depthWrite = false;
      return m;
    },
    emit: () => {
      const m = new THREE.MeshBasicNodeMaterial();
      m.colorNode = vcol.rgb.mul(2.2);
      return m;
    },
    // Feux arrière : rouges, plus forts au freinage.
    tail: () => {
      const m = new THREE.MeshBasicNodeMaterial();
      m.colorNode = vec3(1.0, 0.03, 0.02).mul(brake.mul(5.0).add(1.2));
      return m;
    },
    // Optiques : phares devant ; derrière (même matériau dans certains modèles), feux de recul.
    head: () => {
      const m = new THREE.MeshBasicNodeMaterial();
      const front = step(0, positionLocal.z);
      m.colorNode = mix(vec3(1.0, 1.0, 0.95).mul(reverse.mul(4.0).add(0.06)), vec3(0.85, 0.92, 1.0).mul(4.5), front);
      return m;
    },
  };
}

export interface ApplyOptions {
  /** 0 = détail complet (joueur), 1 = allégé (adversaires). */
  lod?: 0 | 1;
}

/** Remplace la carrosserie et les roues procédurales d'une voiture par le modèle 3D. */
export function applyCarAsset(visual: CarVisual, asset: CarAsset, spec: CarSpec, options: ApplyOptions = {}): void {
  const lod = options.lod ?? 0;
  const table = looks(visual, lod === 0);
  const made = new Map<string, THREE.Material>();
  const materialOf = (src: THREE.Material): THREE.Material => {
    let m = made.get(src.name);
    if (!m) {
      // Famille inconnue (`tex:…` : plaque, autocollants, livrée) : on garde le matériau du fichier.
      m = table[src.name]?.() ?? src;
      made.set(src.name, m);
    }
    return m;
  };
  const clear = (g: THREE.Object3D): void => {
    for (const child of [...g.children]) {
      g.remove(child);
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && !m.userData.shared) m.geometry.dispose();
      });
    }
  };
  const instance = (src: THREE.Mesh): THREE.Mesh => {
    const mesh = new THREE.Mesh(src.geometry, materialOf(src.material as THREE.Material));
    mesh.userData.shared = true; // géométrie partagée entre voitures : ne pas la libérer
    return mesh;
  };

  clear(visual.body);
  clear(visual.cabin);
  clear(visual.interior);
  // Le fichier a son origine au sol, au milieu des essieux.
  const midZ = (spec.axleFrontZ + spec.axleRearZ) / 2;
  const offset = new THREE.Vector3(0, -REST_HEIGHT, midZ);
  for (const src of lod === 0 ? asset.parts.body : asset.parts.body_lod1) {
    const name = (src.material as THREE.Material).name;
    const mesh = instance(src);
    mesh.position.copy(offset);
    const see = name === 'glass' || name === 'lens';
    if (see) mesh.renderOrder = name === 'glass' ? 3 : 2;
    // Les vitres vont dans `cabin` : masquées en vue intérieure.
    (name === 'glass' ? visual.cabin : visual.body).add(mesh);
  }

  const wheelParts = lod === 0 ? asset.parts.wheel : asset.parts.wheel_lod1.length ? asset.parts.wheel_lod1 : asset.parts.wheel;
  visual.wheels.forEach((w, i) => {
    clear(w.spin);
    const left = i % 2 === 0;
    const isFront = i < 2;
    const radius = isFront ? asset.radiusFront : asset.radiusRear;
    const holder = new THREE.Group();
    // La roue modèle est d'un côté : on la retourne pour l'autre.
    if ((left ? 1 : -1) !== asset.wheelSide) holder.rotation.y = Math.PI;
    holder.scale.setScalar(radius / asset.wheelRadius);
    for (const src of wheelParts) holder.add(instance(src));
    w.spin.add(holder);
    w.spin.position.set(0, 0, 0);
    // Les roues affichées suivent le modèle (voie, empattement, diamètre), pas la physique commune.
    const track = isFront ? asset.halfTrackFront : asset.halfTrackRear;
    visual.wheelOffsets[i] = {
      x: (left ? 1 : -1) * (track - spec.halfTrack),
      y: radius - spec.wheelRadius,
      z: midZ + (isFront ? asset.axleFrontZ : asset.axleRearZ) - (isFront ? spec.axleFrontZ : spec.axleRearZ),
    };
  });
  // Vue intérieure : caméra au pied du pare-brise (les modèles n'ont pas tous un habitacle complet).
  visual.eyePoint.set(0, -REST_HEIGHT + asset.max[1] * 0.8, midZ + asset.axleFrontZ * 0.42);
}
