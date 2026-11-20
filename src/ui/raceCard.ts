import type { AiLevel } from '../config/race';
import type { Track } from '../race/trackBank';

/**
 * Fiche de course affichée avant le départ : tracé, gains possibles, mini-fiches des pilotes
 * adverses. Entrée pour lancer, Échap pour fermer.
 */
export class RaceCard {
  private readonly root: HTMLElement;
  shown: Track | null = null;
  /** Vrai si la fiche a été ouverte par le joueur (Entrée / T), faux si c'est en s'arrêtant sur une borne. */
  manual = false;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'race-card';
    document.body.append(this.root);
  }

  /** `event` : épreuve en solo ou poursuite, avec sa règle et ses médailles à la place des pilotes. */
  show(track: Track, drivers: AiLevel[], reward: { xp: number; money: number }, difficulty: number, title: string, manual: boolean, event?: { rule: string; medals: string[] }, records = ''): void {
    this.shown = track;
    this.manual = manual;
    const r = track.route;
    const km = (r.length / 1000).toFixed(1);
    const bar = (v: number): string => `<span class="rc-bar"><i style="width:${Math.round(Math.max(0.08, Math.min(1, v)) * 100)}%"></i></span>`;
    const pilots = drivers
      .map((d) => {
        const col = `rgb(${Math.round(60 + d.color[0] * 195)}, ${Math.round(60 + d.color[1] * 195)}, ${Math.round(60 + d.color[2] * 195)})`;
        return `<div class="rc-pilot"><i style="background:${col}"></i><div><b>${d.name}</b><small>${d.car}</small><small>${d.bio}</small>
          <div class="rc-stats"><span>Vitesse</span>${bar(((d.topSpeed * difficulty) - 140) / 80)}<span>Virages</span>${bar(((d.cornerGrip * difficulty) - 8) / 6)}</div></div></div>`;
      })
      .join('');
    this.root.innerHTML = `
      <div class="rc-kind">${title}</div>
      <h2>${track.name}</h2>
      <div class="rc-facts"><span>${km} km</span>${r.laps > 1 ? `<span>${r.laps} tours</span>` : '<span>d’un point à un autre</span>'}<span>${r.turns.filter((t) => t.index < r.lapPoints).length} virages</span></div>
      ${event ? `<div class="rc-rule">${event.rule}</div>${event.medals.length ? `<div class="rc-medals">${event.medals.map((m, k) => `<span class="m${k}">${['Or', 'Argent', 'Bronze'][k]} <b>${m}</b></span>`).join('')}</div>` : ''}` : ''}
      ${records ? `<div class="rc-records"><h4>Meilleurs temps</h4>${records}</div>` : ''}
      <div class="rc-reward">À gagner pour ${event ? 'l’or' : 'la 1re place'} : <b>${reward.xp ? `${reward.xp} XP · ` : ''}¥ ${reward.money.toLocaleString('fr-CA')}</b><small>+ mallettes d’argent sur le parcours</small></div>
      <div class="rc-pilots">${pilots}</div>
      <div class="rc-keys"><kbd>Entrée</kbd> lancer &nbsp; <kbd>Y</kbd> ${event ? 'épreuve suivante' : 'épreuves : chrono, drift, poursuite'} &nbsp; <kbd>Échap</kbd> fermer</div>`;
    this.root.classList.add('on');
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = null;
    this.manual = false;
    this.root.classList.remove('on');
  }
}
