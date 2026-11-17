import type { ActionEvent, DriveInput, RawInput } from './actions';
import { emptyDriveInput } from './actions';
import { GamepadSource } from './gamepad';
import { KeyboardSource } from './keyboard';

type Listener = (e: ActionEvent) => void;

/** Regroupe clavier + manette en un seul jeu de commandes. */
export class InputManager {
  readonly drive: DriveInput = emptyDriveInput();
  readonly keyboard: KeyboardSource;
  readonly gamepad: GamepadSource;
  private readonly listeners: Listener[] = [];
  private readonly kb: RawInput = { throttle: 0, brake: 0, steer: 0, drift: false, nos: false, lookBack: false };
  private readonly gp: RawInput = { throttle: 0, brake: 0, steer: 0, drift: false, nos: false, lookBack: false };
  private pendingUp = false;
  private pendingDown = false;

  constructor() {
    const emit = (e: ActionEvent): void => {
      if (e === 'shiftUp') this.pendingUp = true;
      else if (e === 'shiftDown') this.pendingDown = true;
      for (const l of this.listeners) l(e);
    };
    this.keyboard = new KeyboardSource(emit);
    this.gamepad = new GamepadSource(emit);
  }

  on(listener: Listener): void {
    this.listeners.push(listener);
  }

  /** « clavier » ou « manette » selon la dernière source utilisée. */
  get activeSource(): 'clavier' | 'manette' {
    return this.gamepad.connected && this.gamepad.lastUsed > this.keyboard.lastUsed ? 'manette' : 'clavier';
  }

  /** À appeler une fois par image, avant les pas de simulation. */
  poll(): void {
    this.keyboard.read(this.kb);
    this.gamepad.poll(this.gp);
    const d = this.drive;
    d.throttle = Math.max(this.kb.throttle, this.gp.throttle);
    d.brake = Math.max(this.kb.brake, this.gp.brake);
    d.steer = Math.abs(this.gp.steer) > Math.abs(this.kb.steer) ? this.gp.steer : this.kb.steer;
    d.drift = this.kb.drift || this.gp.drift;
    d.nos = this.kb.nos || this.gp.nos;
    d.lookBack = this.kb.lookBack || this.gp.lookBack;
  }

  /** À appeler au début de chaque pas fixe : livre les changements de rapport une seule fois. */
  beginStep(): void {
    this.drive.shiftUp = this.pendingUp;
    this.drive.shiftDown = this.pendingDown;
    this.pendingUp = false;
    this.pendingDown = false;
  }
}
