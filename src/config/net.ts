/** Multijoueur et classement partagé : où est le serveur, à quel rythme on se parle. */
const params = new URLSearchParams(location.search);
const here = location.hostname === 'course.jfleblanc.com';

export const NET = {
  /** Serveur (HTTP) : le site lui-même quand on joue sur course.jfleblanc.com ; « ?serveur=http://localhost:8787 » pour un essai local. */
  server: params.get('serveur') ?? (here ? location.origin : 'https://course.jfleblanc.com'),
  /** Envois de la position par seconde. */
  sendHz: 12,
  /** Les autres voitures sont affichées avec ce retard (s), pour lisser entre deux messages. */
  delay: 0.13,
  /** Au-delà de ce silence (s), on prolonge le mouvement d'après la dernière vitesse connue, puis on fige. */
  extrapolate: 0.3,
  /** Rayon autour d'une borne de départ (m) dans lequel les joueurs sont embarqués dans la course. */
  joinRadius: 12,
  /** Compte à rebours d'une course à plusieurs (s). */
  countdown: 6,
  /** Envois de l'avancée en course par seconde. */
  progressHz: 5,
} as const;
