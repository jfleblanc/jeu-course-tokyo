import type RAPIER from '@dimforge/rapier3d-compat';
import { clamp, moveToward, lerp } from '../core/math';
import { BASE_TRAITS, type CarTraits } from '../config/handling';
import type { CarSpec, HandlingConfig } from '../config/handling';
import type { DriveInput } from '../input/actions';
import { GROUP_CAR, type PhysicsWorld, WHEEL_RAY_GROUPS } from '../physics/physicsWorld';
import { Drivetrain } from './drivetrain';
import { railGuide, type RailCar, type RailPush } from '../world/railGuide';

/**
 * Modèle de véhicule « maison » posé sur Rapier :
 *  - le châssis est un corps rigide Rapier (collisions avec la ville) ;
 *  - chaque roue est un rayon (raycast Rapier) avec ressort + amortisseur ;
 *  - les pneus sont calculés ici (angle de dérive, cercle d'adhérence) pour que
 *    chaque sensation ait un réglage dans le panneau A/B.
 * Aucune dépendance à Three.js : le rendu lit l'état (voir carModel.ts).
 *
 * Repère voiture : +Z = avant, +X = gauche, +Y = haut.
 */

export interface WheelState {
  readonly front: boolean;
  readonly left: boolean;
  /** Ancrage dans le repère voiture. */
  mx: number;
  readonly my: number;
  mz: number;
  inContact: boolean;
  /** Longueur de suspension courante (ancrage → centre de roue). */
  suspLength: number;
  prevSuspLength: number;
  compression: number;
  /** Charge verticale (N). */
  load: number;
  /** Angle de dérive du pneu (rad). */
  slipAngle: number;
  /** Adhérence utilisée : 0 = rien, 1 = à la limite, > 1 = glisse. */
  gripUse: number;
  steerAngle: number;
  /** Rotation de la roue (rad), pour l'affichage. */
  spin: number;
  prevSpin: number;
  spinSpeed: number;
}

const WHEEL_COUNT = 4;
const CAR_SPEC_INERTIA_Y = 2500;
/** Hauteur approximative de l'origine du châssis au repos (m). */
export const REST_HEIGHT = 0.59;

function makeWheel(front: boolean, left: boolean, spec: CarSpec): WheelState {
  return {
    front,
    left,
    mx: (left ? 1 : -1) * spec.halfTrack,
    my: spec.mountY,
    mz: front ? spec.axleFrontZ : spec.axleRearZ,
    inContact: false,
    suspLength: spec.suspRestLength,
    prevSuspLength: spec.suspRestLength,
    compression: 0,
    load: 0,
    slipAngle: 0,
    gripUse: 0,
    steerAngle: 0,
    spin: 0,
    prevSpin: 0,
    spinSpeed: 0,
  };
}

/** Compression au-delà de laquelle ce qu'il y a sous la roue est un rebord, pas la route (m). */
const LEDGE_COMPRESSION = 0.45;

/** Anti-tonneau : roulis libre (rad) et vitesse de roulis libre (rad/s), puis rappel et frein. */
const STABILITY = { freeRoll: 0.1, freeRate: 0.9, spring: 60, damp: 9 };

/** Comportement en l'air (saut en haut d'une rampe). */
const AIR = { extraGravity: 1.1, align: 9, damp: 5, cushionRange: 8, cushionDecel: 75, touchdownSpeed: 3.5 };

export class Vehicle {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly wheels: WheelState[];
  readonly drivetrain: Drivetrain;

  // État lu par le rendu / la télémétrie
  /** Position et rotation au pas précédent et courant (pour l'interpolation). */
  readonly prevPos = { x: 0, y: 0, z: 0 };
  readonly pos = { x: 0, y: 0, z: 0 };
  readonly prevRot = { x: 0, y: 0, z: 0, w: 1 };
  readonly rot = { x: 0, y: 0, z: 0, w: 1 };
  /** Vitesse le long de l'axe de la voiture (m/s, + = avant). */
  forwardSpeed = 0;
  /** Vitesse totale (m/s). */
  speed = 0;
  /** Angle de dérive de la caisse (rad, + = la vitesse pointe à gauche du nez). */
  bodySlip = 0;
  yawRate = 0;
  /** Angle de braquage moyen des roues avant (rad). */
  steerAngle = 0;
  /** Commandes lissées effectivement appliquées. */
  throttle = 0;
  brake = 0;
  /** 0 = adhérence normale, 1 = drift complet. */
  driftAmount = 0;
  /** Vrai si le frein est serré (feux stop). */
  braking = false;
  reversing = false;
  /** Accélération longitudinale lissée (m/s²) pour la caméra. */
  accelLong = 0;
  /** Multiplicateur de puissance momentané (NOS). 1 = normal. */
  powerBoost = 1;

  /** Caractère de la voiture (masse, roues motrices, géométrie) : voir setTraits. */
  traits: CarTraits = BASE_TRAITS;
  private massRatio = 1;
  private inertiaY: number = CAR_SPEC_INERTIA_Y;
  private readonly com = { x: 0, y: 0, z: 0 };

  private steerInput = 0;
  private driftWasDown = false;
  private readonly ray: RAPIER.Ray;
  // Vecteurs temporaires (pas d'allocation dans la boucle)
  private readonly tmpImpulse = { x: 0, y: 0, z: 0 };
  private readonly tmpPoint = { x: 0, y: 0, z: 0 };
  private readonly tmpTorque = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly phys: PhysicsWorld,
    private readonly spec: CarSpec,
    spawn: { x: number; y: number; z: number; yaw: number },
  ) {
    const R = phys.rapier;
    const half = spawn.yaw / 2;
    const bodyDesc = R.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, spawn.y, spawn.z)
      .setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) })
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setLinearDamping(0)
      .setAngularDamping(0.15)
      .setAdditionalMassProperties(spec.mass, spec.centerOfMass, spec.inertia, { x: 0, y: 0, z: 0, w: 1 });
    this.body = phys.world.createRigidBody(bodyDesc);

    const he = spec.halfExtents;
    this.railCar.halfWidth = he.x; this.railCar.halfLength = he.z;
    const colDesc = R.ColliderDesc.cuboid(he.x, he.y, he.z)
      .setTranslation(0, spec.colliderOffsetY, 0)
      .setDensity(0)
      .setFriction(0.15)
      .setRestitution(0.12)
      .setCollisionGroups(GROUP_CAR);
    this.collider = phys.world.createCollider(colDesc, this.body);

    this.wheels = [
      makeWheel(true, true, spec),
      makeWheel(true, false, spec),
      makeWheel(false, true, spec),
      makeWheel(false, false, spec),
    ];
    this.com.x = spec.centerOfMass.x;
    this.com.y = spec.centerOfMass.y;
    this.com.z = spec.centerOfMass.z;
    this.inertiaY = spec.inertia.y;
    this.drivetrain = new Drivetrain(spec);
    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this.syncPose();
    this.copyPose();
  }

  /**
   * Donne à la voiture son caractère : masse, roues motrices, empattement, voies, centre de masse.
   * Les inerties suivent la masse et l'empattement.
   */
  setTraits(t: CarTraits): void {
    const spec = this.spec;
    this.traits = t;
    this.massRatio = t.mass / spec.mass;
    const wb = (t.axleFrontZ - t.axleRearZ) / (spec.axleFrontZ - spec.axleRearZ);
    const track = (t.halfTrackFront + t.halfTrackRear) / (2 * spec.halfTrack);
    const k = this.massRatio;
    const inertia = { x: spec.inertia.x * k * wb * wb, y: spec.inertia.y * k * wb * wb, z: spec.inertia.z * k * track * track };
    this.inertiaY = inertia.y;
    this.com.y = t.comY;
    this.com.z = t.comZ;
    this.body.setAdditionalMassProperties(t.mass, this.com, inertia, { x: 0, y: 0, z: 0, w: 1 }, true);
    for (const w of this.wheels) {
      w.mx = (w.left ? 1 : -1) * (w.front ? t.halfTrackFront : t.halfTrackRear);
      w.mz = w.front ? t.axleFrontZ : t.axleRearZ;
    }
  }

  /** Replace la voiture (touche R ou sortie de carte). */
  teleport(x: number, y: number, z: number, yaw: number, speed = 0): void {
    const half = yaw / 2;
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }, true);
    // `speed` : vitesse conservée dans la nouvelle direction (téléporteur).
    this.body.setLinvel({ x: Math.sin(yaw) * speed, y: 0, z: Math.cos(yaw) * speed }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    if (this.drivetrain.gear < 1) this.drivetrain.setGear(1);
    this.syncPose();
    this.copyPose();
  }

  /** Cap de la voiture autour de l'axe vertical (rad). */
  get yaw(): number {
    const q = this.rot;
    // direction avant = q * (0,0,1)
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    return Math.atan2(fx, fz);
  }

  private syncPose(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.pos.x = t.x;
    this.pos.y = t.y;
    this.pos.z = t.z;
    this.rot.x = r.x;
    this.rot.y = r.y;
    this.rot.z = r.z;
    this.rot.w = r.w;
  }

  private copyPose(): void {
    this.prevPos.x = this.pos.x;
    this.prevPos.y = this.pos.y;
    this.prevPos.z = this.pos.z;
    this.prevRot.x = this.rot.x;
    this.prevRot.y = this.rot.y;
    this.prevRot.z = this.rot.z;
    this.prevRot.w = this.rot.w;
    for (const w of this.wheels) {
      w.prevSpin = w.spin;
      w.prevSuspLength = w.suspLength;
    }
  }

  /**
   * Un pas de simulation. À appeler AVANT world.step(), dans le pas fixe uniquement.
   */
  update(dt: number, input: DriveInput, cfg: HandlingConfig): void {
    const spec = this.spec;
    const body = this.body;
    this.copyPose();
    this.syncPose();

    const q = this.rot;
    const p = this.pos;
    const lv = body.linvel();
    const av = body.angvel();

    // ——— Axes de la voiture dans le monde ———
    const xx = q.x * q.x, yy = q.y * q.y, zz = q.z * q.z;
    const xy = q.x * q.y, xz = q.x * q.z, yz = q.y * q.z;
    const wx = q.w * q.x, wy = q.w * q.y, wz = q.w * q.z;
    // gauche = q*(1,0,0)
    const lx = 1 - 2 * (yy + zz), ly = 2 * (xy + wz), lz = 2 * (xz - wy);
    // haut = q*(0,1,0)
    const ux = 2 * (xy - wz), uy = 1 - 2 * (xx + zz), uz = 2 * (yz + wx);
    // avant = q*(0,0,1)
    const fx = 2 * (xz + wy), fy = 2 * (yz - wx), fz = 1 - 2 * (xx + yy);

    // Centre de masse dans le monde
    const c = this.com;
    const comX = p.x + lx * c.x + ux * c.y + fx * c.z;
    const comY = p.y + ly * c.x + uy * c.y + fy * c.z;
    const comZ = p.z + lz * c.x + uz * c.y + fz * c.z;

    const vF = lv.x * fx + lv.y * fy + lv.z * fz;
    const vL = lv.x * lx + lv.y * ly + lv.z * lz;
    const speed = Math.hypot(lv.x, lv.y, lv.z);
    const yawRate = av.x * ux + av.y * uy + av.z * uz;
    const prevForward = this.forwardSpeed;
    this.forwardSpeed = vF;
    this.speed = speed;
    this.yawRate = yawRate;
    this.accelLong = lerp(this.accelLong, (vF - prevForward) / dt, 0.15);
    const planar = Math.hypot(vF, vL);
    // Angle de dérive de la caisse : fiable seulement quand on roule vraiment.
    const slipBlend = clamp((planar - 3) / 5, 0, 1);
    this.bodySlip = Math.atan2(vL, Math.abs(vF) + 0.5) * slipBlend;

    // ——— Boîte : marche arrière automatique ———
    const dt_ = this.drivetrain;
    let throttleCmd = input.throttle;
    let brakeCmd = input.brake;
    if (dt_.mode === 'manual') {
      if (input.shiftUp) dt_.shift(1);
      if (input.shiftDown) dt_.shift(-1);
    } else {
      if (dt_.gear === 0) dt_.setGear(1);
      if (dt_.gear >= 1 && vF < 1.0 && brakeCmd > 0.3 && throttleCmd < 0.1) dt_.setGear(-1);
      else if (dt_.gear === -1 && vF > -1.0 && throttleCmd > 0.3 && brakeCmd < 0.1) dt_.setGear(1);
      if (dt_.gear === -1) {
        // En marche arrière auto, le frein devient l'accélérateur (et inversement).
        const t = throttleCmd;
        throttleCmd = brakeCmd;
        brakeCmd = t;
      }
    }
    this.reversing = dt_.gear === -1;

    // ——— Lissage des commandes (gâchettes numériques, clavier) ———
    this.throttle = moveToward(this.throttle, throttleCmd, dt / (throttleCmd > this.throttle ? cfg.throttleRise : 0.12));
    this.brake = moveToward(this.brake, brakeCmd, dt / (brakeCmd > this.brake ? cfg.brakeRise : 0.1));
    this.braking = this.brake > 0.05;

    // ——— Direction ———
    const speedKmh = Math.abs(vF) * 3.6;
    const steerT = clamp(speedKmh / cfg.steerSpeedRef, 0, 1);
    // Courbe douce : le braquage diminue vite au début, puis se stabilise.
    const maxSteer = lerp(cfg.steerMaxDeg, cfg.steerMinDeg, 1 - (1 - steerT) * (1 - steerT)) * (Math.PI / 180);
    const rate = cfg.steerRate * (Math.abs(input.steer) > Math.abs(this.steerInput) ? 1 : 1.6);
    this.steerInput = moveToward(this.steerInput, clamp(input.steer, -1, 1), rate * dt);
    // Aide au contre-braquage : les roues avant suivent en partie la direction réelle du
    // déplacement. Pendant un drift (espace) l'aide est presque totale : le volant sert
    // alors à choisir l'angle (braquer dedans = plus d'angle, contre-braquer = on ressort).
    const lockRad = cfg.steerMaxDeg * (Math.PI / 180);
    const assistGain = lerp(cfg.counterSteer, Math.max(cfg.counterSteer, 0.92), this.driftAmount);
    const assist = vF > 0 ? assistGain * this.bodySlip : 0;
    // Quand on contre-braque dans une glisse, on a droit à tout l'angle de braquage.
    const countering = this.steerInput * this.bodySlip > 0 ? clamp(Math.abs(this.bodySlip) / 0.3, 0, 1) : 0;
    const playerSteer = this.steerInput * lerp(maxSteer, lockRad, countering);
    const steer = clamp(playerSteer + assist, -lockRad - 0.15, lockRad + 0.15);
    this.steerAngle = steer;

    // ——— Drift ———
    const driftDown = input.drift;
    const driftTarget = driftDown ? 1 : 0;
    const driftRate = driftTarget > this.driftAmount ? dt / 0.08 : dt / Math.max(0.05, cfg.driftRecovery);
    this.driftAmount = moveToward(this.driftAmount, driftTarget, driftRate);
    const rearGripFactor = lerp(1, cfg.driftRearGrip, this.driftAmount);
    let yawImpulse = 0;
    if (driftDown && !this.driftWasDown && vF > 8 && Math.abs(this.steerInput) > 0.15) {
      yawImpulse += Math.sign(this.steerInput) * cfg.driftKick;
    }
    this.driftWasDown = driftDown;
    // Frein à main façon arcade : à basse vitesse, espace + volant braqué fait pivoter la voiture
    // sur place (demi-tour). Plus on va vite, moins il agit : au-delà, c'est le drift habituel.
    // On en décide au moment où l'on appuie : un drift lancé vite reste un drift jusqu'au bout,
    // même quand la vitesse retombe.
    if (driftDown && !this.hbWasDown) this.hbLatch = clamp(2 - speedKmh / cfg.handbrakeSpeed, 0, 1);
    this.hbWasDown = driftDown;
    const handbrake = this.driftAmount * this.hbLatch * clamp((Math.abs(this.steerInput) - 0.3) / 0.5, 0, 1) * (planar > 2 ? 1 : 0);
    yawImpulse += Math.sign(this.steerInput) * cfg.handbrakeYaw * handbrake * dt;

    // ——— Suspension : un rayon par roue ———
    const rayLen = spec.suspRestLength + spec.wheelRadius;
    const mass = this.traits.mass;
    const mr = this.massRatio;
    const staticLoad = (mass * 9.81) / WHEEL_COUNT;
    const maxSuspForce = staticLoad * 4;
    const bump = this.bumpForce;
    let contacts = 0;
    for (let i = 0; i < WHEEL_COUNT; i++) {
      const w = this.wheels[i] as WheelState;
      const ox = p.x + lx * w.mx + ux * w.my + fx * w.mz;
      const oy = p.y + ly * w.mx + uy * w.my + fy * w.mz;
      const oz = p.z + lz * w.mx + uz * w.my + fz * w.mz;
      const ro = this.ray.origin;
      const rd = this.ray.dir;
      ro.x = ox; ro.y = oy; ro.z = oz;
      rd.x = -ux; rd.y = -uy; rd.z = -uz;
      const hit = this.phys.world.castRayAndGetNormal(this.ray, rayLen, true, undefined, WHEEL_RAY_GROUPS, undefined, body);
      const prevComp = w.compression;
      // Sur un maillage de triangles la normale peut pointer vers le bas : on la retourne face au rayon.
      let hnx = 0, hny = 1, hnz = 0;
      if (hit) {
        const flip = hit.normal.x * ux + hit.normal.y * uy + hit.normal.z * uz < 0 ? -1 : 1;
        hnx = hit.normal.x * flip; hny = hit.normal.y * flip; hnz = hit.normal.z * flip;
      }
      // Rebord sous la roue (dessus d'une glissière, toit d'une autre voiture) : la surface est plus
      // haute que ce que la suspension peut encaisser, caisse posée au sol comprise. Ce n'est pas un
      // appui : sans ce tri, la roue « grimpe » sur la glissière et la voiture s'arrête net.
      const ledge = hit !== null && spec.suspRestLength - (hit.timeOfImpact - spec.wheelRadius) > LEDGE_COMPRESSION;
      // Au ras d'une glissière, la normale renvoyée peut être celle de la paroi : on roule quand
      // même sur le tablier, donc on prend la verticale de la voiture.
      if (hit && !ledge && hny <= 0.3) { hnx = ux; hny = uy; hnz = uz; }
      if (hit && !ledge && hny > 0.3) {
        const dist = hit.timeOfImpact;
        w.inContact = true;
        w.suspLength = Math.max(spec.suspRestLength - spec.suspMaxTravel, dist - spec.wheelRadius);
        w.compression = spec.suspRestLength - (dist - spec.wheelRadius);
        hitNormals[i * 3] = hnx;
        hitNormals[i * 3 + 1] = hny;
        hitNormals[i * 3 + 2] = hnz;
        hitPoints[i * 3] = ox - ux * dist;
        hitPoints[i * 3 + 1] = oy - uy * dist;
        hitPoints[i * 3 + 2] = oz - uz * dist;
        contacts++;
      } else {
        w.inContact = false;
        w.suspLength = moveToward(w.suspLength, spec.suspRestLength, dt * 2);
        w.compression = 0;
      }
      const compVel = clamp((w.compression - prevComp) / dt, -3, 3);
      suspForce[i] = w.inContact ? (cfg.suspStiffness * w.compression + cfg.suspDamping * compVel) * mr : 0;
      // Butée : en fin de course (grosse compression en bas d'une rampe, réception d'un saut) un
      // ressort très raide prend le relais, pour que la caisse ne racle pas la route.
      bump[i] = 0;
      const over = w.compression - spec.suspMaxTravel * 0.8;
      if (w.inContact && over > 0) bump[i] = Math.max(0, (cfg.suspStiffness * 9 * over + cfg.suspDamping * 2.5 * Math.max(0, compVel)) * mr);
    }
    // Barre antiroulis : transfère de la force du côté détendu vers le côté comprimé.
    for (let axle = 0; axle < 2; axle++) {
      const a = this.wheels[axle * 2] as WheelState;
      const b = this.wheels[axle * 2 + 1] as WheelState;
      if (a.inContact && b.inContact) {
        const f = cfg.antiRoll * mr * (a.compression - b.compression);
        suspForce[axle * 2] = (suspForce[axle * 2] as number) + f;
        suspForce[axle * 2 + 1] = (suspForce[axle * 2 + 1] as number) - f;
      }
    }

    // ——— Force moteur ———
    const rl = this.wheels[2] as WheelState;
    const rr = this.wheels[3] as WheelState;
    const sliding = Math.abs(this.bodySlip) > 0.3 || this.driftAmount > 0.5;
    // Contrôle de stabilité : hors drift, si la voiture part en travers, l'antipatinage coupe
    // une partie des gaz pour qu'elle se remette en ligne au lieu de tourner en rond.
    const slideExcess = clamp((Math.abs(this.bodySlip) - 0.2) / 0.3, 0, 1) * (1 - this.driftAmount);
    const powerCut = 1 - cfg.tractionControl * slideExcess * (vF > 0 ? 1 : 0);
    const driveForce = dt_.update(dt, vF, this.throttle * powerCut, cfg.enginePower * this.powerBoost * mr, cfg.engineBrake * mr, sliding);
    // Répartition du couple : propulsion, traction ou intégrale.
    const driveFront = this.traits.driveFront;
    const rearContacts = (rl.inContact ? 1 : 0) + (rr.inContact ? 1 : 0);
    const frontContacts = ((this.wheels[0] as WheelState).inContact ? 1 : 0) + ((this.wheels[1] as WheelState).inContact ? 1 : 0);
    const frontDrive = frontContacts > 0 ? (driveForce * driveFront) / frontContacts : 0;
    const rearDrive = rearContacts > 0 ? (driveForce * (1 - driveFront)) / rearContacts : 0;

    // ——— Pneus ———
    const peakSlip = cfg.peakSlipDeg * (Math.PI / 180);
    const massShare = mass / WHEEL_COUNT;
    // Hauteur d'application des forces : entre le sol (plein transfert) et le centre de masse (aucun).
    const comHeight = Math.max(0.05, REST_HEIGHT + this.com.y);
    const liftApply = (1 - cfg.weightTransfer) * comHeight;
    const tcCap = lerp(1.0, 0.72, cfg.tractionControl);

    for (let i = 0; i < WHEEL_COUNT; i++) {
      const w = this.wheels[i] as WheelState;
      w.steerAngle = w.front ? steer : 0;
      if (!w.inContact) {
        w.load = 0;
        w.gripUse = 0;
        w.slipAngle = 0;
        // Roue en l'air : elle ralentit doucement (ou s'emballe si motrice).
        w.spinSpeed = lerp(w.spinSpeed, (w.front ? driveFront > 0.5 : driveFront < 0.9) ? (vF / spec.wheelRadius) * (1 + this.throttle) : vF / spec.wheelRadius, 0.05);
        w.spin += w.spinSpeed * dt;
        continue;
      }
      const nx = hitNormals[i * 3] as number, ny = hitNormals[i * 3 + 1] as number, nz = hitNormals[i * 3 + 2] as number;
      const cx = hitPoints[i * 3] as number, cy = hitPoints[i * 3 + 1] as number, cz = hitPoints[i * 3 + 2] as number;

      const fs = clamp(suspForce[i] as number, 0, maxSuspForce) + Math.min(bump[i] as number, maxSuspForce * 3);
      const load = fs * Math.max(0, nx * ux + ny * uy + nz * uz);
      w.load = load;

      // Vitesse du point de contact
      const rx = cx - comX, ry = cy - comY, rz = cz - comZ;
      const vx = lv.x + (av.y * rz - av.z * ry);
      const vy = lv.y + (av.z * rx - av.x * rz);
      const vz = lv.z + (av.x * ry - av.y * rx);

      // Direction de la roue, projetée sur le sol
      const cs = Math.cos(w.steerAngle), sn = Math.sin(w.steerAngle);
      let hx = fx * cs + lx * sn, hy = fy * cs + ly * sn, hz = fz * cs + lz * sn;
      const hn = hx * nx + hy * ny + hz * nz;
      hx -= nx * hn; hy -= ny * hn; hz -= nz * hn;
      const hl = Math.hypot(hx, hy, hz) || 1;
      hx /= hl; hy /= hl; hz /= hl;
      // côté = normale × avant (≈ gauche)
      const sx = ny * hz - nz * hy, sy = nz * hx - nx * hz, sz = nx * hy - ny * hx;

      const vLong = vx * hx + vy * hy + vz * hz;
      const vLat = vx * sx + vy * sy + vz * sz;

      // — Longitudinal —
      let fLong = 0;
      fLong += w.front ? frontDrive : rearDrive;
      const brakeShare = w.front ? cfg.brakeBias : 1 - cfg.brakeBias;
      let fBrake = (this.brake * cfg.brakeForce * mr * brakeShare) / 2 + spec.rollingResistance / WHEEL_COUNT;
      // Le frein ne peut pas inverser le sens de la roue en un pas.
      fBrake = Math.min(fBrake, (Math.abs(vLong) * massShare) / dt);
      fLong -= Math.sign(vLong) * fBrake;

      const longLimit = cfg.gripLong * load;
      let longRatio = longLimit > 1 ? fLong / longLimit : 0;
      const longExcess = Math.abs(longRatio);
      // Antipatinage / ABS simplifiés : on plafonne la part d'adhérence utilisée en long.
      longRatio = clamp(longRatio, -tcCap, tcCap);
      fLong = longRatio * longLimit;

      // — Latéral —
      const slip = Math.atan2(vLat, Math.abs(vLong) + 2.0);
      w.slipAngle = slip;
      const n = slip / peakSlip;
      const an = Math.abs(n);
      let curve: number;
      if (an < 1) curve = n * (1.5 - 0.5 * n * n);
      else curve = Math.sign(n) * (cfg.slideGrip + (1 - cfg.slideGrip) * Math.exp(-(an - 1) * 1.2));
      const muLat = (w.front ? cfg.gripFront : cfg.gripRear * rearGripFactor);
      // Cercle d'adhérence : ce qui est pris en long n'est plus disponible en latéral.
      // Au freinage, l'aide « freinage en virage » laisse aux pneus presque toute leur tenue latérale
      // (sinon, frein à fond = la voiture file tout droit).
      const isBraking = fLong * vLong < 0;
      const coupling = isBraking ? 0.85 * (1 - cfg.trailBraking) : 0.85;
      const latScale = Math.sqrt(Math.max(0.04, 1 - longRatio * longRatio * coupling));
      const latLimit = muLat * load * latScale;
      let fLat = -latLimit * curve;
      // À basse vitesse, on ne dépasse jamais la force qui annule la vitesse latérale (pas d'oscillation).
      const stopForce = (Math.abs(vLat) * massShare) / dt * 0.5;
      if (Math.abs(fLat) > stopForce) fLat = Math.sign(fLat) * stopForce;

      w.gripUse = Math.max(Math.min(longExcess, 2), an);

      // — Application —
      const imp = this.tmpImpulse;
      const pt = this.tmpPoint;
      // Suspension : le long de la normale, au point de contact
      imp.x = nx * fs * dt; imp.y = ny * fs * dt; imp.z = nz * fs * dt;
      pt.x = cx; pt.y = cy; pt.z = cz;
      body.applyImpulseAtPoint(imp, pt, true);
      // Pneu : au point de contact remonté vers le centre de masse selon « transfert de poids »
      imp.x = (hx * fLong + sx * fLat) * dt;
      imp.y = (hy * fLong + sy * fLat) * dt;
      imp.z = (hz * fLong + sz * fLat) * dt;
      pt.x = cx + ux * liftApply; pt.y = cy + uy * liftApply; pt.z = cz + uz * liftApply;
      body.applyImpulseAtPoint(imp, pt, true);

      // Rotation visuelle de la roue (patinage si la motricité est dépassée)
      let wheelSpeed = vLong / spec.wheelRadius;
      if ((w.front ? driveFront > 0.5 : driveFront < 0.9) && longExcess > 1 && this.throttle > 0.5) wheelSpeed *= 1 + Math.min(1.5, longExcess - 1);
      if (this.brake > 0.9 && longExcess > 1.1) wheelSpeed *= 0.3;
      w.spinSpeed = wheelSpeed;
      w.spin += wheelSpeed * dt;
    }

    // ——— Forces sur la caisse ———
    const imp = this.tmpImpulse;
    // Traînée aérodynamique
    const drag = spec.dragCoef * speed;
    imp.x = -lv.x * drag * dt; imp.y = -lv.y * drag * dt; imp.z = -lv.z * drag * dt;
    if (contacts > 0) {
      // Appui : pousse la voiture vers le sol avec la vitesse²
      const down = cfg.downforce * vF * vF * dt;
      imp.x -= ux * down; imp.y -= uy * down; imp.z -= uz * down;
    }
    if (contacts === 0 && speed > 6) {
      // En l'air : la voiture retombe plus vite qu'en vrai (moins de longs vols plats en haut des
      // rampes) et se remet dans l'axe de sa trajectoire pour se recevoir à plat, sans planter le nez.
      imp.y -= mass * 9.81 * AIR.extraGravity * dt;
      const vx = lv.x / speed, vy = lv.y / speed, vz = lv.z / speed;
      const sgn = vF >= 0 ? 1 : -1;
      // rotation qui amène l'avant sur la vitesse : avant × vitesse
      const cx = (fy * vz - fz * vy) * sgn, cy = (fz * vx - fx * vz) * sgn, cz = (fx * vy - fy * vx) * sgn;
      // on ne garde que le tangage (autour de l'axe latéral) : le lacet reste au joueur
      const pitchErr = cx * lx + cy * ly + cz * lz;
      const pitchRate = av.x * lx + av.y * ly + av.z * lz;
      const rollRate = av.x * fx + av.y * fy + av.z * fz;
      const k = (pitchErr * AIR.align - pitchRate * AIR.damp) * this.inertiaY * dt;
      const kr = -rollRate * AIR.damp * 0.5 * this.inertiaY * dt;
      const tq = this.tmpTorque;
      tq.x = lx * k + fx * kr; tq.y = ly * k + fy * kr; tq.z = lz * k + fz * kr;
      body.applyTorqueImpulse(tq, true);
      // Coussin de réception : à l'approche du sol on freine la chute petit à petit. Sans lui, une
      // voiture qui retombe de haut s'enfonce dans la route en un pas de calcul et s'arrête net.
      const ro = this.ray.origin, rd = this.ray.dir;
      ro.x = p.x; ro.y = p.y; ro.z = p.z; rd.x = 0; rd.y = -1; rd.z = 0;
      const hit = this.phys.world.castRayAndGetNormal(this.ray, AIR.cushionRange, true, undefined, WHEEL_RAY_GROUPS, undefined, body);
      if (hit) {
        const flip = hit.normal.y < 0 ? -1 : 1;
        const nx = hit.normal.x * flip, ny = hit.normal.y * flip, nz = hit.normal.z * flip;
        if (ny > 0.5) {
          const closing = -(lv.x * nx + lv.y * ny + lv.z * nz);
          const room = Math.max(0, hit.timeOfImpact * ny - 0.6);
          const allowed = Math.sqrt(2 * AIR.cushionDecel * room) + AIR.touchdownSpeed;
          if (closing > allowed) {
            const k = mass * (closing - allowed);
            imp.x += nx * k; imp.y += ny * k; imp.z += nz * k;
          }
        }
      }
    }
    body.applyImpulse(imp, true);

    // Accroche en drift : on rend à la voiture, au centre de masse (donc sans effet sur le lacet),
    // une partie de l'adhérence retirée aux pneus arrière. La trajectoire se courbe vers le nez
    // au lieu de filer tout droit, et la glisse fait perdre un peu de vitesse.
    if (contacts >= 2 && this.driftAmount > 0.01 && cfg.driftCarve > 0) {
      const want = cfg.driftCarve * 9.81 * mass * this.driftAmount * clamp(Math.abs(this.bodySlip) / 0.2, 0, 1);
      const f = Math.min(want, (Math.abs(vL) * mass) / dt * 0.5);
      const k = -Math.sign(vL) * f * dt;
      imp.x = lx * k; imp.y = 0; imp.z = lz * k;
      body.applyImpulse(imp, true);
    }

    if (contacts >= 2 && handbrake > 0.01 && speed > 1) {
      // Roues arrière bloquées : la voiture perd de la vitesse pendant qu'elle pivote.
      const k = -Math.min(cfg.handbrakeDecel * handbrake * dt, speed) * mass / speed;
      imp.x = lv.x * k; imp.y = 0; imp.z = lv.z * k;
      body.applyImpulse(imp, true);
    }
    // Glissières douces : retenue calculée juste avant le contact (voir src/world/railGuide.ts).
    const guide = railGuide();
    this.scraping = false;
    if (guide) {
      const rc = this.railCar, fl = Math.hypot(fx, fz) || 1;
      rc.x = p.x; rc.y = p.y; rc.z = p.z; rc.fx = fx / fl; rc.fz = fz / fl; rc.vx = lv.x; rc.vz = lv.z;
      const push = guide.push(rc, dt, this.railPush);
      if (push.touching) {
        this.scraping = true;
        imp.x = push.dvx * mass; imp.y = 0; imp.z = push.dvz * mass;
        body.applyImpulse(imp, true);
        const tq = this.tmpTorque;
        tq.x = 0; tq.y = push.dyaw * this.inertiaY; tq.z = 0;
        body.applyTorqueImpulse(tq, true);
      }
    }
    if (contacts >= 1) {
      // Anti-tonneau : au-delà de quelques degrés de roulis (appui contre une glissière, bordure
      // prise de travers), on redresse la caisse et on freine sa rotation. En conduite normale
      // (2 à 4° de roulis en virage) il n'intervient pas.
      const roll = Math.asin(clamp(ly, -1, 1));
      const rollRate = av.x * fx + av.y * fy + av.z * fz;
      const excess = Math.abs(roll) - STABILITY.freeRoll;
      let k = 0;
      if (excess > 0) k -= Math.sign(roll) * excess * STABILITY.spring;
      if (Math.abs(rollRate) > STABILITY.freeRate) k -= (rollRate - Math.sign(rollRate) * STABILITY.freeRate) * STABILITY.damp;
      if (k !== 0) {
        k *= this.inertiaY * 0.35 * dt;
        const tq = this.tmpTorque;
        tq.x = fx * k; tq.y = fy * k; tq.z = fz * k;
        body.applyTorqueImpulse(tq, true);
      }
    }
    if (contacts >= 2) {
      const iy = this.inertiaY;
      // Amortissement du lacet (réduit pendant le drift pour laisser pivoter)
      // Au freinage le poids passe à l'avant et l'arrière s'allège : on stabilise davantage (façon ESP).
      const brakeStab = 1 + 2.5 * this.brake * (1 - this.driftAmount);
      let yawTorque = -cfg.yawDamping * brakeStab * yawRate * iy * lerp(1, 0.35, this.driftAmount) * dt;
      // Limite d'angle de drift : au-delà, on ramène le nez vers la trajectoire.
      // (pendant un demi-tour au frein à main, on laisse la voiture se mettre complètement en travers)
      const maxAngle = lerp(cfg.driftMaxAngleDeg, 175, handbrake) * (Math.PI / 180);
      const excess = Math.abs(this.bodySlip) - maxAngle;
      if (excess > 0 && planar > 3) {
        const k = Math.min(1, excess / 0.12);
        // Ressort vers la trajectoire + frein sur la rotation qui aggrave l'angle.
        yawTorque += Math.sign(this.bodySlip) * excess * 26 * iy * dt;
        if (yawRate * this.bodySlip < 0) yawTorque -= yawRate * 7 * k * iy * dt;
      }
      yawTorque += yawImpulse * iy;
      const tq = this.tmpTorque;
      tq.x = ux * yawTorque; tq.y = uy * yawTorque; tq.z = uz * yawTorque;
      body.applyTorqueImpulse(tq, true);
    }
  }

  private readonly bumpForce = [0, 0, 0, 0];
  /** Vrai quand la voiture frotte une glissière (pour le son, les étincelles). */
  scraping = false;
  private readonly railCar: RailCar = { x: 0, y: 0, z: 0, fx: 0, fz: 1, halfWidth: 0.88, halfLength: 2.12, vx: 0, vz: 0 };
  private readonly railPush: RailPush = { dvx: 0, dvz: 0, dyaw: 0, touching: false };
  private hbLatch = 0;
  private hbWasDown = false;

  /** À appeler juste après world.step() pour que le rendu ait l'état courant. */
  afterStep(): void {
    this.syncPose();
  }
}

// Tampons partagés (une seule voiture mise à jour à la fois)
const hitNormals = new Float64Array(WHEEL_COUNT * 3);
const hitPoints = new Float64Array(WHEEL_COUNT * 3);
const suspForce = new Float64Array(WHEEL_COUNT);
