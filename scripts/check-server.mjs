// Vérifie le serveur en ligne (https://course.jfleblanc.com) : page du jeu, classement, salon à deux.
//   node scripts/check-server.mjs [adresse]
// Lancé par la CI après chaque mise en ligne ; n'empêche pas la publication s'il échoue.
const base = process.argv[2] ?? 'https://course.jfleblanc.com';
const out = [];
let failed = false;
const check = (name, ok, detail = '') => { out.push(`${ok ? 'OK    ' : 'ÉCHEC '} ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed = true; };

try {
  const r = await fetch(`${base}/api/sante`);
  const j = await r.json();
  check('/api/sante', r.ok && j.ok === true, `joueurs max ${j.joueursMax}`);
} catch (e) { check('/api/sante', false, String(e)); }

try {
  const r = await fetch(`${base}/`);
  const t = await r.text();
  check('page du jeu', r.ok && t.includes('<canvas') || t.includes('script'), `${r.status}, ${t.length} octets`);
  const m = /src="([^"]+\.js)"/.exec(t);
  if (m) { const a = await fetch(new URL(m[1], `${base}/`)); check('script du jeu', a.ok, `${m[1]} → ${a.status}`); }
  const g = await fetch(`${base}/models/kaku-anims.json`);
  check('fichier de modèle', g.ok, String(g.status));
} catch (e) { check('page du jeu', false, String(e)); }

try {
  const r = await fetch(`${base}/api/records`);
  const j = await r.json();
  check('/api/records (lecture)', r.ok && typeof j.table === 'object', `${Object.keys(j.table ?? {}).length} classements`);
  const p = await fetch(`${base}/api/records`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cle: 'essai|verification du serveur', points: false, ligne: { player: 'Robot', symbol: 'ろ', car: 'Essai', value: 99.9, date: new Date().toISOString().slice(0, 10) } }) });
  const pj = await p.json();
  check('/api/records (écriture)', p.ok && Array.isArray(pj.liste) && pj.liste.length > 0);
} catch (e) { check('/api/records', false, String(e)); }

// Salon : deux joueurs, le second doit voir le premier, et recevoir son état.
try {
  const code = 'ZZ' + String.fromCharCode(65 + Math.floor(Math.random() * 26)) + String.fromCharCode(65 + Math.floor(Math.random() * 26));
  const ws = (nom) => new WebSocket(`${base.replace(/^http/, 'ws')}/salon/${code}?nom=${nom}&symbole=x`);
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('pas de réponse en 12 s')), 12000);
    const seen = { bienvenueA: false, bienvenueB: false, arrive: false, etat: false, course: false, pong: false };
    const a = ws('Alice');
    let b = null;
    const done = () => { if (Object.values(seen).every(Boolean)) { clearTimeout(timer); a.close(); b?.close(); resolve(seen); } };
    a.onerror = () => reject(new Error('connexion A refusée'));
    a.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === 'bienvenue') {
        seen.bienvenueA = m.id === 1;
        b = ws('Bob');
        b.onerror = () => reject(new Error('connexion B refusée'));
        b.onmessage = (ev2) => {
          const n = JSON.parse(ev2.data);
          if (n.t === 'bienvenue') { seen.bienvenueB = n.id === 2 && n.joueurs.length === 1 && n.joueurs[0].nom === 'Alice'; b.send(JSON.stringify({ t: 'ping', c: Date.now() })); }
          if (n.t === 'pong') seen.pong = typeof n.heure === 'number';
          if (n.t === 'e') seen.etat = n.id === 1 && n.d.length === 12;
          if (n.t === 'course') seen.course = typeof n.heure === 'number' && n.piste === 'essai';
          done();
        };
      }
      if (m.t === 'arrive') {
        seen.arrive = m.nom === 'Bob';
        a.send(JSON.stringify({ t: 'e', d: [1, 2, 3, 0, 0, 0, 1, 0, 0, 0, 0, 0] }));
        a.send(JSON.stringify({ t: 'course', piste: 'essai', joueurs: [1, 2], delai: 6 }));
      }
      done();
    };
    setTimeout(() => reject(new Error('incomplet : ' + JSON.stringify(seen))), 11000);
  });
  check('salon à deux (WebSocket)', true, Object.keys(result).join(', '));
} catch (e) { check('salon à deux (WebSocket)', false, String(e.message ?? e)); }

console.log(`Serveur ${base}\n` + out.join('\n'));
process.exit(failed ? 1 : 0);
