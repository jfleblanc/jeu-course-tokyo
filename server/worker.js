// Serveur du jeu de course, sur Cloudflare Workers : https://course.jfleblanc.com
//  - /salon/CODE   : salon multijoueur (WebSocket), un objet durable par code de 4 lettres ;
//  - /api/records  : classement des meilleurs temps, partagé entre tous les ordinateurs ;
//  - tout le reste : le jeu lui-même, servi depuis GitHub Pages (en attendant de l'héberger ici).
// Déploiement : voir server/README.md.
import { DurableObject } from 'cloudflare:workers';
import { CODE_VALIDE, MAX_JOUEURS, ficheJoueur, inscrire, ligneValide, numeroLibre, traiter } from './protocole.js';

const ORIGINE_DU_JEU = 'https://jfleblanc.github.io/jeu-course-tokyo';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
const json = (corps, status) => new Response(JSON.stringify(corps), { status: status || 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname.startsWith('/salon/')) {
      const code = url.pathname.slice(7).toUpperCase();
      if (!CODE_VALIDE.test(code)) return json({ erreur: 'Code de salon invalide (4 lettres).' }, 400);
      return env.SALONS.get(env.SALONS.idFromName(code)).fetch(request);
    }
    if (url.pathname === '/api/records') return env.CLASSEMENT.get(env.CLASSEMENT.idFromName('monde')).fetch(request);
    if (url.pathname === '/api/sante') return json({ ok: true, heure: Date.now(), joueursMax: MAX_JOUEURS });
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Méthode non permise', { status: 405 });
    // Le jeu : relais vers GitHub Pages, gardé deux minutes en cache à la périphérie.
    let chemin = url.pathname;
    if (chemin.startsWith('/jeu-course-tokyo')) chemin = chemin.slice('/jeu-course-tokyo'.length) || '/';
    const amont = await fetch(ORIGINE_DU_JEU + chemin + url.search, { method: request.method, cf: { cacheTtlByStatus: { '200-299': 120, '404': 5, '500-599': 0 } } });
    const reponse = new Response(amont.body, amont);
    reponse.headers.set('cache-control', chemin === '/' || chemin.endsWith('.html') ? 'no-cache' : 'public, max-age=300');
    return reponse;
  },
};

/** Un salon : jusqu'à MAX_JOUEURS joueurs reliés par WebSocket. Le salon s'endort quand personne ne parle. */
export class Salon extends DurableObject {
  joueurs(sauf) {
    const liste = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === sauf) continue;
      const fiche = ws.deserializeAttachment();
      if (fiche) liste.push({ ws, fiche });
    }
    return liste;
  }

  diffuser(texte, sauf) {
    for (const j of this.joueurs(sauf)) {
      try { j.ws.send(texte); } catch (e) { /* joueur parti entre-temps */ }
    }
  }

  async fetch(request) {
    if (request.headers.get('upgrade') !== 'websocket') return json({ joueurs: this.joueurs().map((j) => j.fiche) });
    const presents = this.joueurs().map((j) => j.fiche);
    const id = numeroLibre(presents);
    if (!id) return json({ erreur: 'Ce salon est plein.' }, 409);
    const url = new URL(request.url);
    const fiche = ficheJoueur(id, url.searchParams.get('nom'), url.searchParams.get('symbole'));
    const paire = new WebSocketPair();
    this.ctx.acceptWebSocket(paire[1]);
    paire[1].serializeAttachment(fiche);
    paire[1].send(JSON.stringify({ t: 'bienvenue', id, heure: Date.now(), joueurs: presents }));
    this.diffuser(JSON.stringify({ t: 'arrive', id, nom: fiche.nom, symbole: fiche.symbole }), paire[1]);
    return new Response(null, { status: 101, webSocket: paire[0] });
  }

  webSocketMessage(ws, message) {
    const fiche = ws.deserializeAttachment();
    if (!fiche) return;
    const r = traiter(fiche, message, Date.now());
    if (r.fiche) ws.serializeAttachment(r.fiche);
    if (r.reponse) ws.send(r.reponse);
    if (r.diffusion) this.diffuser(r.diffusion, r.aTous ? null : ws);
  }

  webSocketClose(ws) {
    const fiche = ws.deserializeAttachment();
    try { ws.close(); } catch (e) { /* déjà fermé */ }
    if (fiche) this.diffuser(JSON.stringify({ t: 'part', id: fiche.id }), ws);
  }

  webSocketError(ws) {
    this.webSocketClose(ws);
  }
}

/** Le classement : une seule table pour tout le monde, gardée dans le stockage de l'objet. */
export class Classement extends DurableObject {
  async fetch(request) {
    const table = (await this.ctx.storage.get('table')) || {};
    if (request.method === 'GET') return json({ version: 1, table });
    if (request.method !== 'POST') return json({ erreur: 'Méthode non permise' }, 405);
    let corps = null;
    try { corps = await request.json(); } catch (e) { corps = null; }
    const v = ligneValide(corps);
    if (!v) return json({ erreur: 'Ligne invalide' }, 400);
    inscrire(table, v.cle, v.ligne, v.points);
    await this.ctx.storage.put('table', table);
    return json({ version: 1, cle: v.cle, liste: table[v.cle] || [] });
  }
}
