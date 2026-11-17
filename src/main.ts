import * as THREE from 'three/webgpu';
import { CAR_SPEC } from './config/handling';
import { QUALITY, type Quality } from './config/render';
import { WORLD } from './config/world';
import { MusicPlayer } from './audio/musicPlayer';
import { FixedLoop } from './core/loop';
import { TuningStore } from './debug/tuningStore';
import { InputManager } from './input/input';
import { createPhysicsWorld } from './physics/physicsWorld';
import { CameraRig } from './render/cameras';
import { createCityMaterials } from './render/materials';
import { createRenderer, type RenderContextInternal } from './render/renderer';
import { AbPanel } from './ui/abPanel';
import { Hud } from './ui/hud';
import { createCarVisual, syncCarVisual } from './vehicle/carModel';
import { REST_HEIGHT, Vehicle } from './vehicle/vehicle';
import { buildCityColliders } from './world/cityColliders';
import { generateCity } from './world/cityGen';
import { buildCityMeshes } from './world/cityMesh';

const bootEl = document.getElementById('boot') as HTMLElement;
const bootMsg = document.getElementById('boot-msg') as HTMLElement;
const setBoot = (text: string): void => {
  bootMsg.textContent = text;
};
/** Laisse le navigateur afficher le message avant une étape lourde. */
const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

function readQuality(params: URLSearchParams): Quality {
  const fromUrl = params.get('q');
  let stored: string | null = null;
  try {
    stored = localStorage.getItem('jeu-course-tokyo.qualite');
  } catch {
    stored = null;
  }
  const v = fromUrl ?? stored ?? 'moyen';
  return v === 'bas' || v === 'haut' ? v : 'moyen';
}

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const quality = readQuality(params);
  const seed = Number(params.get('graine')) || WORLD.seed;

  setBoot('Démarrage du moteur de rendu…');
  await nextFrame();
  const ctx = (await createRenderer(document.getElementById('app') as HTMLElement, quality, params.has('webgl'))) as RenderContextInternal;
  const { scene, camera, renderer } = ctx;

  setBoot('Démarrage de la physique…');
  const phys = await createPhysicsWorld();

  setBoot('Construction du quartier…');
  await nextFrame();
  const city = generateCity(seed);
  const mats = createCityMaterials(QUALITY[quality]);
  ctx.setMaterials(mats);
  const meshes = buildCityMeshes(city, mats);
  scene.add(meshes.group);
  if (QUALITY[quality].reflections) scene.add(mats.reflectorTarget);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 24, 12), mats.sky);
  sky.name = 'ciel';
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  scene.add(sky);
  const colliderCount = buildCityColliders(city, phys);

  // ——— Voiture ———
  const car = new Vehicle(phys, CAR_SPEC, { x: city.spawn.x, y: REST_HEIGHT + 0.15, z: city.spawn.z, yaw: city.spawn.yaw });
  const visual = createCarVisual(CAR_SPEC);
  scene.add(visual.root);

  // ——— Reflets de la carrosserie : on photographie la ville une fois, depuis le point de départ ———
  try {
    const target = new THREE.CubeRenderTarget(128);
    const cubeCam = new THREE.CubeCamera(0.5, 900, target);
    cubeCam.position.set(city.spawn.x, 3.2, city.spawn.z);
    visual.root.visible = false;
    cubeCam.update(renderer as unknown as THREE.Renderer, scene);
    visual.root.visible = true;
    scene.environment = target.texture;
    scene.environmentIntensity = 0.4;
  } catch (err) {
    visual.root.visible = true;
    console.info('Carte d’environnement indisponible, on continue sans.', err);
  }

  // ——— Réglages, commandes, interface ———
  const store = new TuningStore();
  const input = new InputManager();
  const hud = new Hud(ctx.backend);
  hud.setPreset(store.active);
  const rig = new CameraRig(camera);
  rig.applyVisibility(visual);
  let perfText = '';
  const panel = new AbPanel(store, {
    quality,
    onPreset: (p) => {
      hud.setPreset(p);
      hud.toast(`Conduite ${p}`);
    },
    onRender: (cfg) => {
      ctx.apply(cfg);
      music.setVolume(cfg.musicVolume);
    },
    onQuality: (q) => {
      try {
        localStorage.setItem('jeu-course-tokyo.qualite', q);
      } catch {
        /* tant pis */
      }
      const url = new URL(location.href);
      url.searchParams.delete('q');
      location.href = url.toString();
    },
  });
  ctx.apply(store.render);
  const music = new MusicPlayer(store.musicTrack, store.musicOn, store.render.musicVolume);

  const respawn = (): void => {
    let best = city.respawns[0] ?? city.spawn;
    let bestD = Infinity;
    for (const r of city.respawns) {
      const d = (r.x - car.pos.x) ** 2 + (r.z - car.pos.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    car.teleport(best.x, REST_HEIGHT + 0.2, best.z, best.yaw);
  };

  input.on((e) => {
    switch (e) {
      case 'camera':
        hud.toast(rig.toggle(visual) === 'interieure' ? 'Caméra intérieure' : 'Caméra de poursuite');
        break;
      case 'toggleGearbox':
        car.drivetrain.mode = car.drivetrain.mode === 'auto' ? 'manual' : 'auto';
        hud.toast(car.drivetrain.mode === 'auto' ? 'Boîte automatique' : 'Boîte manuelle (↑ ↓ ou R / L)');
        break;
      case 'togglePanel':
        panel.toggle();
        break;
      case 'toggleAB':
        panel.select(store.active === 'A' ? 'B' : 'A');
        break;
      case 'reset':
        respawn();
        hud.toast('Voiture replacée');
        break;
      case 'toggleHelp':
        hud.toggleHelp();
        break;
      case 'musicNext':
        hud.toast(`♪ ${music.next()}`);
        store.musicTrack = music.trackIndex;
        store.musicOn = true;
        store.save();
        break;
      case 'musicToggle':
        store.musicOn = music.toggle();
        store.save();
        hud.toast(store.musicOn ? `♪ ${music.trackName}` : 'Musique coupée');
        break;
      default:
        break;
    }
  });

  // ——— Boucle : physique à pas fixe (60 Hz), rendu interpolé ———
  let frames = 0;
  let perfTimer = 0;
  let perfStart = performance.now();
  const loop = new FixedLoop({
    fixedUpdate(dt) {
      input.beginStep();
      car.update(dt, input.drive, store.current);
      phys.world.step();
      car.afterStep();
      // Filet de sécurité : sortie de carte ou chute sous le sol.
      const b = city.bounds;
      if (car.pos.y < -6 || car.pos.x < b.x0 || car.pos.x > b.x1 || car.pos.z < b.z0 || car.pos.z > b.z1) respawn();
    },
    render(alpha, frameDt) {
      syncCarVisual(visual, car, alpha);
      visual.root.updateMatrixWorld(true);
      rig.update(frameDt, visual, car);
      sky.position.copy(camera.position);
      hud.update(frameDt, car, CAR_SPEC.redlineRpm);

      panel.update(frameDt, car, input, perfText);
      ctx.render();

      // Mesure en temps réel (frameDt est plafonné, il fausserait les i/s sur une machine lente).
      frames++;
      const nowMs = performance.now();
      perfTimer = (nowMs - perfStart) / 1000;
      if (perfTimer >= 0.5) {
        const info = renderer.info.render;
        perfText = `${Math.round(frames / perfTimer)} i/s · ${info.drawCalls} appels · ${Math.round(info.triangles / 1000)}k tri`;
        hud.setPerf(perfText);
        hud.setPad(input.gamepad.connected ? `🎮 Manette : ZR gaz · ZL frein · B/A drift · R/L rapports · X caméra · Y boîte · + A/B · − panneau · croix → musique` : '');
        frames = 0;
        perfStart = nowMs;
      }
    },
  });

  // Accès console pour le débogage : window.__jeu
  (window as unknown as Record<string, unknown>).__jeu = { car, city, store, phys, scene, camera, renderer, rig, visual, input, meshes, colliderCount };

  setBoot('Prêt !');
  // Une première image avant de retirer l'écran de chargement (compile les shaders).
  ctx.render();
  await nextFrame();
  renderer.setAnimationLoop((t: number) => {
    input.poll();
    loop.tick(t);
  });
  bootEl.classList.add('hidden');
  setTimeout(() => bootEl.remove(), 800);
}

boot().catch((err: unknown) => {
  console.error(err);
  bootMsg.classList.add('error');
  setBoot(`Le jeu n'a pas pu démarrer.\n${err instanceof Error ? err.message : String(err)}\n\nEssayez Chrome à jour, ou ajoutez ?webgl à l'adresse.`);
});
