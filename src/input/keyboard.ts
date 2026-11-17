import { KEYBOARD, KEY_EVENTS } from '../config/controls';
import type { ActionEvent, RawInput } from './actions';

export class KeyboardSource {
  private readonly down = new Set<string>();
  /** Horodatage de la dernière touche de conduite (pour savoir quelle source est active). */
  lastUsed = 0;

  constructor(private readonly emit: (e: ActionEvent) => void) {
    window.addEventListener('keydown', (ev) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const target = ev.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'text'))) return;
      const action = KEY_EVENTS[ev.code];
      if (action) {
        ev.preventDefault(); // F1 ouvrirait l'aide du navigateur, les flèches feraient défiler la page
        if (!ev.repeat) this.emit(action);
        return;
      }
      if (this.isDriveKey(ev.code)) {
        ev.preventDefault();
        this.down.add(ev.code);
        this.lastUsed = performance.now();
      }
    });
    window.addEventListener('keyup', (ev) => {
      this.down.delete(ev.code);
    });
    // Si la fenêtre perd le focus, on relâche tout (sinon une touche reste « collée »).
    window.addEventListener('blur', () => this.down.clear());
  }

  private isDriveKey(code: string): boolean {
    for (const list of Object.values(KEYBOARD)) {
      if ((list as readonly string[]).includes(code)) return true;
    }
    return false;
  }

  private any(codes: readonly string[]): boolean {
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  read(out: RawInput): void {
    out.throttle = this.any(KEYBOARD.throttle) ? 1 : 0;
    out.brake = this.any(KEYBOARD.brake) ? 1 : 0;
    out.steer = (this.any(KEYBOARD.steerLeft) ? 1 : 0) - (this.any(KEYBOARD.steerRight) ? 1 : 0);
    out.drift = this.any(KEYBOARD.drift);
    out.nos = this.any(KEYBOARD.nos);
  }
}
