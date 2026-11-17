import { bindings, keyCapture } from './bindings';
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
      if (keyCapture.handler) {
        // Remappage en cours : la touche va au menu.
        ev.preventDefault();
        const h = keyCapture.handler;
        keyCapture.handler = null;
        h(ev.code);
        return;
      }
      const action = bindings.eventOf(ev.code);
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
    return bindings.isDriveKey(code);
  }

  private any(codes: readonly string[]): boolean {
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  read(out: RawInput): void {
    out.throttle = this.any(bindings.codes('throttle')) ? 1 : 0;
    out.brake = this.any(bindings.codes('brake')) ? 1 : 0;
    out.steer = (this.any(bindings.codes('steerLeft')) ? 1 : 0) - (this.any(bindings.codes('steerRight')) ? 1 : 0);
    out.drift = this.any(bindings.codes('drift'));
    out.nos = this.any(bindings.codes('nos'));
  }
}
