import { clamp } from '../core/math';
import type { CarSpec } from '../config/handling';

export type GearboxMode = 'auto' | 'manual';

/**
 * Moteur + boîte de vitesses. Rapport : -1 = marche arrière, 0 = point mort, 1..n.
 * Aucune dépendance au rendu ni à la physique : on lui donne la vitesse des roues
 * motrices, il rend la force de traction disponible.
 */
export class Drivetrain {
  mode: GearboxMode = 'auto';
  gear = 1;
  rpm: number;
  /** Temps restant de coupure de couple pendant un changement de rapport. */
  private shiftTimer = 0;
  private sinceShift = 10;

  constructor(private readonly spec: CarSpec) {
    this.rpm = spec.idleRpm;
  }

  get gearCount(): number {
    return this.spec.gearRatios.length;
  }

  get gearLabel(): string {
    return this.gear === -1 ? 'R' : this.gear === 0 ? 'N' : String(this.gear);
  }

  get isShifting(): boolean {
    return this.shiftTimer > 0;
  }

  private ratio(gear: number): number {
    if (gear === 0) return 0;
    if (gear < 0) return -this.spec.reverseRatio;
    return this.spec.gearRatios[gear - 1] ?? 1;
  }

  private torqueAt(rpm: number): number {
    const curve = this.spec.torqueCurve;
    const x = clamp(rpm / 1000, 0, curve.length - 1.001);
    const i = Math.floor(x);
    const a = curve[i] ?? 0;
    const b = curve[i + 1] ?? a;
    return a + (b - a) * (x - i);
  }

  shift(delta: number): void {
    const next = clamp(this.gear + delta, -1, this.gearCount);
    if (next === this.gear) return;
    this.gear = next;
    this.shiftTimer = this.spec.shiftTime;
    this.sinceShift = 0;
  }

  setGear(gear: number): void {
    if (gear !== this.gear) this.shift(gear - this.gear);
  }

  /**
   * Moteur débrayé (voiture tenue à l'arrêt) : le régime suit librement l'accélérateur, avec le
   * rupteur qui fait « ratatouiller » en haut. Aucune force aux roues.
   */
  rev(dt: number, throttle: number): number {
    const s = this.spec;
    let target = s.idleRpm + throttle * (s.redlineRpm + 250 - s.idleRpm);
    if (throttle > 0.85 && this.rpm > s.redlineRpm - 80) target = s.redlineRpm - 900;
    this.rpm += (target - this.rpm) * Math.min(1, dt * (target > this.rpm ? 8 : 5));
    this.shiftTimer = 0;
    return 0;
  }

  /**
   * @param wheelSpeed vitesse longitudinale moyenne des roues motrices (m/s, + = avant)
   * @param throttle 0..1
   * @param sliding vrai si la voiture glisse fort (on retarde alors la boîte auto)
   * @returns force de traction totale aux roues motrices (N, signée)
   */
  update(dt: number, wheelSpeed: number, throttle: number, power: number, engineBrake: number, sliding: boolean): number {
    const s = this.spec;
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    this.sinceShift += dt;

    const ratio = this.ratio(this.gear) * s.finalDrive;
    const wheelRpm = (wheelSpeed / s.wheelRadius) * ratio * (60 / (2 * Math.PI));

    let target: number;
    if (this.gear === 0) {
      target = s.idleRpm + throttle * (s.redlineRpm - s.idleRpm);
    } else {
      // « Embrayage » : à très basse vitesse le moteur ne cale pas, il patine.
      const launch = s.idleRpm + throttle * 2600;
      target = Math.max(wheelRpm, launch * (Math.abs(this.gear) === 1 ? 1 : 0.5), s.idleRpm);
    }
    target = Math.min(target, s.redlineRpm + 150);
    // Le régime affiché suit avec une petite inertie (plus agréable à l'œil et à l'oreille).
    this.rpm += (target - this.rpm) * Math.min(1, dt * 14);

    if (this.mode === 'auto' && this.gear >= 1 && this.shiftTimer <= 0 && this.sinceShift > 0.45) {
      if (wheelRpm > s.autoUpshiftRpm && this.gear < this.gearCount && throttle > 0.05 && !sliding) {
        this.shift(1);
      } else if (this.gear > 1) {
        // Rétrograde si le régime tombe, ou plus tôt à pleine charge (kick-down).
        const lowerRatio = this.ratio(this.gear - 1) * s.finalDrive;
        const rpmIfDown = (wheelSpeed / s.wheelRadius) * lowerRatio * (60 / (2 * Math.PI));
        const kickDown = throttle > 0.9 && rpmIfDown < s.autoUpshiftRpm - 1000;
        if (wheelRpm < s.autoDownshiftRpm || kickDown) {
          this.shift(-1);
        }
      }
    }

    if (this.gear === 0 || this.shiftTimer > 0) return 0;

    const engineRpm = Math.max(target, s.idleRpm);
    let torque = 0;
    if (engineRpm < s.redlineRpm) {
      torque = this.torqueAt(engineRpm) * throttle * power;
    }
    // Frein moteur : proportionnel au régime, seulement gaz relâchés.
    if (throttle < 0.05 && Math.abs(wheelSpeed) > 1.5) {
      torque -= engineBrake * 90 * (engineRpm / s.redlineRpm) * Math.sign(wheelSpeed * ratio);
    }
    return (torque * ratio * s.drivetrainEfficiency) / s.wheelRadius;
  }
}
