/**
 * Musique générée par code (Web Audio) : aucun fichier audio.
 * Un petit séquenceur joue batterie, basse, nappes, arpège et mélodie à partir de
 * la description d'une piste (voir src/config/music.ts). Style visé : synthwave / dreamwave /
 * retrowave — nappes larges, piano électrique FM, réverbération généreuse, mélodie qui glisse.
 *
 * Le moteur ne dépend que d'un BaseAudioContext : il fonctionne aussi hors ligne
 * (OfflineAudioContext) pour être vérifié sans haut-parleurs.
 */
import { REST, type TrackDef } from '../config/music';

const midiToHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

export class MusicEngine {
  private readonly master: GainNode;
  private readonly duck: GainNode;
  private readonly reverb: ConvolverNode;
  private readonly reverbSend: GainNode;
  private readonly gateSend: GainNode;
  private lastLead = 0;
  private lastLeadTime = 0;
  private seed = 20261117;
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
    this.reverb.buffer = this.makeImpulse(4.2, 2.2);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 1;
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = 0.5;
    this.reverbSend.connect(this.reverb).connect(reverbOut).connect(this.master);

    // Réverbération « coupée » des années 80 pour la caisse claire et les toms : dense, puis plus rien.
    const gate = ctx.createConvolver();
    gate.buffer = this.makeImpulse(0.34, 0.35);
    this.gateSend = ctx.createGain();
    const gateOut = ctx.createGain();
    gateOut.gain.value = 0.3;
    this.gateSend.connect(gate).connect(gateOut).connect(this.master);

    // Écho pour l'arpège et la mélodie.
    this.delay = ctx.createDelay(1.5);
    const feedback = ctx.createGain();
    feedback.gain.value = 0.42;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2200;
    this.delaySend = ctx.createGain();
    this.delaySend.connect(this.delay);
    this.delay.connect(damp).connect(feedback).connect(this.delay);
    const delayOut = ctx.createGain();
    delayOut.gain.value = 0.34;
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

  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    let seed = 987654321;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const t = i / len;
        d[i] = (seed / 2147483648 - 1) * Math.pow(1 - t, decay);
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
    // Structure (32 mesures après l'intro) :
    //  0-7 rythme et arpège · 8-15 mélodie · 16-19 respiration (nappes seules)
    //  20-23 montée · 24-31 seconde mélodie, tout le monde.
    const loopBar = (bar - tr.introBars + 320) % 32;
    const calm = !intro && loopBar >= 16 && loopBar < 20;
    const build = !intro && loopBar >= 20 && loopBar < 24;
    const drums = !intro && !calm;
    const fill = !intro && (loopBar === 15 || loopBar === 23 || loopBar === 31);
    const leadPhrase = intro || calm ? null : loopBar >= 24 ? (tr.lead2 ?? tr.lead) : loopBar >= 8 && loopBar < 16 ? tr.lead : null;

    // — Batterie —
    if (drums) {
      if (tr.kick[s] === 'x' && !(fill && s >= 8)) this.kick(t);
      if (tr.snare[s] === 'x') this.snare(t, build ? 0.8 : 1);
      if (fill && s >= 8 && s % 2 === 0) this.tom(t, (s - 8) / 2); // descente de toms
      const hat = tr.hat[s];
      if (hat === 'x') this.hat(t, 0.04, 0.42, s % 4 === 0 ? -0.25 : 0.25);
      else if (hat === 'o') this.hat(t, 0.2, 0.5, 0.1);
    } else if (calm && s % 4 === 2) {
      this.hat(t, 0.03, 0.25, 0.3);
    }

    // — Basse —
    const b = tr.bass[s];
    if (b !== null && b !== undefined && !calm && !(intro && bar < Math.max(1, tr.introBars - 2))) {
      this.bass(t, tr.root + tr.bassOctave * 12 + (chord[0] as number) + b, this.stepDur * tr.bassLength);
    }

    // — Nappe : un accord tenu par mesure, plus ouvert pendant la respiration —
    if (s === 0) {
      const solo = calm || intro;
      chord.forEach((semi, k) => this.pad(t, tr.root + 12 + semi, this.stepDur * 16, k, solo ? 1.35 : 1, solo ? 2.2 : 1));
    }

    // — Arpège —
    const a = tr.arp[s];
    if (a !== null && a !== undefined && !(intro && bar === 0)) {
      const tones = chord.length;
      const note = (chord[a % tones] as number) + 12 * Math.floor(a / tones);
      const pan = ((s * 5) % 8) / 8 - 0.45;
      if (tr.arpVoice === 'bell') this.bell(t, tr.root + 24 + note, this.stepDur * 3.2, pan);
      else this.pluck(t, tr.root + 24 + note, this.stepDur * 1.6, pan);
    }

    // — Mélodie (une note par croche, sur 4 mesures) —
    if (leadPhrase && s % 2 === 0) {
      const idx = ((loopBar % 4) * 8 + s / 2) % leadPhrase.length;
      const m = leadPhrase[idx];
      if (m !== null && m !== undefined && m !== REST) {
        // La note dure jusqu'à la suivante.
        let hold = 1;
        while (hold < 8 && leadPhrase[(idx + hold) % leadPhrase.length] === null) hold++;
        this.lead(t, tr.root + 24 + m, this.stepDur * 2 * hold);
      }
    }
  }

  // ————————————————————————————————————————————————————————————————
  // Instruments
  // ————————————————————————————————————————————————————————————————
  private out(node: AudioNode, pan: number, dest: AudioNode): AudioNode {
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    node.connect(p).connect(dest);
    return p;
  }

  private kick(t: number): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(125, t);
    osc.frequency.exponentialRampToValueAtTime(44, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.8, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    osc.connect(g).connect(this.drumBus);
    osc.start(t);
    osc.stop(t + 0.45);
    // Effet de pompe, doux et long
    const d = this.duck.gain;
    d.cancelScheduledValues(t);
    d.setValueAtTime(this.track.pump, t);
    d.linearRampToValueAtTime(1, t + Math.min(0.38, this.stepDur * 3.6));
  }

  /** Caisse claire années 80 : bruit + corps grave, envoyée dans une réverbération coupée net. */
  private snare(t: number, level: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500;
    bp.Q.value = 0.55;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.42 * level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.19);
    src.connect(bp).connect(g);
    g.connect(this.drumBus);
    g.connect(this.gateSend);
    src.start(t, 0.1, 0.25);
    const tone = ctx.createOscillator();
    const tg = ctx.createGain();
    tone.frequency.setValueAtTime(190, t);
    tone.frequency.exponentialRampToValueAtTime(120, t + 0.1);
    tg.gain.setValueAtTime(0.34 * level, t);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    tone.connect(tg);
    tg.connect(this.drumBus);
    tg.connect(this.gateSend);
    tone.start(t);
    tone.stop(t + 0.16);
  }

  private tom(t: number, k: number): void {
    const ctx = this.ctx;
    const f = [210, 170, 135, 105][k] ?? 105;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(f * 1.35, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g);
    this.out(g, [-0.5, -0.15, 0.2, 0.55][k] ?? 0, this.drumBus);
    g.connect(this.gateSend);
    o.start(t);
    o.stop(t + 0.32);
  }

  private hat(t: number, length: number, level: number, pan: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 8200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.11 * level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + length);
    src.connect(hp).connect(g);
    this.out(g, pan, this.drumBus);
    src.start(t, 0.3, length + 0.02);
  }

  /** Basse ronde : dent de scie + carré une octave dessous, filtre fermé. */
  private bass(t: number, midi: number, dur: number): void {
    const ctx = this.ctx;
    const f = midiToHz(midi);
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = f;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = f / 2;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.55;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 2.5;
    lp.frequency.setValueAtTime(this.track.bassCutoff * 2.2, t);
    lp.frequency.exponentialRampToValueAtTime(this.track.bassCutoff, t + Math.min(0.2, dur));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.012);
    g.gain.setValueAtTime(0.3, t + dur * 0.75);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    saw.connect(lp);
    lp.connect(g);
    sub.connect(subGain).connect(g);
    g.connect(this.duck);
    saw.start(t);
    sub.start(t);
    saw.stop(t + dur + 0.02);
    sub.stop(t + dur + 0.02);
  }

  /** Nappe large : quatre dents de scie désaccordées, réparties à gauche et à droite. */
  private pad(t: number, midi: number, dur: number, voice: number, open: number, level: number): void {
    const ctx = this.ctx;
    const cutoff = this.track.padCutoff * open;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(cutoff * 0.55, t);
    lp.frequency.linearRampToValueAtTime(cutoff, t + dur * 0.55);
    lp.frequency.linearRampToValueAtTime(cutoff * 0.65, t + dur + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.034 * level, t + 0.5);
    g.gain.setValueAtTime(0.034 * level, t + dur - 0.05);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.9);
    lp.connect(g);
    g.connect(this.duck);
    g.connect(this.reverbSend);
    const side = voice % 2 === 0 ? -1 : 1;
    for (const [detune, pan] of [[-13, -0.75], [-4, -0.25], [5, 0.3], [12, 0.8]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midiToHz(midi);
      o.detune.value = detune + this.wobble();
      const p = ctx.createStereoPanner();
      p.pan.value = pan * side;
      o.connect(p).connect(lp);
      o.start(t);
      o.stop(t + dur + 1.0);
    }
  }

  /** Piano électrique façon DX7 : une sinusoïde modulée par une autre (FM), plus un petit « tine ». */
  private bell(t: number, midi: number, dur: number, pan: number): void {
    const ctx = this.ctx;
    const f = midiToHz(midi);
    const carrier = ctx.createOscillator();
    carrier.frequency.value = f;
    carrier.detune.value = this.wobble();
    const mod = ctx.createOscillator();
    mod.frequency.value = f;
    const index = ctx.createGain();
    index.gain.setValueAtTime(f * 1.9, t);
    index.gain.exponentialRampToValueAtTime(f * 0.12, t + 0.32);
    mod.connect(index).connect(carrier.frequency);
    const tine = ctx.createOscillator();
    tine.frequency.value = f * 7;
    const tineGain = ctx.createGain();
    tineGain.gain.setValueAtTime(0.12, t);
    tineGain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(this.track.arpLevel, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    carrier.connect(g);
    tine.connect(tineGain).connect(g);
    const p = this.out(g, pan, this.duck);
    p.connect(this.delaySend);
    p.connect(this.reverbSend);
    for (const o of [carrier, mod, tine]) {
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  private pluck(t: number, midi: number, dur: number, pan: number): void {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 2;
    lp.frequency.setValueAtTime(3000, t);
    lp.frequency.exponentialRampToValueAtTime(600, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(this.track.arpLevel, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    lp.connect(g);
    const p = this.out(g, pan, this.duck);
    p.connect(this.delaySend);
    p.connect(this.reverbSend);
    for (const detune of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midiToHz(midi);
      o.detune.value = detune;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
  }

  /** Mélodie douce : glisse depuis la note précédente, vibrato tardif, beaucoup d'espace. */
  private lead(t: number, midi: number, dur: number): void {
    const ctx = this.ctx;
    const f = midiToHz(midi);
    const from = this.lastLead > 0 && t - this.lastLeadTime < 1.2 ? this.lastLead : f;
    this.lastLead = f;
    this.lastLeadTime = t + dur;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(1400, t);
    lp.frequency.linearRampToValueAtTime(2600, t + Math.min(0.25, dur));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.075, t + 0.045);
    g.gain.setValueAtTime(0.075, t + Math.max(0.05, dur - 0.06));
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.22);
    lp.connect(g);
    g.connect(this.duck);
    g.connect(this.delaySend);
    g.connect(this.reverbSend);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.2;
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(0, t + Math.min(0.2, dur * 0.4));
    lfoGain.gain.linearRampToValueAtTime(f * 0.007, t + Math.min(0.7, dur));
    lfo.connect(lfoGain);
    for (const [type, detune, level] of [['sawtooth', -8, 0.8], ['sawtooth', 8, 0.8], ['triangle', 0, 1]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(from, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.07);
      o.detune.value = detune;
      const og = ctx.createGain();
      og.gain.value = level;
      lfoGain.connect(o.frequency);
      o.connect(og).connect(lp);
      o.start(t);
      o.stop(t + dur + 0.25);
    }
    lfo.start(t);
    lfo.stop(t + dur + 0.25);
  }

  /** Léger désaccord aléatoire, comme une bande un peu fatiguée. */
  private wobble(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return (this.seed / 4294967296 - 0.5) * 7;
  }
}
