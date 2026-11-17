import { PRESET_A, PRESET_B, type HandlingConfig } from '../config/handling';
import { RENDER_DEFAULTS, type RenderConfig } from '../config/render';

export type PresetName = 'A' | 'B';

const KEY = 'jeu-course-tokyo.reglages';
/** À augmenter quand les préréglages par défaut changent : les anciens réglages locaux sont alors ignorés. */
const VERSION = 7;

interface Saved {
  version: number;
  A: HandlingConfig;
  B: HandlingConfig;
  active: PresetName;
  render: RenderConfig;
  musicTrack?: number;
  musicOn?: boolean;
}

/** Réglages A/B courants, sauvegardés dans le navigateur. */
export class TuningStore {
  A: HandlingConfig = { ...PRESET_A };
  B: HandlingConfig = { ...PRESET_B };
  active: PresetName = 'A';
  render: RenderConfig = { ...RENDER_DEFAULTS };
  musicTrack = 0;
  musicOn = true;

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw) as Partial<Saved>;
        if (s.version === VERSION) {
          // On repart des valeurs par défaut pour tolérer l'ajout de nouveaux réglages.
          this.A = { ...PRESET_A, ...s.A };
          this.B = { ...PRESET_B, ...s.B };
          this.active = s.active === 'B' ? 'B' : 'A';
          this.render = { ...RENDER_DEFAULTS, ...s.render };
          this.musicTrack = s.musicTrack ?? 0;
          this.musicOn = s.musicOn ?? true;
        }
      }
    } catch {
      // Stockage indisponible ou corrompu : on garde les valeurs par défaut.
    }
  }

  get current(): HandlingConfig {
    return this.active === 'A' ? this.A : this.B;
  }

  toggle(): PresetName {
    this.active = this.active === 'A' ? 'B' : 'A';
    this.save();
    return this.active;
  }

  reset(): void {
    this.A = { ...PRESET_A };
    this.B = { ...PRESET_B };
    this.render = { ...RENDER_DEFAULTS };
    this.save();
  }

  save(): void {
    try {
      const s: Saved = { version: VERSION, A: this.A, B: this.B, active: this.active, render: this.render, musicTrack: this.musicTrack, musicOn: this.musicOn };
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      // Navigation privée, quota… ce n'est pas grave.
    }
  }

  exportJson(): string {
    return JSON.stringify({ version: __APP_VERSION__, actif: this.active, A: this.A, B: this.B, rendu: this.render }, null, 2);
  }
}
