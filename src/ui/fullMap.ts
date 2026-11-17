import type { District } from '../world/streetGraph';

/** Ce que la grande carte reçoit de la mini-carte : le plan pré-dessiné et son échelle. */
export interface MapLayers {
  base: HTMLCanvasElement;
  route: HTMLCanvasElement;
  ox: number;
  oz: number;
  /** Pixels du plan par mètre. */
  px: number;
}

export interface FullMapState {
  x: number;
  z: number;
  yaw: number;
  level: number;
  racing: boolean;
  allOpen: boolean;
}

/**
 * Carte complète de la ville, en plein écran (touche Tab) : toutes les rues, y compris les
 * quartiers pas encore accessibles (grisés, avec le niveau requis), les bornes de départ et la
 * position du joueur. Le jeu continue derrière.
 */
export class FullMap {
  open = false;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(
    private readonly layers: MapLayers,
    private readonly districts: District[],
    private readonly markers: { x: number; z: number; circuit: boolean; name: string }[],
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'fullmap';
    document.body.append(this.canvas);
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
  }

  toggle(): boolean {
    this.open = !this.open;
    this.canvas.classList.toggle('open', this.open);
    return this.open;
  }

  /** À appeler à chaque image quand la carte est ouverte. */
  update(s: FullMapState): void {
    if (!this.open) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth, H = window.innerHeight;
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) {
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
    }
    const c = this.ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(7, 6, 15, 0.88)';
    c.fillRect(0, 0, W, H);

    const L = this.layers;
    const pad = 56;
    const k = Math.min((W - pad * 2) / L.base.width, (H - pad * 2 - 30) / L.base.height);
    const x0 = (W - L.base.width * k) / 2, y0 = (H - 30 - L.base.height * k) / 2;
    const mx = (x: number): number => x0 + (x - L.ox) * L.px * k;
    const mz = (z: number): number => y0 + (z - L.oz) * L.px * k;
    c.drawImage(L.base, x0, y0, L.base.width * k, L.base.height * k);
    if (s.racing) c.drawImage(L.route, x0, y0, L.route.width * k, L.route.height * k);

    c.textAlign = 'center';
    // Quartiers extérieurs : voile sombre et cadenas tant qu'ils sont fermés.
    for (const d of this.districts) {
      const locked = !s.allOpen && s.level < d.unlockLevel;
      const r = d.radius * L.px * k;
      if (locked) {
        c.fillStyle = 'rgba(7, 6, 15, 0.62)';
        c.beginPath();
        c.arc(mx(d.cx), mz(d.cz), r, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = 'rgba(255, 176, 46, 0.7)';
        c.setLineDash([6, 6]);
        c.lineWidth = 1.5;
        c.stroke();
        c.setLineDash([]);
        // Barrière de chantier
        c.fillStyle = '#ffb02e';
        c.beginPath();
        c.arc(mx(d.gate.x), mz(d.gate.z), 5, 0, Math.PI * 2);
        c.fill();
      }
      c.font = '600 15px system-ui, sans-serif';
      c.fillStyle = locked ? '#ffb02e' : '#2ee6ff';
      c.fillText(d.name, mx(d.cx), mz(d.cz) - 4);
      c.font = '13px system-ui, sans-serif';
      c.fillStyle = locked ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.6)';
      c.fillText(locked ? `🔒 ouverture au niveau ${d.unlockLevel}` : 'ouvert', mx(d.cx), mz(d.cz) + 15);
    }

    // Bornes de départ
    if (!s.racing) {
      c.font = '11px system-ui, sans-serif';
      for (const m of this.markers) {
        c.fillStyle = m.circuit ? '#ff2d95' : '#2ee6ff';
        c.strokeStyle = '#0b0b16';
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(mx(m.x), mz(m.z), 6, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        c.fillStyle = 'rgba(255,255,255,0.8)';
        c.fillText(m.name, mx(m.x), mz(m.z) - 10);
      }
    }

    // Joueur : flèche dans le sens de marche
    const px = mx(s.x), pz = mz(s.z);
    const hx = Math.sin(s.yaw), hz = Math.cos(s.yaw);
    c.fillStyle = '#ffffff';
    c.strokeStyle = '#ff2d95';
    c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(px + hx * 13, pz + hz * 13);
    c.lineTo(px - hx * 8 + hz * 8, pz - hz * 8 - hx * 8);
    c.lineTo(px - hx * 3, pz - hz * 3);
    c.lineTo(px - hx * 8 - hz * 8, pz - hz * 8 + hx * 8);
    c.closePath();
    c.fill();
    c.stroke();

    // Légende
    c.font = '13px system-ui, sans-serif';
    c.fillStyle = 'rgba(255,255,255,0.7)';
    c.fillText('●  course (cyan) · circuit (magenta)      ▬  autoroute de ceinture (bleu)      🔒  quartier fermé      Tab ou Échap : fermer', W / 2, H - 22);
  }
}
