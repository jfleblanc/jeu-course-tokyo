import { drawHouse, drawPlan } from './minimap';
import type { CityData } from '../world/cityGen';
import type { Route } from '../race/route';

/** Un lieu de la carte : pastille de course, garage, colis. */
export interface MapPlace {
  x: number;
  z: number;
  name: string;
  kind: 'course' | 'circuit' | 'garage' | 'colis' | 'arrivee';
}

export interface FullMapState {
  x: number;
  z: number;
  yaw: number;
  level: number;
  racing: boolean;
  allOpen: boolean;
  /** Tracé de la course en cours. */
  route: Route | null;
  /** Courses déjà faites : nom du tracé → meilleure place. */
  done: Record<string, number>;
  /** Livraisons : colis proposés et arrivée en cours. */
  parcels: { x: number; z: number; name: string }[];
  goal: { x: number; z: number; name: string } | null;
  /** Itinéraire en cours (x, z, x, z…) et sa destination. */
  guide: number[];
  target: { x: number; z: number; name: string } | null;
  /** Autres joueurs du salon. */
  players: { x: number; z: number; name: string }[];
}

const MEDAL = ['#ffd257', '#cfd8e6', '#d9905a'];

/**
 * Carte de la ville en plein écran (touche Tab). On la déplace en la faisant glisser, on zoome à
 * la molette (ou + et −), et un clic sur un lieu trace l'itinéraire pour s'y rendre. Elle est
 * redessinée en traits à chaque image : nette à tous les zooms. Le jeu continue derrière.
 */
export class FullMap {
  open = false;
  /** Appelé quand le joueur clique un lieu (ou `null` : clic droit, on efface l'itinéraire). */
  onPick: ((place: MapPlace | null) => void) | null = null;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** Vue : centre (m) et échelle (pixels d'écran par mètre). */
  private cx = 0;
  private cz = 0;
  private scale = 1;
  private follow = true;
  private drag: { x: number; y: number; cx: number; cz: number; moved: boolean } | null = null;
  private mouse = { x: -1, y: -1 };
  places: MapPlace[] = [];
  private last: FullMapState | null = null;

  constructor(
    private readonly city: CityData,
    private readonly markers: { x: number; z: number; circuit: boolean; name: string; districts?: number[] }[],
    /** Garage du joueur (petite maison sur la carte). */
    private readonly home: { x: number; z: number } | null = null,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'fullmap';
    document.body.append(this.canvas);
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    const cv = this.canvas;
    cv.addEventListener('pointerdown', (ev) => {
      if (ev.button === 2) return;
      cv.setPointerCapture(ev.pointerId);
      this.drag = { x: ev.clientX, y: ev.clientY, cx: this.cx, cz: this.cz, moved: false };
    });
    cv.addEventListener('pointermove', (ev) => {
      this.mouse.x = ev.clientX;
      this.mouse.y = ev.clientY;
      const d = this.drag;
      if (!d) return;
      if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 4) d.moved = true;
      if (d.moved) {
        this.cx = d.cx - (ev.clientX - d.x) / this.scale;
        this.cz = d.cz - (ev.clientY - d.y) / this.scale;
        this.follow = false;
        this.clamp();
      }
    });
    cv.addEventListener('pointerup', (ev) => {
      const d = this.drag;
      this.drag = null;
      if (d && !d.moved) {
        const place = this.placeAt(ev.clientX, ev.clientY);
        if (place) this.onPick?.(place);
      }
    });
    cv.addEventListener('pointercancel', () => { this.drag = null; });
    cv.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      this.onPick?.(null);
    });
    cv.addEventListener('dblclick', () => { this.follow = true; });
    cv.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      this.zoomAt(ev.clientX, ev.clientY, Math.exp(-ev.deltaY * 0.0015));
    }, { passive: false });
    window.addEventListener('keydown', (ev) => {
      if (!this.open) return;
      if (ev.key === '+' || ev.key === '=') this.zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.3);
      else if (ev.key === '-' || ev.key === '_') this.zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1 / 1.3);
      else if (ev.key === '0') this.follow = true;
    });
  }

  /** Échelle qui montre toute la ville. */
  private fitScale(): number {
    const b = this.city.bounds;
    return Math.min(window.innerWidth / (b.x1 - b.x0), window.innerHeight / (b.z1 - b.z0)) * 0.94;
  }

  private clamp(): void {
    const b = this.city.bounds;
    this.cx = Math.max(b.x0, Math.min(b.x1, this.cx));
    this.cz = Math.max(b.z0, Math.min(b.z1, this.cz));
  }

  /** Zoome en gardant sous le curseur le point qui s'y trouve. */
  private zoomAt(sx: number, sy: number, factor: number): void {
    const W = window.innerWidth, H = window.innerHeight;
    const wx = this.cx + (sx - W / 2) / this.scale, wz = this.cz + (sy - H / 2) / this.scale;
    this.scale = Math.max(this.fitScale(), Math.min(5, this.scale * factor));
    this.cx = wx - (sx - W / 2) / this.scale;
    this.cz = wz - (sy - H / 2) / this.scale;
    this.follow = false;
    this.clamp();
  }

  private placeAt(sx: number, sy: number): MapPlace | null {
    const W = window.innerWidth, H = window.innerHeight;
    let best: MapPlace | null = null, bd = 18;
    for (const p of this.places) {
      const d = Math.hypot(W / 2 + (p.x - this.cx) * this.scale - sx, H / 2 + (p.z - this.cz) * this.scale - sy);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  toggle(): boolean {
    this.open = !this.open;
    this.canvas.classList.toggle('open', this.open);
    if (this.open) {
      // À l'ouverture : centrée sur la voiture, assez près pour lire les rues (environ 1,2 km de large).
      this.follow = true;
      this.scale = Math.max(this.fitScale(), Math.min(2.2, window.innerWidth / 1250));
      this.drag = null;
    }
    return this.open;
  }

  /** À appeler à chaque image quand la carte est ouverte. */
  update(s: FullMapState): void {
    if (!this.open) return;
    this.last = s;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth, H = window.innerHeight;
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) {
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
    }
    if (this.follow) { this.cx = s.x; this.cz = s.z; }
    this.scale = Math.max(this.fitScale(), this.scale);
    const k = this.scale;
    const c = this.ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = 'rgba(7, 6, 15, 0.93)';
    c.fillRect(0, 0, W, H);
    const mx = (x: number): number => W / 2 + (x - this.cx) * k;
    const mz = (z: number): number => H / 2 + (z - this.cz) * k;

    // Plan de la ville, en mètres : c'est la transformation du canevas qui fait le zoom.
    c.save();
    c.translate(W / 2 - this.cx * k, H / 2 - this.cz * k);
    c.scale(k, k);
    drawPlan(c, this.city, 1, 0, 0);
    const line = (pts: (i: number) => { x: number; z: number } | null, n: number, color: string, width: number): void => {
      c.strokeStyle = color;
      c.lineWidth = width / k;
      c.lineJoin = 'round';
      c.beginPath();
      let started = false;
      for (let i = 0; i < n; i++) {
        const p = pts(i);
        if (!p) continue;
        if (!started) { c.moveTo(p.x, p.z); started = true; } else c.lineTo(p.x, p.z);
      }
      c.stroke();
    };
    if (s.racing && s.route) {
      const r = s.route;
      line((i) => r.points[i * 2] ?? null, Math.floor(r.lapPoints / 2), 'rgba(0,0,0,0.55)', 9);
      line((i) => r.points[i * 2] ?? null, Math.floor(r.lapPoints / 2), '#ffb02e', 5);
    }
    if (s.guide.length >= 4) {
      const g = s.guide;
      line((i) => ({ x: g[i * 2] as number, z: g[i * 2 + 1] as number }), g.length / 2, 'rgba(0,0,0,0.5)', 8);
      line((i) => ({ x: g[i * 2] as number, z: g[i * 2 + 1] as number }), g.length / 2, s.goal ? '#50ff82' : '#2ee6ff', 4.5);
    }
    c.restore();

    c.textAlign = 'center';
    // Quartiers extérieurs : voile sombre et cadenas tant qu'ils sont fermés.
    for (const d of this.city.graph.districts) {
      const locked = !s.allOpen && s.level < d.unlockLevel;
      if (locked) {
        c.fillStyle = 'rgba(7, 6, 15, 0.62)';
        c.beginPath();
        c.arc(mx(d.cx), mz(d.cz), d.radius * k, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = 'rgba(255, 176, 46, 0.7)';
        c.setLineDash([6, 6]);
        c.lineWidth = 1.5;
        c.stroke();
        c.setLineDash([]);
        c.fillStyle = '#ffb02e';
        c.beginPath();
        c.arc(mx(d.gate.x), mz(d.gate.z), 5, 0, Math.PI * 2);
        c.fill();
      }
      c.font = '600 16px system-ui, sans-serif';
      c.fillStyle = locked ? '#ffb02e' : '#2ee6ff';
      c.fillText(d.name, mx(d.cx), mz(d.cz) - 4);
      c.font = '13px system-ui, sans-serif';
      c.fillStyle = 'rgba(255,255,255,0.7)';
      c.fillText(locked ? `🔒 ouverture au niveau ${d.unlockLevel}` : '', mx(d.cx), mz(d.cz) + 15);
    }

    // Lieux : garage, pastilles de course (pleines = faites, creuses = à faire), colis.
    const places: MapPlace[] = [];
    const hover = this.drag?.moved ? null : this.placeAt(this.mouse.x, this.mouse.y);
    const names = k > 0.55;
    const label = (text: string, x: number, y: number, color: string, strong: boolean): void => {
      c.font = `${strong ? '600 13px' : '12px'} system-ui, sans-serif`;
      c.lineWidth = 3;
      c.strokeStyle = 'rgba(7, 6, 15, 0.9)';
      c.strokeText(text, x, y);
      c.fillStyle = color;
      c.fillText(text, x, y);
    };
    let made = 0;
    if (!s.racing) {
      if (this.home) {
        places.push({ x: this.home.x, z: this.home.z, name: 'Garage', kind: 'garage' });
        c.save();
        c.translate(mx(this.home.x), mz(this.home.z));
        drawHouse(c, 11);
        c.restore();
        label('Garage', mx(this.home.x), mz(this.home.z) - 16, '#ffd23e', true);
      }
      for (const m of this.markers) {
        const place = s.done[m.name];
        const done = place !== undefined;
        if (done) made++;
        // Course dans un quartier encore fermé : estompée, et on ne peut pas s'y rendre.
        const closed = !s.allOpen && (m.districts ?? []).some((d) => d >= 0 && s.level < (this.city.graph.districts[d]?.unlockLevel ?? 0));
        if (closed) {
          c.globalAlpha = 0.35;
          c.beginPath();
          c.arc(mx(m.x), mz(m.z), 6, 0, Math.PI * 2);
          c.strokeStyle = m.circuit ? '#ff2d95' : '#2ee6ff';
          c.lineWidth = 2;
          c.stroke();
          c.globalAlpha = 1;
          continue;
        }
        const col = m.circuit ? '#ff2d95' : '#2ee6ff';
        const p: MapPlace = { x: m.x, z: m.z, name: m.name, kind: m.circuit ? 'circuit' : 'course' };
        places.push(p);
        const x = mx(m.x), y = mz(m.z);
        const isHover = hover !== null && hover.name === m.name && hover.kind === p.kind;
        const r = isHover ? 10 : 8;
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fillStyle = done ? col : '#0b0b16';
        c.fill();
        c.lineWidth = done ? 2 : 3;
        c.strokeStyle = done ? '#0b0b16' : col;
        c.stroke();
        if (done) {
          // au centre : la couleur de la médaille (ou un point sombre si pas de podium)
          c.beginPath();
          c.arc(x, y, 3.6, 0, Math.PI * 2);
          c.fillStyle = MEDAL[(place as number) - 1] ?? '#0b0b16';
          c.fill();
        }
        if (names || isHover) label(m.name, x, y - 13, done ? 'rgba(255,255,255,0.6)' : '#ffffff', !done);
      }
      for (const q of s.parcels) {
        places.push({ x: q.x, z: q.z, name: q.name, kind: 'colis' });
        const x = mx(q.x), y = mz(q.z);
        c.fillStyle = '#ffa31a';
        c.strokeStyle = '#0b0b16';
        c.lineWidth = 1.5;
        c.fillRect(x - 7, y - 7, 14, 14);
        c.strokeRect(x - 7, y - 7, 14, 14);
        if (names) label(`📦 ${q.name}`, x, y - 12, '#ffc266', false);
      }
      if (s.goal) {
        c.fillStyle = '#40ff73';
        c.beginPath();
        c.arc(mx(s.goal.x), mz(s.goal.z), 9, 0, Math.PI * 2);
        c.fill();
        label(`Arrivée : ${s.goal.name}`, mx(s.goal.x), mz(s.goal.z) - 14, '#40ff73', true);
      }
      if (s.target) {
        c.strokeStyle = '#ffffff';
        c.lineWidth = 2;
        c.setLineDash([4, 4]);
        c.beginPath();
        c.arc(mx(s.target.x), mz(s.target.z), 15, 0, Math.PI * 2);
        c.stroke();
        c.setLineDash([]);
      }
    }
    this.places = places;
    this.canvas.style.cursor = this.drag?.moved ? 'grabbing' : hover ? 'pointer' : 'grab';

    // Autres joueurs
    for (const q of s.players) {
      c.fillStyle = '#ffffff';
      c.strokeStyle = '#2ee6ff';
      c.lineWidth = 2.5;
      c.beginPath();
      c.arc(mx(q.x), mz(q.z), 6, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      label(q.name, mx(q.x), mz(q.z) - 11, '#ffffff', false);
    }

    // Joueur : flèche dans le sens de marche
    const px = mx(s.x), pz = mz(s.z);
    const hx = Math.sin(s.yaw), hz = Math.cos(s.yaw);
    c.fillStyle = '#ffffff';
    c.strokeStyle = '#ff2d95';
    c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(px + hx * 14, pz + hz * 14);
    c.lineTo(px - hx * 9 + hz * 9, pz - hz * 9 - hx * 9);
    c.lineTo(px - hx * 3, pz - hz * 3);
    c.lineTo(px - hx * 9 - hz * 9, pz - hz * 9 + hx * 9);
    c.closePath();
    c.fill();
    c.stroke();

    // Bandeaux : compteur en haut, mode d'emploi en bas.
    c.fillStyle = 'rgba(7, 6, 15, 0.8)';
    c.fillRect(0, H - 40, W, 40);
    c.font = '13px system-ui, sans-serif';
    c.fillStyle = 'rgba(255,255,255,0.78)';
    c.fillText('Glisser : déplacer   ·   Molette ou + − : zoom   ·   0 ou double-clic : revenir à la voiture   ·   Clic sur un lieu : itinéraire (clic droit : l’effacer)   ·   Tab : fermer', W / 2, H - 15);
    c.textAlign = 'left';
    c.font = '600 14px system-ui, sans-serif';
    const head = s.racing ? 'Course en cours' : `Courses faites : ${made} / ${this.markers.length}      ● pleine : faite   ○ creuse : à faire      cyan : course · magenta : circuit · carré ambre : colis`;
    c.lineWidth = 4;
    c.strokeStyle = 'rgba(7, 6, 15, 0.9)';
    c.strokeText(head, 20, 30);
    c.fillStyle = '#ffffff';
    c.fillText(head, 20, 30);
    if (s.target) {
      const t = `Itinéraire vers : ${s.target.name}`;
      c.strokeText(t, 20, 54);
      c.fillStyle = '#2ee6ff';
      c.fillText(t, 20, 54);
    }
  }

  /** Dernier état dessiné (pour les essais). */
  get state(): { cx: number; cz: number; scale: number; places: number } {
    return { cx: this.cx, cz: this.cz, scale: this.scale, places: this.places.length + (this.last ? 0 : 0) };
  }
}
