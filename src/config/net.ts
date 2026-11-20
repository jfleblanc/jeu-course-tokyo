/** Multijoueur et classement partagé : où est le serveur, à quel rythme on se parle. */
const params = new URLSearchParams(location.search);
const here = location.hostname === 'course.jfleblanc.com';

export const NET = {
  /** Serveur (HTTP) : le site lui-même quand on joue sur course.jfleblanc.com ; « ?serveur=http://localhost:8787 » pour un essai local. */
  server: params.get('serveur') ?? (here ? location.origin : 'https://course.jfleblanc.com'),
  /** Envois de la position par seconde. */
  sendHz: 12,
  /** Les autres voitures sont placées là où elles doivent être maintenant (dernier état reçu, prolongé par sa vitesse, au plus ce temps en s)… */
  extrapolate: 0.3,
  /** … et l'affichage rejoint cette position en douceur (1/s : plus c'est grand, plus c'est vif, mais saccadé). */
  smooth: 16,
  /** Une voiture qui saute de plus de cette distance (m) d'un coup (replacement, départ de course) reste traversable ce temps (s). */
  jump: 8,
  ghostSeconds: 1.2,
  /** Rayon autour d'une borne de départ (m) dans lequel les joueurs sont embarqués dans la course. */
  joinRadius: 12,
  /** Compte à rebours d'une course à plusieurs (s). */
  countdown: 6,
  /** Envois de l'avancée en course par seconde. */
  progressHz: 5,
} as const;
