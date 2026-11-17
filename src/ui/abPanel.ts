import { HANDLING_SLIDERS, type HandlingConfig, type SliderDef } from '../config/handling';
import { RENDER_SLIDERS, type RenderConfig } from '../config/render';
import type { PresetName, TuningStore } from '../debug/tuningStore';
import type { InputManager } from '../input/input';
import type { Vehicle } from '../vehicle/vehicle';

interface SliderUi {
  def: SliderDef;
  root: HTMLElement;
  input: HTMLInputElement;
  out: HTMLOutputElement;
}

function fmt(v: number, step: number): string {
  if (step >= 1) return String(Math.round(v));
  const digits = step >= 0.1 ? 1 : step >= 0.01 ? 2 : 4;
  return v.toFixed(digits);
}

/**
 * Panneau de réglage A/B (touche F1) : préréglages A et B, curseurs, bascule en un clic,
 * export JSON, télémétrie. On peut continuer à conduire pendant qu'il est ouvert.
 */
export class AbPanel {
  private readonly root: HTMLElement;
  private readonly sliders: SliderUi[] = [];
  private readonly renderInputs: { key: keyof RenderConfig; input: HTMLInputElement; out: HTMLOutputElement; step: number }[] = [];
  private readonly btnA: HTMLButtonElement;
  private readonly btnB: HTMLButtonElement;
  private readonly diffBox: HTMLElement;
  private readonly tele: HTMLElement;
  private readonly wheelBars: { bar: HTMLElement; label: HTMLElement }[] = [];
  private readonly padBox: HTMLElement;
  private readonly exportArea: HTMLTextAreaElement;
  private teleTimer = 0;
  open = false;

  constructor(
    private readonly store: TuningStore,
    private readonly callbacks: { onPreset(p: PresetName): void; onRender(cfg: RenderConfig): void; onQuality(q: string): void; quality: string },
  ) {
    const root = document.createElement('aside');
    root.id = 'panel';
    this.root = root;
    root.innerHTML = `
      <header>
        <h2>Réglage de la conduite — A / B</h2>
        <div class="row">
          <button class="ab" data-p="A" title="Conduite A">A</button>
          <button class="ab" data-p="B" title="Conduite B">B</button>
          <button data-act="toggle">⇄ Basculer <b>(B)</b></button>
        </div>
        <div class="diffbox" data-ref="diff"></div>
        <div class="tabs">
          <button data-tab="conduite" class="active">Conduite</button>
          <button data-tab="telemetrie">Télémétrie</button>
          <button data-tab="rendu">Rendu et son</button>
        </div>
      </header>
      <div class="scroll">
        <section data-page="conduite"></section>
        <section data-page="telemetrie" hidden>
          <h3>Voiture</h3>
          <div class="tele" data-ref="tele"></div>
          <h3>Adhérence utilisée par roue</h3>
          <div class="wheels" data-ref="wheels"></div>
          <div class="note">Barre pleine = pneu à la limite. Magenta = le pneu glisse.</div>
          <h3>Manette</h3>
          <div class="note" data-ref="pad"></div>
        </section>
        <section data-page="rendu" hidden>
          <h3>Ambiance et musique</h3>
          <div data-ref="render"></div>
          <h3>Qualité</h3>
          <div class="row"><select data-ref="quality">
            <option value="bas">Basse (sans reflets)</option>
            <option value="moyen">Moyenne</option>
            <option value="haut">Haute</option>
          </select><span class="note">Recharge la page.</span></div>
        </section>
        <h3>Réglages</h3>
        <div class="row">
          <button data-act="copyAB">Copier A → B</button>
          <button data-act="copyBA">Copier B → A</button>
          <button data-act="reset">Réinitialiser</button>
          <button data-act="export">Exporter JSON</button>
        </div>
        <textarea data-ref="export" readonly hidden></textarea>
        <div class="note">Les curseurs modifient le préréglage actif. Tout est sauvegardé dans ce navigateur.
        « Exporter JSON » copie les deux réglages : envoyez-les pour les intégrer au jeu.</div>
      </div>`;
    document.body.append(root);

    const ref = <T extends HTMLElement>(name: string): T => root.querySelector(`[data-ref="${name}"]`) as T;
    this.btnA = root.querySelector('button[data-p="A"]') as HTMLButtonElement;
    this.btnB = root.querySelector('button[data-p="B"]') as HTMLButtonElement;
    this.diffBox = ref('diff');
    this.tele = ref('tele');
    this.padBox = ref('pad');
    this.exportArea = ref<HTMLTextAreaElement>('export');

    // — Curseurs de conduite —
    const page = root.querySelector('[data-page="conduite"]') as HTMLElement;
    for (const group of HANDLING_SLIDERS) {
      const h = document.createElement('h3');
      h.textContent = group.title;
      page.append(h);
      for (const def of group.sliders) {
        const wrap = document.createElement('div');
        wrap.className = 'slider';
        const label = document.createElement('label');
        label.textContent = def.label;
        const out = document.createElement('output');
        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(def.min);
        input.max = String(def.max);
        input.step = String(def.step);
        const hint = document.createElement('small');
        hint.textContent = def.hint;
        wrap.append(label, out, input, hint);
        page.append(wrap);
        input.addEventListener('input', () => {
          this.store.current[def.key] = Number(input.value);
          out.textContent = fmt(Number(input.value), def.step);
          this.store.save();
          this.refreshDiff();
        });
        // Rendre le clavier au jeu dès qu'on lâche le curseur (sinon les flèches le déplacent).
        input.addEventListener('change', () => input.blur());
        this.sliders.push({ def, root: wrap, input, out });
      }
    }

    // — Curseurs de rendu —
    const renderBox = ref('render');
    for (const def of RENDER_SLIDERS) {
      const wrap = document.createElement('div');
      wrap.className = 'slider';
      const label = document.createElement('label');
      label.textContent = def.label;
      const out = document.createElement('output');
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(def.min);
      input.max = String(def.max);
      input.step = String(def.step);
      wrap.append(label, out, input);
      renderBox.append(wrap);
      input.addEventListener('input', () => {
        this.store.render[def.key] = Number(input.value);
        out.textContent = fmt(Number(input.value), def.step);
        this.store.save();
        this.callbacks.onRender(this.store.render);
      });
      input.addEventListener('change', () => input.blur());
      this.renderInputs.push({ key: def.key, input, out, step: def.step });
    }
    const quality = ref<HTMLSelectElement>('quality');
    quality.value = this.callbacks.quality;
    quality.addEventListener('change', () => this.callbacks.onQuality(quality.value));

    // — Roues (télémétrie) —
    const wheelsBox = ref('wheels');
    for (const name of ['Avant gauche', 'Avant droite', 'Arrière gauche', 'Arrière droite']) {
      const w = document.createElement('div');
      w.className = 'wheel';
      const label = document.createElement('div');
      label.textContent = name;
      const bar = document.createElement('div');
      bar.className = 'bar';
      const fill = document.createElement('i');
      bar.append(fill);
      w.append(label, bar);
      wheelsBox.append(w);
      this.wheelBars.push({ bar: fill, label });
    }

    // — Boutons —
    root.addEventListener('click', (ev) => {
      const t = (ev.target as HTMLElement).closest('button');
      if (!t) return;
      const p = t.getAttribute('data-p') as PresetName | null;
      const act = t.getAttribute('data-act');
      const tab = t.getAttribute('data-tab');
      if (p) this.select(p);
      else if (act === 'toggle') this.select(this.store.active === 'A' ? 'B' : 'A');
      else if (act === 'copyAB') {
        this.store.B = { ...this.store.A };
        this.store.save();
        this.refresh();
      } else if (act === 'copyBA') {
        this.store.A = { ...this.store.B };
        this.store.save();
        this.refresh();
      } else if (act === 'reset') {
        this.store.reset();
        this.callbacks.onRender(this.store.render);
        this.refresh();
      } else if (act === 'export') this.exportJson();
      else if (tab) {
        for (const b of root.querySelectorAll('.tabs button')) b.classList.toggle('active', b === t);
        for (const s of root.querySelectorAll<HTMLElement>('[data-page]')) s.hidden = s.getAttribute('data-page') !== tab;
      }
      t.blur();
    });

    this.refresh();
  }

  toggle(): void {
    this.open = !this.open;
    this.root.classList.toggle('open', this.open);
  }

  select(p: PresetName): void {
    this.store.active = p;
    this.store.save();
    this.callbacks.onPreset(p);
    this.refresh();
  }

  /** Remet tous les curseurs sur le préréglage actif. */
  refresh(): void {
    const cfg = this.store.current;
    for (const s of this.sliders) {
      const v = cfg[s.def.key];
      s.input.value = String(v);
      s.out.textContent = fmt(v, s.def.step);
    }
    for (const r of this.renderInputs) {
      const v = this.store.render[r.key];
      r.input.value = String(v);
      r.out.textContent = fmt(v, r.step);
    }
    this.btnA.classList.toggle('active', this.store.active === 'A');
    this.btnB.classList.toggle('active', this.store.active === 'B');
    this.refreshDiff();
  }

  private refreshDiff(): void {
    const a = this.store.A;
    const b = this.store.B;
    const lines: string[] = [];
    for (const s of this.sliders) {
      const k = s.def.key as keyof HandlingConfig;
      const differs = Math.abs(a[k] - b[k]) > 1e-9;
      s.root.classList.toggle('diff', differs);
      if (differs) lines.push(`${s.def.label} : <b>A ${fmt(a[k], s.def.step)}</b> · <b>B ${fmt(b[k], s.def.step)}</b>`);
    }
    this.diffBox.innerHTML = lines.length ? `Ce qui diffère entre A et B :<br>${lines.join('<br>')}` : 'A et B sont identiques.';
  }

  private exportJson(): void {
    const json = this.store.exportJson();
    this.exportArea.hidden = false;
    this.exportArea.value = json;
    const done = (): void => {
      this.exportArea.select();
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(json).then(done, done);
    else done();
  }

  /** Télémétrie : rafraîchie ~10 fois par seconde seulement (le DOM coûte cher). */
  update(dt: number, car: Vehicle, input: InputManager, perf: string): void {
    if (!this.open) return;
    this.teleTimer -= dt;
    if (this.teleTimer > 0) return;
    this.teleTimer = 0.1;
    const deg = 180 / Math.PI;
    this.tele.innerHTML =
      `<span>Vitesse</span><b>${(car.forwardSpeed * 3.6).toFixed(0)} km/h</b>` +
      `<span>Régime</span><b>${car.drivetrain.rpm.toFixed(0)} tr/min</b>` +
      `<span>Rapport</span><b>${car.drivetrain.gearLabel} (${car.drivetrain.mode})</b>` +
      `<span>Angle de dérive</span><b>${(car.bodySlip * deg).toFixed(1)}°</b>` +
      `<span>Lacet</span><b>${(car.yawRate * deg).toFixed(0)}°/s</b>` +
      `<span>Braquage</span><b>${(car.steerAngle * deg).toFixed(1)}°</b>` +
      `<span>Gaz / frein</span><b>${(car.throttle * 100).toFixed(0)} % / ${(car.brake * 100).toFixed(0)} %</b>` +
      `<span>Drift</span><b>${(car.driftAmount * 100).toFixed(0)} %</b>` +
      `<span>Commandes</span><b>${input.activeSource}</b>` +
      `<span>Affichage</span><b>${perf}</b>`;
    for (let i = 0; i < 4; i++) {
      const w = car.wheels[i];
      const ui = this.wheelBars[i];
      if (!w || !ui) continue;
      const use = w.inContact ? w.gripUse : 0;
      ui.bar.style.width = `${Math.min(100, use * 100).toFixed(0)}%`;
      ui.bar.classList.toggle('over', use > 1);
    }
    const gp = input.gamepad;
    this.padBox.textContent = gp.connected
      ? `${gp.name}\nBoutons enfoncés : ${gp.pressed.length ? gp.pressed.join(', ') : 'aucun'}`
      : 'Aucune manette détectée. Branchez-la en Bluetooth puis appuyez sur un bouton.';
  }
}
