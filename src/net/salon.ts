import { NET } from '../config/net';

/** Un autre joueur du salon, tel qu'on le connaît par ses messages. */
export interface Peer {
  id: number;
  name: string;
  symbol: string;
  car: { model: string; paint: number; neon: number } | null;
  /** Derniers états reçus : instant de réception (s) puis x, y, z, qx, qy, qz, qw, vx, vy, vz, volant, drapeaux. */
  samples: number[][];
  /** Vrai : il est dans son garage (chacun a le sien : on ne l'affiche pas). */
  hidden: boolean;
}

export type SalonEvent =
  | { type: 'arrive' | 'part' | 'voiture'; peer: Peer }
  | { type: 'course'; from: number; track: string; players: number[]; startAt: number }
  | { type: 'progres'; from: number; progress: number; finished: boolean; time: number }
  | { type: 'ferme'; reason: string };

/** États gardés par joueur (un peu plus d'une demi-seconde). */
const KEEP = 10;

/**
 * Connexion à un salon : un code de 4 lettres, jusqu'à 4 joueurs. Le serveur ne fait que relayer :
 * chacun calcule sa voiture et envoie son état ; on affiche celles des autres (voitures « fantômes »,
 * sans collision entre joueurs).
 */
export class Salon {
  code = '';
  id = 0;
  connected = false;
  readonly peers = new Map<number, Peer>();
  readonly events: SalonEvent[] = [];
  private ws: WebSocket | null = null;
  /** Heure du serveur − heure locale (ms). */
  private offset = 0;
  /** Meilleur aller-retour mesuré (ms) : l'horloge est calée sur l'échange le plus rapide. */
  private bestRtt = Infinity;

  /** Heure du serveur, estimée (ms). */
  serverNow(): number {
    return Date.now() + this.offset;
  }

  static randomCode(): string {
    const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ'; // sans I, O, Q : trop faciles à confondre
    let c = '';
    for (let k = 0; k < 4; k++) c += letters[Math.floor(Math.random() * letters.length)];
    return c;
  }

  connect(code: string, name: string, symbol: string): Promise<void> {
    this.leave();
    return new Promise((resolve, reject) => {
      const base = NET.server.replace(/^http/, 'ws');
      let ws: WebSocket;
      try {
        ws = new WebSocket(`${base}/salon/${encodeURIComponent(code)}?nom=${encodeURIComponent(name)}&symbole=${encodeURIComponent(symbol)}`);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      let settled = false;
      const fail = (why: string): void => {
        if (!settled) { settled = true; reject(new Error(why)); }
      };
      const timer = setTimeout(() => { fail('Le serveur ne répond pas.'); ws.close(); }, 8000);
      ws.onmessage = (ev) => {
        let m: Record<string, unknown>;
        try { m = JSON.parse(String(ev.data)) as Record<string, unknown>; } catch { return; }
        if (m.t === 'bienvenue') {
          clearTimeout(timer);
          this.ws = ws;
          this.code = code;
          this.id = Number(m.id);
          this.offset = Number(m.heure) - Date.now();
          this.connected = true;
          this.peers.clear();
          for (const j of (m.joueurs as { id: number; nom: string; symbole: string; voiture: { modele: string; peinture: number; neon: number } | null }[]) ?? []) {
            this.peers.set(j.id, { id: j.id, name: j.nom, symbol: j.symbole, car: j.voiture ? { model: j.voiture.modele, paint: j.voiture.peinture, neon: j.voiture.neon } : null, samples: [], hidden: true });
          }
          // Horloge : quelques échanges pour estimer l'heure du serveur au plus juste (départs synchronisés).
          this.bestRtt = Infinity;
          for (let k = 0; k < 4; k++) setTimeout(() => this.send({ t: 'ping', c: Date.now() }), 200 + k * 700);
          settled = true;
          resolve();
          return;
        }
        this.receive(m);
      };
      ws.onerror = () => fail('Connexion impossible (salon plein, ou serveur injoignable).');
      ws.onclose = () => {
        clearTimeout(timer);
        fail('Connexion refusée (salon plein ?).');
        if (this.ws === ws) {
          this.ws = null;
          this.connected = false;
          this.peers.clear();
          this.events.push({ type: 'ferme', reason: 'La connexion au salon est coupée.' });
        }
      };
    });
  }

  leave(): void {
    const ws = this.ws;
    this.ws = null;
    this.connected = false;
    this.peers.clear();
    this.code = '';
    if (ws) { ws.onclose = null; ws.close(); }
  }

  private receive(m: Record<string, unknown>): void {
    if (m.t === 'pong') {
      const now = Date.now(), rtt = now - Number(m.c);
      if (rtt >= 0 && rtt < this.bestRtt) { this.bestRtt = rtt; this.offset = Number(m.heure) + rtt / 2 - now; }
      return;
    }
    const id = Number(m.id);
    if (m.t === 'arrive') {
      const peer: Peer = { id, name: String(m.nom), symbol: String(m.symbole), car: null, samples: [], hidden: true };
      this.peers.set(id, peer);
      this.events.push({ type: 'arrive', peer });
      return;
    }
    if (m.t === 'course') {
      this.events.push({ type: 'course', from: id, track: String(m.piste), players: (m.joueurs as number[]) ?? [], startAt: Number(m.heure) + Number(m.delai) * 1000 });
      return;
    }
    const peer = this.peers.get(id);
    if (!peer) return;
    if (m.t === 'part') {
      this.peers.delete(id);
      this.events.push({ type: 'part', peer });
    } else if (m.t === 'voiture') {
      peer.car = { model: String(m.modele), paint: Number(m.peinture), neon: Number(m.neon) };
      this.events.push({ type: 'voiture', peer });
    } else if (m.t === 'e') {
      const d = m.d as number[];
      if (!Array.isArray(d) || d.length < 12) return;
      peer.samples.push([performance.now() / 1000, ...d]);
      if (peer.samples.length > KEEP) peer.samples.shift();
      peer.hidden = ((d[11] as number) & 1) === 1;
    } else if (m.t === 'progres') {
      this.events.push({ type: 'progres', from: id, progress: Number(m.p), finished: m.f === true, time: Number(m.tm) });
    }
  }

  send(message: Record<string, unknown>): void {
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }
}
