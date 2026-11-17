/**
 * Couche d'abstraction des commandes : le jeu ne connaît que ces actions.
 * Clavier et manette sont mappés dessus (voir keyboard.ts et gamepad.ts).
 */
export interface DriveInput {
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** -1..1, positif = à gauche. */
  steer: number;
  drift: boolean;
  nos: boolean;
  /** Vue arrière tenue. */
  lookBack: boolean;
  /** Vrai pendant un seul pas de simulation. */
  shiftUp: boolean;
  shiftDown: boolean;
}

/** Commandes brutes d'une source (avant lissage). */
export interface RawInput {
  throttle: number;
  brake: number;
  steer: number;
  drift: boolean;
  nos: boolean;
  lookBack: boolean;
}

/** Actions ponctuelles (un appui = un événement). */
export type ActionEvent =
  | 'shiftUp'
  | 'shiftDown'
  | 'camera'
  | 'toggleGearbox'
  | 'togglePanel'
  | 'toggleAB'
  | 'reset'
  | 'toggleHelp'
  | 'musicNext'
  | 'musicToggle'
  | 'raceStart'
  | 'circuitStart'
  | 'garage'
  | 'map'
  | 'raceQuit';

export const emptyDriveInput = (): DriveInput => ({
  throttle: 0,
  brake: 0,
  steer: 0,
  drift: false,
  nos: false,
  lookBack: false,
  shiftUp: false,
  shiftDown: false,
});
