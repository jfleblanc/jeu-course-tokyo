import type { CityData } from '../world/cityGen';
import type { Race } from '../race/race';
import type { Vehicle } from '../vehicle/vehicle';

/**
 * Mini-carte en bas à droite : la carte tourne pour que la voiture pointe toujours vers le haut.
 * Le plan de la ville est dessiné une seule fois ; à chaque image on n'en affiche qu'un morceau.
 */
const SIZE = 210;
/** Pixels par mètre du plan pré-dessiné. */
let PX = 0.75;
/** Rayon de terrain visible (m). */
const VIEW = 260;

const ROAD_COLOR = { boulevard: '#8a6f9c', avenue: '#77809c', street: '#5d6680', alley: '#474e66' } as const;

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  private readonly routeLayer: HTMLCanvasElement;
  private readonly ox: number;
  private readonly oz: number;
  private routeGeneration = -1;
  private timer = 0;

  constructor(
    private readonly city: CityData,
    /** Bornes de départ des courses, affichées en balade libre. */
    private readonly markers: { x: number; z: number; circuit: boolean }[] = [],
  ) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'minimap';
    this.canvas.width = SIZE * dpr;
    this.canvas.height = SIZE * dpr;
    this.canvas.style.width = `${SIZE}px`;
    this.canvas.style.height = `${SIZE}px`;
    document.body.append(this.canvas);
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.ctx.scale(dpr, dpr);

    const b = city.bounds;
    // Grande ville : on réduit l'échelle du plan pour ne pas dépasser environ 2000 pixels de côté.
    PX = Math.min(0.75, 2000 / Math.max(b.x1 - b.x0, b.z1 - b.z0));
    this.ox = b.x0;
    this.oz = b.z0;
    const w = Math.ceil((b.x1 - b.x0) * PX), h = Math.ceil((b.z1 - b.z0) * PX);
    this.base = document.createElement('canvas');
    this.base.width = w;
    this.base.height = h;
    this.routeLayer = document.createElement('canvas');
    this.routeLayer.width = w;
    this.routeLayer.height = h;
    this.drawBase();
  }

  /** Plan pré-dessiné et échelle, pour la carte complète (touche Tab). */
  get layers(): { base: HTMLCanvasElement; route: HTMLCanvasElement; ox: number; oz: number; px: number } {
    return { base: this.base, route: this.routeLayer, ox: this.ox, oz: this.oz, px: PX };
  }

  private mx(x: number): number {
    return (x - this.ox) * PX;
  }
  private mz(z: number): number {
    return (z - this.oz) * PX;
  }

  private drawBase(): void {
    const c = this.base.getContext('2d') as CanvasRenderingContext2D;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    // Autoroute de ceinture (plus claire quand elle est surélevée)
    const rs = this.city.ringway.samples;
    for (let i = 0; i < rs.length; i += 2) {
      const a = rs[i], b = rs[(i + 2) % rs.length];
      if (!a || !b) continue;
      c.strokeStyle = a.y > 4 ? '#3f8fb8' : '#2a6687';
      c.lineWidth = this.city.ringway.halfWidth * 2 * PX;
      c.beginPath();
      c.moveTo(this.mx(a.x), this.mz(a.z));
      c.lineTo(this.mx(b.x), this.mz(b.z));
      c.stroke();
    }
    c.strokeStyle = '#2a6687';
    for (const con of this.city.connectors) {
      c.lineWidth = con.width * PX;
      c.beginPath();
      for (let k = 0; k < con.pts.length; k += 2) {
        const x = this.mx(con.pts[k] as number), z = this.mz(con.pts[k + 1] as number);
        if (k === 0) c.moveTo(x, z);
        else c.lineTo(x, z);
      }
      c.stroke();
    }
    // Ponts d'accès
    c.strokeStyle = '#3f8fb8';
    for (const br of this.city.bridges) {
      c.lineWidth = Math.max(2, br.halfWidth * 2 * PX);
      c.beginPath();
      br.samples.forEach((p, k) => {
        if (k === 0) c.moveTo(this.mx(p.x), this.mz(p.z));
        else c.lineTo(this.mx(p.x), this.mz(p.z));
      });
      c.stroke();
    }
    // Route de montagne
    if (this.city.mountain) {
      c.strokeStyle = '#7a8f6a';
      c.lineWidth = Math.max(2, this.city.mountain.road.halfWidth * 2 * PX);
      c.beginPath();
      this.city.mountain.road.samples.forEach((p, k) => {
        if (k === 0) c.moveTo(this.mx(p.x), this.mz(p.z));
        else c.lineTo(this.mx(p.x), this.mz(p.z));
      });
      c.stroke();
    }
    // Rues, des plus petites aux plus grandes
    const order = ['alley', 'street', 'avenue', 'boulevard'] as const;
    for (const kind of order) {
      c.strokeStyle = ROAD_COLOR[kind];
      for (const e of this.city.graph.edges) {
        if (e.kind !== kind) continue;
        c.lineWidth = Math.max(2, e.width * PX);
        c.beginPath();
        for (let k = 0; k < e.pts.length; k += 2) {
          const x = this.mx(e.pts[k] as number), z = this.mz(e.pts[k + 1] as number);
          if (k === 0) c.moveTo(x, z);
          else c.lineTo(x, z);
        }
        c.stroke();
      }
    }
    // Autoroute centrale, en pointillé
    c.strokeStyle = '#4fb3de';
    c.lineWidth = 3;
    c.setLineDash([6, 5]);
    c.beginPath();
    this.city.highway.samples.forEach((p, k) => {
      if (k === 0) c.moveTo(this.mx(p.x), this.mz(p.z));
      else c.lineTo(this.mx(p.x), this.mz(p.z));
    });
    c.stroke();
    c.setLineDash([]);
  }

  private drawRoute(race: Race): void {
    const c = this.routeLayer.getContext('2d') as CanvasRenderingContext2D;
    c.clearRect(0, 0, this.routeLayer.width, this.routeLayer.height);
    const route = race.route;
    if (!route) return;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const n = route.lapPoints;
    for (const [color, width] of [['rgba(0,0,0,0.55)', 9], ['#ffb02e', 5]] as const) {
      c.strokeStyle = color;
      c.lineWidth = width;
      c.beginPath();
      for (let k = 0; k < n; k += 2) {
        const p = route.points[k];
        if (!p) continue;
        if (k === 0) c.moveTo(this.mx(p.x), this.mz(p.z));
        else c.lineTo(this.mx(p.x), this.mz(p.z));
      }
      c.stroke();
    }
    // Arrivée
    const end = route.points[n - 1];
    if (end) {
      c.fillStyle = '#ff2d95';
      c.beginPath();
      c.arc(this.mx(end.x), this.mz(end.z), 7, 0, Math.PI * 2);
      c.fill();
    }
  }

  /** Livraisons : colis proposés, arrivée en cours et chemin conseillé (x, z, x, z…). */
  parcels: { x: number; z: number }[] = [];
  goal: { x: number; z: number } | null = null;
  guide: number[] = [];

  update(dt: number, car: Vehicle, race: Race): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1 / 30;
    if (race.generation !== this.routeGeneration || (!race.active && this.routeGeneration >= 0)) {
      this.routeGeneration = race.active ? race.generation : -1;
      this.drawRoute(race);
    }
    const c = this.ctx;
    const half = SIZE / 2;
    c.clearRect(0, 0, SIZE, SIZE);
    c.save();
    c.beginPath();
    c.arc(half, half, half - 2, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = 'rgba(12, 10, 26, 0.82)';
    c.fillRect(0, 0, SIZE, SIZE);
    // La voiture est un peu sous le centre : on voit plus loin devant que derrière.
    const cy = half + 34;
    const zoom = half / (VIEW * PX);
    c.translate(half, cy);
    c.rotate(car.yaw - Math.PI);
    c.scale(zoom, zoom);
    c.translate(-this.mx(car.pos.x), -this.mz(car.pos.z));
    c.drawImage(this.base, 0, 0);
    // Le garage du joueur : une petite maison, toujours droite.
    const home = this.city.garage;
    if (home) {
      c.save();
      c.translate(this.mx(home.x), this.mz(home.z));
      c.rotate(-(car.yaw - Math.PI));
      c.scale(1 / zoom, 1 / zoom);
      drawHouse(c, 8);
      c.restore();
    }
    if (!race.active) {
      for (const m of this.markers) {
        c.fillStyle = m.circuit ? '#ff2d95' : '#2ee6ff';
        c.strokeStyle = '#0b0b16';
        c.lineWidth = 1.5 / zoom;
        c.beginPath();
        c.arc(this.mx(m.x), this.mz(m.z), 6 / zoom, 0, Math.PI * 2);
        c.fill();
        c.stroke();
      }
    }
    if (!race.active) {
      // Livraison : chemin conseillé, colis à prendre (carrés ambre), arrivée (rond vert).
      if (this.guide.length >= 4) {
        c.strokeStyle = 'rgba(80, 255, 130, 0.85)';
        c.lineWidth = 4 / zoom;
        c.lineJoin = 'round';
        c.beginPath();
        for (let k = 0; k < this.guide.length; k += 2) {
          const gx = this.mx(this.guide[k] as number), gz = this.mz(this.guide[k + 1] as number);
          if (k === 0) c.moveTo(gx, gz); else c.lineTo(gx, gz);
        }
        c.stroke();
      }
      c.strokeStyle = '#0b0b16';
      c.lineWidth = 1.5 / zoom;
      for (const p of this.parcels) {
        const s = 6 / zoom;
        c.fillStyle = '#ffa31a';
        c.fillRect(this.mx(p.x) - s, this.mz(p.z) - s, s * 2, s * 2);
        c.strokeRect(this.mx(p.x) - s, this.mz(p.z) - s, s * 2, s * 2);
      }
      if (this.goal) {
        c.fillStyle = '#40ff73';
        c.beginPath();
        c.arc(this.mx(this.goal.x), this.mz(this.goal.z), 8 / zoom, 0, Math.PI * 2);
        c.fill();
        c.stroke();
      }
    }
    if (race.active && race.route) {
      c.drawImage(this.routeLayer, 0, 0);
      const route = race.route;
      const player = race.player;
      // Prochain point de passage
      if (player && player.nextCheckpoint < route.checkpoints.length) {
        const p = route.points[route.checkpoints[player.nextCheckpoint] as number];
        if (p) {
          c.strokeStyle = '#2ee6ff';
          c.lineWidth = 3 / zoom;
          c.beginPath();
          c.arc(this.mx(p.x), this.mz(p.z), 9 / zoom, 0, Math.PI * 2);
          c.stroke();
        }
      }
      // Objets à ramasser
      for (const pk of race.pickups) {
        if (pk.taken) continue;
        c.fillStyle = pk.kind === 'cash' ? '#ffd24a' : '#c86bff';
        c.beginPath();
        c.arc(this.mx(pk.x), this.mz(pk.z), 3.5 / zoom, 0, Math.PI * 2);
        c.fill();
      }
      // Adversaires
      for (const r of race.racers) {
        if (r.isPlayer) continue;
        const col = r.level ? r.level.color : [1, 1, 1];
        c.fillStyle = `rgb(${Math.round(60 + (col[0] as number) * 195)}, ${Math.round(60 + (col[1] as number) * 195)}, ${Math.round(60 + (col[2] as number) * 195)})`;
        c.strokeStyle = '#000';
        c.lineWidth = 1.2 / zoom;
        c.beginPath();
        c.arc(this.mx(r.car.pos.x), this.mz(r.car.pos.z), 5 / zoom, 0, Math.PI * 2);
        c.fill();
        c.stroke();
      }
    }
    c.restore();
    // Voiture du joueur : flèche fixe, pointe vers le haut
    c.save();
    c.translate(half, cy);
    c.fillStyle = '#fff';
    c.strokeStyle = '#ff2d95';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, -9);
    c.lineTo(6.5, 7);
    c.lineTo(0, 3.5);
    c.lineTo(-6.5, 7);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
    // Cadre
    c.strokeStyle = 'rgba(255,255,255,0.22)';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(half, half, half - 2, 0, Math.PI * 2);
    c.stroke();
  }
}

/** Dessine une petite maison centrée sur l'origine (repère du garage sur les cartes). */
export function drawHouse(c: CanvasRenderingContext2D, size: number): void {
  const s = size;
  c.beginPath();
  c.moveTo(0, -s);
  c.lineTo(s, -s * 0.1);
  c.lineTo(s * 0.68, -s * 0.1);
  c.lineTo(s * 0.68, s * 0.8);
  c.lineTo(-s * 0.68, s * 0.8);
  c.lineTo(-s * 0.68, -s * 0.1);
  c.lineTo(-s, -s * 0.1);
  c.closePath();
  c.fillStyle = '#ffd23e';
  c.strokeStyle = '#0b0b16';
  c.lineWidth = Math.max(1.2, s * 0.18);
  c.lineJoin = 'round';
  c.stroke();
  c.fill();
  c.fillStyle = '#0b0b16';
  c.fillRect(-s * 0.2, s * 0.2, s * 0.4, s * 0.6);
}
