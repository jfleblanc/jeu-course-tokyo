import { KEYBOARD, KEY_EVENTS } from '../config/controls';
import type { ActionEvent } from './actions';

/**
 * Touches du clavier, modifiables dans le menu des paramètres et sauvegardées dans le navigateur.
 * Les valeurs de départ viennent de `config/controls.ts`.
 */
export type DriveKey = keyof typeof KEYBOARD;
export type BindAction = DriveKey | ActionEvent;

const KEY = 'jeu-course-tokyo.touches';

/** Actions proposées dans le menu, dans l'ordre d'affichage. */
export const BIND_LABELS: { action: BindAction; label: string }[] = [
  { action: 'throttle', label: 'Accélérer' },
  { action: 'brake', label: 'Freiner / reculer' },
  { action: 'steerLeft', label: 'Tourner à gauche' },
  { action: 'steerRight', label: 'Tourner à droite' },
  { action: 'drift', label: 'Drift' },
  { action: 'nos', label: 'NOS' },
  { action: 'lookBack', label: 'Vue arrière (tenir)' },
  { action: 'shiftUp', label: 'Rapport supérieur' },
  { action: 'shiftDown', label: 'Rapport inférieur' },
  { action: 'toggleGearbox', label: 'Boîte auto / manuelle' },
  { action: 'camera', label: 'Changer de caméra' },
  { action: 'reset', label: 'Replacer la voiture' },
  { action: 'raceStart', label: 'Course' },
  { action: 'circuitStart', label: 'Circuit' },
  { action: 'eventStart', label: 'Épreuve (chrono, drift, poursuite)' },
  { action: 'interact', label: 'Descendre / monter en voiture (garage)' },
  { action: 'garage', label: 'Garage' },
  { action: 'map', label: 'Carte complète' },
  { action: 'musicNext', label: 'Musique suivante' },
  { action: 'musicToggle', label: 'Musique oui / non' },
  { action: 'toggleHelp', label: 'Aide' },
];

/** Touches réservées, non modifiables. */
const FIXED = new Set(['Escape', 'F1']);

function defaults(): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const [action, codes] of Object.entries(KEYBOARD)) map[action] = [...codes];
  for (const [code, action] of Object.entries(KEY_EVENTS)) (map[action] ??= []).push(code);
  return map;
}

class Bindings {
  map: Record<string, string[]> = defaults();
  private events = new Map<string, ActionEvent>();
  private driveCodes = new Set<string>();

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Record<string, string[]>;
        for (const [action, codes] of Object.entries(saved)) {
          if (action in this.map && Array.isArray(codes)) this.map[action] = codes.filter((c) => typeof c === 'string');
        }
        // Maj est devenue la vue arrière : une ancienne sauvegarde qui y avait le NOS le déplace.
        if (!('lookBack' in saved)) {
          const nos = (this.map.nos ?? []).filter((c) => c !== 'ShiftLeft' && c !== 'ShiftRight');
          this.map.nos = nos.length ? nos : defaults().nos ?? [];
        }
      }
    } catch {
      // Stockage indisponible : touches par défaut.
    }
    this.rebuild();
  }

  private rebuild(): void {
    this.events.clear();
    this.driveCodes.clear();
    for (const [action, codes] of Object.entries(this.map)) {
      for (const code of codes) {
        if (action in KEYBOARD) this.driveCodes.add(code);
        else this.events.set(code, action as ActionEvent);
      }
    }
  }

  codes(action: BindAction): readonly string[] {
    return this.map[action] ?? [];
  }

  eventOf(code: string): ActionEvent | undefined {
    return this.events.get(code);
  }

  isDriveKey(code: string): boolean {
    return this.driveCodes.has(code);
  }

  /** Attribue une touche à une action (et la retire de celle qui l'avait). Faux si la touche est réservée. */
  set(action: BindAction, code: string): boolean {
    if (FIXED.has(code)) return false;
    for (const [other, codes] of Object.entries(this.map)) {
      if (other !== action && !FIXED.has(codes[0] ?? '')) this.map[other] = codes.filter((c) => c !== code);
    }
    this.map[action] = [code];
    this.rebuild();
    this.save();
    return true;
  }

  reset(): void {
    this.map = defaults();
    this.rebuild();
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.map));
    } catch {
      // tant pis
    }
  }

  /** Nom lisible d'une touche (« KeyW » → « W »). */
  label(code: string | undefined): string {
    if (!code) return '—';
    const names: Record<string, string> = { Space: 'Espace', ShiftLeft: 'Maj', ShiftRight: 'Maj droite', ControlLeft: 'Ctrl', ControlRight: 'Ctrl droite', AltLeft: 'Alt', AltRight: 'Alt droite', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Entrée', Escape: 'Échap', Backspace: 'Retour', Tab: 'Tab', Comma: ',', Period: '.', Semicolon: ';', Slash: '/', Quote: "'", Minus: '-', Equal: '=' };
    if (names[code]) return names[code] as string;
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Numpad')) return 'Pavé ' + code.slice(6);
    return code;
  }

  /** Touche principale d'une action, lisible. */
  key(action: BindAction): string {
    return this.label(this.codes(action)[0]);
  }
}

export const bindings = new Bindings();

/** Quand un menu attend une touche (remappage), il la reçoit ici et le jeu ne la voit pas. */
export const keyCapture: { handler: ((code: string) => void) | null } = { handler: null };
