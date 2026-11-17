import type { Race } from '../race/race';
import type { RouteTurn } from '../race/route';

const fmtTime = (t: number): string => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
};

/** Affichage de course : décompte, position, classement en direct, flèche du prochain virage, résultats. */
export class RaceHud {
  private readonly root: HTMLElement;
  private readonly big: HTMLElement;
  private readonly pos: HTMLElement;
  private readonly info: HTMLElement;
  private readonly board: HTMLElement;
  private readonly turn: HTMLElement;
  private readonly results: HTMLElement;
  private readonly hint: HTMLElement;
  private timer = 0;
  private lastBig = '';
  private goTimer = 0;
  private resultsShown = false;

  constructor() {
    const root = document.createElement('div');
    root.id = 'race-hud';
    root.innerHTML = `
      <div class="hud race-big" data-r="big"></div>
      <div class="hud race-pos" data-r="pos"></div>
      <div class="hud race-info" data-r="info"></div>
      <div class="hud race-board" data-r="board"></div>
      <div class="hud race-turn" data-r="turn"></div>
      <div class="race-results" data-r="results"></div>
      <div class="hud race-hint" data-r="hint"></div>`;
    document.body.append(root);
    this.root = root;
    const q = (n: string): HTMLElement => root.querySelector(`[data-r="${n}"]`) as HTMLElement;
    this.big = q('big');
    this.pos = q('pos');
    this.info = q('info');
    this.board = q('board');
    this.turn = q('turn');
    this.results = q('results');
    this.hint = q('hint');
    this.hint.innerHTML = '<kbd>Entrée</kbd> lancer une course';
  }

  private setBig(text: string): void {
    if (text !== this.lastBig) {
      this.big.textContent = text;
      this.big.classList.remove('pop');
      void this.big.offsetWidth; // relance l'animation
      if (text) this.big.classList.add('pop');
      this.lastBig = text;
    }
  }

  update(dt: number, race: Race): void {
    const active = race.active;
    this.root.classList.toggle('racing', active);
    if (!active) {
      this.setBig('');
      this.results.classList.remove('on');
      this.resultsShown = false;
      this.hint.innerHTML = '<kbd>Entrée</kbd> lancer une course';
      return;
    }
    const route = race.route;
    const player = race.player;
    if (!route || !player) return;

    // — Décompte —
    if (race.phase === 'countdown') {
      const n = Math.ceil(race.countdown);
      this.setBig(n > 3 ? '' : String(Math.max(1, n)));
      this.goTimer = 1.1;
    } else if (this.goTimer > 0) {
      this.goTimer -= dt;
      this.setBig(this.goTimer > 0 ? 'GO !' : '');
    }
    this.hint.innerHTML = race.phase === 'finished' ? '<kbd>Entrée</kbd> nouvelle course · <kbd>Échap</kbd> balade libre' : '<kbd>Échap</kbd> abandonner';

    // — Prochain virage : flèche + distance —
    let next: RouteTurn | null = null;
    for (const t of route.turns) {
      if (t.s > player.progress + 6) {
        next = t;
        break;
      }
    }
    const dist = next ? next.s - player.progress : Infinity;
    if (next && dist < 230 && race.phase === 'running') {
      const left = next.angle > 0;
      const sharp = Math.abs(next.angle) > 1.15;
      const arrow = left ? (sharp ? '↰' : '←') : sharp ? '↱' : '→';
      this.turn.innerHTML = `<span class="arrow${sharp ? ' sharp' : ''}">${arrow}</span><span class="dist">${Math.max(0, Math.round(dist / 10) * 10)} m</span>`;
      this.turn.classList.add('on');
      this.turn.classList.toggle('near', dist < 70);
    } else {
      this.turn.classList.remove('on');
    }

    // — Le reste n'a pas besoin d'être rafraîchi à chaque image —
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.15;
    const ranking = race.ranking();
    const place = ranking.indexOf(player) + 1;
    this.pos.innerHTML = `<b>${place}</b><span>/${ranking.length}</span>`;
    const remaining = Math.max(0, route.length - player.progress);
    this.info.innerHTML = `${fmtTime(race.time)}<small>point ${Math.min(player.nextCheckpoint + (player.finished ? 0 : 1), route.checkpoints.length)}/${route.checkpoints.length} · ${(remaining / 1000).toFixed(2)} km</small>`;
    this.board.innerHTML = ranking
      .map((r, k) => {
        const gap = r === player ? '' : r.finished ? fmtTime(r.finishTime) : `${r.progress - player.progress >= 0 ? '+' : '−'}${Math.abs(Math.round(r.progress - player.progress))} m`;
        return `<div class="${r.isPlayer ? 'me' : ''}"><i>${k + 1}</i><span>${r.name}</span><em>${gap}</em></div>`;
      })
      .join('');

    if (race.phase === 'finished' && !this.resultsShown) {
      this.resultsShown = true;
      const medal = ['1re place !', '2e place', '3e place', '4e place'][place - 1] ?? `${place}e place`;
      this.results.innerHTML = `<h2>${medal}</h2><div class="time">${fmtTime(player.finishTime)}</div><div class="list" data-r="list"></div><p><kbd>Entrée</kbd> nouvelle course &nbsp; <kbd>Échap</kbd> balade libre</p>`;
      this.results.classList.add('on');
    }
    if (this.resultsShown) {
      const list = this.results.querySelector('[data-r="list"]');
      if (list) {
        list.innerHTML = ranking.map((r, k) => `<div class="${r.isPlayer ? 'me' : ''}"><i>${k + 1}</i><span>${r.name}</span><em>${r.finished ? fmtTime(r.finishTime) : 'en course…'}</em></div>`).join('');
      }
    }
  }
}
