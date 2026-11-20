// Serveur d'essai local (mêmes règles que le serveur en ligne) :  node server/dev-server.mjs [port]
// Demande le paquet « ws » (npm i ws). Le jeu s'y connecte avec  ?serveur=ws://localhost:8787
import http from 'node:http';
import { createRequire } from 'node:module';
import { CODE_VALIDE, ficheJoueur, inscrire, ligneValide, numeroLibre, traiter } from './protocole.js';

const require = createRequire(import.meta.url);
let WebSocketServer;
try { ({ WebSocketServer } = require('ws')); } catch { ({ WebSocketServer } = createRequire('/opt/npm-tools/')('ws')); }

const salons = new Map(); // code → Set de { ws, fiche }
let table = {};
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'content-type': 'application/json' };
const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  if (req.url.startsWith('/api/records')) {
    if (req.method === 'GET') { res.writeHead(200, cors); res.end(JSON.stringify({ version: 1, table })); return; }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let v = null;
      try { v = ligneValide(JSON.parse(body)); } catch { v = null; }
      if (!v) { res.writeHead(400, cors); res.end('{}'); return; }
      table = inscrire(table, v.cle, v.ligne, v.points);
      res.writeHead(200, cors);
      res.end(JSON.stringify({ version: 1, cle: v.cle, liste: table[v.cle] }));
    });
    return;
  }
  res.writeHead(404, cors);
  res.end('{}');
});
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  const code = url.pathname.startsWith('/salon/') ? url.pathname.slice(7).toUpperCase() : '';
  if (!CODE_VALIDE.test(code)) { socket.destroy(); return; }
  if (!salons.has(code)) salons.set(code, new Set());
  const salon = salons.get(code);
  const id = numeroLibre([...salon].map((j) => j.fiche));
  if (!id) { socket.write('HTTP/1.1 409 Conflict\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const moi = { ws, fiche: ficheJoueur(id, url.searchParams.get('nom'), url.searchParams.get('symbole')) };
    ws.send(JSON.stringify({ t: 'bienvenue', id, heure: Date.now(), joueurs: [...salon].map((j) => j.fiche) }));
    for (const j of salon) j.ws.send(JSON.stringify({ t: 'arrive', id, nom: moi.fiche.nom, symbole: moi.fiche.symbole }));
    salon.add(moi);
    ws.on('message', (data) => {
      const r = traiter(moi.fiche, data.toString(), Date.now());
      if (r.fiche) moi.fiche = r.fiche;
      if (r.reponse) ws.send(r.reponse);
      if (r.diffusion) for (const j of salon) if (r.aTous || j !== moi) j.ws.send(r.diffusion);
    });
    ws.on('close', () => {
      salon.delete(moi);
      for (const j of salon) j.ws.send(JSON.stringify({ t: 'part', id }));
    });
  });
});
const port = Number(process.argv[2] ?? 8787);
server.listen(port, () => console.log('Serveur d’essai sur le port ' + port));
