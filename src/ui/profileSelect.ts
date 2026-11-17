import { CAR_MODELS } from '../config/cars';
import { tierOf } from '../config/progression';
import { SYMBOLS, createProfile, deleteProfile, updateProfile, listProfiles, pinMatches, profileSummary, type Profile } from '../progression/profiles';

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/**
 * Choix du joueur, après l'écran titre : une rangée de petites cartes en bas de l'écran (le jeu
 * reste visible derrière). Survoler une carte montre le garage de ce joueur ; la dernière carte
 * crée un nouveau joueur (nom, symbole, NIP facultatif).
 */
export class ProfileSelect {
  private readonly el = document.createElement('div');
  private profiles: Profile[] = [];
  private focus = 0;
  private mode: 'liste' | 'nouveau' | 'nip' | 'supprimer' | 'modifier' = 'liste';
  private symbol: string = SYMBOLS[0];
  private error = '';
  isOpen = false;

  constructor(private readonly cb: { hover(p: Profile | null): void; choose(p: Profile): void }) {
    this.el.id = 'profils';
    this.el.addEventListener('click', (ev) => this.click(ev.target as HTMLElement));
    this.el.addEventListener('mouseover', (ev) => {
      const card = (ev.target as HTMLElement).closest<HTMLElement>('[data-k]');
      if (card && this.mode === 'liste') this.setFocus(Number(card.dataset.k), false);
    });
    // Tant que le choix est ouvert, le clavier est pour lui : le jeu derrière n'en voit rien.
    window.addEventListener('keydown', (ev) => {
      if (!this.isOpen) return;
      ev.stopPropagation();
      const typing = (ev.target as HTMLElement).tagName === 'INPUT';
      if (ev.code === 'Escape' && this.mode !== 'liste') { this.mode = 'liste'; this.error = ''; this.render(); return; }
      if (ev.code === 'Enter' || ev.code === 'NumpadEnter') { ev.preventDefault(); this.confirm(); return; }
      if (typing) return;
      if (ev.code === 'ArrowLeft' || ev.code === 'KeyA') this.move(-1);
      else if (ev.code === 'ArrowRight' || ev.code === 'KeyD') this.move(1);
    }, true);
    window.addEventListener('keyup', (ev) => { if (this.isOpen) ev.stopPropagation(); }, true);
  }

  open(): void {
    this.profiles = listProfiles();
    this.isOpen = true;
    this.mode = 'liste';
    this.focus = 0;
    document.body.append(this.el);
    this.render();
    this.cb.hover(this.profiles[0] ?? null);
  }

  close(): void {
    this.isOpen = false;
    this.el.remove();
  }

  /** Carte suivante / précédente (flèches, manette). */
  move(delta: number): void {
    if (this.mode !== 'liste') return;
    const n = this.profiles.length + 1;
    this.setFocus((this.focus + delta + n) % n, true);
  }

  private setFocus(k: number, redraw: boolean): void {
    if (k === this.focus && !redraw) return;
    this.focus = k;
    this.el.querySelectorAll<HTMLElement>('[data-k]').forEach((c) => c.classList.toggle('on', Number(c.dataset.k) === k));
    this.cb.hover(this.profiles[k] ?? null);
  }

  /** Valide la carte ou le formulaire en cours (Entrée, manette). */
  confirm(): void {
    const p = this.profiles[this.focus];
    if (this.mode === 'liste') {
      if (!p) { this.mode = 'nouveau'; this.error = ''; this.render(); return; }
      if (p.pin) { this.mode = 'nip'; this.error = ''; this.render(); return; }
      this.cb.choose(p);
    } else if (this.mode === 'nip' && p) {
      const pin = this.el.querySelector<HTMLInputElement>('input[name=nip]')?.value ?? '';
      if (pinMatches(p, pin)) this.cb.choose(p);
      else { this.error = 'NIP incorrect'; this.render(); }
    } else if (this.mode === 'supprimer' && p) {
      const pin = this.el.querySelector<HTMLInputElement>('input[name=nip]')?.value ?? '';
      if (!pinMatches(p, pin)) { this.error = 'NIP incorrect'; this.render(); return; }
      deleteProfile(p.id);
      this.profiles = listProfiles();
      this.mode = 'liste';
      this.focus = Math.min(this.focus, this.profiles.length);
      this.render();
      this.cb.hover(this.profiles[this.focus] ?? null);
    } else if (this.mode === 'modifier' && p) {
      const val = (n: string): string => this.el.querySelector<HTMLInputElement>(`input[name=${n}]`)?.value.trim() ?? '';
      const name = val('nom'), old = val('ancien'), pin = val('nip');
      if (!pinMatches(p, old)) { this.error = 'NIP actuel incorrect'; this.render(name, pin); return; }
      if (!name) { this.error = 'Il faut un nom'; this.render(name, pin); return; }
      if (pin && !/^\d{4}$/.test(pin)) { this.error = 'Le NIP : 4 chiffres, ou rien'; this.render(name, pin); return; }
      // NIP laissé vide : on garde l'actuel ; « 0000 » n'a rien de spécial. Case cochée : on l'enlève.
      const drop = this.el.querySelector<HTMLInputElement>('input[name=sans]')?.checked ?? false;
      updateProfile(p.id, { name, symbol: this.symbol, pin: drop ? '' : pin || undefined });
      this.profiles = listProfiles();
      this.mode = 'liste'; this.error = '';
      this.render();
      this.cb.hover(this.profiles[this.focus] ?? null);
    } else if (this.mode === 'nouveau') {
      const name = this.el.querySelector<HTMLInputElement>('input[name=nom]')?.value.trim() ?? '';
      const pin = this.el.querySelector<HTMLInputElement>('input[name=nip]')?.value.trim() ?? '';
      if (!name) { this.error = 'Il faut un nom'; this.render(name, pin); return; }
      if (pin && !/^\d{4}$/.test(pin)) { this.error = 'Le NIP : 4 chiffres, ou rien'; this.render(name, pin); return; }
      this.cb.choose(createProfile(name, this.symbol, pin));
    }
  }

  private click(t: HTMLElement): void {
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'retour') { this.mode = 'liste'; this.error = ''; this.render(); return; }
    if (act === 'ok') { this.confirm(); return; }
    if (act === 'modif') {
      this.setFocus(Number(t.closest<HTMLElement>('[data-k]')?.dataset.k ?? this.focus), true);
      const cur = this.profiles[this.focus];
      if (cur) { this.symbol = cur.symbol; this.mode = 'modifier'; this.error = ''; this.render(cur.name); }
      return;
    }
    if (act === 'suppr') {
      this.setFocus(Number(t.closest<HTMLElement>('[data-k]')?.dataset.k ?? this.focus), true);
      this.mode = 'supprimer'; this.error = ''; this.render();
      return;
    }
    const sym = t.closest<HTMLElement>('[data-sym]')?.dataset.sym;
    if (sym) {
      this.symbol = sym;
      const name = this.el.querySelector<HTMLInputElement>('input[name=nom]')?.value ?? '', pin = this.el.querySelector<HTMLInputElement>('input[name=nip]')?.value ?? '';
      this.render(name, pin);
      return;
    }
    const card = t.closest<HTMLElement>('[data-k]');
    if (card && this.mode === 'liste') {
      this.setFocus(Number(card.dataset.k), true);
      this.confirm();
    }
  }

  private render(name = '', pin = ''): void {
    const err = this.error ? `<div class="pf-err">${esc(this.error)}</div>` : '';
    const p = this.profiles[this.focus];
    if (this.mode === 'modifier' && p) {
      this.el.innerHTML = `<div class="pf-form">
        <div class="pf-title">Modifier la carte</div>
        <label>Nom <input name="nom" maxlength="14" autocomplete="off" value="${esc(name)}"></label>
        <div class="pf-syms">${[...new Set([p.symbol, ...SYMBOLS])].map((s) => `<button type="button" tabindex="-1" data-sym="${s}" class="${s === this.symbol ? 'on' : ''}">${s}</button>`).join('')}</div>
        ${p.pin ? '<label>NIP actuel <input name="ancien" type="password" inputmode="numeric" maxlength="4" autocomplete="off"></label>' : ''}
        <label>Nouveau NIP (4 chiffres ; vide = ${p.pin ? 'inchangé' : 'aucun'}) <input name="nip" type="password" inputmode="numeric" maxlength="4" autocomplete="off" value="${esc(pin)}"></label>
        ${p.pin ? '<label class="pf-check"><input name="sans" type="checkbox"> Enlever le NIP</label>' : ''}
        ${err}
        <div class="pf-row"><button type="button" data-act="retour">Retour</button><button type="button" data-act="ok" class="go">Enregistrer</button></div>
      </div>`;
      return;
    }
    if (this.mode === 'nouveau') {
      this.el.innerHTML = `<div class="pf-form">
        <div class="pf-title">Nouveau joueur</div>
        <label>Nom <input name="nom" maxlength="14" autocomplete="off" value="${esc(name)}"></label>
        <div class="pf-syms">${SYMBOLS.map((s) => `<button type="button" tabindex="-1" data-sym="${s}" class="${s === this.symbol ? 'on' : ''}">${s}</button>`).join('')}</div>
        <label>NIP (4 chiffres, facultatif) <input name="nip" type="password" inputmode="numeric" maxlength="4" autocomplete="off" value="${esc(pin)}"></label>
        ${err}
        <div class="pf-row"><button type="button" data-act="retour">Retour</button><button type="button" data-act="ok" class="go">Créer et jouer</button></div>
      </div>`;
      const f = this.el.querySelector<HTMLInputElement>('input[name=nom]');
      if (f && !name) f.focus();
      return;
    }
    if ((this.mode === 'nip' || this.mode === 'supprimer') && p) {
      const del = this.mode === 'supprimer';
      this.el.innerHTML = `<div class="pf-form">
        <div class="pf-title"><span class="pf-sym">${esc(p.symbol)}</span> ${esc(p.name)}</div>
        ${del ? '<div class="pf-warn">Supprimer ce joueur et toute sa partie ?</div>' : ''}
        ${p.pin ? '<label>NIP <input name="nip" type="password" inputmode="numeric" maxlength="4" autocomplete="off"></label>' : ''}
        ${err}
        <div class="pf-row"><button type="button" data-act="retour">Retour</button><button type="button" data-act="ok" class="go">${del ? 'Supprimer' : 'Jouer'}</button></div>
      </div>`;
      this.el.querySelector<HTMLInputElement>('input[name=nip]')?.focus();
      return;
    }
    const cards = this.profiles.map((pr, k) => {
      const s = profileSummary(pr.id);
      const main = CAR_MODELS.find((m) => m.id === s.cars[s.active]?.model);
      return `<div class="pf-card ${k === this.focus ? 'on' : ''}" data-k="${k}">
        <button type="button" class="pf-x" data-act="suppr" title="Supprimer ce joueur">×</button>
        <button type="button" class="pf-x pf-edit" data-act="modif" title="Modifier le nom, le symbole ou le NIP">✎</button>
        <div class="pf-head"><span class="pf-sym">${esc(pr.symbol)}</span><span class="pf-name">${esc(pr.name)}${pr.pin ? ' <i title="Protégé par un NIP">🔒</i>' : ''}</span></div>
        <div class="pf-line">Niveau <b>${s.level}</b> · ${esc(tierOf(s.level).name)}</div>
        <div class="pf-line money">¥ ${s.money.toLocaleString('fr-CA')}</div>
        <div class="pf-line dim">${s.cars.length} voiture${s.cars.length > 1 ? 's' : ''}${main ? ' · ' + esc(main.name) : ''}</div>
        <div class="pf-line dim">${s.wins} victoire${s.wins > 1 ? 's' : ''} sur ${s.races} course${s.races > 1 ? 's' : ''}</div>
      </div>`;
    });
    const k = this.profiles.length;
    cards.push(`<div class="pf-card new ${k === this.focus ? 'on' : ''}" data-k="${k}"><div class="pf-plus">+</div><div class="pf-line">Nouveau joueur</div></div>`);
    this.el.innerHTML = `<div class="pf-hint">Qui joue ? <kbd>←</kbd> <kbd>→</kbd> puis <kbd>Entrée</kbd></div><div class="pf-cards">${cards.join('')}</div>`;
  }
}
