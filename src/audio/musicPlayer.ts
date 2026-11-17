import { TRACKS } from '../config/music';
import { MusicEngine } from './music';

/**
 * Lecteur de musique du jeu : crée le contexte audio au premier geste du joueur
 * (les navigateurs interdisent le son avant), puis alimente le séquenceur en continu.
 */
export class MusicPlayer {
  private ctx: AudioContext | null = null;
  private engine: MusicEngine | null = null;
  private timer = 0;
  trackIndex = 0;
  enabled = true;
  private volume = 0.6;

  constructor(trackIndex: number, enabled: boolean, volume: number) {
    this.trackIndex = ((trackIndex % TRACKS.length) + TRACKS.length) % TRACKS.length;
    this.enabled = enabled;
    this.volume = volume;
    const unlock = (): void => {
      this.ensureStarted();
      if (this.ctx && this.ctx.state === 'running') {
        window.removeEventListener('keydown', unlock);
        window.removeEventListener('pointerdown', unlock);
      }
    };
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
    // Onglet caché : on met le son en pause plutôt que de le laisser hacher.
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else if (this.enabled) void this.ctx.resume();
    });
  }

  get trackName(): string {
    return (TRACKS[this.trackIndex] ?? TRACKS[0])?.name ?? '';
  }

  private ensureStarted(): void {
    if (!this.enabled) return;
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext({ latencyHint: 'interactive' });
        this.engine = new MusicEngine(this.ctx, TRACKS[this.trackIndex] ?? (TRACKS[0] as (typeof TRACKS)[number]));
        this.engine.setVolume(this.volume);
        this.timer = window.setInterval(() => {
          if (this.ctx && this.engine) this.engine.schedule(this.ctx.currentTime + 0.3);
        }, 50);
      }
      if (this.ctx.state !== 'running') void this.ctx.resume();
      this.engine?.start();
    } catch (err) {
      console.info('Audio indisponible :', err);
      this.enabled = false;
      window.clearInterval(this.timer);
    }
  }

  setVolume(v: number): void {
    this.volume = v;
    this.engine?.setVolume(v);
  }

  /** Active ou coupe la musique. Renvoie le nouvel état. */
  toggle(): boolean {
    this.enabled = !this.enabled;
    if (this.enabled) this.ensureStarted();
    else {
      this.engine?.stop();
      if (this.ctx) void this.ctx.suspend();
    }
    return this.enabled;
  }

  /** Passe à la piste suivante. Renvoie son nom. */
  next(): string {
    this.trackIndex = (this.trackIndex + 1) % TRACKS.length;
    const track = TRACKS[this.trackIndex];
    if (track) this.engine?.setTrack(track);
    if (!this.enabled) this.toggle();
    return this.trackName;
  }
}
