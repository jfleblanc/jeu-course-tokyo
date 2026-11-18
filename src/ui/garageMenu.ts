import { CAR_MODELS, MAX_CARS, NEON_COLORS, NEON_PRICE, NOS, PAINTS, PAINT_PRICE, UPGRADES, UPGRADE_EFFECT, type UpgradeId } from '../config/cars';
import { MAX_LEVEL } from '../config/progression';
import type { PlayerState } from '../progression/playerState';

/** Vignette d'une voiture (photo prise dans l'atelier, rangée dans public/vignettes). */
const thumbUrl = (glb: string | null): string => new URL(`vignettes/${glb}.webp`, document.baseURI).href;
const thumb = (glb: string | null): string => `<img class="g-thumb" src="${thumbUrl(glb)}" alt="" loading="lazy">`;
const yen = (n: number): string => `¥ ${n.toLocaleString('fr-CA')}`;
const css = (c: readonly [number, number, number]): string => {
  const g = (v: number): number => Math.round(255 * Math.pow(Math.min(1, v), 1 / 2.2));
  return `rgb(${g(c[0])}, ${g(c[1])}, ${g(c[2])})`;
};

/**
 * Menu du garage (touche G) : voitures possédées, améliorations, peinture, néon, concessionnaire.
 * Le jeu est en pause tant qu'il est ouvert.
 */
export class GarageMenu {
  private readonly root: HTMLElement;
  open = false;
  /** Fiche technique affichée au survol d'une voiture. */
  private readonly sheet: HTMLElement;
  /** Largeur du panneau à l'écran (px) : la caméra du garage se cadre sur ce qui reste à droite. */
  get panelWidth(): number {
    return this.open ? this.root.getBoundingClientRect().width : 0;
  }
  /** Onglet affiché. */
  private tab: 'voitures' | 'ameliorations' | 'apparence' | 'concession' = 'voitures';

  constructor(
    private readonly player: PlayerState,
    private readonly onChange: (kind: 'voiture' | 'apparence' | 'achat') => void,
  ) {
    this.root = document.createElement('aside');
    this.root.id = 'garage';
    this.root.className = 'side-menu';
    document.body.append(this.root);
    this.sheet = document.createElement('div');
    this.sheet.id = 'g-fiche';
    document.body.append(this.sheet);
    this.root.addEventListener('mouseover', (ev) => {
      const t = (ev.target as HTMLElement).closest('[data-fiche]') as HTMLElement | null;
      if (!t) { this.sheet.classList.remove('on'); return; }
      this.showSheet(t);
    });
    this.root.addEventListener('mouseleave', () => this.sheet.classList.remove('on'));
    this.root.addEventListener('click', (ev) => {
      const t = (ev.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!t || t.hasAttribute('disabled')) return;
      const act = t.getAttribute('data-act') as string;
      if (act === 'tab') {
        this.tab = (t.getAttribute('data-id') ?? 'voitures') as typeof this.tab;
        this.render();
        return;
      }
      const arg = Number(t.getAttribute('data-arg') ?? 0);
      const id = t.getAttribute('data-id') ?? '';
      let kind: 'voiture' | 'apparence' | 'achat' = 'achat';
      if (act === 'drive') {
        this.player.select(arg);
        kind = 'voiture';
      } else if (act === 'sell') {
        if (!window.confirm('Vendre cette voiture ?')) return;
        this.player.sellCar(arg);
        kind = 'voiture';
      } else if (act === 'buy') {
        const model = CAR_MODELS.find((m) => m.id === id);
        if (model) this.player.buyCar(model);
        kind = 'voiture';
      } else if (act === 'upgrade') this.player.buyUpgrade(id as UpgradeId);
      else if (act === 'nos') this.player.buyNos();
      else if (act === 'paint') {
        this.player.setPaint(arg);
        kind = 'apparence';
      } else if (act === 'neon') {
        this.player.setNeon(arg);
        kind = 'apparence';
      } else if (act === 'close') {
        this.toggle();
        return;
      } else if (act === 'reset') {
        if (!window.confirm('Recommencer à zéro ? Niveau, argent et voitures seront perdus.')) return;
        this.player.reset();
        kind = 'voiture';
      }
      this.onChange(kind);
      this.render();
    });
  }

  toggle(): boolean {
    this.open = !this.open;
    this.root.classList.toggle('open', this.open);
    if (this.open) this.render();
    else this.sheet.classList.remove('on');
    return this.open;
  }

  private render(): void {
    const p = this.player;
    const car = p.car;
    const model = p.modelOf(car);
    const need = p.xpNeeded;
    const buyable = (price: number): string => (p.money >= price ? '' : 'disabled');

    const cars = p.cars
      .map((c, i) => {
        const m = p.modelOf(c);
        const activeCar = i === p.active;
        const ups = c.upgrades.engine + c.upgrades.tires + c.upgrades.weight + (c.nos ? 1 : 0);
        return `<div class="g-card${activeCar ? ' active' : ''}" data-fiche="${m.id}" data-own="${i}">
          ${thumb(m.glb)}
          <div class="g-txt"><b>${m.name}</b><small>${ups ? `${ups} amélioration${ups > 1 ? 's' : ''}` : 'de série'} · revente ${yen(p.resaleValue(c))}</small></div>
          <div class="g-btns">
            ${activeCar ? '<span class="g-tag">au volant</span>' : `<button data-act="drive" data-arg="${i}">Conduire</button>`}
            ${p.cars.length > 1 ? `<button class="danger" data-act="sell" data-arg="${i}">Vendre</button>` : ''}
          </div></div>`;
      })
      .join('');

    const upgrades = UPGRADES.map((u) => {
      const lvl = car.upgrades[u.id];
      const price = p.upgradePrice(car, u.id);
      const dots = u.prices.map((_, k) => `<i class="${k < lvl ? 'on' : ''}"></i>`).join('');
      return `<div class="g-row"><div><b>${u.name}</b> <span class="g-dots">${dots}</span><small>${u.what}</small></div>
        ${price === null ? '<span class="g-tag">au maximum</span>' : `<button data-act="upgrade" data-id="${u.id}" ${buyable(price)}>${yen(price)}</button>`}</div>`;
    }).join('');

    const nos = `<div class="g-row"><div><b>NOS</b><small>${NOS.seconds} s de surpuissance par course (touche E)</small></div>
      ${car.nos ? '<span class="g-tag">installé</span>' : `<button data-act="nos" ${buyable(NOS.price)}>${yen(NOS.price)}</button>`}</div>`;

    const paints = PAINTS.map((c, i) => `<button class="g-swatch${car.paint === i ? ' on' : ''}" title="${c.name}" style="background:${css(c.color)}" data-act="paint" data-arg="${i}" ${car.paint === i ? '' : buyable(PAINT_PRICE)}></button>`).join('');
    const neonOff = `<button class="g-swatch off${car.neon < 0 ? ' on' : ''}" title="Éteint" data-act="neon" data-arg="-1" ${car.neonOwned ? '' : 'disabled'}>×</button>`;
    const neons = NEON_COLORS.map((c, i) => `<button class="g-swatch${car.neon === i ? ' on' : ''}" title="${c.name}" style="background:${css(c.color)}" data-act="neon" data-arg="${i}" ${car.neonOwned ? '' : buyable(NEON_PRICE)}></button>`).join('');

    const dealer = CAR_MODELS.filter((m) => m.price > 0)
      .map((m) => {
        const state = p.canBuy(m);
        const label = state === 'possédée' ? '<span class="g-tag">dans le garage</span>' : state === 'garage plein' ? '<span class="g-tag">garage plein</span>' : `<button data-act="buy" data-id="${m.id}" ${state === 'ok' ? '' : 'disabled'}>${yen(m.price)}</button>`;
        return `<div class="g-card" data-fiche="${m.id}">${thumb(m.glb)}<div class="g-txt"><b>${m.name}</b><small>${m.engine} · ${m.drive.toLowerCase()}</small></div><div class="g-btns">${label}</div></div>`;
      })
      .join('');

    // Panneau à gauche, un onglet à la fois : la caméra du garage occupe toute la partie droite.
    const tabs: [typeof this.tab, string][] = [['voitures', `Voitures ${p.cars.length}/${MAX_CARS}`], ['ameliorations', 'Améliorations'], ['apparence', 'Peinture'], ['concession', 'Concession']];
    const body =
      this.tab === 'voitures' ? `${cars}<p class="g-note">Revente : 50 % du prix d'achat et des améliorations. ${p.races} course${p.races > 1 ? 's' : ''}, ${p.wins} victoire${p.wins > 1 ? 's' : ''}.</p><button class="danger small" data-act="reset">Recommencer à zéro</button>`
      : this.tab === 'ameliorations' ? `<div class="g-card active" data-fiche="${model.id}" data-own="${p.active}">${thumb(model.glb)}<div class="g-txt"><b>${model.name}</b><small>au volant</small></div></div>${upgrades}${nos}`
      : this.tab === 'apparence' ? `<h3>Peinture <small>${model.paintable ? `${yen(PAINT_PRICE)} le changement` : 'livrée d’origine, non modifiable'}</small></h3>${model.paintable ? `<div class="g-swatches">${paints}</div>` : ''}
          <h3>Néon sous la voiture <small>${car.neonOwned ? 'installé : couleur au choix' : yen(NEON_PRICE)}</small></h3><div class="g-swatches">${neonOff}${neons}</div>`
      : dealer;
    this.root.innerHTML = `
      <header>
        <div class="g-top"><h2>Garage</h2><button data-act="close">Fermer <kbd>G</kbd></button></div>
        <div class="g-status">
          <div><span>Niveau</span><b>${p.level}</b><small>${p.tierName}</small></div>
          <div class="g-xp"><span>XP ${p.level >= MAX_LEVEL ? 'max' : `${Math.round(p.xp)} / ${need}`}</span><div class="bar"><i style="width:${Math.min(100, (p.xp / need) * 100).toFixed(0)}%"></i></div>${p.trialPending ? '<small class="trial">Épreuve de palier prête</small>' : ''}</div>
          <div><span>Argent</span><b class="money">${yen(p.money)}</b></div>
        </div>
        <nav class="g-tabs">${tabs.map(([id, label]) => `<button data-act="tab" data-id="${id}" class="${id === this.tab ? 'on' : ''}">${label}</button>`).join('')}</nav>
      </header>
      <div class="scroll">${body}</div>`;
  }

  /** Fiche technique à droite du panneau, à la hauteur de la carte survolée. */
  private showSheet(card: HTMLElement): void {
    const p = this.player;
    const m = CAR_MODELS.find((c) => c.id === card.getAttribute('data-fiche'));
    if (!m) return;
    const ownAttr = card.getAttribute('data-own');
    const own = ownAttr === null ? null : p.cars[Number(ownAttr)] ?? null;
    // Chiffres avec les améliorations de la voiture, si elle est au garage.
    const up = own?.upgrades ?? { engine: 0, tires: 0, weight: 0 };
    const power = m.power * (1 + UPGRADE_EFFECT.engine * up.engine) * (1 + UPGRADE_EFFECT.weight * up.weight);
    const grip = m.grip * (1 + UPGRADE_EFFECT.tires * up.tires);
    const brake = m.brake * (1 + UPGRADE_EFFECT.weight * up.weight);
    const max = (f: (c: (typeof CAR_MODELS)[number]) => number): number => Math.max(...CAR_MODELS.map(f)) * 1.25;
    const bar = (label: string, v: number, top: number, base: number): string =>
      `<div class="f-bar"><span>${label}</span><div class="bar"><i style="width:${Math.min(100, (v / top) * 100).toFixed(0)}%"></i></div><b>×${v.toFixed(2)}${v > base + 0.004 ? ` <em>+${Math.round((v / base - 1) * 100)} %</em>` : ''}</b></div>`;
    const row = (k: string, v: string): string => `<div class="f-row"><span>${k}</span><b>${v}</b></div>`;
    const wb = Math.abs(m.traits.axleFrontZ - m.traits.axleRearZ);
    this.sheet.innerHTML = `
      <img src="${thumbUrl(m.glb)}" alt="">
      <h4>${m.name}</h4>
      <p>${m.blurb}</p>
      ${bar('Puissance', power, max((c) => c.power), m.power)}
      ${bar('Adhérence', grip, max((c) => c.grip), m.grip)}
      ${bar('Freinage', brake, max((c) => c.brake), m.brake)}
      ${row('Moteur', m.engine)}
      ${row('Suralimentation', m.sound.turbo > 0.05 ? 'turbo' : 'atmosphérique')}
      ${row('Transmission', m.drive)}
      ${row('Poids', `${m.traits.mass.toLocaleString('fr-CA')} kg`)}
      ${row('Empattement', `${wb.toFixed(2).replace('.', ',')} m`)}
      ${row('Peinture', m.paintable ? 'au choix' : 'livrée d’origine')}
      ${own ? row('Améliorations', `moteur ${up.engine}/3 · pneus ${up.tires}/3 · carbone ${up.weight}/2${own.nos ? ' · NOS' : ''}`) + row('Revente', yen(p.resaleValue(own))) : row('Prix', m.price > 0 ? yen(m.price) : 'voiture de départ')}`;
    const r = card.getBoundingClientRect(), panel = this.root.getBoundingClientRect();
    this.sheet.style.left = `${panel.right + 12}px`;
    this.sheet.classList.add('on');
    const h = this.sheet.getBoundingClientRect().height;
    this.sheet.style.top = `${Math.max(10, Math.min(window.innerHeight - h - 10, r.top - 20))}px`;
  }
}
