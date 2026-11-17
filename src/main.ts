import * as THREE from 'three/webgpu';
import { NEON_COLORS, NOS, PAINTS } from './config/cars';
import { CAR_SPEC, PRESET_A, type HandlingConfig } from './config/handling';
import { TIER_TRIAL, aiDifficulty } from './config/progression';
import { PlayerState } from './progression/playerState';
import { GarageMenu } from './ui/garageMenu';
import { RACE } from './config/race';
import { QUALITY, type Quality } from './config/render';
import { WORLD } from './config/world';
import { MusicPlayer } from './audio/musicPlayer';
import { FixedLoop } from './core/loop';
import { TuningStore } from './debug/tuningStore';
import { InputManager } from './input/input';
import { createPhysicsWorld } from './physics/physicsWorld';
import { Race, pickDrivers } from './race/race';
import { buildTrackBank, type Track } from './race/trackBank';
import { RaceCard } from './ui/raceCard';
import { SettingsMenu } from './ui/settingsMenu';
import { Tutorial } from './ui/tutorial';
import { Sfx } from './audio/sfx';
import { Traffic, type TrafficActor } from './world/traffic';
import { TrafficVisuals } from './render/trafficVisuals';
import { emptyDriveInput } from './input/actions';
import { bindings } from './input/bindings';
import { PICKUPS } from './config/race';
import type { AiLevel } from './config/race';
import { raceReward } from './config/progression';
import { RaceVisuals } from './race/raceVisuals';
import { CameraRig } from './render/cameras';
import { createCityMaterials } from './render/materials';
import { createRenderer, type RenderContextInternal } from './render/renderer';
import { AbPanel } from './ui/abPanel';
import { Hud } from './ui/hud';
import { Minimap } from './ui/minimap';
import { RaceHud } from './ui/raceHud';
import { createCarVisual, syncCarVisual } from './vehicle/carModel';
import { applyCarAsset, loadCarAsset } from './vehicle/glbCar';
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
  // ——— Joueur : niveau, argent, garage (sauvegardé dans le navigateur) ———
  const player = new PlayerState();
  const lookOf = (): { color: readonly [number, number, number]; bigWing: boolean } => {
    const owned = player.car;
    const model = player.modelOf(owned);
    return { color: owned.paint >= 0 ? (PAINTS[owned.paint]?.color ?? model.color) : model.color, bigWing: model.bigWing };
  };
  let visualModel = player.car.model;
  let visual = createCarVisual(CAR_SPEC, lookOf());
  scene.add(visual.root);
  // Chaque voiture du garage a son modèle 3D. `?modele=<id>` l'impose à tout le monde (essais) ;
  // `?modele=aucun` revient aux voitures procédurales. Si un fichier ne se charge pas, on garde
  // la voiture procédurale.
  let testModel = params.get('modele');
  // Physique propre à la voiture active (masse, roues motrices, empattement).
  car.setTraits(player.modelOf(player.car).traits);
  const glbOf = (): string | null => (testModel === 'aucun' ? null : (testModel ?? player.modelOf(player.car).glb));
  const dressPlayer = (): Promise<void> => {
    const id = glbOf();
    if (!id) return Promise.resolve();
    const target = visual;
    target.root.visible = false;
    return loadCarAsset(id)
      .then((asset) => {
        if (target !== visual) return;
        applyCarAsset(target, asset, CAR_SPEC, { lod: 0, traits: car.traits });
        rig?.applyVisibility(target);
      })
      .catch((err: unknown) => console.info('Modèle 3D indisponible, voiture procédurale conservée.', err))
      .finally(() => {
        target.root.visible = true;
      });
  };
  // eslint-disable-next-line prefer-const
  let rig: CameraRig | undefined;
  await dressPlayer();
  const applyNeon = (): void => {
    const owned = player.car;
    visual.setUnderglow(owned.neon >= 0 ? (NEON_COLORS[owned.neon]?.color ?? null) : null);
  };
  applyNeon();

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

  let sfx: Sfx | undefined;
  let lastBeep = -1;
  const idleInput = emptyDriveInput();
  // ——— Réglages, commandes, interface ———
  const store = new TuningStore();
  const input = new InputManager();
  const hud = new Hud(ctx.backend);
  hud.setPreset(store.active);
  rig = new CameraRig(camera);
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
      sfx?.setVolume(cfg.sfxVolume);
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
  sfx = new Sfx(store.render.sfxVolume);
  const sound = sfx;

  // ——— Écran titre, tutoriel, paramètres ———
  const direct = params.has('direct'); // ?direct : sans écran titre ni tutoriel (essais automatiques)
  let titlePhase: 'attente' | 'glisse' | 'fini' = direct ? 'fini' : 'attente';
  let titleTime = 0;
  let glide = 0;
  const glideFrom = new THREE.Vector3();
  const glideQuat = new THREE.Quaternion();
  const titleEl = document.createElement('div');
  titleEl.id = 'title';
  titleEl.innerHTML = `<div class="t-name">COURSE DE NUIT<span>東京</span></div><div class="t-go">APPUYEZ SUR <kbd>ENTRÉE</kbd></div><div class="t-sub">ou sur un bouton de la manette</div>`;
  if (titlePhase === 'attente') {
    document.body.append(titleEl);
    document.body.classList.add('titre');
  }
  // Circulation (essai) : en balade seulement. ?trafic=non la coupe.
  const traffic = new Traffic(phys, city.graph, seed);
  const trafficVisuals = new TrafficVisuals(scene, traffic);
  // ?trafic=non : aucune circulation ; ?trafic=balade : pas pendant les courses.
  const trafficOn = params.get('trafic') !== 'non';
  const trafficInRace = params.get('trafic') !== 'balade';
  let lastTrafficRoute: unknown = null;
  const actors: TrafficActor[] = [{ x: 0, z: 0, vx: 0, vz: 0 }];
  const tutorial = new Tutorial();
  let cheat = '';
  let cameraChanged = false;
  const leaveTitle = (): void => {
    if (titlePhase !== 'attente') return;
    titlePhase = 'glisse';
    glide = 0;
    glideFrom.copy(camera.position);
    glideQuat.copy(camera.quaternion);
    titleEl.classList.add('hidden');
    document.body.classList.remove('titre');
    window.setTimeout(() => titleEl.remove(), 1200);
    if (Tutorial.needed) tutorial.start();
  };
  window.addEventListener('pointerdown', leaveTitle);
  window.addEventListener('keydown', (ev) => {
    // Code secret : taper K I K I donne un million de yens (pour tout essayer sans compter).
    cheat = (cheat + ev.code.replace('Key', '')).slice(-4);
    if (cheat === 'KIKI') {
      cheat = '';
      player.money += 1_000_000;
      player.save();
      refreshProgress();
      if (garage.open) {
        garage.toggle();
        garage.toggle();
      }
      sound.coin();
      hud.toast('Code KIKI : +¥ 1 000 000');
    }
    if (ev.code === 'Backspace') tutorial.skip();
    else if (titlePhase === 'attente' && (ev.code === 'Space' || bindings.isDriveKey(ev.code))) leaveTitle();
  });
  const settings = new SettingsMenu({
    musicVolume: () => store.render.musicVolume,
    setMusicVolume: (v) => {
      store.render.musicVolume = v;
      music.setVolume(v);
      store.save();
    },
    sfxVolume: () => store.render.sfxVolume,
    setSfxVolume: (v) => {
      store.render.sfxVolume = v;
      sound.setVolume(v);
      store.save();
    },
    quality: () => quality,
    setQuality: (q) => {
      if (q === quality) return;
      try {
        localStorage.setItem('jeu-course-tokyo.qualite', q);
      } catch {
        // tant pis
      }
      const url = new URL(location.href);
      url.searchParams.delete('q');
      location.href = url.href;
    },
    gearbox: () => car.drivetrain.mode,
    setGearbox: (m) => {
      car.drivetrain.mode = m;
    },
    padPressed: () => input.gamepad.pressed,
    padName: () => input.gamepad.name,
    replayTutorial: () => tutorial.start(),
    click: () => sound.click(),
  });

  // ——— Course ———
  const race = new Race(phys, CAR_SPEC, car);
  const tracks = buildTrackBank(city.graph);
  // ?barrieres : aperçu des rues transversales barrées (désactivé par défaut).
  const raceVisuals = new RaceVisuals(scene, mats, city.graph, params.has('barrieres'), tracks, testModel);
  const minimap = new Minimap(city, tracks.map((t) => ({ x: t.start.x, z: t.start.z, circuit: t.circuit })));
  const card = new RaceCard();
  const raceHud = new RaceHud();

  let raceKind: 'course' | 'circuit' | 'palier' = 'course';
  let lastPhase = race.phase;
  let nosCharge: number = NOS.seconds;
  const tuned: HandlingConfig = { ...PRESET_A };
  const refreshProgress = (): void => hud.setProgress(player.level, player.tierName, player.xp, player.xpNeeded, player.money, player.trialPending);
  refreshProgress();

  // Garage : change de voiture, de peinture ou de néon sans recharger le jeu.
  const garage = new GarageMenu(player, (kind) => {
    if (kind !== 'achat') {
      if (player.car.model !== visualModel) {
        // Autre modèle : on reconstruit la voiture affichée.
        scene.remove(visual.root);
        visual.root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && !m.userData.shared) m.geometry.dispose();
        });
        car.setTraits(player.modelOf(player.car).traits);
        visual = createCarVisual(CAR_SPEC, lookOf());
        scene.add(visual.root);
        rig.applyVisibility(visual);
        void dressPlayer();
        visualModel = player.car.model;
      } else {
        visual.setPaint(lookOf().color);
      }
      applyNeon();
    }
    nosCharge = NOS.seconds;
    refreshProgress();
  });
  let garageTime = 0;

  // Course proposée (fiche affichée) en attente de confirmation.
  let offered: { track: Track; kind: 'course' | 'circuit' | 'palier'; difficulty: number; drivers: AiLevel[] } | null = null;

  /** Affiche la fiche d'un tracé : type, gains, pilotes adverses. */
  const offer = (track: Track, manual: boolean): void => {
    const base = aiDifficulty(player.level);
    // Dernier niveau du palier, barre d'XP pleine : tout circuit devient l'épreuve de palier.
    const kind: 'course' | 'circuit' | 'palier' = track.circuit ? (player.trialPending ? 'palier' : 'circuit') : 'course';
    const difficulty = kind === 'palier' ? base + TIER_TRIAL.extraDifficulty : kind === 'circuit' ? base * RACE.circuit.difficulty : base;
    // Les adversaires changent d'une course à l'autre.
    const drivers = pickDrivers(track.route.seed + player.races * 131);
    offered = { track, kind, difficulty, drivers };
    const reward = raceReward(player.level, 1, track.circuit);
    const title = kind === 'palier' ? 'Épreuve de palier — finir dans les deux premiers' : kind === 'circuit' ? 'Circuit' : 'Course';
    card.show(track, drivers, kind === 'palier' ? { xp: 0, money: reward.money } : reward, difficulty, title, manual);
  };

  const pickTrack = (circuit: boolean): Track | null => {
    const list = tracks.filter((t) => t.circuit === circuit);
    const fallback = list.length ? list : tracks;
    return fallback[Math.floor(Math.random() * fallback.length)] ?? null;
  };

  const launch = (): void => {
    if (!offered) return;
    const o = offered;
    raceKind = o.kind;
    raceHud.title = o.kind === 'palier' ? 'Épreuve de palier' : '';
    raceHud.summary = null;
    nosCharge = NOS.seconds;
    const ok = race.start(o.track.route, { difficulty: o.difficulty, drivers: o.drivers, cashValue: PICKUPS.cashBase + PICKUPS.cashPerLevel * player.level });
    card.hide();
    offered = null;
    hud.toast(!ok ? 'Impossible de lancer la course' : o.kind === 'palier' ? 'Épreuve de palier : finissez dans les deux premiers !' : o.track.name);
  };

  /** Entrée ou T : lance la course proposée, sinon en propose une au hasard dans la banque. */
  const startRace = (kind: 'course' | 'circuit'): void => {
    if (garage.open || !(race.phase === 'idle' || race.phase === 'finished')) return;
    if (card.shown && offered) {
      launch();
      return;
    }
    const track = pickTrack(kind === 'circuit' || player.trialPending);
    if (!track) {
      hud.toast('Aucun tracé disponible');
      return;
    }
    if (race.phase === 'finished') race.stop();
    offer(track, true);
  };

  const respawn = (): void => {
    // En course : on revient sur le tracé, au dernier point atteint.
    const pr = race.player;
    if (race.active && race.route && pr) {
      const q = race.route.points[Math.max(0, pr.index - 2)];
      if (q) {
        car.teleport(q.x, REST_HEIGHT + 0.2, q.z, Math.atan2(q.tx, q.tz));
        return;
      }
    }
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
    // Écran titre : n'importe quelle commande lance le jeu.
    if (titlePhase === 'attente') {
      leaveTitle();
      return;
    }
    if (settings.open && e !== 'raceQuit') return;
    switch (e) {
      case 'camera':
        cameraChanged = true;
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
      case 'raceStart':
        startRace('course');
        break;
      case 'circuitStart':
        startRace('circuit');
        break;
      case 'garage':
        // Pas de garage en pleine course.
        if (garage.open || race.phase === 'idle' || race.phase === 'finished') {
          garage.toggle();
          garageTime = 0;
        }
        break;
      case 'raceQuit':
        if (settings.open) {
          settings.toggle();
        } else if (garage.open) {
          garage.toggle();
        } else if (card.shown) {
          card.hide();
          offered = null;
        } else if (race.active) {
          const wasFinished = race.phase === 'finished';
          race.stop();
          hud.toast(wasFinished ? 'Balade libre' : 'Course abandonnée');
        } else {
          // Rien à fermer : Échap ouvre les paramètres (jeu en pause).
          settings.toggle();
        }
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
      if (garage.open || settings.open) return; // jeu en pause dans les menus
      if (titlePhase === 'attente') {
        // Écran titre : la voiture attend, moteur au ralenti.
        car.update(dt, idleInput, tuned);
        phys.world.step();
        car.afterStep();
        return;
      }
      // NOS : surpuissance tant qu'il en reste ; se recharge seulement en balade libre.
      const hasNos = player.car.nos;
      const boosting = hasNos && input.drive.nos && nosCharge > 0 && input.drive.throttle > 0.2 && race.phase !== 'countdown';
      car.powerBoost = boosting ? NOS.boost : 1;
      if (boosting) nosCharge = Math.max(0, nosCharge - dt);
      else if (hasNos && !race.active) nosCharge = Math.min(NOS.seconds, nosCharge + NOS.refill * dt);
      player.applyTo(store.current, tuned);
      car.update(dt, race.playerInput(input.drive), tuned);
      race.beforeStep(dt, store.current);
      // Circulation : partout en balade ; sur le tracé pendant une course (obstacles).
      const trafficRoute = race.active ? race.route : null;
      if (trafficRoute !== lastTrafficRoute) {
        lastTrafficRoute = trafficRoute;
        traffic.setRoute(trafficRoute && trafficInRace ? trafficRoute.edges : null);
      }
      traffic.enabled = trafficOn && (!race.active || trafficInRace) && race.phase !== 'finished';
      traffic.keepOut = race.phase === 'countdown' ? 130 : 0;
      actors.length = 1;
      const me = actors[0] as TrafficActor;
      const lv = car.body.linvel();
      me.x = car.pos.x; me.z = car.pos.z; me.vx = lv.x; me.vz = lv.z;
      race.obstacles.length = 0;
      if (race.active) {
        for (const r of race.racers) {
          if (r.isPlayer) continue;
          const v = r.car.body.linvel();
          actors.push({ x: r.car.pos.x, z: r.car.pos.z, vx: v.x, vz: v.z });
        }
        for (const c of traffic.cars) if (c.active) race.obstacles.push(c);
      }
      traffic.beforeStep(dt, actors);
      phys.world.step();
      car.afterStep();
      race.afterStep(dt);
      // Filet de sécurité : sortie de carte ou chute sous le sol.
      const b = city.bounds;
      if (car.pos.y < -6 || car.pos.x < b.x0 || car.pos.x > b.x1 || car.pos.z < b.z0 || car.pos.z > b.z1) respawn();
    },
    render(alpha, frameDt) {
      syncCarVisual(visual, car, alpha);
      visual.root.updateMatrixWorld(true);
      const orbit = (window as unknown as { __orbit?: { a: number; d: number; h: number } }).__orbit;
      if (orbit) {
        // Débogage : caméra fixe autour de la voiture (planches de contrôle des modèles 3D).
        const a = car.yaw + orbit.a;
        camera.position.set(visual.root.position.x + Math.sin(a) * orbit.d, visual.root.position.y + orbit.h, visual.root.position.z + Math.cos(a) * orbit.d);
        camera.lookAt(visual.root.position.x, visual.root.position.y + 0.1, visual.root.position.z);
      } else if (garage.open) {
        // Dans le garage, la caméra tourne lentement autour de la voiture.
        garageTime += frameDt;
        const a = car.yaw + 2.4 + garageTime * 0.25;
        camera.position.set(visual.root.position.x + Math.sin(a) * 6.2, visual.root.position.y + 1.7, visual.root.position.z + Math.cos(a) * 6.2);
        camera.lookAt(visual.root.position.x, visual.root.position.y + 0.3, visual.root.position.z);
      } else if (titlePhase === 'attente') {
        // Écran titre : la caméra tourne lentement autour de la voiture.
        titleTime += frameDt;
        const a = car.yaw + 0.7 + titleTime * 0.12;
        camera.position.set(visual.root.position.x + Math.sin(a) * 6.8, visual.root.position.y + 1.25 + Math.sin(titleTime * 0.2) * 0.25, visual.root.position.z + Math.cos(a) * 6.8);
        camera.lookAt(visual.root.position.x, visual.root.position.y + 0.25, visual.root.position.z);
      } else {
        rig.update(frameDt, visual, car);
        if (titlePhase === 'glisse') {
          // Départ : la caméra glisse de l'écran titre jusqu'à sa place derrière la voiture.
          glide = Math.min(1, glide + frameDt / 2.4);
          const k = glide * glide * (3 - 2 * glide);
          camera.position.lerpVectors(glideFrom, camera.position, k);
          camera.quaternion.slerpQuaternions(glideQuat, camera.quaternion, k);
          if (glide >= 1) titlePhase = 'fini';
        }
      }
      if (settings.open) settings.update();
      // Bruitages
      sound.update(frameDt, {
        rpm: car.drivetrain.rpm,
        redline: CAR_SPEC.redlineRpm,
        throttle: car.throttle,
        speed: car.speed,
        slip: car.bodySlip,
        drifting: input.drive.drift,
        nos: car.powerBoost > 1,
        active: !garage.open && !settings.open,
        engine: player.modelOf(player.car).sound,
      });
      // Décompte : un bip par seconde, un plus aigu au départ.
      if (race.phase === 'countdown') {
        const n = Math.ceil(race.countdown);
        if (n !== lastBeep && n >= 1 && n <= 3) sound.beep(false);
        lastBeep = n;
      } else if (lastBeep !== -1) {
        if (race.phase === 'running') sound.beep(true);
        lastBeep = -1;
      }
      tutorial.update(frameDt, {
        kmh: car.speed * 3.6,
        steer: input.drive.steer,
        brake: input.drive.brake,
        drifting: input.drive.drift && Math.abs(car.bodySlip) > 0.12,
        cameraChanged,
        garageOpen: garage.open,
        cardShown: card.shown !== null,
        racing: race.active,
        pad: input.activeSource === 'manette',
      });
      // Fin de course : récompenses.
      if (race.phase !== lastPhase) {
        if (race.phase === 'finished') {
          const me = race.player;
          const place = me ? race.ranking().indexOf(me) + 1 : 4;
          raceHud.summary = player.finishRace(place, raceKind !== 'course', raceKind === 'palier', race.bonusMoney);
          refreshProgress();
          sound.finish(place === 1);
        }
        lastPhase = race.phase;
      }
      visual.nosLevel.value = car.powerBoost > 1 ? 1 : 0;
      hud.setNos(player.car.nos, nosCharge / NOS.seconds);
      sky.position.copy(camera.position);
      raceVisuals.update(race, alpha, frameDt);
      trafficVisuals.update(traffic);
      // Mallettes et téléporteur ramassés
      while (race.events.length) {
        const ev = race.events.shift();
        if (!ev) break;
        if (ev.type === 'cash') sound.coin();
        else sound.warp();
        if (ev.type === 'cash') hud.toast(`Mallette : +¥ ${ev.amount.toLocaleString('fr-CA')}`);
        else hud.toast(ev.gained > 0 ? `Téléporteur : +${Math.round(ev.gained)} m !` : 'Téléporteur : vous êtes déjà en tête');
      }
      // Bornes de départ : en s'arrêtant dessus, la fiche de la course s'affiche.
      if (race.phase === 'idle' && !garage.open && !card.manual) {
        let near: Track | null = null;
        if (car.speed < 9) {
          for (const t of tracks) {
            if ((t.start.x - car.pos.x) ** 2 + (t.start.z - car.pos.z) ** 2 < 6 * 6) near = t;
          }
        }
        if (near && card.shown !== near) offer(near, false);
        else if (!near && card.shown) {
          card.hide();
          offered = null;
        }
      }
      raceHud.update(frameDt, race);
      minimap.update(frameDt, car, race);
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
  (window as unknown as Record<string, unknown>).__jeu = { car, city, store, phys, scene, camera, renderer, rig, input, meshes, colliderCount, race, player, garage, tracks, traffic,
    /** Éclairage de studio pour les planches de contrôle. */
    studio: (): void => {
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8888aa, 3.2));
    },
    /** Essayer un modèle 3D sur la voiture du joueur (planches de contrôle). */
    setModel: (id: string, paint?: [number, number, number]): Promise<void> => {
      testModel = id;
      return loadCarAsset(id).then((asset) => {
        applyCarAsset(visual, asset, CAR_SPEC, { lod: 0 });
        rig.applyVisibility(visual);
        const c = paint ?? asset.paint;
        if (c) visual.setPaint(c);
      });
    },
  };

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
