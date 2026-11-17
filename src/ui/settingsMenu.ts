import { BIND_LABELS, bindings, keyCapture, type BindAction } from '../input/bindings';
import type { Quality } from '../config/render';

/** Ce que le menu lit et modifie ; le jeu fournit les fonctions. */
export interface SettingsHost {
  musicVolume(): number;
  setMusicVolume(v: number): void;
  sfxVolume(): number;
  setSfxVolume(v: number): void;
  quality(): Quality;
  /** Enregistre la qualité et recharge la page. */
  setQuality(q: Quality): void;
  gearbox(): 'auto' | 'manual';
  setGearbox(m: 'auto' | 'manual'): void;
  /** Boutons de manette enfoncés (pour le test). */
  padPressed(): readonly number[];
  padName(): string;
  replayTutorial(): void;
  click(): void;
}

/** Menu des paramètres (Échap en balade) : son, qualité, boîte, touches du clavier, test de manette. */
export class SettingsMenu {
  open = false;
  private readonly root: HTMLElement;
  private waiting: BindAction | null = null;

  constructor(private readonly host: SettingsHost) {
    this.root = document.createElement('div');
    this.root.id = 'settings';
    this.root.className = 'side-menu';
    document.body.append(this.root);
    this.root.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest('button');
      if (!b) return;
      const act = b.dataset.act;
      const arg = b.dataset.arg ?? '';
      host.click();
      if (act === 'close') this.toggle();
      else if (act === 'quality') host.setQuality(arg as Quality);
      else if (act === 'gearbox') host.setGearbox(arg as 'auto' | 'manual');
      else if (act === 'tuto') {
        this.toggle();
        host.replayTutorial();
        return;
      } else if (act === 'resetKeys') bindings.reset();
      else if (act === 'bind') {
        this.waiting = arg as BindAction;
        keyCapture.handler = (code) => {
          if (code !== 'Escape' && this.waiting) bindings.set(this.waiting, code);
          this.waiting = null;
          this.render();
        };
      }
      this.render();
    });
    this.root.addEventListener('input', (ev) => {
      const el = ev.target as HTMLInputElement;
      if (el.dataset.vol === 'music') host.setMusicVolume(Number(el.value));
      else if (el.dataset.vol === 'sfx') host.setSfxVolume(Number(el.value));
    });
  }

  toggle(): boolean {
    this.open = !this.open;
    this.root.classList.toggle('open', this.open);
    if (!this.open) {
      this.waiting = null;
      keyCapture.handler = null;
    } else this.render();
    return this.open;
  }

  /** À appeler à chaque image quand le menu est ouvert : test de la manette en direct. */
  update(): void {
    const el = this.root.querySelector('.s-pad');
    if (!el) return;
    const name = this.host.padName();
    const pressed = this.host.padPressed();
    el.textContent = name ? `${name.slice(0, 34)} — boutons : ${pressed.length ? pressed.join(', ') : 'aucun'}` : 'Aucune manette détectée (appuyez sur un bouton).';
  }

  private render(): void {
    const h = this.host;
    const seg = (act: string, items: [string, string][], current: string): string =>
      `<div class="s-seg">${items.map(([v, l]) => `<button data-act="${act}" data-arg="${v}" class="${v === current ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const keys = BIND_LABELS.map(({ action, label }) => {
      const wait = this.waiting === action;
      return `<div class="g-row"><div><b>${label}</b></div><button class="s-key${wait ? ' wait' : ''}" data-act="bind" data-arg="${action}">${wait ? 'appuyez…' : bindings.key(action)}</button></div>`;
    }).join('');
    this.root.innerHTML = `
      <header><div class="g-top"><h2>Paramètres</h2><button data-act="close">Fermer <kbd>Échap</kbd></button></div></header>
      <div class="scroll">
        <h3>Son</h3>
        <div class="g-row"><div><b>Musique</b></div><input type="range" min="0" max="1" step="0.05" value="${h.musicVolume()}" data-vol="music"></div>
        <div class="g-row"><div><b>Bruitages</b><small>moteur, pneus, vent</small></div><input type="range" min="0" max="1" step="0.05" value="${h.sfxVolume()}" data-vol="sfx"></div>
        <h3>Jeu</h3>
        <div class="g-row"><div><b>Boîte de vitesses</b></div>${seg('gearbox', [['auto', 'Automatique'], ['manual', 'Manuelle']], h.gearbox())}</div>
        <div class="g-row"><div><b>Qualité d'image</b><small>recharge le jeu</small></div>${seg('quality', [['bas', 'Basse'], ['moyen', 'Moyenne'], ['haut', 'Haute']], h.quality())}</div>
        <div class="g-row"><div><b>Tutoriel</b></div><button data-act="tuto">Revoir</button></div>
        <h3>Clavier <small>cliquez sur une touche pour la changer</small></h3>
        ${keys}
        <button class="small" data-act="resetKeys">Touches par défaut</button>
        <h3>Manette</h3>
        <div class="s-pad"></div>
        <p class="g-note"><small>Switch Pro : ZR accélérer, ZL freiner, B drift, A NOS, R / L rapports, X caméra, Y boîte, croix ↑ course, ← abandon, → musique.</small></p>
      </div>`;
    this.update();
  }
}
