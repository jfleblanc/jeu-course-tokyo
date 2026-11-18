/**
 * Bruitages générés par code (Web Audio), sans fichier : moteur, pneus, vent, NOS, et petits
 * sons ponctuels (décompte, mallette, téléporteur, arrivée, choc).
 *
 * Le moteur est un son continu dont la hauteur suit le régime : deux oscillateurs (fréquence
 * d'allumage d'un quatre-cylindres et son octave inférieure) passés dans une saturation douce
 * et un filtre qui s'ouvre avec l'accélérateur.
 */
import type { EngineSound } from '../config/cars';

export interface SfxState {
  rpm: number;
  redline: number;
  /** 0..1 */
  throttle: number;
  /** m/s */
  speed: number;
  /** Glissement latéral de la voiture (rad), en valeur absolue. */
  slip: number;
  drifting: boolean;
  nos: boolean;
  /** Rapport engagé (pour le bruit du turbo aux changements de rapport). */
  gear?: number;
  /** Faux : tout est coupé (menus, pause). */
  active: boolean;
  /** Caractère du moteur de la voiture conduite. */
  engine: EngineSound;
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engine: { a: OscillatorNode; b: OscillatorNode; c: OscillatorNode; filter: BiquadFilterNode; gain: GainNode; levels: GainNode[]; rumble: GainNode; whistle: OscillatorNode; whistleGain: GainNode } | null = null;
  private tire: { filter: BiquadFilterNode; gain: GainNode } | null = null;
  private wind: { filter: BiquadFilterNode; gain: GainNode } | null = null;
  private nos: { gain: GainNode } | null = null;
  private volume = 0.7;
  private lastSpeed = 0;
  private noiseBuffer: AudioBuffer | null = null;
  /** Pression du turbo (0..1) : monte quand on reste sur les gaz, retombe sinon. */
  private boostLevel = 0;
  private lastThrottle = 0;
  private lastGear = 0;
  private blowCooldown = 0;
  private thudCooldown = 0;
  enabled = true;

  constructor(volume: number) {
    this.volume = volume;
    const unlock = (): void => {
      this.ensure();
      if (this.ctx && this.ctx.state === 'running') {
        window.removeEventListener('keydown', unlock);
        window.removeEventListener('pointerdown', unlock);
      }
    };
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  private ensure(): void {
    if (this.ctx) {
      if (this.ctx.state !== 'running') void this.ctx.resume();
      return;
    }
    try {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.ratio.value = 3;
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(comp).connect(ctx.destination);

      // Bruit blanc en boucle, partagé par les pneus, le vent et le NOS.
      const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      this.noiseBuffer = noise;
      const data = noise.getChannelData(0);
      let seed = 24680;
      for (let i = 0; i < data.length; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        data[i] = seed / 2147483648 - 1;
      }
      const noiseSrc = (): AudioBufferSourceNode => {
        const s = ctx.createBufferSource();
        s.buffer = noise;
        s.loop = true;
        s.start();
        return s;
      };

      // — Moteur —
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(257);
      for (let i = 0; i < 257; i++) {
        const x = i / 128 - 1;
        curve[i] = Math.tanh(2.2 * x);
      }
      shaper.curve = curve;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 1.4;
      filter.frequency.value = 400;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const levels: GainNode[] = [];
      const mk = (type: OscillatorType, level: number): OscillatorNode => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = 30;
        const g = ctx.createGain();
        g.gain.value = level;
        levels.push(g);
        o.connect(g).connect(shaper);
        o.start();
        return o;
      };
      const a = mk('sawtooth', 0.5);
      const b = mk('square', 0.35);
      const c = mk('sawtooth', 0.25);
      c.detune.value = 9;
      shaper.connect(filter).connect(gain).connect(this.master);
      // Grondement irrégulier (moteurs rauques, diesel) : bruit grave ajouté avant la saturation.
      const rumbleFilter = ctx.createBiquadFilter();
      rumbleFilter.type = 'lowpass';
      rumbleFilter.frequency.value = 180;
      const rumble = ctx.createGain();
      rumble.gain.value = 0;
      noiseSrc().connect(rumbleFilter).connect(rumble).connect(shaper);
      // Sifflement de turbo : une note aiguë qui monte avec la charge.
      const whistle = ctx.createOscillator();
      whistle.type = 'sine';
      whistle.frequency.value = 2000;
      const whistleGain = ctx.createGain();
      whistleGain.gain.value = 0;
      whistle.connect(whistleGain).connect(this.master);
      whistle.start();
      this.engine = { a, b, c, filter, gain, levels, rumble, whistle, whistleGain };

      // — Pneus qui crissent —
      const tf = ctx.createBiquadFilter();
      tf.type = 'bandpass';
      tf.frequency.value = 1200;
      tf.Q.value = 5;
      const tg = ctx.createGain();
      tg.gain.value = 0;
      noiseSrc().connect(tf).connect(tg).connect(this.master);
      this.tire = { filter: tf, gain: tg };

      // — Vent et roulement —
      const wf = ctx.createBiquadFilter();
      wf.type = 'lowpass';
      wf.frequency.value = 300;
      const wg = ctx.createGain();
      wg.gain.value = 0;
      noiseSrc().connect(wf).connect(wg).connect(this.master);
      this.wind = { filter: wf, gain: wg };

      // — Sifflement du NOS —
      const nf = ctx.createBiquadFilter();
      nf.type = 'highpass';
      nf.frequency.value = 3800;
      const ng = ctx.createGain();
      ng.gain.value = 0;
      noiseSrc().connect(nf).connect(ng).connect(this.master);
      this.nos = { gain: ng };
    } catch (err) {
      console.info('Bruitages indisponibles :', err);
      this.enabled = false;
    }
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** À appeler à chaque image avec l'état de la voiture. */
  update(dt: number, s: SfxState): void {
    const ctx = this.ctx;
    if (!ctx || !this.engine || !this.tire || !this.wind || !this.nos) return;
    const t = ctx.currentTime;
    const on = s.active && this.enabled ? 1 : 0;
    // Fréquence d'allumage : une explosion tous les deux tours par cylindre (4 cylindres = 2 par tour).
    const en = s.engine;
    const f = Math.max(14, (s.rpm / 60) * (en.cylinders / 2) * en.pitch);
    const e = this.engine;
    e.a.frequency.setTargetAtTime(f, t, 0.03);
    e.b.frequency.setTargetAtTime(f / 2, t, 0.03);
    e.c.frequency.setTargetAtTime(f * 1.5, t, 0.03);
    const rev = Math.min(1, s.rpm / s.redline);
    const bright = 0.45 + en.bright;
    e.filter.frequency.setTargetAtTime((260 + rev * 900 + s.throttle * (900 + rev * 1600)) * bright, t, 0.05);
    // Timbre : beaucoup de cylindres = son plus lisse (moins de sous-octave), moteur rauque = plus de carré et de grondement.
    const smooth = Math.min(1, en.cylinders / 8);
    (e.levels[0] as GainNode).gain.setTargetAtTime(0.5, t, 0.1);
    (e.levels[1] as GainNode).gain.setTargetAtTime(0.12 + en.rough * 0.45 * (1 - smooth * 0.6), t, 0.1);
    (e.levels[2] as GainNode).gain.setTargetAtTime(0.12 + en.bright * 0.3, t, 0.1);
    e.rumble.gain.setTargetAtTime(on * en.rough * (0.25 + s.throttle * 0.5), t, 0.08);
    const boost = en.turbo * s.throttle * Math.max(0, rev - 0.3);
    e.whistle.frequency.setTargetAtTime(1800 + rev * 2600, t, 0.15);
    e.whistleGain.gain.setTargetAtTime(on * boost * 0.035, t, 0.12);
    // Soupape de décharge : un turbo sous pression « souffle » quand on lâche les gaz ou qu'on
    // change de rapport. La pression met une demi-seconde à monter.
    if (en.turbo > 0.05) {
      const target = s.throttle * Math.max(0, Math.min(1, (rev - 0.35) / 0.4));
      this.boostLevel += (target - this.boostLevel) * Math.min(1, dt * (target > this.boostLevel ? 2.2 : 4));
      this.blowCooldown = Math.max(0, this.blowCooldown - dt);
      const lifted = this.lastThrottle > 0.6 && s.throttle < 0.25;
      const shifted = s.gear !== undefined && s.gear !== this.lastGear && s.gear > 1 && this.lastGear >= 1;
      if (on && (lifted || shifted) && this.boostLevel > 0.45 && this.blowCooldown === 0) {
        this.blowOff(en.turbo * this.boostLevel, shifted && !lifted);
        this.blowCooldown = 0.5;
        this.boostLevel *= 0.25;
      }
    } else this.boostLevel = 0;
    this.lastThrottle = s.throttle;
    if (s.gear !== undefined) this.lastGear = s.gear;
    e.gain.gain.setTargetAtTime(on * (0.05 + s.throttle * 0.1 + rev * 0.05), t, 0.06);

    const kmh = s.speed * 3.6;
    // Crissement : dès que la voiture glisse de travers à bonne vitesse.
    const slide = Math.min(1, Math.max(0, (Math.abs(s.slip) - 0.1) / 0.35)) * Math.min(1, kmh / 45);
    this.tire.gain.gain.setTargetAtTime(on * slide * (s.drifting ? 0.16 : 0.11), t, 0.07);
    this.tire.filter.frequency.setTargetAtTime(900 + slide * 500 + Math.min(400, kmh * 2), t, 0.1);

    const air = Math.min(1, kmh / 200);
    this.wind.gain.gain.setTargetAtTime(on * air * air * 0.22, t, 0.2);
    this.wind.filter.frequency.setTargetAtTime(250 + air * 1300, t, 0.2);

    this.nos.gain.gain.setTargetAtTime(on && s.nos ? 0.07 : 0, t, 0.05);

    // Choc : la vitesse chute brutalement.
    this.thudCooldown -= dt;
    const drop = this.lastSpeed - s.speed;
    if (on && drop > 4.5 && this.thudCooldown <= 0 && dt < 0.1) {
      this.thud(Math.min(1, drop / 14));
      this.thudCooldown = 0.35;
    }
    this.lastSpeed = s.speed;
  }

  // ——— Sons ponctuels ———
  private tone(freq: number, start: number, dur: number, level: number, type: OscillatorType = 'sine', slideTo?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.enabled) return;
    const t = ctx.currentTime + start;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Bip du décompte ; `go` = départ. */
  beep(go: boolean): void {
    this.tone(go ? 880 : 440, 0, go ? 0.5 : 0.16, 0.16, 'square');
  }

  /** Mallette ramassée. */
  coin(): void {
    this.tone(988, 0, 0.1, 0.14);
    this.tone(1319, 0.08, 0.3, 0.14);
  }

  /** Téléporteur. */
  warp(): void {
    this.tone(220, 0, 0.45, 0.16, 'sawtooth', 1760);
    this.tone(1760, 0.4, 0.3, 0.1);
  }

  /** Fin de course : petite phrase montante (plus longue pour une victoire). */
  finish(win: boolean): void {
    const notes = win ? [523, 659, 784, 1047] : [523, 659];
    notes.forEach((n, k) => this.tone(n, k * 0.13, k === notes.length - 1 ? 0.6 : 0.16, 0.14, 'triangle'));
  }

  /**
   * Soupape de décharge du turbo : un souffle aigu qui retombe (« pschhh »), suivi sur les gros
   * turbos d'un battement rapide (« tu-tu-tu »). Plus court à un changement de rapport.
   */
  private blowOff(level: number, short: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuffer) return;
    const t = ctx.currentTime;
    const dur = short ? 0.22 : 0.42;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 1.6;
    band.frequency.setValueAtTime(5200, t);
    band.frequency.exponentialRampToValueAtTime(1700, t + dur);
    const g = ctx.createGain();
    const peak = Math.min(0.2, 0.06 + level * 0.14);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    // Battement : la pression qui repart par à-coups dans le compresseur.
    const flutter = ctx.createGain();
    flutter.gain.value = 1;
    if (level > 0.5 && !short) {
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.setValueAtTime(34, t);
      lfo.frequency.linearRampToValueAtTime(16, t + dur);
      const depth = ctx.createGain();
      depth.gain.value = 0.55;
      lfo.connect(depth).connect(flutter.gain);
      lfo.start(t + 0.08);
      lfo.stop(t + dur + 0.05);
    }
    src.connect(band).connect(flutter).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  /** Lampadaire fauché : choc sourd et tintement métallique. */
  clang(): void {
    this.tone(150, 0, 0.12, 0.2, 'triangle', 60);
    this.tone(1250, 0.01, 0.35, 0.07, 'square', 1180);
    this.tone(1870, 0.01, 0.25, 0.04, 'square', 1790);
  }

  /** Arbre fauché (force 0,5) ou gros tronc cassé (force 1) : craquement de bois et choc sourd. */
  crack(strength: number): void {
    this.tone(120, 0, 0.18, 0.22 * strength + 0.08, 'triangle', 45);
    this.tone(420, 0, 0.05, 0.1 * strength, 'sawtooth', 160);
    this.tone(310, 0.05, 0.07, 0.08 * strength, 'sawtooth', 120);
    if (strength > 0.8) this.tone(70, 0.02, 0.4, 0.3, 'sine', 32);
  }


  click(): void {
    this.tone(660, 0, 0.05, 0.07, 'triangle');
  }

  private thud(strength: number): void {
    this.tone(95, 0, 0.22, 0.3 * strength + 0.1, 'sine', 40);
    this.tone(180, 0, 0.06, 0.12 * strength, 'square', 70);
  }
}
