// Règles du salon multijoueur et du classement, sans rien de propre à Cloudflare : le même
// fichier sert au serveur en ligne (worker.js) et au serveur d'essai local (dev-server.mjs).
//
// Le serveur ne simule rien : il relaie. Chaque joueur calcule sa propre voiture et envoie son
// état une dizaine de fois par seconde ; les autres l'affichent.

export const MAX_JOUEURS = 4;
export const CODE_VALIDE = /^[A-Z]{4}$/;
const TAILLE_MAX = 2000;
/** Messages qu'un joueur peut envoyer et qui sont relayés aux autres. */
const RELAYES = new Set(['e', 'voiture', 'course', 'progres', 'annule']);

const texte = (v, max) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').slice(0, max);

/** Fiche d'un joueur à partir de ce qu'il annonce en se connectant. */
export function ficheJoueur(id, nom, symbole) {
  return { id, nom: texte(nom, 16) || 'Joueur', symbole: texte(symbole, 2) || '?', voiture: null };
}

/** Numéro libre le plus petit (1 à MAX_JOUEURS), ou 0 si le salon est plein. */
export function numeroLibre(presents) {
  for (let id = 1; id <= MAX_JOUEURS; id++) if (!presents.some((p) => p.id === id)) return id;
  return 0;
}

/**
 * Traite un message d'un joueur. Renvoie ce qu'il faut faire :
 *  - `reponse` : texte à renvoyer à ce joueur seulement ;
 *  - `diffusion` : texte à envoyer à tous les autres (`aTous` : à lui aussi) ;
 *  - `fiche` : sa fiche mise à jour (à mémoriser).
 */
export function traiter(joueur, brut, maintenant) {
  if (typeof brut !== 'string' || brut.length > TAILLE_MAX) return {};
  let m;
  try { m = JSON.parse(brut); } catch { return {}; }
  if (!m || typeof m.t !== 'string') return {};
  if (m.t === 'ping') return { reponse: JSON.stringify({ t: 'pong', c: m.c, heure: maintenant }) };
  if (!RELAYES.has(m.t)) return {};
  m.id = joueur.id;
  if (m.t === 'voiture') {
    const voiture = { modele: texte(m.modele, 24), peinture: Number(m.peinture) || -1, neon: Number(m.neon) || -1 };
    if (m.peinture === 0) voiture.peinture = 0;
    if (m.neon === 0) voiture.neon = 0;
    return { fiche: { ...joueur, voiture }, diffusion: JSON.stringify({ t: 'voiture', id: joueur.id, ...voiture }) };
  }
  if (m.t === 'course') {
    // Le départ est daté par le serveur : tout le monde part au même instant.
    m.heure = maintenant;
    return { diffusion: JSON.stringify(m), aTous: true };
  }
  return { diffusion: JSON.stringify(m) };
}

// ——— Classement partagé ———
const GARDER = 5;
const CLES_MAX = 400;

/** Vérifie et nettoie une ligne de classement envoyée par un joueur ; null si elle est invalide. */
export function ligneValide(corps) {
  if (!corps || typeof corps !== 'object') return null;
  const cle = texte(corps.cle, 90);
  const e = corps.ligne ?? {};
  const valeur = Number(e.value);
  if (!cle || !Number.isFinite(valeur) || valeur <= 0 || valeur > 1e7) return null;
  return {
    cle,
    points: corps.points === true,
    ligne: { player: texte(e.player, 16) || 'Joueur', symbol: texte(e.symbol, 2) || '?', car: texte(e.car, 40) || '?', value: Math.round(valeur * 1000) / 1000, date: texte(e.date, 10) },
  };
}

/** Ajoute une ligne à une table de classement (une ligne par joueur et par voiture, les 5 meilleures). */
export function inscrire(table, cle, ligne, points) {
  if (!(cle in table) && Object.keys(table).length >= CLES_MAX) return table;
  const liste = (table[cle] ?? []).slice();
  const mieux = (a, b) => (points ? a > b : a < b);
  const k = liste.findIndex((x) => x.player === ligne.player && x.car === ligne.car);
  if (k >= 0) {
    if (!mieux(ligne.value, liste[k].value)) return table;
    liste.splice(k, 1);
  }
  liste.push(ligne);
  liste.sort((a, b) => (points ? b.value - a.value : a.value - b.value));
  liste.length = Math.min(liste.length, GARDER);
  table[cle] = liste;
  return table;
}
