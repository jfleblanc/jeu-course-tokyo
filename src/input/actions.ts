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
  | 'toggleHelp';

export const emptyDriveInput = (): DriveInput => ({
  throttle: 0,
  brake: 0,
  steer: 0,
  drift: false,
  shiftUp: false,
  shiftDown: false,
});
