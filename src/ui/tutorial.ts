import { bindings } from '../input/bindings';

const KEY = 'jeu-course-tokyo.tutoriel';

/** Ce que le tutoriel observe pour savoir qu'une étape est réussie. */
export interface TutorialState {
  kmh: number;
  steer: number;
  brake: number;
  drifting: boolean;
  cameraChanged: boolean;
  garageOpen: boolean;
  mapOpen: boolean;
  cardShown: boolean;
  racing: boolean;
  pad: boolean;
}

interface Step {
  text: (pad: boolean) => string;
  hint: string;
  /** Vrai quand l'étape est réussie (peut cumuler un temps dans `acc`). */
  done: (s: TutorialState, acc: { t: number }, dt: number) => boolean;
}

const k = (action: Parameters<typeof bindings.key>[0]): string => `<kbd>${bindings.key(action)}</kbd>`;

const STEPS: Step[] = [
  { text: (p) => `Accélérez avec ${p ? '<kbd>ZR</kbd>' : k('throttle')} jusqu'à 50 km/h.`, hint: 'La boîte est automatique.', done: (s) => s.kmh > 50 },
  {
    text: (p) => `Tournez avec ${p ? 'le <kbd>stick gauche</kbd>' : `${k('steerLeft')} et ${k('steerRight')}`}.`,
    hint: 'À haute vitesse, le volant tourne moins : c’est voulu.',
    done: (s, a, dt) => {
      if (Math.abs(s.steer) > 0.5 && s.kmh > 15) a.t += dt;
      return a.t > 1.2;
    },
  },
  { text: (p) => `Freinez avec ${p ? '<kbd>ZL</kbd>' : k('brake')}.`, hint: 'À l’arrêt, la même commande fait reculer.', done: (s, a, dt) => ((a.t += s.brake > 0.5 && s.kmh > 8 ? dt : 0), a.t > 0.5) },
  {
    text: (p) => `Drift : prenez un virage à bonne vitesse en tenant ${p ? '<kbd>B</kbd>' : k('drift')}.`,
    hint: 'Gardez les gaz et contre-braquez un peu pour tenir la glisse.',
    done: (s, a, dt) => ((a.t += s.drifting && s.kmh > 35 ? dt : 0), a.t > 0.8),
  },
  { text: (p) => `Changez de caméra avec ${p ? '<kbd>X</kbd>' : k('camera')}.`, hint: 'Vue de poursuite ou vue du capot.', done: (s) => s.cameraChanged },
  { text: () => `Ouvrez la carte avec ${k('map')} : pastilles de course, colis, et votre garage (la maison).`, hint: 'Un clic sur un lieu trace l’itinéraire. Le menu du garage s’ouvre une fois rentré dedans.', done: (s) => s.mapOpen },
  {
    text: (p) => `Lancez une course : arrêtez-vous sur une pastille lumineuse, puis ${p ? '<kbd>croix ↑</kbd>' : k('raceStart')}.`,
    hint: 'Sur la mini-carte : cyan = course, magenta = circuit ; creuse = pas encore faite.',
    done: (s) => s.cardShown || s.racing,
  },
];

/** Tutoriel du premier lancement : une consigne à la fois, validée en la réalisant. */
export class Tutorial {
  active = false;
  private readonly root: HTMLElement;
  private index = 0;
  private acc = { t: 0 };
  private endTimer = 0;
  private pad = false;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'tuto';
    this.root.className = 'hidden';
    document.body.append(this.root);
  }

  /** Vrai si le tutoriel n'a jamais été terminé ou passé. */
  static get needed(): boolean {
    try {
      return localStorage.getItem(KEY) !== 'fait';
    } catch {
      return false;
    }
  }

  start(): void {
    this.active = true;
    this.index = 0;
    this.acc = { t: 0 };
    this.endTimer = 0;
    this.root.classList.remove('hidden', 'done');
    this.render();
  }

  /** Passe le tutoriel (touche Retour arrière). */
  skip(): void {
    if (!this.active) return;
    this.finish();
    this.root.classList.add('hidden');
  }

  private finish(): void {
    this.active = false;
    try {
      localStorage.setItem(KEY, 'fait');
    } catch {
      // tant pis
    }
  }

  private render(): void {
    const step = STEPS[this.index];
    if (!step) return;
    this.root.innerHTML = `<div class="tu-step">Tutoriel · ${this.index + 1} / ${STEPS.length}</div>
      <div class="tu-text">${step.text(this.pad)}</div>
      <div class="tu-hint">${step.hint} · <kbd>Retour</kbd> passer le tutoriel</div>
      <div class="tu-bar"><i style="width:${((this.index / STEPS.length) * 100).toFixed(0)}%"></i></div>`;
  }

  update(dt: number, s: TutorialState): void {
    if (this.endTimer > 0) {
      this.endTimer -= dt;
      if (this.endTimer <= 0) this.root.classList.add('hidden');
      return;
    }
    if (!this.active) return;
    if (s.pad !== this.pad) {
      this.pad = s.pad;
      this.render();
    }
    const step = STEPS[this.index];
    if (step && step.done(s, this.acc, dt)) {
      this.index++;
      this.acc = { t: 0 };
      if (this.index >= STEPS.length) {
        this.finish();
        this.root.classList.add('done');
        this.root.innerHTML = `<div class="tu-step">Tutoriel terminé</div><div class="tu-text">Bonne route ! Gagnez des courses pour monter de niveau et acheter de nouvelles voitures.</div><div class="tu-bar"><i style="width:100%"></i></div>`;
        this.endTimer = 5;
      } else this.render();
    }
  }
}
