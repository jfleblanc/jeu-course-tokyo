import * as THREE from 'three/webgpu';
import { pass, vec4 } from 'three/tsl';

/** Luminosité maximale par pixel prise en compte par le halo (bloom). */
const BLOOM_INPUT_MAX = 2.2;
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { QUALITY, type Quality, type RenderConfig } from '../config/render';
import { SKY_HORIZON, type CityMaterials } from './materials';

export interface RenderContext {
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** « WebGPU » ou « WebGL2 » (repli automatique). */
  backend: string;
  render(): void;
  apply(cfg: RenderConfig): void;
  resize(): void;
}

export async function createRenderer(container: HTMLElement, quality: Quality, forceWebGL: boolean): Promise<RenderContext> {
  const q = QUALITY[quality];
  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL, powerPreference: 'high-performance' });
  // WebGPU si disponible, sinon repli automatique en WebGL2.
  await renderer.init();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  // Compteurs remis à zéro une fois par image (et non à chaque passe) pour l'overlay de performance.
  renderer.info.autoReset = false;

  const backendObj = renderer.backend as unknown as { isWebGPUBackend?: boolean };
  const backend = backendObj.isWebGPUBackend ? 'WebGPU' : 'WebGL2';

  const scene = new THREE.Scene();
  scene.background = SKY_HORIZON.clone();
  const fog = new THREE.FogExp2(SKY_HORIZON.clone().multiplyScalar(0.75), 0.003);
  scene.fog = fog;

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.15, 1800);

  // Quelques vraies lumières seulement : ambiance bleutée + « lune ». Tout le reste est émissif.
  const hemi = new THREE.HemisphereLight(0x5b6cff, 0x2a1030, 0.32);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0x8fa8ff, 0.22);
  moon.position.set(-0.4, 1, 0.3);
  scene.add(moon);

  // Post-traitement : scène → bloom (la clé de l'ambiance néon)
  const pipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode('output');
  // Le halo ne reçoit jamais plus qu'une certaine luminosité par pixel : un reflet ou une petite
  // lampe très brillants qui entrent dans le champ ne font plus un éclair blanc.
  const bloomInput = sceneColor.min(vec4(BLOOM_INPUT_MAX, BLOOM_INPUT_MAX, BLOOM_INPUT_MAX, 1));
  const bloomPass = bloom(bloomInput as unknown as typeof sceneColor, 0.5, 0.6, 0.75);
  pipeline.outputNode = q.bloom ? sceneColor.add(bloomPass as unknown as typeof sceneColor) : sceneColor;

  let materials: CityMaterials | null = null;

  const ctx: RenderContext & { setMaterials(m: CityMaterials): void } = {
    renderer,
    scene,
    camera,
    backend,
    render() {
      renderer.info.reset();
      pipeline.render();
    },
    apply(cfg) {
      renderer.toneMappingExposure = cfg.exposure;
      bloomPass.strength.value = cfg.bloomStrength;
      bloomPass.radius.value = cfg.bloomRadius;
      bloomPass.threshold.value = cfg.bloomThreshold;
      fog.density = cfg.fogDensity;
      if (materials) {
        materials.tuning.neon.value = cfg.neon;
        materials.tuning.wetness.value = cfg.wetness;
      }
    },
    resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    setMaterials(m) {
      materials = m;
    },
  };
  window.addEventListener('resize', () => ctx.resize());
  return ctx;
}

export type RenderContextInternal = RenderContext & { setMaterials(m: CityMaterials): void };
