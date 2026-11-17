import * as THREE from 'three/webgpu';
import { color, float, mix, positionLocal, step, vec3 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { CarSpec } from '../config/handling';
import type { CarVisual } from './carModel';
import { REST_HEIGHT } from './vehicle';

/**
 * Voitures en vrai modèle 3D (GLB produit par `tools/convert-car.mjs`).
 *
 * Le fichier contient `body` et `wheel` (détail complet, voiture du joueur) ainsi que
 * `body_lod1` et `wheel_lod1` (allégés, adversaires). Origine : au sol, au milieu des essieux,
 * +Z vers l'avant. Les matériaux du fichier sont remplacés par ceux du jeu d'après leur nom :
 * `paint` devient la peinture réglable, `red_glass` les feux de frein, etc.
 */
export interface CarAsset {
  id: string;
  credit: string;
  wheelRadius: number;
  halfTrack: number;
  /** Côté de la roue modèle : −1 = droite (x négatif). */
  wheelSide: number;
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
      const extras = gltf.scene.userData as { credit?: string; wheelRadius?: number; halfTrack?: number; wheelSide?: number };
      const parts: CarAsset['parts'] = { body: [], body_lod1: [], wheel: [], wheel_lod1: [] };
      for (const name of Object.keys(parts) as (keyof CarAsset['parts'])[]) {
        gltf.scene.getObjectByName(name)?.traverse((o: THREE.Object3D) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) parts[name].push(m);
        });
      }
      if (!parts.body.length || !parts.wheel.length) throw new Error(`modèle ${id} incomplet`);
      return { id, credit: extras.credit ?? '', wheelRadius: extras.wheelRadius ?? 0.33, halfTrack: extras.halfTrack ?? 0.8, wheelSide: extras.wheelSide ?? -1, parts };
    });
    cache.set(id, loading);
    p = loading;
  }
  return p;
}

type Look = (src: THREE.MeshStandardMaterial) => THREE.Material;

/** Matériaux du jeu, d'après le nom du matériau dans le fichier. */
function looks(visual: CarVisual): Record<string, Look> {
  const std = (c: [number, number, number], metal: number, rough: number): Look => () => {
    const m = new THREE.MeshStandardNodeMaterial();
    m.colorNode = color(c[0], c[1], c[2]);
    m.metalnessNode = float(metal);
    m.roughnessNode = float(rough);
    return m;
  };
  const glow = (r: number, g: number, b: number, gain: number, braking = 0): Look => () => {
    const m = new THREE.MeshBasicNodeMaterial();
    m.colorNode = vec3(r, g, b).mul(float(gain).add(float(visual.brakeLevel as unknown as number).mul(braking)));
    return m;
  };
  return {
    paint: () => visual.paint,
    chrome: std([0.82, 0.84, 0.88], 1.0, 0.12),
    alloy: std([0.55, 0.57, 0.6], 0.95, 0.3),
    black_paint: std([0.02, 0.02, 0.022], 0.4, 0.45),
    black_matte: std([0.016, 0.016, 0.018], 0.0, 0.8),
    tire: std([0.012, 0.012, 0.013], 0.0, 0.88),
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
    // Même matériau pour les optiques avant et arrière : phares devant, feux de recul derrière.
    headlights: () => {
      const m = new THREE.MeshBasicNodeMaterial();
      const front = step(0, positionLocal.z);
      const reverse = float(visual.reverseLevel as unknown as number).mul(4.0).add(0.06);
      m.colorNode = mix(vec3(1.0, 1.0, 0.95).mul(reverse), vec3(0.85, 0.92, 1.0).mul(4.5), front);
      return m;
    },
    red_glass: glow(1.0, 0.03, 0.02, 1.2, 5.0),
    orange_glass: glow(1.0, 0.42, 0.04, 0.9),
  };
}

export interface ApplyOptions {
  /** 0 = détail complet (joueur), 1 = allégé (adversaires). */
  lod?: 0 | 1;
}

/** Remplace la carrosserie et les roues procédurales d'une voiture par le modèle 3D. */
export function applyCarAsset(visual: CarVisual, asset: CarAsset, spec: CarSpec, options: ApplyOptions = {}): void {
  const lod = options.lod ?? 0;
  const table = looks(visual);
  const made = new Map<string, THREE.Material>();
  const materialOf = (src: THREE.Material): THREE.Material => {
    let m = made.get(src.name);
    if (!m) {
      // Matériau inconnu (plaque, autocollants) : on garde celui du fichier, avec sa texture.
      m = table[src.name]?.(src as THREE.MeshStandardMaterial) ?? src;
      made.set(src.name, m);
    }
    return m;
  };
  const clear = (g: THREE.Object3D): void => {
    for (const child of [...g.children]) {
      g.remove(child);
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
    }
  };

  clear(visual.body);
  clear(visual.cabin);
  clear(visual.interior);
  // Le fichier a son origine au sol, au milieu des essieux.
  const offset = new THREE.Vector3(0, -REST_HEIGHT, (spec.axleFrontZ + spec.axleRearZ) / 2);
  for (const src of lod === 0 ? asset.parts.body : asset.parts.body_lod1) {
    const name = (src.material as THREE.Material).name;
    const mesh = new THREE.Mesh(src.geometry, materialOf(src.material as THREE.Material));
    mesh.position.copy(offset);
    if (name === 'glass') mesh.renderOrder = 2;
    // Les vitres vont dans `cabin` : masquées en vue intérieure, on voit à travers le pare-brise.
    (name === 'glass' ? visual.cabin : visual.body).add(mesh);
  }

  const scale = spec.wheelRadius / asset.wheelRadius;
  const wheelParts = lod === 0 ? asset.parts.wheel : asset.parts.wheel_lod1.length ? asset.parts.wheel_lod1 : asset.parts.wheel;
  visual.wheels.forEach((w, i) => {
    clear(w.spin);
    const left = i % 2 === 0;
    const holder = new THREE.Group();
    // La roue modèle est d'un côté : on la retourne pour l'autre.
    if ((left ? 1 : -1) !== asset.wheelSide) holder.rotation.y = Math.PI;
    holder.scale.setScalar(scale);
    for (const src of wheelParts) holder.add(new THREE.Mesh(src.geometry, materialOf(src.material as THREE.Material)));
    w.spin.add(holder);
    // Voie du modèle (les roues du jeu sont un peu plus écartées que celles de cette voiture).
    w.spin.position.x = (left ? 1 : -1) * (asset.halfTrack - spec.halfTrack);
  });
  // Vue intérieure : caméra au pied du pare-brise (les modèles n'ont pas tous un habitacle complet).
  visual.eyePoint.set(0, 0.52, 0.62);
}
