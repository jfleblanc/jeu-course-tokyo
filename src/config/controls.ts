import type { ActionEvent } from '../input/actions';

/**
 * Mappage des commandes (codes physiques des touches : indépendant de la langue du clavier).
 * Phase 5 : ces tables deviendront modifiables dans un menu et sauvegardées.
 */
export const KEYBOARD = {
  throttle: ['KeyW'],
  brake: ['KeyS'],
  steerLeft: ['KeyA'],
  steerRight: ['KeyD'],
  drift: ['Space'],
  nos: ['KeyE', 'ControlLeft'],
  /** Vue arrière : tant que la touche est tenue. */
  lookBack: ['ShiftLeft', 'ShiftRight'],
} as const;

export const KEY_EVENTS: Record<string, ActionEvent> = {
  ArrowUp: 'shiftUp',
  ArrowDown: 'shiftDown',
  KeyC: 'camera',
  KeyM: 'toggleGearbox',
  F1: 'togglePanel',
  KeyB: 'toggleAB',
  KeyR: 'reset',
  KeyH: 'toggleHelp',
  KeyN: 'musicNext',
  KeyP: 'musicToggle',
  Enter: 'raceStart',
  KeyT: 'circuitStart',
  KeyG: 'garage',
  Tab: 'map',
  Escape: 'raceQuit',
};

/**
 * Manette, disposition « standard » de l'API Gamepad (Switch Pro / Switch 2 Pro en Bluetooth).
 * Rappel Nintendo : B est en bas (0), A à droite (1), Y à gauche (2), X en haut (3).
 */
export const GAMEPAD = {
  throttleButton: 7, // ZR
  brakeButton: 6, // ZL
  steerAxis: 0, // stick gauche, horizontal
  driftButtons: [0], // B
  nosButtons: [1], // A
  lookBackButtons: [10], // clic du stick gauche
  deadzone: 0.14,
  events: {
    5: 'shiftUp', // R
    4: 'shiftDown', // L
    3: 'camera', // X
    2: 'toggleGearbox', // Y
    8: 'togglePanel', // −
    9: 'toggleAB', // +
    10: 'reset', // clic du stick gauche
    15: 'musicNext', // croix : droite
    13: 'musicToggle', // croix : bas
    12: 'raceStart', // croix : haut
    11: 'map', // clic du stick droit
    14: 'raceQuit', // croix : gauche
  } as Record<number, ActionEvent>,
} as const;
