import { GAMEPAD } from '../config/controls';
import type { ActionEvent, RawInput } from './actions';

/**
 * Manette via l'API Gamepad, interrogée à chaque image.
 * Les gâchettes ZL/ZR des manettes Switch sont numériques (0 ou 1) : la valeur brute
 * est lissée plus loin (voir Vehicle : throttleRise / brakeRise).
 */
export class GamepadSource {
  connected = false;
  name = '';
  lastUsed = 0;
  /** Boutons actuellement enfoncés (pour l'écran de test du panneau). */
  readonly pressed: number[] = [];
  private prev: boolean[] = [];

  constructor(private readonly emit: (e: ActionEvent) => void) {
    window.addEventListener('gamepadconnected', () => this.poll(null));
    window.addEventListener('gamepaddisconnected', () => this.poll(null));
  }

  private pick(): Gamepad | null {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    let fallback: Gamepad | null = null;
    for (const p of pads) {
      if (!p || !p.connected) continue;
      if (p.mapping === 'standard') return p;
      fallback ??= p;
    }
    return fallback;
  }

  /** Lit la manette ; remplit `out` si fourni. Renvoie vrai si une manette est branchée. */
  poll(out: RawInput | null): boolean {
    const pad = this.pick();
    this.connected = pad !== null;
    this.pressed.length = 0;
    if (!pad) {
      this.name = '';
      this.prev.length = 0;
      if (out) {
        out.throttle = out.brake = out.steer = 0;
        out.drift = false;
        out.nos = false;
        out.lookBack = false;
      }
      return false;
    }
    this.name = pad.id;
    const b = pad.buttons;
    let active = false;
    for (let i = 0; i < b.length; i++) {
      const isDown = (b[i]?.pressed ?? false) || (b[i]?.value ?? 0) > 0.5;
      if (isDown) {
        this.pressed.push(i);
        active = true;
        if (!this.prev[i]) {
          const action = GAMEPAD.events[i];
          if (action) this.emit(action);
        }
      }
      this.prev[i] = isDown;
    }
    const rawSteer = pad.axes[GAMEPAD.steerAxis] ?? 0;
    const mag = Math.abs(rawSteer);
    let steer = 0;
    if (mag > GAMEPAD.deadzone) {
      const t = (mag - GAMEPAD.deadzone) / (1 - GAMEPAD.deadzone);
      // Courbe douce : précis autour du centre, plein braquage en butée.
      steer = -Math.sign(rawSteer) * (0.55 * t + 0.45 * t * t);
      active = true;
    }
    if (active) this.lastUsed = performance.now();
    if (out) {
      out.throttle = Math.max(b[GAMEPAD.throttleButton]?.value ?? 0, b[GAMEPAD.throttleButton]?.pressed ? 1 : 0);
      out.brake = Math.max(b[GAMEPAD.brakeButton]?.value ?? 0, b[GAMEPAD.brakeButton]?.pressed ? 1 : 0);
      out.steer = steer;
      out.drift = GAMEPAD.driftButtons.some((i) => b[i]?.pressed ?? false);
      out.nos = GAMEPAD.nosButtons.some((i) => b[i]?.pressed ?? false);
      out.lookBack = GAMEPAD.lookBackButtons.some((i) => b[i]?.pressed ?? false);
    }
    return true;
  }
}
