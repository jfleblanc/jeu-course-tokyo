import { CAR_MODELS, MAX_CARS, NEON_PRICE, NOS, PAINT_PRICE, RESALE, UPGRADES, UPGRADE_EFFECT, type CarModel, type UpgradeId } from '../config/cars';
import type { HandlingConfig } from '../config/handling';
import { activeProfileId, listProfiles, saveKeyFor } from './profiles';
import { MAX_LEVEL, START_MONEY, TIER_TRIAL, raceReward, tierOf, xpToNext } from '../config/progression';

/**
 * État du joueur : niveau, XP, argent, garage. Un seul objet versionné, sauvegardé dans le
 * navigateur. Aucune dépendance au rendu.
 */
export interface OwnedCar {
  model: string;
  upgrades: Record<UpgradeId, number>;
  nos: boolean;
  /** Indice dans PAINTS, ou −1 pour la couleur de série. */
  paint: number;
  /** Indice dans NEON_COLORS, ou −1 si pas de néon. */
  neon: number;
  neonOwned: boolean;
  /** Total dépensé pour cette voiture (achat + améliorations), base de la revente. */
  spent: number;
}

interface SaveData {
  version: number;
  level: number;
  xp: number;
  money: number;
  cars: OwnedCar[];
  active: number;
  races: number;
  wins: number;
}

export interface RaceSummary {
  place: number;
  xp: number;
  money: number;
  leveledUp: boolean;
  level: number;
  /** Vrai si l'épreuve de palier vient d'être réussie. */
  promoted: boolean;
  /** Part de l'argent venant des mallettes ramassées. */
  bonus: number;
  /** Vrai si c'était une épreuve de palier (réussie ou non). */
  trial: boolean;
  tierName: string;
}

const VERSION = 1;

const newCar = (model: CarModel): OwnedCar => ({
  model: model.id,
  upgrades: { engine: 0, tires: 0, weight: 0 },
  nos: false,
  paint: -1,
  neon: -1,
  neonOwned: false,
  spent: model.price > 0 ? model.price : model.baseValue,
});

export class PlayerState {
  level = 1;
  xp = 0;
  money = START_MONEY;
  cars: OwnedCar[] = [newCar(CAR_MODELS[0] as CarModel)];
  active = 0;
  races = 0;
  wins = 0;

  /** Clé de sauvegarde du joueur en cours (une par carte de joueur). */
  private key = 'jeu-course-tokyo.joueur.invite';
  /** Identifiant du joueur en cours, ou null (invité : essais automatiques, première visite). */
  profileId: string | null = null;

  constructor() {
    listProfiles(); // migre au besoin l'ancienne sauvegarde unique vers un premier joueur
    const id = activeProfileId();
    if (id) this.loadProfile(id);
    else this.load();
  }

  /** Passe à un autre joueur : recharge sa sauvegarde (ou une partie neuve). */
  loadProfile(id: string): void {
    this.profileId = id;
    this.key = saveKeyFor(id);
    this.level = 1;
    this.xp = 0;
    this.money = START_MONEY;
    this.cars = [newCar(CAR_MODELS[0] as CarModel)];
    this.active = 0;
    this.races = 0;
    this.wins = 0;
    this.load();
    this.save();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return;
      const d = JSON.parse(raw) as Partial<SaveData>;
      // Migration : quand le format changera, convertir ici les anciennes versions.
      if (d.version !== VERSION || !Array.isArray(d.cars) || d.cars.length === 0) return;
      this.level = Math.max(1, Math.min(MAX_LEVEL, d.level ?? 1));
      this.xp = Math.max(0, d.xp ?? 0);
      this.money = Math.max(0, d.money ?? 0);
      this.cars = d.cars.filter((c) => CAR_MODELS.some((m) => m.id === c.model)).slice(0, MAX_CARS);
      if (this.cars.length === 0) this.cars = [newCar(CAR_MODELS[0] as CarModel)];
      this.active = Math.max(0, Math.min(this.cars.length - 1, d.active ?? 0));
      this.races = d.races ?? 0;
      this.wins = d.wins ?? 0;
    } catch {
      // Sauvegarde illisible : on repart de zéro plutôt que de planter.
    }
  }

  save(): void {
    try {
      const d: SaveData = { version: VERSION, level: this.level, xp: this.xp, money: this.money, cars: this.cars, active: this.active, races: this.races, wins: this.wins };
      localStorage.setItem(this.key, JSON.stringify(d));
    } catch {
      // Navigation privée, quota… tant pis.
    }
  }

  /** Remet le joueur à zéro (bouton du garage). */
  reset(): void {
    this.level = 1;
    this.xp = 0;
    this.money = START_MONEY;
    this.cars = [newCar(CAR_MODELS[0] as CarModel)];
    this.active = 0;
    this.races = 0;
    this.wins = 0;
    this.save();
  }

  get car(): OwnedCar {
    return this.cars[this.active] as OwnedCar;
  }

  modelOf(car: OwnedCar): CarModel {
    return CAR_MODELS.find((m) => m.id === car.model) ?? (CAR_MODELS[0] as CarModel);
  }

  get tierName(): string {
    return tierOf(this.level).name;
  }

  get xpNeeded(): number {
    return xpToNext(this.level);
  }

  /** Au dernier niveau d'un palier avec la barre d'XP pleine : il faut réussir l'épreuve de palier. */
  get trialPending(): boolean {
    return this.level < MAX_LEVEL && this.level % 10 === 0 && this.xp >= this.xpNeeded;
  }

  // ——— Performance : multiplie le réglage de conduite choisi ———

  /** Écrit dans `out` le réglage `base` ajusté pour la voiture active (modèle + améliorations). */
  applyTo(base: HandlingConfig, out: HandlingConfig): HandlingConfig {
    Object.assign(out, base);
    const car = this.car;
    const m = this.modelOf(car);
    const light = 1 + car.upgrades.weight * UPGRADE_EFFECT.weight;
    const grip = m.grip * (1 + car.upgrades.tires * UPGRADE_EFFECT.tires);
    out.enginePower = base.enginePower * m.power * (1 + car.upgrades.engine * UPGRADE_EFFECT.engine) * light;
    out.gripFront = base.gripFront * grip;
    out.gripRear = base.gripRear * grip;
    out.gripLong = base.gripLong * grip;
    out.brakeForce = base.brakeForce * m.brake * light;
    return out;
  }

  // ——— Courses ———

  /** Enregistre le résultat d'une course et renvoie ce qui a été gagné. */
  finishRace(place: number, circuit: boolean, trial: boolean, bonusMoney = 0): RaceSummary {
    const reward = raceReward(this.level, place, circuit);
    reward.money += bonusMoney;
    this.races++;
    if (place === 1) this.wins++;
    this.money += reward.money;
    let leveledUp = false;
    let promoted = false;
    if (trial) {
      // Épreuve de palier : la réussir fait passer au palier suivant.
      if (place <= TIER_TRIAL.placeNeeded && this.level < MAX_LEVEL) {
        this.level++;
        this.xp = 0;
        leveledUp = true;
        promoted = true;
      }
    } else if (this.level < MAX_LEVEL) {
      this.xp += reward.xp;
      while (this.level < MAX_LEVEL && this.xp >= this.xpNeeded) {
        // Au dernier niveau d'un palier, la barre reste pleine en attendant l'épreuve.
        if (this.level % 10 === 0) {
          this.xp = this.xpNeeded;
          break;
        }
        this.xp -= this.xpNeeded;
        this.level++;
        leveledUp = true;
      }
    }
    this.save();
    return { place, xp: trial ? 0 : reward.xp, money: reward.money, bonus: bonusMoney, leveledUp, level: this.level, promoted, trial, tierName: this.tierName };
  }

  // ——— Garage ———

  upgradePrice(car: OwnedCar, id: UpgradeId): number | null {
    const def = UPGRADES.find((u) => u.id === id);
    if (!def) return null;
    return def.prices[car.upgrades[id]] ?? null;
  }

  private pay(car: OwnedCar, price: number): boolean {
    if (this.money < price) return false;
    this.money -= price;
    car.spent += price;
    this.save();
    return true;
  }

  buyUpgrade(id: UpgradeId): boolean {
    const car = this.car;
    const price = this.upgradePrice(car, id);
    if (price === null || !this.pay(car, price)) return false;
    car.upgrades[id]++;
    this.save();
    return true;
  }

  buyNos(): boolean {
    const car = this.car;
    if (car.nos || !this.pay(car, NOS.price)) return false;
    car.nos = true;
    this.save();
    return true;
  }

  /** Change la peinture (payante si elle est différente de la peinture actuelle). */
  setPaint(index: number): boolean {
    const car = this.car;
    if (car.paint === index) return true;
    if (!this.pay(car, PAINT_PRICE)) return false;
    car.paint = index;
    this.save();
    return true;
  }

  /** Néon sous la voiture : acheté une fois, puis la couleur se change librement (−1 = éteint). */
  setNeon(index: number): boolean {
    const car = this.car;
    if (!car.neonOwned) {
      if (!this.pay(car, NEON_PRICE)) return false;
      car.neonOwned = true;
    }
    car.neon = index;
    this.save();
    return true;
  }

  resaleValue(car: OwnedCar): number {
    return Math.round((car.spent * RESALE) / 10) * 10;
  }

  canBuy(model: CarModel): 'ok' | 'possédée' | 'garage plein' | 'argent' {
    if (this.cars.some((c) => c.model === model.id)) return 'possédée';
    if (this.cars.length >= MAX_CARS) return 'garage plein';
    if (this.money < model.price) return 'argent';
    return 'ok';
  }

  buyCar(model: CarModel): boolean {
    if (this.canBuy(model) !== 'ok') return false;
    this.money -= model.price;
    this.cars.push(newCar(model));
    this.active = this.cars.length - 1;
    this.save();
    return true;
  }

  /** Revente en tout temps, sauf la dernière voiture. */
  sellCar(index: number): boolean {
    if (this.cars.length <= 1 || !this.cars[index]) return false;
    this.money += this.resaleValue(this.cars[index] as OwnedCar);
    this.cars.splice(index, 1);
    if (this.active >= this.cars.length) this.active = this.cars.length - 1;
    else if (this.active > index) this.active--;
    this.save();
    return true;
  }

  select(index: number): void {
    if (this.cars[index]) {
      this.active = index;
      this.save();
    }
  }
}
