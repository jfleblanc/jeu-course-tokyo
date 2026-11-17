import { CAR_MODELS, MAX_CARS, NEON_COLORS, NEON_PRICE, NOS, PAINTS, PAINT_PRICE, UPGRADES, type UpgradeId } from '../config/cars';
import { MAX_LEVEL } from '../config/progression';
import type { PlayerState } from '../progression/playerState';

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

  constructor(
    private readonly player: PlayerState,
    private readonly onChange: (kind: 'voiture' | 'apparence' | 'achat') => void,
  ) {
    this.root = document.createElement('aside');
    this.root.id = 'garage';
    this.root.className = 'side-menu';
    document.body.append(this.root);
    this.root.addEventListener('click', (ev) => {
      const t = (ev.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!t || t.hasAttribute('disabled')) return;
      const act = t.getAttribute('data-act') as string;
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
        return `<div class="g-card${activeCar ? ' active' : ''}">
          <div><b>${m.name}</b><small>${ups ? `${ups} amélioration${ups > 1 ? 's' : ''}` : 'de série'} · revente ${yen(p.resaleValue(c))}</small></div>
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

    const nos = `<div class="g-row"><div><b>NOS</b><small>${NOS.seconds} s de surpuissance par course (touche Maj)</small></div>
      ${car.nos ? '<span class="g-tag">installé</span>' : `<button data-act="nos" ${buyable(NOS.price)}>${yen(NOS.price)}</button>`}</div>`;

    const paints = PAINTS.map((c, i) => `<button class="g-swatch${car.paint === i ? ' on' : ''}" title="${c.name}" style="background:${css(c.color)}" data-act="paint" data-arg="${i}" ${car.paint === i ? '' : buyable(PAINT_PRICE)}></button>`).join('');
    const neonOff = `<button class="g-swatch off${car.neon < 0 ? ' on' : ''}" title="Éteint" data-act="neon" data-arg="-1" ${car.neonOwned ? '' : 'disabled'}>×</button>`;
    const neons = NEON_COLORS.map((c, i) => `<button class="g-swatch${car.neon === i ? ' on' : ''}" title="${c.name}" style="background:${css(c.color)}" data-act="neon" data-arg="${i}" ${car.neonOwned ? '' : buyable(NEON_PRICE)}></button>`).join('');

    const dealer = CAR_MODELS.filter((m) => m.price > 0)
      .map((m) => {
        const state = p.canBuy(m);
        const label = state === 'possédée' ? '<span class="g-tag">dans le garage</span>' : state === 'garage plein' ? '<span class="g-tag">garage plein</span>' : `<button data-act="buy" data-id="${m.id}" ${state === 'ok' ? '' : 'disabled'}>${yen(m.price)}</button>`;
        return `<div class="g-row"><div><b>${m.name}</b><small>${m.blurb} ${m.drive}, ${m.traits.mass.toLocaleString('fr-CA')} kg. Puissance ×${m.power.toFixed(2)}, adhérence ×${m.grip.toFixed(2)}.</small></div>${label}</div>`;
      })
      .join('');

    this.root.innerHTML = `
      <header>
        <div class="g-top"><h2>Garage</h2><button data-act="close">Fermer <kbd>G</kbd></button></div>
        <div class="g-status">
          <div><span>Niveau</span><b>${p.level}</b><small>${p.tierName}</small></div>
          <div class="g-xp"><span>XP ${p.level >= MAX_LEVEL ? 'max' : `${Math.round(p.xp)} / ${need}`}</span><div class="bar"><i style="width:${Math.min(100, (p.xp / need) * 100).toFixed(0)}%"></i></div>${p.trialPending ? '<small class="trial">Épreuve de palier prête : appuyez sur Entrée en balade.</small>' : ''}</div>
          <div><span>Argent</span><b class="money">${yen(p.money)}</b></div>
        </div>
      </header>
      <div class="scroll">
        <h3>Mes voitures (${p.cars.length}/${MAX_CARS})</h3>${cars}
        <h3>Améliorations — ${model.name}</h3>${upgrades}${nos}
        <h3>Peinture <small>${model.paintable ? `${yen(PAINT_PRICE)} le changement` : 'livrée d’origine, non modifiable'}</small></h3>${model.paintable ? `<div class="g-swatches">${paints}</div>` : ''}
        <h3>Néon sous la voiture <small>${car.neonOwned ? 'installé : couleur au choix' : yen(NEON_PRICE)}</small></h3><div class="g-swatches">${neonOff}${neons}</div>
        <h3>Concessionnaire</h3>${dealer}
        <p class="g-note">Revente : 50 % du prix d'achat et des améliorations. ${p.races} course${p.races > 1 ? 's' : ''}, ${p.wins} victoire${p.wins > 1 ? 's' : ''}.</p>
        <button class="danger small" data-act="reset">Recommencer à zéro</button>
      </div>`;
  }
}
