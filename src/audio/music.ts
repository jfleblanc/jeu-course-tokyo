/**
 * Musique générée par code (Web Audio) : aucun fichier audio.
 * Un petit séquenceur joue batterie, basse, nappes, arpège et mélodie à partir de
 * la description d'une piste (voir src/config/music.ts). Style visé : électro / synthwave.
 *
 * Le moteur ne dépend que d'un BaseAudioContext : il fonctionne aussi hors ligne
 * (OfflineAudioContext) pour être vérifié sans haut-parleurs.
 */
import type { TrackDef } from '../config/music';

const midiToHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

export class MusicEngine {
  private readonly master: GainNode;
  private readonly duck: GainNode;
  private readonly reverb: ConvolverNode;
  private readonly reverbSend: GainNode;
  private readonly delay: DelayNode;
  private readonly delaySend: GainNode;
  private readonly drumBus: GainNode;
  private readonly noise: AudioBuffer;
  private track: TrackDef;
  private step = 0;
  private nextTime = 0;
  private playing = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    track: TrackDef,
  ) {
    this.track = track;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(comp).connect(ctx.destination);

    // Tout ce qui n'est pas la batterie passe par « duck » : le volume plonge à chaque
    // coup de grosse caisse (effet de pompe typique de la synthwave).
    this.duck = ctx.createGain();
    this.duck.connect(this.master);
    this.drumBus = ctx.createGain();
    this.drumBus.connect(this.master);

    // Réverbération : réponse impulsionnelle fabriquée (bruit qui s'éteint).
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.4);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 1;
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = 0.32;
    this.reverbSend.connect(this.reverb).connect(reverbOut).connect(this.master);

    // Écho pour l'arpège et la mélodie.
    this.delay = ctx.createDelay(1.5);
    const feedback = ctx.createGain();
    feedback.gain.value = 0.36;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2600;
    this.delaySend = ctx.createGain();
    this.delaySend.connect(this.delay);
    this.delay.connect(damp).connect(feedback).connect(this.delay);
    const delayOut = ctx.createGain();
    delayOut.gain.value = 0.3;
    damp.connect(delayOut).connect(this.duck);

    // Bruit blanc réutilisé pour la caisse claire et les cymbales.
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let seed = 1234567;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = seed / 2147483648 - 1;
    }
    this.applyTrack();
  }

  private makeImpulse(seconds: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    let seed = 987654321;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const t = i / len;
        d[i] = (seed / 2147483648 - 1) * Math.pow(1 - t, 2.6);
      }
    }
    return buf;
  }

  private get stepDur(): number {
    return 60 / this.track.bpm / 4; // une double croche
  }

  private applyTrack(): void {
    // Écho calé sur le tempo (croche pointée).
    this.delay.delayTime.value = Math.min(1.4, this.stepDur * 3);
  }

  setVolume(v: number): void {
    this.master.gain.setTargetAtTime(Math.max(0, v) * 0.85, this.ctx.currentTime, 0.05);
  }

  setTrack(track: TrackDef): void {
    this.track = track;
    this.applyTrack();
    this.step = 0;
    this.nextTime = Math.max(this.nextTime, this.ctx.currentTime + 0.08);
  }

  start(): void {
    if (this.playing) return;
    this.playing = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
  }

  stop(): void {
    this.playing = false;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Programme toutes les notes jusqu'à l'instant `until` (horloge du contexte audio). */
  schedule(until: number): void {
    if (!this.playing) return;
    // Après une longue pause (onglet caché), on repart du présent au lieu de rattraper.
    if (this.nextTime < this.ctx.currentTime - 0.3) this.nextTime = this.ctx.currentTime + 0.05;
    while (this.nextTime < until) {
      this.playStep(this.step, this.nextTime);
      this.step++;
      this.nextTime += this.stepDur;
    }
  }

  // ————————————————————————————————————————————————————————————————
  // Séquenceur
  // ————————————————————————————————————————————————————————————————
  private playStep(n: number, t: number): void {
    const tr = this.track;
    const s = n % 16;
    const bar = Math.floor(n / 16);
    const chord = tr.chords[bar % tr.chords.length] as number[];
    const intro = bar < tr.introBars;
    // Structure : boucle de 16 mesures après l'intro ; la mélodie entre dans la seconde moitié.
    const loopBar = (bar - tr.introBars + 160) % 16;
    const withLead = !intro && loopBar >= 8;
    const breakdown = !intro && loopBar === 15; // petite respiration avant de reboucler

    // — Batterie —
    if (!intro) {
      const kick = tr.kick[s] === 'x' && !(breakdown && s >= 8);
      if (kick) this.kick(t);
      if (tr.snare[s] === 'x') this.snare(t, 1);
      if (breakdown && s >= 12) this.snare(t, 0.45 + (s - 12) * 0.12); // roulement
      const hat = tr.hat[s];
      if (hat === 'x') this.hat(t, 0.035, 0.5);
      else if (hat === 'o') this.hat(t, 0.16, 0.6);
    } else if (tr.hat[s] === 'x' && bar >= tr.introBars - 1) {
      this.hat(t, 0.03, 0.35);
    }

    // — Basse —
    const b = tr.bass[s];
    if (b !== null && b !== undefined && !(intro && bar === 0)) {
      this.bass(t, tr.root + tr.bassOctave * 12 + (chord[0] as number) + b, this.stepDur * tr.bassLength);
    }

    // — Nappe : un accord tenu par mesure —
    if (s === 0) {
      for (const semi of chord) this.pad(t, tr.root + 12 + semi, this.stepDur * 16);
    }

    // — Arpège —
    const a = tr.arp[s];
    if (a !== null && a !== undefined) {
      const tones = chord.length;
      const note = (chord[a % tones] as number) + 12 * Math.floor(a / tones);
      this.pluck(t, tr.root + 24 + note, this.stepDur * 1.6);
    }

    // — Mélodie (une note par croche, sur 4 mesures) —
    if (withLead && s % 2 === 0) {
      const idx = ((loopBar % 4) * 8 + s / 2) % tr.lead.length;
      const m = tr.lead[idx];
      if (m !== null && m !== undefined) {
        // La note dure jusqu'à la suivante.
        let hold = 1;
        while (hold < 8 && tr.lead[(idx + hold) % tr.lead.length] === null) hold++;
        this.lead(t, tr.root + 24 + m, this.stepDur * 2 * hold);
      }
    }
  }

  // ————————————————————————————————————————————————————————————————
  // Instruments
  // ————————————————————————————————————————————————————————————————
  private kick(t: number): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(155, t);
    osc.frequency.exponentialRampToValueAtTime(46, t + 0.11);
    g.gain.setValueAtTime(0.95, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    osc.connect(g).connect(this.drumBus);
    osc.start(t);
    osc.stop(t + 0.36);
    // Effet de pompe
    const d = this.duck.gain;
    d.cancelScheduledValues(t);
    d.setValueAtTime(this.track.pump, t);
    d.linearRampToValueAtTime(1, t + Math.min(0.3, this.stepDur * 3.2));
  }

  private snare(t: number, level: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5 * level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    src.connect(bp).connect(g);
    g.connect(this.drumBus);
    g.connect(this.reverbSend); // caisse claire « années 80 » avec beaucoup de réverbération
    src.start(t, 0.1, 0.25);
    const tone = ctx.createOscillator();
    const tg = ctx.createGain();
    tone.frequency.setValueAtTime(210, t);
    tone.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    tg.gain.setValueAtTime(0.3 * level, t);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    tone.connect(tg).connect(this.drumBus);
    tone.start(t);
    tone.stop(t + 0.12);
  }

  private hat(t: number, length: number, level: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16 * level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + length);
    src.connect(hp).connect(g).connect(this.drumBus);
    src.start(t, 0.3, length + 0.02);
  }

  private bass(t: number, midi: number, dur: number): void {
    const ctx = this.ctx;
    const f = midiToHz(midi);
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = f;
    const sub = ctx.createOscillator();
    sub.type = 'square';
    sub.frequency.value = f / 2;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.35;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 5;
    lp.frequency.setValueAtTime(this.track.bassCutoff * 2.6, t);
    lp.frequency.exponentialRampToValueAtTime(this.track.bassCutoff, t + Math.min(0.14, dur));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.006);
    g.gain.setValueAtTime(0.3, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    saw.connect(lp);
    sub.connect(subGain).connect(lp);
    lp.connect(g).connect(this.duck);
    saw.start(t);
    sub.start(t);
    saw.stop(t + dur + 0.02);
    sub.stop(t + dur + 0.02);
  }

  private pad(t: number, midi: number, dur: number): void {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(this.track.padCutoff * 0.6, t);
    lp.frequency.linearRampToValueAtTime(this.track.padCutoff, t + dur * 0.5);
    lp.frequency.linearRampToValueAtTime(this.track.padCutoff * 0.7, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.25);
    g.gain.setValueAtTime(0.05, t + dur - 0.1);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.35);
    lp.connect(g);
    g.connect(this.duck);
    g.connect(this.reverbSend);
    for (const detune of [-9, 8]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midiToHz(midi);
      o.detune.value = detune;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.4);
    }
  }

  private pluck(t: number, midi: number, dur: number): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = this.track.arpWave;
    o.frequency.value = midiToHz(midi);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 3;
    lp.frequency.setValueAtTime(4200, t);
    lp.frequency.exponentialRampToValueAtTime(700, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(this.track.arpLevel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(lp).connect(g);
    g.connect(this.duck);
    g.connect(this.delaySend);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private lead(t: number, midi: number, dur: number): void {
    const ctx = this.ctx;
    const f = midiToHz(midi);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.085, t + 0.03);
    g.gain.setValueAtTime(0.085, t + Math.max(0.04, dur - 0.08));
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.12);
    lp.connect(g);
    g.connect(this.duck);
    g.connect(this.delaySend);
    g.connect(this.reverbSend);
    // Vibrato léger qui arrive après l'attaque
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(0, t);
    lfoGain.gain.linearRampToValueAtTime(f * 0.006, t + Math.min(0.5, dur));
    lfo.connect(lfoGain);
    for (const [type, detune, level] of [['sawtooth', -6, 1], ['square', 7, 0.5]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = detune;
      const og = ctx.createGain();
      og.gain.value = level;
      lfoGain.connect(o.frequency);
      o.connect(og).connect(lp);
      o.start(t);
      o.stop(t + dur + 0.15);
    }
    lfo.start(t);
    lfo.stop(t + dur + 0.15);
  }
}
