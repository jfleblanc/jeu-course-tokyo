import type { Vehicle } from '../vehicle/vehicle';
import type { PresetName } from '../debug/tuningStore';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
}

/** Affichage en jeu : vitesse, rapport, régime, préréglage A/B, version, aide. */
export class Hud {
  private readonly kmh: HTMLElement;
  private readonly gear: HTMLElement;
  private readonly rpm: HTMLElement;
  private readonly mode: HTMLElement;
  private readonly drift: HTMLElement;
  private readonly preset: HTMLElement;
  private readonly version: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly help: HTMLElement;
  private readonly prog: HTMLElement;
  private readonly nos: HTMLElement;
  private readonly nosFill: HTMLElement;
  private toastTimer = 0;
  private lastKmh = -1;
  private lastGear = '';
  private lastMode = '';

  constructor(backend: string) {
    const speed = el('div', { id: 'hud-speed', class: 'hud' });
    this.gear = el('div', { class: 'gear' }, '1');
    const box = el('div', { class: 'box' });
    const line = el('div', {}, '');
    this.kmh = el('span', { class: 'kmh' }, '0');
    line.append(this.kmh, el('span', { class: 'unit' }, ' KM/H'));
    const rpmBar = el('div', { class: 'rpm' });
    this.rpm = el('i');
    rpmBar.append(this.rpm);
    this.mode = el('div', { class: 'mode' }, 'BOÎTE AUTO');
    this.drift = el('div', { class: 'drift-tag' }, 'DRIFT');
    box.append(this.drift, line, rpmBar, this.mode);
    speed.append(this.gear, box);

    this.version = el('div', { id: 'hud-version', class: 'hud' });
    this.version.innerHTML = `version <b>${__APP_VERSION__}</b><br>${__BUILD_DATE__} · ${backend}<br><span id="hud-fps"></span>`;

    this.preset = el('div', { id: 'hud-preset', class: 'hud' });
    this.toastEl = el('div', { id: 'hud-toast', class: 'hud' });

    this.help = el('div', { id: 'hud-help', class: 'hud' });
    this.help.innerHTML = `
      <h4>COMMANDES</h4>
      <kbd>W</kbd> accélérer · <kbd>S</kbd> freiner / reculer · <kbd>A</kbd> <kbd>D</kbd> tourner<br>
      <kbd>Espace</kbd> drift · <kbd>C</kbd> caméra · <kbd>R</kbd> replacer la voiture<br>
      <kbd>M</kbd> boîte auto / manuelle · <kbd>↑</kbd> <kbd>↓</kbd> rapports (manuelle)<br>
      <kbd>F1</kbd> panneau de réglage · <kbd>B</kbd> basculer conduite A / B<br>
      <kbd>Entrée</kbd> course · <kbd>T</kbd> circuit à 3 tours · <kbd>Y</kbd> épreuve · <kbd>F</kbd> descendre de voiture (garage) · <kbd>Échap</kbd> abandonner<br>
      <kbd>G</kbd> garage · <kbd>E</kbd> NOS (si installé) · <kbd>Maj</kbd> vue arrière<br>
      <kbd>N</kbd> musique suivante · <kbd>P</kbd> musique oui / non<br>
      <kbd>H</kbd> masquer cette aide
      <div class="pad" id="hud-pad"></div>`;

    this.prog = el('div', { id: 'hud-prog', class: 'hud' });
    this.nos = el('div', { id: 'hud-nos', class: 'hud' }, 'NOS<div class="bar"><i></i></div>');
    this.nosFill = this.nos.querySelector('i') as HTMLElement;
    document.body.append(speed, this.version, this.preset, this.toastEl, this.help, this.prog, this.nos);
  }

  setPreset(p: PresetName): void {
    this.preset.innerHTML = `CONDUITE <b>${p}</b>`;
    this.preset.classList.toggle('b', p === 'B');
  }

  /** Bandeau de progression : niveau, palier, XP, argent. */
  setProgress(level: number, tier: string, xp: number, need: number, money: number, trial: boolean): void {
    this.prog.innerHTML = `<div class="line"><span>Niveau <b>${level}</b> · ${tier}</span><span class="money">¥ ${money.toLocaleString('fr-CA')}</span></div><div class="bar"><i style="width:${Math.min(100, (xp / need) * 100).toFixed(0)}%"></i></div>${trial ? '<small class="trial">Épreuve de palier prête : Entrée</small>' : '<small>G : garage</small>'}`;
  }

  /** Jauge de NOS (cachée si la voiture n'en a pas). */
  setNos(installed: boolean, ratio: number): void {
    this.nos.classList.toggle('on', installed);
    if (installed) this.nosFill.style.width = `${(Math.max(0, Math.min(1, ratio)) * 100).toFixed(0)}%`;
  }

  toggleHelp(): void {
    this.help.classList.toggle('hidden');
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('on');
    this.toastTimer = 1.8;
  }

  setPad(text: string): void {
    const pad = document.getElementById('hud-pad');
    if (pad && pad.textContent !== text) pad.textContent = text;
  }

  setPerf(text: string): void {
    const fps = document.getElementById('hud-fps');
    if (fps) fps.innerHTML = text;
  }

  update(dt: number, car: Vehicle, redline: number): void {
    const kmh = Math.round(Math.abs(car.forwardSpeed) * 3.6);
    if (kmh !== this.lastKmh) {
      this.kmh.textContent = String(kmh);
      this.lastKmh = kmh;
    }
    const g = car.drivetrain.gearLabel;
    if (g !== this.lastGear) {
      this.gear.textContent = g;
      this.lastGear = g;
    }
    const ratio = Math.min(1, car.drivetrain.rpm / redline);
    this.rpm.style.width = `${(ratio * 100).toFixed(1)}%`;
    this.gear.classList.toggle('redline', ratio > 0.93);
    const mode = car.drivetrain.mode === 'auto' ? 'BOÎTE AUTO' : 'BOÎTE MANUELLE  ↑ ↓';
    if (mode !== this.lastMode) {
      this.mode.textContent = mode;
      this.lastMode = mode;
    }
    this.drift.classList.toggle('on', Math.abs(car.bodySlip) > 0.22 && car.speed > 8);
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('on');
    }
  }
}
