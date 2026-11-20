import type { Salon } from '../net/salon';

export interface SalonHost {
  me(): { name: string; symbol: string };
  create(): void;
  join(code: string): void;
  leave(): void;
}

/**
 * Panneau « Jouer à plusieurs » (touche J) : créer un salon, en rejoindre un avec son code,
 * voir qui est là. Une pastille reste à l'écran tant qu'on est connecté.
 */
export class SalonPanel {
  open = false;
  message = '';
  busy = false;
  private readonly root: HTMLElement;
  private readonly chip: HTMLElement;
  private drawn = '';

  constructor(private readonly salon: Salon, private readonly host: SalonHost) {
    this.root = document.createElement('div');
    this.root.id = 'salon';
    this.chip = document.createElement('div');
    this.chip.id = 'salon-chip';
    document.body.append(this.root, this.chip);
    this.root.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest('button');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'creer') this.host.create();
      else if (act === 'joindre') this.submit();
      else if (act === 'quitter') this.host.leave();
      else if (act === 'fermer') this.toggle();
    });
    // Dans le champ du code, les touches ne doivent pas commander le jeu.
    this.root.addEventListener('keydown', (ev) => {
      if ((ev.target as HTMLElement).tagName !== 'INPUT') return;
      ev.stopPropagation();
      if (ev.key === 'Enter') this.submit();
      if (ev.key === 'Escape') this.toggle();
    }, true);
    this.root.addEventListener('keyup', (ev) => { if ((ev.target as HTMLElement).tagName === 'INPUT') ev.stopPropagation(); }, true);
  }

  private submit(): void {
    const input = this.root.querySelector('input');
    const code = (input?.value ?? '').toUpperCase().replace(/[^A-Z]/g, '');
    if (code.length !== 4) { this.message = 'Le code fait 4 lettres.'; this.render(true); return; }
    this.host.join(code);
  }

  toggle(): void {
    this.open = !this.open;
    this.root.classList.toggle('on', this.open);
    if (this.open) { this.render(true); this.root.querySelector('input')?.focus(); }
    else (document.activeElement as HTMLElement | null)?.blur?.();
  }

  /** À appeler à chaque image : met à jour le panneau et la pastille s'ils ont changé. */
  render(force = false): void {
    const s = this.salon;
    const me = this.host.me();
    const list = s.connected
      ? [`<div class="sj me"><b>${me.symbol}</b> ${me.name} <small>vous</small></div>`, ...[...s.peers.values()].map((p) => `<div class="sj"><b>${p.symbol}</b> ${p.name}${p.hidden ? ' <small>au garage</small>' : ''}</div>`)].join('')
      : '';
    const chip = s.connected ? `Salon <b>${s.code}</b> · ${s.peers.size + 1} joueur${s.peers.size ? 's' : ''} · <kbd>J</kbd>` : '';
    if (this.chip.innerHTML !== chip) { this.chip.innerHTML = chip; this.chip.classList.toggle('on', s.connected); }
    if (!this.open) return;
    const state = `${s.connected}|${s.code}|${list}|${this.message}|${this.busy}`;
    if (!force && state === this.drawn) return;
    this.drawn = state;
    const typed = (this.root.querySelector('input') as HTMLInputElement | null)?.value ?? '';
    this.root.innerHTML = s.connected
      ? `<h2>Jouer à plusieurs</h2>
         <p>Code du salon, à donner aux autres joueurs :</p><div class="s-code">${s.code}</div>
         <div class="s-list">${list}</div>
         <p class="s-help">Tout le monde roule dans la même ville. Pour courir ensemble : garez-vous sur la même borne de départ, puis l’un de vous appuie sur <kbd>Entrée</kbd> deux fois. Les voitures des autres sont des fantômes : on se traverse.</p>
         ${this.message ? `<p class="s-msg">${this.message}</p>` : ''}
         <div class="s-btns"><button data-act="quitter" class="danger">Quitter le salon</button><button data-act="fermer">Fermer <kbd>J</kbd></button></div>`
      : `<h2>Jouer à plusieurs</h2>
         <p>Jusqu’à 4 joueurs, chacun sur son ordinateur, dans la même ville.</p>
         <div class="s-btns"><button data-act="creer" ${this.busy ? 'disabled' : ''}>Créer un salon</button></div>
         <p>ou rejoindre celui d’un ami :</p>
         <div class="s-join"><input maxlength="4" placeholder="CODE" autocomplete="off" spellcheck="false" value="${typed}"><button data-act="joindre" ${this.busy ? 'disabled' : ''}>Rejoindre</button></div>
         ${this.message ? `<p class="s-msg">${this.message}</p>` : ''}
         <div class="s-btns"><button data-act="fermer">Fermer <kbd>J</kbd></button></div>`;
    if (!s.connected) {
      const input = this.root.querySelector('input');
      if (input && typed === '') input.focus();
    }
  }
}
